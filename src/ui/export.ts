// ============================================================
// HipCreep — export of the results (JSON, CSV and Excel)
// ============================================================

import type { ReportData } from './report.ts';
import { LAWS } from '../model/laws.ts';
import { MODES } from '../model/analysis.ts';
import type { Stats } from '../model/stats.ts';
import { writeXlsx, XLSX_MIME, type Sheet } from '../io/xlsx.ts';
import { SERIES_COLUMNS, seriesTable, type SeriesResult } from '../model/series.ts';
import type { CaseInput } from '../model/case.ts';

export function download(name: string, content: string | Blob, type = 'application/json'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const statObj = (s: Stats | null) => s && { p5: s.p5, p25: s.p25, p50: s.p50, p75: s.p75, p95: s.p95, mean: s.mean, sd: s.sd, n: s.n };

export function resultsJson(d: ReportData, version: string): string {
  const { c, det, mc } = d;
  return JSON.stringify({
    format: 'hipcreep-results',
    version: 1,
    program: { name: 'HipCreep', version },
    createdAt: new Date().toISOString(),
    inputs: c,
    settings: d.ui,
    source: d.loaded ? { file: d.loaded.name, caseId: d.loaded.caseId, warnings: d.loaded.warnings } : null,
    deterministic: {
      parameters: det.params,
      recoveredFraction: det.recovered,
      recoveredFractionAltKinetics: det.recoveredAlt,
      rows: det.rows.map((r) => ({
        law: r.law, mode: r.mode, temperature: r.temperature, tempC: r.tempC,
        creepUm: r.creepUm, remainingUm: r.remainingUm,
        peakPressureInitialMPa: r.peakPressureInitialMPa, peakPressureFinalMPa: r.peakPressureFinalMPa,
        contactHalfAngleDeg: r.contactHalfAngleDeg, notes: r.notes,
      })),
    },
    monteCarlo: {
      samples: mc.n, seed: c.seed, laws: mc.laws,
      recoveredFraction: statObj(mc.recovery),
      modes: Object.fromEntries(MODES.map((m) => [m, {
        creepUm: statObj(mc.summary[m].creep),
        recoveredUm: statObj(mc.summary[m].recovered),
        remainingUm: statObj(mc.summary[m].remaining),
        wearUm: statObj(mc.summary[m].wear),
        creepShareOfPenetration: statObj(mc.summary[m].creepShare),
        probWearNegative: mc.summary[m].probWearNegative,
        probRemainingAboveDetectionLimit: mc.summary[m].probRemainingAboveLod,
        byRecoveryScenario: Object.fromEntries((['lp', 'long'] as const).map((k) => {
          const b = mc.summary[m].byScenario[k];
          return [k, b ? { recoveredFraction: statObj(b.recovered), remainingUm: statObj(b.remaining), wearUm: statObj(b.wear), probWearNegative: b.probWearNegative } : null];
        })),
        creepByLawUm: Object.fromEntries(Object.entries(mc.summary[m].byLaw).map(([k, s]) => [k, statObj(s!)])),
      }])),
      pooled: { creepUm: statObj(mc.pooled.creep), remainingUm: statObj(mc.pooled.remaining), wearUm: statObj(mc.pooled.wear) },
    },
    elevation: d.elevation,
  }, null, 2);
}

export function resultsCsv(d: ReportData): string {
  const { c, det, mc } = d;
  const L: string[] = [];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  L.push('# HipCreep results');
  L.push(`Case,${q(c.caseId)}`);
  L.push(`Body mass (kg),${c.bodyMassKg}`, `Implantation (months),${c.implantMonths}`, `Head diameter (mm),${c.headDiameterMm}`,
    `Wall thickness (mm),${c.thicknessMm}`, `Radial clearance (mm),${c.clearance.nominal}`, `Load angle (deg),${c.loadAngleDeg}`,
    `Material,${q(c.material)}`, `Days ex vivo,${c.exVivoDays}`, `Storage temperature (C),${c.recoveryTempC}`, `In vivo temperature (C),${c.inVivoTempC}`);
  if (c.measured?.notDetected) L.push(`Measured penetration (um),not detected`, `Detection limit (um),${c.measured.detectionLimitUm}`);
  else if (c.measured) L.push(`Measured penetration (um),${c.measured.penetrationUm}`, `Measured penetration SD (um),${c.measured.sdUm}`);
  for (const m of MODES) if (mc.summary[m].probRemainingAboveLod != null) L.push(`P(remaining creep > detection limit) ${m},${mc.summary[m].probRemainingAboveLod!.toFixed(4)}`);
  L.push('');
  L.push('# Deterministic (nominal parameters)');
  L.push('Law,Mode,Temperature,T (C),Creep (um),Remaining (um),p0 initial (MPa),p0 final (MPa),Notes');
  for (const r of det.rows) L.push([LAWS[r.law].shortRef, r.mode, r.temperature, r.tempC, r.creepUm.toFixed(2), r.remainingUm.toFixed(2), r.peakPressureInitialMPa.toFixed(3), r.peakPressureFinalMPa.toFixed(3), q(r.notes.join('; '))].join(','));
  L.push('');
  L.push('# Monte Carlo');
  L.push('Quantity,Mode,P5,P25,P50,P75,P95');
  const row = (name: string, mode: string, s: Stats | null) => { if (s) L.push([q(name), mode, s.p5, s.p25, s.p50, s.p75, s.p95].map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join(',')); };
  for (const m of MODES) {
    row('Creep at explantation (um)', m, mc.summary[m].creep);
    row('Recovered (um)', m, mc.summary[m].recovered);
    row('Remaining creep (um)', m, mc.summary[m].remaining);
    for (const k of ['lp', 'long'] as const) {
      const b = mc.summary[m].byScenario[k];
      if (b) { row(`Remaining creep, recovery ${k} (um)`, m, b.remaining); row(`Wear, recovery ${k} (um)`, m, b.wear); }
    }
    row('Wear (um)', m, mc.summary[m].wear);
    row('Creep share of penetration', m, mc.summary[m].creepShare);
  }
  row('Recovered fraction', 'both', mc.recovery);
  if (d.elevation) {
    L.push('');
    L.push('# Elevations (minimum creep)');
    L.push('k,sigma (um),threshold (um),raw (mm3),noise floor (mm3),net (mm3),area (mm2)');
    for (const r of d.elevation.rows) L.push([r.k, r.sigmaUm, r.thresholdUm, r.rawMm3, r.noiseFloorMm3, r.netMm3, r.elevatedAreaMm2].map((x) => x.toFixed(4)).join(','));
  }
  return L.join('\n');
}

// ---------- series → Excel ----------

const COLUMN_NOTES: Record<string, string> = {
  case: 'Case id (from the HipWear file)', file: 'HipWear file', material: 'Polyethylene (with dose and treatment for the dose grade)',
  years_in_vivo: 'Time in vivo (years)', body_mass_kg: 'Body mass (kg)', days_ex_vivo: 'Days from revision to the scan',
  head_mm: 'Head diameter (mm)', wall_mm: 'Liner wall thickness (mm)', mode: 'Loading mode of the creep law (dynamic / static)',
  D_um: 'Measured penetration D (µm)', D_sd_um: 'SD of D (µm)', D_not_detected: 'yes = HipWear did not detect penetration (D below the detection limit)',
  detection_limit_um: 'Detection limit (µm)', Cmax_p50: 'Creep at revision, in vivo (µm): median', Cmax_p5: '… 5th percentile', Cmax_p95: '… 95th percentile',
  Crem_LP_p50: 'Creep remaining at the scan, Lee & Pienkowski recovery (µm): median', Crem_LP_p5: '… 5th percentile', Crem_LP_p95: '… 95th percentile',
  Crem_long_p50: 'Creep remaining at the scan, long-loading recovery (µm): median', Crem_long_p5: '… 5th percentile', Crem_long_p95: '… 95th percentile',
  W_LP_p50: 'Wear = D − remaining creep, L&P scenario (µm): median', W_LP_p5: '… 5th percentile', W_LP_p95: '… 95th percentile',
  W_long_p50: 'Wear = D − remaining creep, long-loading scenario (µm): median', W_long_p5: '… 5th percentile', W_long_p95: '… 95th percentile',
  elev_min_creep_um: 'Minimum remaining creep from the elevations above the original sphere (µm): nominal', elev_min_lo: '… low end', elev_min_hi: '… high end',
  elev_check_LP: 'Model vs elevation bound, L&P: consistent / median-below / below', elev_check_long: 'Model vs elevation bound, long loading', verdict: 'Verdict on the creep/wear separation',
};

const rng = (r: { nominal: number; lo: number; hi: number }) => `${r.nominal} (${r.lo}–${r.hi})`;

/** Workbook with the series results, the run settings and the file warnings */
export function seriesXlsx(res: SeriesResult[], c: CaseInput, opt: { refRadius: string; rimBandDeg: number }, version: string): Blob {
  const widths = SERIES_COLUMNS.map((h, j) => (j === 1 ? 28 : j === 2 ? 34 : j === 33 ? 40 : Math.max(9, h.length + 2)));
  const sheets: Sheet[] = [{ name: 'Results', header: true, widths, rows: [[...SERIES_COLUMNS], ...seriesTable(res)] }];
  const info: (string | number | null)[][] = [
    ['HipCreep series results'], [],
    ['Program', `HipCreep v${version}`], ['Created', new Date().toLocaleString()], ['Liners', res.length],
    ['Monte Carlo samples per liner', c.samples], ['Creep laws (Monte Carlo)', c.mcLaws.join(', ')],
    ['Recovery scenario', c.recoveryScenario === 'both' ? 'both (L&P and long loading, 50/50)' : c.recoveryScenario],
    ['Activation energy (kcal/mol)', rng(c.eaKcal)], ['Reference radius', opt.refRadius], ['Rim band (°)', opt.rimBandDeg],
    [], ['Values in µm. p5–p95 = 90 % interval of the Monte Carlo. One row per liner and loading mode.'], [],
    ['Column', 'Meaning'], ...SERIES_COLUMNS.map((h) => [h, COLUMN_NOTES[h] ?? '']),
  ];
  sheets.push({ name: 'Info', widths: [30, 90], rows: info });
  const warn = res.flatMap((r) => r.warnings.map((w) => [r.caseId, r.file, w]));
  if (warn.length) sheets.push({ name: 'Warnings', header: true, widths: [16, 30, 100], rows: [['case', 'file', 'warning'], ...warn] });
  const bytes = writeXlsx(sheets);
  return new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MIME });
}
