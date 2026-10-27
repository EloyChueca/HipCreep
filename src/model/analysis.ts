// ============================================================
// HipCreep — analysis driver
// ------------------------------------------------------------
// • Deterministic table: every enabled law × {static, dynamic} × {law's own
//   temperature, in vivo temperature} with the nominal parameters.
// • Monte Carlo: law and parameters sampled from their ranges; static and dynamic
//   creep, recovery, and (with a HipWear measurement) the wear / creep split.
// ============================================================

import { G, DAYS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_YEAR } from './constants.ts';
import { LAWS, type LawId, type Loading, type LawOptions } from './laws.ts';
import { MATERIALS, type Range } from './materials.ts';
import { simulate, RES_FINE, RES_MC, type Resolution, type SimResult } from './creep.ts';
import { recoveredFraction, type RecoveryKinetics } from './recovery.ts';
import type { CaseInput } from './case.ts';
import { mulberry32, uniform, logUniform, normal, summarize, type Stats } from './stats.ts';

export const MODES: Loading[] = ['static', 'dynamic'];

export interface ScenarioParams {
  forceBW: number;
  cyclesPerYear: number;
  dynStaticRatio: number;
  E: number;
  nu: number;
  thicknessMm: number;
  clearanceMm: number;
  eaKcal: number;
  materialFactor: number;
  leeExtrapolation: 'cap' | 'log';
  r10k: number;
  recoveryKinetics: RecoveryKinetics;
}

export function creepFactorRange(c: CaseInput): Range {
  return c.creepFactorOverride ?? MATERIALS[c.material].creepFactor;
}

export function recoveryRange(c: CaseInput): Range {
  return c.recoveryOverride ?? MATERIALS[c.material].recovery10k;
}

export function nominalParams(c: CaseInput): ScenarioParams {
  return {
    forceBW: c.peakForceBW.nominal,
    cyclesPerYear: c.cyclesPerYear.nominal,
    dynStaticRatio: c.dynStaticRatio.nominal,
    E: c.E.nominal,
    nu: c.nu.nominal,
    thicknessMm: c.thicknessMm,
    clearanceMm: Math.max(0, c.clearance.nominal),
    eaKcal: c.eaKcal.nominal,
    materialFactor: creepFactorRange(c).nominal,
    leeExtrapolation: c.leeExtrapolation === 'log' ? 'log' : 'cap',
    r10k: recoveryRange(c).nominal,
    recoveryKinetics: c.recoveryKinetics === 'log' ? 'log' : 'plateau',
  };
}

export function sampleParams(c: CaseInput, rng: () => number): ScenarioParams {
  const pick = <T extends string>(v: T | 'both', a: T, b: T): T => (v === 'both' ? (rng() < 0.5 ? a : b) : v);
  return {
    forceBW: uniform(rng, c.peakForceBW),
    cyclesPerYear: logUniform(rng, c.cyclesPerYear),
    dynStaticRatio: uniform(rng, c.dynStaticRatio),
    E: uniform(rng, c.E),
    nu: uniform(rng, c.nu),
    thicknessMm: Math.max(1, normal(rng, c.thicknessMm, c.thicknessSdMm)),
    clearanceMm: Math.max(0, uniform(rng, c.clearance)),
    eaKcal: uniform(rng, c.eaKcal),
    materialFactor: uniform(rng, creepFactorRange(c)),
    leeExtrapolation: pick(c.leeExtrapolation, 'cap', 'log'),
    r10k: uniform(rng, recoveryRange(c)),
    recoveryKinetics: pick(c.recoveryKinetics, 'plateau', 'log'),
  };
}

export function implantSeconds(c: CaseInput): number {
  return c.implantMonths * DAYS_PER_MONTH * SECONDS_PER_DAY;
}

/** Cumulative walking time (s) = number of gait cycles / gait frequency */
export function gaitSeconds(c: CaseInput, cyclesPerYear: number): number {
  return (cyclesPerYear * implantSeconds(c) / SECONDS_PER_YEAR) / Math.max(c.gaitFrequencyHz, 1e-6);
}

