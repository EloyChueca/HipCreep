// ============================================================
// HipCreep — one retrieved liner end-to-end, and a series of them
// ------------------------------------------------------------
// The same steps as the single-case report (deterministic table, Monte Carlo,
// sphere → plane elevation bound), reduced to the numbers needed to compare
// liners: penetration D, creep at explantation, remaining creep and wear in each
// recovery scenario, verdict, and the minimum creep from the elevations with its
// consistency with the model.
// ============================================================

import type { CaseInput } from './case.ts';
import type { Loading } from './laws.ts';
import { materialPreset, type MaterialId } from './materials.ts';
import { MODES, runDeterministic, runMonteCarlo, verdict, type McResult, type Verdict, type UncertaintyBudget } from './analysis.ts';
import { analyseSurface, elevationAnalysis, minCreepDepthUm, type ElevatedZone, type ElevationResult, type LoadZone } from './surface.ts';
import type { LoadedHipWearCase } from '../io/hipwear.ts';
import type { Stats } from './stats.ts';
import type { RecoveryScenario } from './recovery.ts';

/** Case inputs from the shared (form) inputs and what the HipWear file provides */
export function caseFromLoaded(base: CaseInput, L: LoadedHipWearCase): CaseInput {
  const c: CaseInput = structuredClone(base);
  c.caseId = L.caseId;
  if (L.implantMonths != null) c.implantMonths = +L.implantMonths.toFixed(3);
  if (L.exVivoDays != null) c.exVivoDays = L.exVivoDays;
  c.headDiameterMm = L.headDiameterMm;
  if (L.material) c.material = L.material;
  if (L.irradiation) c.irradiation = { ...L.irradiation };
  if (L.thicknessMm != null) c.thicknessMm = +L.thicknessMm.toFixed(3);
  if (L.thicknessSdMm != null) c.thicknessSdMm = L.thicknessSdMm;
  if (L.clearanceMm != null) {
    const cl = +L.clearanceMm.toFixed(4);
    c.clearance = { nominal: cl, lo: Math.max(0, +(cl - 0.03).toFixed(4)), hi: +(cl + 0.03).toFixed(4) };
  }
  if (L.loadAngleDeg != null) c.loadAngleDeg = +L.loadAngleDeg.toFixed(2);
  c.measured = L.measured;
  return c;
}

export type ElevationStatus = 'consistent' | 'median-below' | 'below';

/** Is the model's remaining creep compatible with the minimum creep given by the elevations? */
export function elevationStatus(minCreepUm: number, remaining: Stats): ElevationStatus {
  if (!(minCreepUm > 0)) return 'consistent';
  if (minCreepUm > remaining.p95) return 'below';
  if (minCreepUm > remaining.p50) return 'median-below';
  return 'consistent';
}

export interface ElevatedZoneResult extends ElevatedZone {
  volumeAboveNoiseMm3: number;
  thresholdUm: number;
  sigmaUm: number;
  /** Elevated volume with the reference radius ∓ its uncertainty: [low, high] (mm³) */
  volumeRangeMm3: [number, number];
  radiusUncUm: number;
  /** Load zone: half-angle (deg) about the load axis, or about the pole when the direction is unknown */
  zoneHalfAngleDeg: number;
  zoneAboutPole: boolean;
  /** Elevated volume outside the load zone, not counted (mm³) */
  excludedVolumeMm3: number;
  plausibility: Plausibility;
}

export interface Plausibility {
  ok: boolean;
  /** Short reasons (English) when not ok */
  flags: string[];
}

/** Default uncertainty of the reference radius for the range of the elevated volume (µm) */
export const RADIUS_UNC_UM = 5;

/** Margin added to the model's contact half-angle to define the load zone (deg) */
export const LOAD_ZONE_MARGIN_DEG = 15;

/**
 * Load zone for the elevations: the contact zone of the creep model (static, in vivo — the widest) plus a
 * margin, about the penetration direction; about the pole (adding the load angle) when the direction is
 * unknown or was rejected.
 */
