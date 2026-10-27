// ============================================================
// HipCreep — compressive creep laws of UHMWPE taken from the literature
// ------------------------------------------------------------
// Every law returns the TIME-DEPENDENT (creep) part of the uniaxial compressive
// strain, dimensionless and positive in compression, for a stress σ (MPa) held
// for a time t (s) at the law's own (native) temperature and loading type.
// The instantaneous elastic strain is excluded: a retrieved liner is measured
// unloaded, so only creep can remain in it.
//
// All three laws are linear in σ (creep compliance × σ), as reported by their
// authors in the stress range they tested. Each one also has a closed-form
// inverse t(σ, ε), which the strain-hardening time integration needs.
// ============================================================

import { SECONDS_PER_MINUTE } from './constants.ts';

export type LawId = 'lee2003' | 'deng1998' | 'lewis2001';
export type Loading = 'static' | 'dynamic';

export interface LawOptions {
  /** Lee 2003 was measured up to 10⁴ min. 'cap' keeps the 10⁴-min value afterwards
   *  (the authors saw a steady state after ≈4·10³ min); 'log' continues the log-linear fit. */
  leeExtrapolation: 'cap' | 'log';
}

export const DEFAULT_LAW_OPTIONS: LawOptions = { leeExtrapolation: 'cap' };

export interface CreepLaw {
  id: LawId;
  label: string;
  shortRef: string;
  reference: string;
  /** Temperature at which the law was measured (°C) */
  nativeTempC: number;
  /** Loading of the original tests: 'dynamic' = 1 Hz cyclic (σ is the PEAK pressure) */
  nativeLoading: Loading;
  material: string;
  testConditions: string;
  /** Range of times actually tested (s); outside it the law is an extrapolation */
  testedTimeRangeS: [number, number];
  /** Range of stresses actually tested (MPa) */
  testedStressRangeMPa: [number, number];
  formula: string;
  /** Creep strain for stress sigma (MPa) held a time t (s) */
  strain(sigma: number, t: number, opt: LawOptions): number;
  /** Time (s) at which the creep strain reaches eps under sigma. 0 if eps ≤ 0; Infinity if unreachable. */
  timeFor(sigma: number, eps: number, opt: LawOptions): number;
}

// ------------------------------------------------------------
// Lee, Pienkowski & Lee (2003), KSME Int J 17(9):1332–1338
// Dynamic compressive creep, extruded unirradiated GUR 4151HP, 37 °C bovine serum,
// sinusoidal 1 Hz, p_max = 2/4/8 MPa, R = 0.1, 10 → 10⁴ min.
// Strain linear in log(time) (r² = 0.97) and in p_max:
//   ε(10⁴ min) = 2.076·10⁻³ /MPa · p_max   (r² = 0.99)
//   slope      = 3.897·10⁻⁴ /log10(min)/MPa (r² = 0.99)
// Strains were measured on the unloaded specimen (thickness change), i.e. without the
// elastic part.
// ------------------------------------------------------------
const LEE_A = 2.076e-3;          // 1/MPa, strain per MPa at 10⁴ min
const LEE_B = 3.897e-4;          // 1/MPa per decade of minutes
const LEE_CAP_MIN = 1e4;         // last tested time (min)
const LEE_T0_MIN = Math.pow(10, 4 - LEE_A / LEE_B); // time at which the fit crosses zero (≈0.047 min)

const lee2003: CreepLaw = {
  id: 'lee2003',
  label: 'Lee et al. 2003 — dynamic, 37 °C',
  shortRef: 'Lee 2003',
  reference: 'Lee K-Y, Pienkowski D, Lee S. Dynamic compressive creep of extruded ultra-high molecular weight polyethylene. KSME Int J. 2003;17(9):1332–1338.',
  nativeTempC: 37,
  nativeLoading: 'dynamic',
  material: 'Extruded GUR 4151HP, unirradiated',
  testConditions: '1 Hz sinusoidal compression, p_max 2–8 MPa, R = 0.1, bovine serum 37 °C, 10–10⁴ min',
  testedTimeRangeS: [10 * SECONDS_PER_MINUTE, LEE_CAP_MIN * SECONDS_PER_MINUTE],
  testedStressRangeMPa: [2, 8],
  formula: 'ε = p_max · [2.076·10⁻³ + 3.897·10⁻⁴ · (log₁₀ t_min − 4)]',
  strain(sigma, t, opt) {
    if (!(sigma > 0) || !(t > 0)) return 0;
    let tMin = t / SECONDS_PER_MINUTE;
    if (opt.leeExtrapolation === 'cap' && tMin > LEE_CAP_MIN) tMin = LEE_CAP_MIN;
    const x = LEE_A + LEE_B * (Math.log10(tMin) - 4);
    return x > 0 ? sigma * x : 0;
  },
  timeFor(sigma, eps, opt) {
    if (!(sigma > 0)) return Infinity;
    if (!(eps > 0)) return 0;
    const L = 4 + (eps / sigma - LEE_A) / LEE_B;
    const tMin = Math.pow(10, L);
    if (opt.leeExtrapolation === 'cap' && tMin >= LEE_CAP_MIN) return Infinity;
    return Math.max(tMin, LEE_T0_MIN) * SECONDS_PER_MINUTE;
  },
};