export function runSim(
  c: CaseInput, p: ScenarioParams, lawId: LawId, mode: Loading, tempC: number, res: Resolution, history = false,
): SimResult {
  const lawOpt: LawOptions = { leeExtrapolation: p.leeExtrapolation };
  return simulate({
    law: LAWS[lawId],
    lawOpt,
    mode,
    forceN: p.forceBW * c.bodyMassKg * G,
    timeS: mode === 'static' ? implantSeconds(c) : gaitSeconds(c, p.cyclesPerYear),
    dynStaticRatio: p.dynStaticRatio,
    tempC,
    eaKcal: p.eaKcal,
    materialFactor: p.materialFactor,
    kappa: c.kappa,
    geometry: {
      headRadiusMm: c.headDiameterMm / 2,
      clearanceMm: p.clearanceMm,
      thicknessMm: p.thicknessMm,
      loadAngleDeg: c.loadAngleDeg,
      coverageDeg: c.coverageDeg,
    },
    elastic: { E: p.E, nu: p.nu },
    res,
    conform: c.conform,
    history,
  });
}

export function recoveryFor(c: CaseInput, p: ScenarioParams): number {
  return recoveredFraction({
    r10k: p.r10k,
    timeS: c.exVivoDays * SECONDS_PER_DAY,
    tempC: c.recoveryTempC,
    eaKcal: p.eaKcal,
    kinetics: p.recoveryKinetics,
  });
}

// ------------------------------------------------------------
// Deterministic table
// ------------------------------------------------------------

export interface DeterministicRow {
  law: LawId;
  mode: Loading;
  temperature: 'native' | 'in-vivo';
  tempC: number;
  creepUm: number;
  remainingUm: number;
  peakPressureInitialMPa: number;
  peakPressureFinalMPa: number;
  contactHalfAngleDeg: number;
  notes: string[];
  sim: SimResult;
}

export interface DeterministicResult {
  params: ScenarioParams;
  recovered: number;
  /** Recovered fraction with the other kinetics scenario, for reference */
  recoveredAlt: number;
  rows: DeterministicRow[];
}

export function runDeterministic(c: CaseInput): DeterministicResult {
  const p = nominalParams(c);
  const R = recoveryFor(c, p);
  const Ralt = recoveryFor(c, { ...p, recoveryKinetics: p.recoveryKinetics === 'plateau' ? 'log' : 'plateau' });
  const rows: DeterministicRow[] = [];
  for (const lawId of c.laws) {
    const law = LAWS[lawId];
    for (const mode of MODES) {
      for (const temperature of ['native', 'in-vivo'] as const) {
        const tempC = temperature === 'native' ? law.nativeTempC : c.inVivoTempC;
        const sim = runSim(c, p, lawId, mode, tempC, RES_FINE, true);
        const notes: string[] = [];
        if (sim.timeExtrapolated) notes.push('time extrapolated');
        if (sim.stressExtrapolated) notes.push('stress above tested range');
        if (sim.edgeLoading) notes.push('edge loading');
        if (temperature === 'in-vivo' && tempC !== law.nativeTempC) notes.push(`TTS ×${sim.timeShift.toPrecision(3)}`);
        rows.push({
          law: lawId, mode, temperature, tempC,
          creepUm: sim.maxCreepMm * 1000,
          remainingUm: sim.maxCreepMm * 1000 * (1 - R),
          peakPressureInitialMPa: sim.peakPressureInitialMPa,
          peakPressureFinalMPa: sim.peakPressureFinalMPa,
          contactHalfAngleDeg: sim.contactHalfAngleFinalDeg,
          notes,
          sim,
        });
      }
    }
  }
  return { params: p, recovered: R, recoveredAlt: Ralt, rows };
}

// ------------------------------------------------------------
// Monte Carlo
// ------------------------------------------------------------

export interface ModeSamples {
  creepUm: Float64Array;
  recoveredUm: Float64Array;
  remainingUm: Float64Array;
  /** Only with a measurement: D − remaining creep */
  wearUm: Float64Array | null;
  /** Only with a measurement: remaining creep / D */
  creepShare: Float64Array | null;
}