export function loadZoneFor(c: CaseInput, L: LoadedHipWearCase, det: ReturnType<typeof runDeterministic>, marginDeg = LOAD_ZONE_MARGIN_DEG): LoadZone {
  const law = c.mcLaws[0] ?? c.laws[0];
  const rows = det.rows.filter((r) => r.temperature === 'in-vivo' && (r.law === law));
  const half = Math.max(...(rows.length ? rows : det.rows).map((r) => r.sim.contactHalfAngleFinalDeg));
  const aboutPole = !L.load || L.loadAngleDeg == null;
  return { halfAngleDeg: Math.min(180, half + marginDeg + (aboutPole ? c.loadAngleDeg : 0)), aboutPole };
}

/**
 * Is the elevated material plausible as creep? Not when it is more than the model's largest remaining
 * creep could displace (static, P95), when its highest point sits at the analysed edge, or when it is
 * not above the scanner noise.
 */
export function elevationPlausibility(e: ElevationResult, maxCreepVolumeMm3: number): Plausibility {
  const flags: string[] = [];
  const z = e.raw;
  if (!(e.nominal.netMm3 > 0.01)) flags.push('not above the scanner noise');
  if (maxCreepVolumeMm3 > 0 && e.nominal.netMm3 > maxCreepVolumeMm3)
    flags.push(`more than the largest creep volume the model allows (${maxCreepVolumeMm3.toFixed(2)} mm³): reference radius/centre or form error likely`);
  if (z.peakUm > 0 && z.peakThetaDeg > e.edgeThetaDeg - 10) flags.push('highest point at the trim edge (within 10°): possible rim artefact');
  return { ok: flags.length === 0, flags };
}

export interface SeriesModeResult {
  creep: Stats;
  remaining: Stats;
  wear: Stats | null;
  /** Remaining creep / D */
  creepShare: Stats | null;
  /** Remaining creep volume and volumetric wear (mm³) */
  creepVolRem: Stats;
  wearVol: Stats | null;
  byScenario: Partial<Record<RecoveryScenario, { remaining: Stats; wear: Stats | null; elevation: ElevationStatus | null; creepShare: Stats | null; creepVolRem: Stats; wearVol: Stats | null }>>;
  budget: UncertaintyBudget | null;
  /** Nominal creep model in vivo: peak contact pressure at the start and at explantation (MPa), contact half-angle
   *  at explantation (deg) and contact area (mm²), edge loading and pressure beyond the range of the law tests */
  contact: { peakInitialMPa: number; peakFinalMPa: number; halfAngleDeg: number; areaMm2: number; edgeLoading: boolean; beyondTestedPressure: boolean; maxLawStressMPa: number };
  verdict: Verdict | null;
}

/** Pressure range of the creep tests behind the Lee laws (MPa) */
export const LAW_TESTED_MAX_MPA = 8;

export interface SeriesResult {
  caseId: string;
  file: string;
  years: number;
  material: MaterialId;
  /** Label of the polyethylene (includes dose and treatment for the 'dose' grade) */
  materialLabel: string;
  bodyMassKg: number;
  exVivoDays: number;
  headDiameterMm: number;
  thicknessMm: number;
  measured: CaseInput['measured'];
  modes: Record<Loading, SeriesModeResult>;
  /** Minimum remaining creep from the elevations (µm), nominal and range; null without a mesh */
  elevationMinCreepUm: { nominal: number; lo: number; hi: number } | null;
  /** Measured elevated material around the load zone (no model): volume, area and peak above the original
   *  sphere, its range with the radius uncertainty, what was left out and a plausibility check; null without a mesh */
  elevatedZone: ElevatedZoneResult | null;
  /** Measured area penetrated beyond the noise threshold (mm²), null without a mesh */
  penetratedAreaMm2: number | null;
  warnings: string[];
  elapsedMs: number;
}

