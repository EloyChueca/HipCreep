// ============================================================
// HipCreep — export of the results (JSON and CSV)
// ============================================================

import type { ReportData } from './report.ts';
import { LAWS } from '../model/laws.ts';
import { MODES } from '../model/analysis.ts';
import type { Stats } from '../model/stats.ts';

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
