// ============================================================
// HipCreep — sensitivity of the results to the uncertain inputs, and the
// effect of the time between explantation and scanning
// ------------------------------------------------------------
// • Sensitivity: Spearman rank correlation between each sampled input and the
//   output (remaining creep or wear) over the Monte Carlo samples. ρ² is a rough
//   share of the output variance explained by that input (monotonic relations).
// • Recovery curve: the creep at explantation of every sample is kept, so the
//   remaining creep (and the wear) can be recomputed for any unloaded time
//   without new simulations.
// ============================================================

import { PARAM_KEYS, type McResult, type ParamKey } from './analysis.ts';
import type { CaseInput } from './case.ts';
import type { Loading } from './laws.ts';
import { recoveredFraction, type RecoveryScenario } from './recovery.ts';
import { percentile } from './stats.ts';
import { SECONDS_PER_DAY } from './constants.ts';

export const PARAM_LABEL: Record<ParamKey | 'law' | 'scenario' | 'leeLog' | 'kineticsLog' | 'measuredD', string> = {
  forceBW: 'Peak hip force (× BW)',
  cyclesPerYear: 'Gait cycles per year',
  dynStaticRatio: 'Dynamic/static factor k',
  E: 'Elastic modulus E',
  nu: 'Poisson ratio ν',
  thicknessMm: 'Wall thickness',
  clearanceMm: 'Radial clearance',
  eaKcal: 'Activation energy Ea',
  materialFactor: 'Material creep factor',
  r10k: 'Recovered fraction R₁₀ₖ',
  law: 'Creep law',
  scenario: 'Recovery scenario',
  leeLog: 'Lee laws beyond 10⁴ min',
  kineticsLog: 'Recovery kinetics',
  measuredD: 'Measured penetration D',
};

/** Average ranks (ties share the mean rank) */
function ranks(a: ArrayLike<number>): Float64Array {
  const n = a.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i] - a[j]);
  const r = new Float64Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation (NaN if one variable is constant) */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const rx = ranks(x), ry = ranks(y);
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += rx[i]; my += ry[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export interface SensitivityRow { key: string; label: string; rho: number }

/** Inputs ranked by |ρ| with the chosen output of one loading mode */
export function sensitivity(mc: McResult, mode: Loading, output: 'remaining' | 'wear' | 'creep'): SensitivityRow[] {
  const ms = mc.modes[mode];
  const y = output === 'remaining' ? ms.remainingUm : output === 'wear' ? ms.wearUm : ms.creepUm;
  if (!y) return [];
  const rows: SensitivityRow[] = [];
  const push = (key: string, x: ArrayLike<number>) => {
    const rho = spearman(x, y);
    if (Number.isFinite(rho)) rows.push({ key, label: PARAM_LABEL[key as keyof typeof PARAM_LABEL] ?? key, rho });
  };
  for (const k of PARAM_KEYS) {
    if (k === 'cyclesPerYear' && mode === 'static') continue;   // no effect in static mode
    if (k === 'r10k' && output === 'creep') continue;
    push(k, mc.params[k]);
  }
  if (mc.laws.length > 1) push('law', mc.lawIndex);
  if (output !== 'creep') push('scenario', mc.scenario);
  push('leeLog', mc.leeLog);
  if (output !== 'creep') push('kineticsLog', mc.kineticsLog);
  if (output === 'wear' && mc.measuredUm) push('measuredD', mc.measuredUm);
  return rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}

export interface RecoveryCurve {
  days: number[];
  byScenario: Partial<Record<RecoveryScenario, { remaining: { p5: number[]; p50: number[]; p95: number[] }; wear: { p5: number[]; p50: number[]; p95: number[] } | null }>>;
}

/** Remaining creep (and wear, with a measurement) as a function of the days unloaded before scanning */
export function recoveryCurve(mc: McResult, c: CaseInput, mode: Loading, days: number[]): RecoveryCurve {
  const ms = mc.modes[mode];
  const out: RecoveryCurve = { days, byScenario: {} };
  (['lp', 'long'] as const).forEach((sc, si) => {
    const idx: number[] = [];
    for (let i = 0; i < mc.n; i++) if (mc.scenario[i] === si) idx.push(i);
    if (!idx.length) return;
    const rem = { p5: [] as number[], p50: [] as number[], p95: [] as number[] };
    const wear = mc.measuredUm && !c.measured?.notDetected ? { p5: [] as number[], p50: [] as number[], p95: [] as number[] } : null;
    for (const d of days) {
      const r = new Float64Array(idx.length), w = wear ? new Float64Array(idx.length) : null;
      idx.forEach((i, k) => {
        const R = recoveredFraction({
          r10k: mc.params.r10k[i], timeS: d * SECONDS_PER_DAY, tempC: c.recoveryTempC,
          eaKcal: mc.params.eaKcal[i], kinetics: mc.kineticsLog[i] ? 'log' : 'plateau',
        });
        r[k] = ms.creepUm[i] * (1 - R);
        if (w) w[k] = mc.measuredUm![i] - r[k];
      });
      r.sort();
      rem.p5.push(percentile(r, 0.05)); rem.p50.push(percentile(r, 0.5)); rem.p95.push(percentile(r, 0.95));
      if (w && wear) { w.sort(); wear.p5.push(percentile(w, 0.05)); wear.p50.push(percentile(w, 0.5)); wear.p95.push(percentile(w, 0.95)); }
    }
    out.byScenario[sc] = { remaining: rem, wear };
  });
  return out;
}