export interface McResult {
  n: number;
  lawIndex: Uint8Array;
  laws: LawId[];
  recoveredFraction: Float64Array;
  measuredUm: Float64Array | null;
  modes: Record<Loading, ModeSamples>;
  summary: Record<Loading, {
    creep: Stats; recovered: Stats; remaining: Stats;
    wear: Stats | null; creepShare: Stats | null; probWearNegative: number | null;
    /** Penetration not detected: fraction of samples whose remaining creep exceeds the detection limit */
    probRemainingAboveLod: number | null;
    byLaw: Partial<Record<LawId, Stats>>;
  }>;
  /** Pooled static + dynamic samples (envelope of both scenarios) */
  pooled: { creep: Stats; remaining: Stats; wear: Stats | null };
  recovery: Stats;
  elapsedMs: number;
}

export async function runMonteCarlo(
  c: CaseInput, onProgress?: (fraction: number) => void, signal?: { cancelled: boolean },
): Promise<McResult> {
  const t0 = performance.now();
  const n = Math.max(10, Math.round(c.samples));
  const rng = mulberry32(c.seed);
  const laws = c.laws.length ? c.laws : (['lee2003'] as LawId[]);
  const lawIndex = new Uint8Array(n);
  const Rarr = new Float64Array(n);
  const meas = c.measured;
  // not detected: D is only known to lie in [0, LoD] — no wear / creep split is computed
  const notDetected = !!meas?.notDetected;
  const lod = meas?.detectionLimitUm ?? 0;
  const split = !!meas && !notDetected;
  const Darr = meas ? new Float64Array(n) : null;
  const mk = (): ModeSamples => ({
    creepUm: new Float64Array(n),
    recoveredUm: new Float64Array(n),
    remainingUm: new Float64Array(n),
    wearUm: split ? new Float64Array(n) : null,
    creepShare: split ? new Float64Array(n) : null,
  });
  const modes: Record<Loading, ModeSamples> = { static: mk(), dynamic: mk() };

  const CHUNK = 8;
  for (let s = 0; s < n; s++) {
    const li = Math.min(laws.length - 1, Math.floor(rng() * laws.length));
    lawIndex[s] = li;
    const p = sampleParams(c, rng);
    const R = recoveryFor(c, p);
    Rarr[s] = R;
    const D = !meas ? 0 : notDetected ? uniform(rng, { nominal: lod / 2, lo: 0, hi: lod }) : normal(rng, meas.penetrationUm, meas.sdUm);
    if (Darr) Darr[s] = D;
    for (const mode of MODES) {
      const sim = runSim(c, p, laws[li], mode, c.inVivoTempC, RES_MC);
      const C = sim.maxCreepMm * 1000;
      const ms = modes[mode];
      ms.creepUm[s] = C;
      ms.recoveredUm[s] = C * R;
      ms.remainingUm[s] = C * (1 - R);
      if (ms.wearUm && ms.creepShare) {
        ms.wearUm[s] = D - C * (1 - R);
        ms.creepShare[s] = D > 0 ? (C * (1 - R)) / D : NaN;
      }
    }
    if ((s + 1) % CHUNK === 0) {
      onProgress?.((s + 1) / n);
      await new Promise((r) => setTimeout(r, 0));
      if (signal?.cancelled) throw new Error('cancelled');
    }
  }
  onProgress?.(1);

  const summary = {} as McResult['summary'];
  for (const mode of MODES) {
    const ms = modes[mode];
    const byLaw: Partial<Record<LawId, Stats>> = {};
    laws.forEach((id, li) => {
      byLaw[id] = summarize(ms.creepUm.filter((_, i) => lawIndex[i] === li));
    });
    let pNeg: number | null = null;
    if (ms.wearUm) {
      let k = 0;
      for (const w of ms.wearUm) if (w < 0) k++;
      pNeg = k / n;
    }
    let pAbove: number | null = null;
    if (notDetected && lod > 0) {
      let k = 0;
      for (const v of ms.remainingUm) if (v > lod) k++;
      pAbove = k / n;
    }
    summary[mode] = {
      probRemainingAboveLod: pAbove,
      creep: summarize(ms.creepUm),
      recovered: summarize(ms.recoveredUm),
      remaining: summarize(ms.remainingUm),
      wear: ms.wearUm ? summarize(ms.wearUm) : null,
      creepShare: ms.creepShare ? summarize(ms.creepShare) : null,
      probWearNegative: pNeg,
      byLaw,
    };
  }
  const cat = (a: Float64Array, b: Float64Array) => { const r = new Float64Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
  const pooled = {
    creep: summarize(cat(modes.static.creepUm, modes.dynamic.creepUm)),
    remaining: summarize(cat(modes.static.remainingUm, modes.dynamic.remainingUm)),
    wear: modes.static.wearUm && modes.dynamic.wearUm ? summarize(cat(modes.static.wearUm, modes.dynamic.wearUm)) : null,
  };
  return {
    n, lawIndex, laws, recoveredFraction: Rarr, measuredUm: Darr, modes, summary, pooled,
    recovery: summarize(Rarr),
    elapsedMs: performance.now() - t0,
  };
}

// ------------------------------------------------------------
// Creep / wear decomposition verdict
// ------------------------------------------------------------

export interface Verdict {
  level: 'small-signal' | 'inconsistent' | 'separable';
  title: string;
  detail: string;
}

/**
 * Interpret the Monte Carlo split for one scenario (or the pooled envelope).
 * Small signal: the predicted remaining creep is not larger than twice the measurement
 * uncertainty, or the measured penetration itself is below the detection limit / 2·SD.
 */
export function verdict(
  m: { penetrationUm: number; sdUm: number; detectionLimitUm?: number | null; notDetected?: boolean },
  remaining: Stats, wear: Stats | null, probWearNegative: number | null,
): Verdict {
  const u = Math.max(m.sdUm, 0);
  const lod = m.detectionLimitUm ?? 0;
  const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toPrecision(2) : x === 0 ? '0' : x.toPrecision(2));
  if (m.notDetected) {
    if (remaining.p50 > lod) {
      return {
        level: 'inconsistent',
        title: `Penetration not detected, but the model predicts more remaining creep than the detection limit`,
        detail: `HipWear found no directional penetration (< ${fmt(lod)} µm), while the predicted remaining creep is ${fmt(remaining.p50)} µm (90 %: ${fmt(remaining.p5)}–${fmt(remaining.p95)} µm). The creep model over-predicts for this liner (load, clearance, material, time) or more creep has recovered.`,
      };
    }
    return {
      level: 'small-signal',
      title: `Penetration not detected (< ${fmt(lod)} µm) — creep below the detection limit`,
      detail: `HipWear found no directional penetration, so D is only known to lie between 0 and ${fmt(lod)} µm. The predicted remaining creep (median ${fmt(remaining.p50)} µm, 90 %: ${fmt(remaining.p5)}–${fmt(remaining.p95)} µm) is below that limit: consistent with the measurement, but creep and wear cannot be separated on this liner.`,
    };
  }
  if (remaining.p50 <= 2 * u || m.penetrationUm <= Math.max(2 * u, lod)) {
    const why = m.penetrationUm <= Math.max(2 * u, lod)
      ? `the measured penetration (${fmt(m.penetrationUm)} µm) is not clearly above its uncertainty (±${fmt(u)} µm${lod ? `, detection limit ${fmt(lod)} µm` : ''})`
      : `the predicted remaining creep (median ${fmt(remaining.p50)} µm) is smaller than twice the measurement uncertainty (2·SD = ${fmt(2 * u)} µm)`;
    return {
      level: 'small-signal',
      title: 'Creep of the order of the measurement uncertainty',
      detail: `Here ${why}. Creep and wear cannot be separated for this liner; report creep as being of the same order as the uncertainty.`,
    };
  }
  if (probWearNegative != null && probWearNegative > 0.5) {
    return {
      level: 'inconsistent',
      title: 'Predicted remaining creep exceeds the measured penetration',
      detail: `In ${(probWearNegative * 100).toFixed(0)} % of the simulations the remaining creep is larger than the measured penetration. Either the creep model over-predicts for this liner (load, clearance, material) or more creep has recovered than assumed. The whole penetration is compatible with creep; wear is not detectable.`,
    };
  }
  return {
    level: 'separable',
    title: 'Penetration can be split into creep and wear',
    detail: wear
      ? `Estimated wear ${fmt(wear.p50)} µm (90 % interval ${fmt(wear.p5)} to ${fmt(wear.p95)} µm); remaining creep ${fmt(remaining.p50)} µm (${fmt(remaining.p5)}–${fmt(remaining.p95)} µm).`
        + (probWearNegative != null && probWearNegative > 0.05 ? ` In ${(probWearNegative * 100).toFixed(0)} % of the simulations the remaining creep alone explains the whole penetration.` : '')
      : '',
  };
}
