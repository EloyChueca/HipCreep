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
import { MODES, runDeterministic, runMonteCarlo, verdict, type McResult, type Verdict } from './analysis.ts';
import { analyseSurface, elevationAnalysis, minCreepDepthUm, type ElevatedZone } from './surface.ts';
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

export interface SeriesModeResult {
  creep: Stats;
  remaining: Stats;
  wear: Stats | null;
  byScenario: Partial<Record<RecoveryScenario, { remaining: Stats; wear: Stats | null; elevation: ElevationStatus | null }>>;
  verdict: Verdict | null;
}

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
  /** Measured elevated zone (no model): volume, area and peak above the original sphere; null without a mesh */
  elevatedZone: (ElevatedZone & { volumeAboveNoiseMm3: number; thresholdUm: number; sigmaUm: number }) | null;
  warnings: string[];
  elapsedMs: number;
}

export async function runSeriesCase(
  c: CaseInput, L: LoadedHipWearCase, opt: { refRadius: 'measured' | 'commercial'; rimBandDeg: number },
): Promise<SeriesResult> {
  const t0 = performance.now();
  const det = runDeterministic(c);
  const mc: McResult = await runMonteCarlo(c);
  let elev: SeriesResult['elevationMinCreepUm'] = null;
  let zone: SeriesResult['elevatedZone'] = null;
  if (L.mesh) {
    const useMeasured = opt.refRadius === 'measured' && !!L.measuredRadiusMm;
    const R = useMeasured ? L.measuredRadiusMm! : L.commercialRadiusMm;
    const center = useMeasured && L.measuredCenter ? L.measuredCenter : L.center;
    const s = analyseSurface(L.mesh, { center, radiusMm: R, pole: L.pole, load: L.load });
    const e = elevationAnalysis(s, L.noiseSigmaUm, L.surfaceUncertaintyUm, opt.rimBandDeg);
    const row = det.rows.find((r) => r.law === (c.mcLaws[0] ?? c.laws[0]) && r.mode === 'dynamic' && r.temperature === 'in-vivo') ?? det.rows[0];
    const shape = row.sim.shapeAreaMm2;
    elev = { nominal: minCreepDepthUm(e.nominal.netMm3, shape), lo: minCreepDepthUm(e.netRangeMm3[0], shape), hi: minCreepDepthUm(e.netRangeMm3[1], shape) };
    zone = { ...e.raw, volumeAboveNoiseMm3: e.nominal.netMm3, thresholdUm: e.nominal.thresholdUm, sigmaUm: e.sigmaEffUm };
  }
  const modes = {} as Record<Loading, SeriesModeResult>;
  for (const mode of MODES) {
    const S = mc.summary[mode];
    const byScenario: SeriesModeResult['byScenario'] = {};
    for (const k of ['lp', 'long'] as const) {
      const b = S.byScenario[k];
      if (b) byScenario[k] = { remaining: b.remaining, wear: b.wear, elevation: elev ? elevationStatus(elev.nominal, b.remaining) : null };
    }
    modes[mode] = {
      creep: S.creep, remaining: S.remaining, wear: S.wear, byScenario,
      verdict: c.measured ? verdict(c.measured, S.remaining, S.wear, S.probWearNegative) : null,
    };
  }
  return {
    caseId: c.caseId, file: L.name, years: c.implantMonths / 12, material: c.material, materialLabel: materialPreset(c.material, c.irradiation).label, bodyMassKg: c.bodyMassKg,
    exVivoDays: c.exVivoDays, headDiameterMm: c.headDiameterMm, thicknessMm: c.thicknessMm, measured: c.measured,
    modes, elevationMinCreepUm: elev, elevatedZone: zone, warnings: L.warnings, elapsedMs: performance.now() - t0,
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
  'elevated_area_mm2', 'elevated_volume_mm3', 'elevated_volume_above_noise_mm3', 'elevation_peak_um', 'elevation_peak_1mm2_um', 'elevation_peak_theta_deg'] as const;

/** Columns quoted in the CSV (free text) */
const TEXT_COLS = new Set([0, 1, 2, 33]);

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
      r1(r.elevatedZone?.peakUm), r1(r.elevatedZone?.peak1mm2Um), r1(r.elevatedZone?.peakThetaDeg)]);
  }
  return out;
}

/** One row per liner and loading mode */
export function seriesCsv(rows: SeriesResult[]): string {
  const decimals = (j: number) => (j === 3 || j === 7 ? 2 : j === 4 || j === 5 || j === 12 ? 0 : j === 35 || j === 36 ? 3 : 1);
  const L = [SERIES_COLUMNS.join(',')];
  for (const row of seriesTable(rows)) {
    L.push(row.map((v, j) => TEXT_COLS.has(j) ? q(String(v ?? '')) : typeof v === 'number' ? n(v, decimals(j)) : (v ?? '')).join(','));
  }
  return L.join('\n');
}