export async function runSeriesCase(
  c: CaseInput, L: LoadedHipWearCase, opt: { refRadius: 'measured' | 'commercial'; rimBandDeg: number; loadZoneMarginDeg?: number; radiusUncUm?: number },
): Promise<SeriesResult> {
  const t0 = performance.now();
  const det = runDeterministic(c);
  const mc: McResult = await runMonteCarlo(c);
  let elev: SeriesResult['elevationMinCreepUm'] = null;
  let zone: SeriesResult['elevatedZone'] = null;
  let elevResult: ElevationResult | null = null, zoneShape = 0, penArea: number | null = null;
  if (L.mesh) {
    const useMeasured = opt.refRadius === 'measured' && !!L.measuredRadiusMm;
    const R = useMeasured ? L.measuredRadiusMm! : L.commercialRadiusMm;
    const center = useMeasured && L.measuredCenter ? L.measuredCenter : L.center;
    const s = analyseSurface(L.mesh, { center, radiusMm: R, pole: L.pole, load: L.load });
    const lz = loadZoneFor(c, L, det, opt.loadZoneMarginDeg);
    const e = elevationAnalysis(s, L.noiseSigmaUm, L.surfaceUncertaintyUm, opt.rimBandDeg, { zone: lz, radiusUncUm: opt.radiusUncUm ?? RADIUS_UNC_UM });
    const row = det.rows.find((r) => r.law === (c.mcLaws[0] ?? c.laws[0]) && r.mode === 'dynamic' && r.temperature === 'in-vivo') ?? det.rows[0];
    const shape = row.sim.shapeAreaMm2;
    elev = { nominal: minCreepDepthUm(e.nominal.netMm3, shape), lo: minCreepDepthUm(e.netRangeMm3[0], shape), hi: minCreepDepthUm(e.netRangeMm3[1], shape) };
    elevResult = e;
    zoneShape = shape;
    penArea = e.penetrationAreaMm2;
  }
  const modes = {} as Record<Loading, SeriesModeResult>;
  for (const mode of MODES) {
    const S = mc.summary[mode];
    const byScenario: SeriesModeResult['byScenario'] = {};
    for (const k of ['lp', 'long'] as const) {
      const b = S.byScenario[k];
      if (b) byScenario[k] = { remaining: b.remaining, wear: b.wear, elevation: elev ? elevationStatus(elev.nominal, b.remaining) : null, creepShare: b.creepShare, creepVolRem: b.creepVolRem, wearVol: b.wearVol };
    }
    const law = c.mcLaws[0] ?? c.laws[0];
    const row = det.rows.find((r) => r.law === law && r.mode === mode && r.temperature === 'in-vivo') ?? det.rows[0];
    const R = c.headDiameterMm / 2, half = row.sim.contactHalfAngleFinalDeg;
    modes[mode] = {
      creep: S.creep, remaining: S.remaining, wear: S.wear, creepShare: S.creepShare, creepVolRem: S.creepVolRem, wearVol: S.wearVol, byScenario,
      budget: S.budget,
      contact: {
        peakInitialMPa: row.sim.peakPressureInitialMPa, peakFinalMPa: row.sim.peakPressureFinalMPa, halfAngleDeg: half,
        areaMm2: 2 * Math.PI * R * R * (1 - Math.cos(half * Math.PI / 180)), edgeLoading: row.sim.edgeLoading,
        beyondTestedPressure: row.sim.peakPressureInitialMPa > LAW_TESTED_MAX_MPA, maxLawStressMPa: row.sim.maxLawStressMPa,
      },
      verdict: c.measured ? verdict(c.measured, S.remaining, S.wear, S.probWearNegative) : null,
    };
  }
  if (elevResult) {
    const e = elevResult;
    const maxVol = (mc.summary.static.remaining.p95 * zoneShape) / 1000;      // µm × mm² → mm³
    zone = {
      ...e.raw, volumeAboveNoiseMm3: e.nominal.netMm3, thresholdUm: e.nominal.thresholdUm, sigmaUm: e.sigmaEffUm,
      volumeRangeMm3: e.rawRange, radiusUncUm: e.radiusUncUm,
      zoneHalfAngleDeg: e.zone?.halfAngleDeg ?? 180, zoneAboutPole: e.zone?.aboutPole ?? true,
      excludedVolumeMm3: Math.max(0, e.rawAll.volumeMm3 - e.raw.volumeMm3),
      plausibility: elevationPlausibility(e, maxVol),
    };
  }
  return {
    caseId: c.caseId, file: L.name, years: c.implantMonths / 12, material: c.material, materialLabel: materialPreset(c.material, c.irradiation).label, bodyMassKg: c.bodyMassKg,
    exVivoDays: c.exVivoDays, headDiameterMm: c.headDiameterMm, thicknessMm: c.thicknessMm, measured: c.measured,
    modes, elevationMinCreepUm: elev, elevatedZone: zone, penetratedAreaMm2: penArea, warnings: L.warnings, elapsedMs: performance.now() - t0,
  };
}

