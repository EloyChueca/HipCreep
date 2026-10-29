// ============================================================
// HipCreep — analysis driver
// ------------------------------------------------------------
// • Deterministic table: every enabled law × {static, dynamic} × {law's own
//   temperature, in vivo temperature} with the nominal parameters.
// • Monte Carlo: law and parameters sampled from their ranges; static and dynamic
//   creep, recovery, and (with a HipWear measurement) the wear / creep split.
// ============================================================

import { yieldTask } from '../compute/yield.ts';
import { G, DAYS_PER_MONTH, SECONDS_PER_DAY, SECONDS_PER_YEAR } from './constants.ts';
import { LAWS, type LawId, type Loading, type LawOptions } from './laws.ts';
import { materialPreset, type Range } from './materials.ts';
import { simulate, RES_FINE, RES_MC, type Resolution, type SimResult } from './creep.ts';
import { recoveredFraction, RECOVERY_LONG_10K, type RecoveryKinetics, type RecoveryScenario } from './recovery.ts';
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
  recoveryScenario: RecoveryScenario;
}

export function creepFactorRange(c: CaseInput): Range {
  return c.creepFactorOverride ?? materialPreset(c.material, c.irradiation).creepFactor;
}

export function recoveryRange(c: CaseInput): Range {
  return c.recoveryOverride ?? materialPreset(c.material, c.irradiation).recovery10k;
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
    recoveryScenario: 'lp',
  };
}

export function sampleParams(c: CaseInput, rng: () => number): ScenarioParams {
  const pick = <T extends string>(v: T | 'both', a: T, b: T): T => (v === 'both' ? (rng() < 0.5 ? a : b) : v);
  const out: ScenarioParams = {
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
    recoveryScenario: 'lp',
  };
  // drawn after the other parameters so the rest of the sample does not depend on it
  const sc = pick(c.recoveryScenario ?? 'both', 'lp', 'long');
  if (sc === 'long') { out.recoveryScenario = 'long'; out.r10k = uniform(rng, RECOVERY_LONG_10K); }
  return out;
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
  /** Remaining creep in the long-loading recovery scenario */
  remainingLongUm: number;
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
  /** Nominal recovered fraction in the long-loading scenario */
  recoveredLong: number;
  rows: DeterministicRow[];
}

export function runDeterministic(c: CaseInput): DeterministicResult {
  const p = nominalParams(c);
  const R = recoveryFor(c, p);
  const Ralt = recoveryFor(c, { ...p, recoveryKinetics: p.recoveryKinetics === 'plateau' ? 'log' : 'plateau' });
  const Rlong = recoveryFor(c, { ...p, recoveryScenario: 'long', r10k: RECOVERY_LONG_10K.nominal });
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
          remainingLongUm: sim.maxCreepMm * 1000 * (1 - Rlong),
          peakPressureInitialMPa: sim.peakPressureInitialMPa,
          peakPressureFinalMPa: sim.peakPressureFinalMPa,
          contactHalfAngleDeg: sim.contactHalfAngleFinalDeg,
          notes,
          sim,
        });
      }
    }
  }
  return { params: p, recovered: R, recoveredAlt: Ralt, recoveredLong: Rlong, rows };
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

/** Sampled inputs kept per Monte Carlo sample (sensitivity analysis, recovery curves) */
export const PARAM_KEYS = ['forceBW', 'cyclesPerYear', 'dynStaticRatio', 'E', 'nu', 'thicknessMm', 'clearanceMm', 'eaKcal', 'materialFactor', 'r10k'] as const;
export type ParamKey = typeof PARAM_KEYS[number];

/** Sampled inputs of one loading mode's Monte Carlo (sensitivity analysis, recovery curves) */
export interface McInputs {
  lawIndex: Uint8Array;
  recoveredFraction: Float64Array;
  /** Recovery scenario of each sample: 0 = Lee & Pienkowski, 1 = long loading */
  scenario: Uint8Array;
  /** Sampled parameters of each sample */
  params: Record<ParamKey, Float64Array>;
  /** 1 = log-linear recovery kinetics, 0 = plateau */
  kineticsLog: Uint8Array;
  /** 1 = Lee laws continue log-linearly beyond 10⁴ min, 0 = capped */
  leeLog: Uint8Array;
  measuredUm: Float64Array | null;
}

/**
 * Two independent Monte Carlo simulations, one per loading mode (v0.11): each mode draws its own
 * samples (law, parameters, recovery, measured D) from its own random stream, with n samples each.
 */