// ------------------------------------------------------------
// Deng, Latour, Ogale & Shalaby (1998), J Biomed Mater Res 40:214–223
// Static compressive creep, compression-moulded GUR 405, 1 MPa, 37 °C.
// Eq. (2), best of the three analytical forms for long-term prediction:
//   D(t) = 1.294 · (log₁₀ t_s)^0.507   [1/GPa]   (t in s; check: D(1 month) = 3.320 1/GPa, Table III)
// Creep part = D(t) − D(10 s), with D(10 s) = 1.294 1/GPa.
// Linear viscoelastic (1 MPa): it under-predicts creep at hip contact stresses
// (compliance increases with stress — Lewis 2001, Metin 2016).
// ------------------------------------------------------------
const DENG_C1 = 1.294;   // 1/GPa
const DENG_B = 0.507;
const DENG_T_REF = 10;   // s

const deng1998: CreepLaw = {
  id: 'deng1998',
  label: 'Deng et al. 1998 — static, 37 °C',
  shortRef: 'Deng 1998',
  reference: 'Deng M, Latour RA, Ogale AA, Shalaby SW. Study of creep behavior of ultra-high-molecular-weight polyethylene systems. J Biomed Mater Res. 1998;40:214–223.',
  nativeTempC: 37,
  nativeLoading: 'static',
  material: 'Compression-moulded GUR 405, unirradiated',
  testConditions: 'Static compression 1 MPa, 37 °C; 30-min tests 37–62 °C, validated up to 30 days',
  testedTimeRangeS: [DENG_T_REF, 30 * 86400],
  testedStressRangeMPa: [1, 1],
  formula: 'ε = σ · [D(t) − D(10 s)],  D = 1.294 · (log₁₀ t_s)^0.507  [1/GPa]',
  strain(sigma, t) {
    if (!(sigma > 0) || !(t > DENG_T_REF)) return 0;
    const L = Math.log10(t);
    return sigma * DENG_C1 * (Math.pow(L, DENG_B) - 1) / 1000;
  },
  timeFor(sigma, eps) {
    if (!(sigma > 0)) return Infinity;
    if (!(eps > 0)) return 0;
    const y = 1 + (1000 * eps) / (DENG_C1 * sigma);
    return Math.pow(10, Math.pow(y, 1 / DENG_B));
  },
};

// ------------------------------------------------------------
// Lewis & Carroll (2001), Bio-Med Mater Eng 11:167–183
// Quasi-static compressive creep, ram-extruded GUR 1050 (control, uncrosslinked),
// 6.89 MPa, 1 h, laboratory air 22 ± 1 °C. Table 2:
//   C′(t) = δ + λ · (log₁₀ t_s)^η  [% / MPa],  δ = −0.0103, λ = 0.0644, η = 1.4119
// (check: σ = 5 MPa, 10 y → 6.5 %, Table 3). Strain was measured from 10 s, so the
// creep part is λ·[(log t)^η − 1].
// ------------------------------------------------------------
const LEWIS = { delta: -0.0103, lambda: 0.0644, eta: 1.4119 };
const LEWIS_T_REF = 10; // s

const lewis2001: CreepLaw = {
  id: 'lewis2001',
  label: 'Lewis & Carroll 2001 — static, 22 °C',
  shortRef: 'Lewis 2001',
  reference: 'Lewis G, Carroll M. Effect of crosslinking UHMWPE on its tensile and compressive creep performance. Bio-Med Mater Eng. 2001;11:167–183.',
  nativeTempC: 22,
  nativeLoading: 'static',
  material: 'Ram-extruded GUR 1050, unirradiated (control)',
  testConditions: 'Static compression 6.89 MPa, 1 h, air 22 °C (ASTM D621)',
  testedTimeRangeS: [LEWIS_T_REF, 3600],
  testedStressRangeMPa: [6.89, 6.89],
  formula: 'ε = σ · λ · [(log₁₀ t_s)^η − 1] / 100,  λ = 0.0644, η = 1.4119',
  strain(sigma, t) {
    if (!(sigma > 0) || !(t > LEWIS_T_REF)) return 0;
    const L = Math.log10(t);
    return sigma * LEWIS.lambda * (Math.pow(L, LEWIS.eta) - 1) / 100;
  },
  timeFor(sigma, eps) {
    if (!(sigma > 0)) return Infinity;
    if (!(eps > 0)) return 0;
    const y = 1 + (100 * eps) / (LEWIS.lambda * sigma);
    return Math.pow(10, Math.pow(y, 1 / LEWIS.eta));
  },
};

/** Raw compliance relations, exported for the validation tests */
export const RAW = {
  /** Lee 2003 dynamic creep strain per MPa of peak pressure */
  leePerMPa: (tMin: number) => LEE_A + LEE_B * (Math.log10(tMin) - 4),
  /** Deng 1998 Eq. (2), total compliance in 1/GPa */
  dengCompliance: (tS: number) => DENG_C1 * Math.pow(Math.log10(tS), DENG_B),
  /** Lewis 2001 compressive compliance C′ in %/MPa (control) */
  lewisCompliance: (tS: number) => LEWIS.delta + LEWIS.lambda * Math.pow(Math.log10(tS), LEWIS.eta),
};

export const LAWS: Record<LawId, CreepLaw> = { lee2003, deng1998, lewis2001 };
export const LAW_IDS: LawId[] = ['lee2003', 'deng1998', 'lewis2001'];