const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const n = (x: number | null | undefined, d = 1) => (x != null && Number.isFinite(x) ? x.toFixed(d) : '');
/** Rounded number, or null when missing (for the Excel export) */
const r1 = (x: number | null | undefined, d = 1): number | null => (x != null && Number.isFinite(x) ? Number(x.toFixed(d)) : null);

export const SERIES_COLUMNS = ['case', 'file', 'material', 'years_in_vivo', 'body_mass_kg', 'days_ex_vivo', 'head_mm', 'wall_mm', 'mode',
  'D_um', 'D_sd_um', 'D_not_detected', 'detection_limit_um',
  'Cmax_p50', 'Cmax_p5', 'Cmax_p95',
  'Crem_LP_p50', 'Crem_LP_p5', 'Crem_LP_p95', 'Crem_long_p50', 'Crem_long_p5', 'Crem_long_p95',
  'W_LP_p50', 'W_LP_p5', 'W_LP_p95', 'W_long_p50', 'W_long_p5', 'W_long_p95',
  'elev_min_creep_um', 'elev_min_lo', 'elev_min_hi', 'elev_check_LP', 'elev_check_long', 'verdict',
  'elevated_area_mm2', 'elevated_volume_mm3', 'elevated_volume_above_noise_mm3', 'elevation_peak_um', 'elevation_peak_1mm2_um', 'elevation_peak_theta_deg',
  'elevated_volume_lo_mm3', 'elevated_volume_hi_mm3', 'load_zone_half_angle_deg', 'excluded_elevated_volume_mm3', 'elevation_plausible', 'elevation_flags'] as const;

/** Columns quoted in the CSV (free text) */
const TEXT_COLS = new Set([0, 1, 2, 33, 45]);

/** One row per liner and loading mode; numbers rounded as in the CSV, null when missing */
export function seriesTable(rows: SeriesResult[]): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  for (const r of rows) for (const mode of MODES) {
    const m = r.modes[mode], lp = m.byScenario.lp, lg = m.byScenario.long;
    const D = r.measured && !r.measured.notDetected ? r.measured : null;
    out.push([r.caseId, r.file, r.materialLabel, r1(r.years, 2), r1(r.bodyMassKg, 0), r1(r.exVivoDays, 0), r1(r.headDiameterMm, 1), r1(r.thicknessMm, 2), mode,
      r1(D?.penetrationUm), r1(D?.sdUm),
      r.measured?.notDetected ? 'yes' : 'no', r1(r.measured?.detectionLimitUm ?? null, 0),
      r1(m.creep.p50), r1(m.creep.p5), r1(m.creep.p95),
      r1(lp?.remaining.p50), r1(lp?.remaining.p5), r1(lp?.remaining.p95), r1(lg?.remaining.p50), r1(lg?.remaining.p5), r1(lg?.remaining.p95),
      r1(lp?.wear?.p50), r1(lp?.wear?.p5), r1(lp?.wear?.p95), r1(lg?.wear?.p50), r1(lg?.wear?.p5), r1(lg?.wear?.p95),
      r1(r.elevationMinCreepUm?.nominal), r1(r.elevationMinCreepUm?.lo), r1(r.elevationMinCreepUm?.hi),
      lp?.elevation ?? null, lg?.elevation ?? null, m.verdict?.title ?? '',
      r1(r.elevatedZone?.areaMm2), r1(r.elevatedZone?.volumeMm3, 3), r1(r.elevatedZone?.volumeAboveNoiseMm3, 3),
      r1(r.elevatedZone?.peakUm), r1(r.elevatedZone?.peak1mm2Um), r1(r.elevatedZone?.peakThetaDeg),
      r1(r.elevatedZone?.volumeRangeMm3[0], 3), r1(r.elevatedZone?.volumeRangeMm3[1], 3), r1(r.elevatedZone?.zoneHalfAngleDeg),
      r1(r.elevatedZone?.excludedVolumeMm3, 3), r.elevatedZone ? (r.elevatedZone.plausibility.ok ? 'yes' : 'doubtful') : null,
      r.elevatedZone?.plausibility.flags.join('; ') ?? null]);
  }
  return out;
}