export interface McResult {
  n: number;
  laws: LawId[];
  /** Sampled inputs of each mode's simulation */
  inputs: Record<Loading, McInputs>;
  modes: Record<Loading, ModeSamples>;
  summary: Record<Loading, {
    creep: Stats; recovered: Stats; remaining: Stats;
    wear: Stats | null; creepShare: Stats | null; probWearNegative: number | null;
    /** Penetration not detected: fraction of samples whose remaining creep exceeds the detection limit */
    probRemainingAboveLod: number | null;
    /** Remaining creep and wear for each recovery scenario (null if the scenario was not sampled) */
    byScenario: Record<RecoveryScenario, { remaining: Stats; wear: Stats | null; recovered: Stats; probWearNegative: number | null } | null>;
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
  const mcSet = (c.mcLaws ?? []).filter((id) => LAWS[id]);
  const laws = mcSet.length ? mcSet : c.laws.length ? c.laws : (['lee2003'] as LawId[]);
  const meas = c.measured;
  // not detected: D is only known to lie in [0, LoD] — no wear / creep split is computed
  const notDetected = !!meas?.notDetected;
  const lod = meas?.detectionLimitUm ?? 0;
  const split = !!meas && !notDetected;
  const mk = (): ModeSamples => ({
    creepUm: new Float64Array(n),
    recoveredUm: new Float64Array(n),
    remainingUm: new Float64Array(n),
    wearUm: split ? new Float64Array(n) : null,
    creepShare: split ? new Float64Array(n) : null,
  });
  const mkInputs = (): McInputs => ({
    lawIndex: new Uint8Array(n), recoveredFraction: new Float64Array(n), scenario: new Uint8Array(n),
    params: Object.fromEntries(PARAM_KEYS.map((k) => [k, new Float64Array(n)])) as Record<ParamKey, Float64Array>,
    kineticsLog: new Uint8Array(n), leeLog: new Uint8Array(n), measuredUm: meas ? new Float64Array(n) : null,
  });
  const modes: Record<Loading, ModeSamples> = { static: mk(), dynamic: mk() };
  const inputs: Record<Loading, McInputs> = { static: mkInputs(), dynamic: mkInputs() };
  // independent random streams: the dynamic simulation keeps the case seed, the static one a derived seed
  const SEED: Record<Loading, number> = { dynamic: c.seed >>> 0, static: (Math.imul(c.seed ^ 0x5bd1e995, 0x9e3779b1) ^ 0x7f4a7c15) >>> 0 };

  const CHUNK = 8;
  const ORDER: Loading[] = ['dynamic', 'static'];
  for (let mi = 0; mi < ORDER.length; mi++) {
    const mode = ORDER[mi];
    const rng = mulberry32(SEED[mode]);
    const inp = inputs[mode], ms = modes[mode];
    for (let s = 0; s < n; s++) {
      const li = Math.min(laws.length - 1, Math.floor(rng() * laws.length));
      inp.lawIndex[s] = li;
      const p = sampleParams(c, rng);
      const R = recoveryFor(c, p);
      inp.recoveredFraction[s] = R;
      inp.scenario[s] = p.recoveryScenario === 'long' ? 1 : 0;
      for (const k of PARAM_KEYS) inp.params[k][s] = p[k];
      inp.kineticsLog[s] = p.recoveryKinetics === 'log' ? 1 : 0;
      inp.leeLog[s] = p.leeExtrapolation === 'log' ? 1 : 0;
      const D = !meas ? 0 : notDetected ? uniform(rng, { nominal: lod / 2, lo: 0, hi: lod }) : normal(rng, meas.penetrationUm, meas.sdUm);
      if (inp.measuredUm) inp.measuredUm[s] = D;
      const sim = runSim(c, p, laws[li], mode, c.inVivoTempC, RES_MC);
      const C = sim.maxCreepMm * 1000;
      ms.creepUm[s] = C;
      ms.recoveredUm[s] = C * R;
      ms.remainingUm[s] = C * (1 - R);
      if (ms.wearUm && ms.creepShare) {
        ms.wearUm[s] = D - C * (1 - R);
        ms.creepShare[s] = D > 0 ? (C * (1 - R)) / D : NaN;
      }
      if ((s + 1) % CHUNK === 0) {
        onProgress?.((mi * n + s + 1) / (ORDER.length * n));
        await yieldTask();
        if (signal?.cancelled) throw new Error('cancelled');
      }
    }
  }
  onProgress?.(1);

  const summary = {} as McResult['summary'];
  for (const mode of MODES) {
    const ms = modes[mode];
    const { lawIndex, scenario: scen, recoveredFraction: Rarr } = inputs[mode];
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
    const byScenario = {} as McResult['summary'][Loading]['byScenario'];
    (['lp', 'long'] as const).forEach((sc, si) => {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) if (scen[i] === si) idx.push(i);
      if (!idx.length) { byScenario[sc] = null; return; }
      const sub = (a: Float64Array) => Float64Array.from(idx, (i) => a[i]);
      let pn: number | null = null;
      if (ms.wearUm) { let k = 0; for (const i of idx) if (ms.wearUm[i] < 0) k++; pn = k / idx.length; }
      byScenario[sc] = { remaining: summarize(sub(ms.remainingUm)), wear: ms.wearUm ? summarize(sub(ms.wearUm)) : null, recovered: summarize(sub(Rarr)), probWearNegative: pn };
    });
    summary[mode] = {
      byScenario,
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
    n, laws, inputs, modes, summary, pooled,
    recovery: summarize(cat(inputs.static.recoveredFraction, inputs.dynamic.recoveredFraction)),
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