/** One row per liner and loading mode */
export function seriesCsv(rows: SeriesResult[]): string {
  const decimals = (j: number) => (j === 3 || j === 7 ? 2 : j === 4 || j === 5 || j === 12 ? 0 : j === 35 || j === 36 || j === 40 || j === 41 || j === 43 ? 3 : 1);
  const L = [SERIES_COLUMNS.join(',')];
  for (const row of seriesTable(rows)) {
    L.push(row.map((v, j) => TEXT_COLS.has(j) ? q(String(v ?? '')) : typeof v === 'number' ? n(v, decimals(j)) : (v ?? '')).join(','));
  }
  return L.join('\n');
}

// ---------- cohort: measured penetration vs time in vivo ----------

export interface CohortFit {
  group: string;
  n: number;
  /** D = intercept + slope · years (OLS): slope = penetration rate (µm/year), intercept = early penetration (µm) */
  slope: number; slopeSe: number;
  intercept: number; interceptSe: number;
  r2: number;
  /** Model: mean over the group of the median remaining creep (µm), dynamic and static */
  modelCreepDyn: number; modelCreepStat: number;
  points: { caseId: string; years: number; D: number; sd: number }[];
}

/** Liners with a detected penetration, grouped by polyethylene, plus all together (groups with ≥ 3 liners) */
export function cohortFits(res: SeriesResult[]): CohortFit[] {
  const shortMat = (r: SeriesResult) => r.materialLabel.split(',')[0].split(' (')[0].trim();
  const det = res.filter((r) => r.measured && !r.measured.notDetected && r.years > 0);
  const groups = new Map<string, SeriesResult[]>([['All liners', det]]);
  for (const r of det) { const g = shortMat(r); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r); }
  const out: CohortFit[] = [];
  for (const [group, rs] of groups) {
    const n = rs.length;
    if (n < 3) continue;
    const x = rs.map((r) => r.years), y = rs.map((r) => r.measured!.penetrationUm);
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
    if (!(sxx > 0)) continue;
    const slope = sxy / sxx, intercept = my - slope * mx;
    let sse = 0, sst = 0;
    for (let i = 0; i < n; i++) { sse += (y[i] - intercept - slope * x[i]) ** 2; sst += (y[i] - my) ** 2; }
    const s2 = n > 2 ? sse / (n - 2) : NaN;
    out.push({
      group, n, slope, slopeSe: Math.sqrt(s2 / sxx), intercept, interceptSe: Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)),
      r2: sst > 0 ? 1 - sse / sst : NaN,
      modelCreepDyn: rs.reduce((a, r) => a + r.modes.dynamic.remaining.p50, 0) / n,
      modelCreepStat: rs.reduce((a, r) => a + r.modes.static.remaining.p50, 0) / n,
      points: rs.map((r) => ({ caseId: r.caseId, years: r.years, D: r.measured!.penetrationUm, sd: r.measured!.sdUm })),
    });
  }
  return out;
}

/** Reference values for the wear rates (literature) */
export const LINEAR_OSTEOLYSIS_MM_PER_YEAR = 0.1;     // Dumbleton et al. 2002, J Arthroplasty 17:649
/** Volumetric wear above which osteolysis becomes frequent (Oparaugo et al. 2001, Acta Orthop Scand 72:22) */
export const VOLUMETRIC_OSTEOLYSIS_MM3_PER_YEAR = 80;
