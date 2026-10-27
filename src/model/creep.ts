// ============================================================
// HipCreep — analytic creep model of a UHMWPE acetabular liner
// ------------------------------------------------------------
// 1. Contact: elastic-foundation (Winkler) model of a ball in a spherical socket
//    with radial clearance c (Jin et al.-type model). At angle ψ from the load axis
//    the interference is  δ(ψ) = e·cosψ − c − w(ψ,φ)  (e: head displacement, w: creep
//    already accumulated) and the contact pressure is  p = k_f·⟨δ⟩,
//    k_f = E_f/h,  E_f = (1−ν)E / [(1+ν)(1−2ν)]  (thin layer bonded to a rigid shell).
//    e is solved from the force balance  F = Σ p·cosψ·dA  (Newton, convex problem).
//    Without clearance this gives the classic p₀ = 3F/(2πR²).
//    Cells beyond the rim (angle from the cup pole > coverage) carry no load.
// 2. Through the wall the stress decays as σ(r) = p·(R_c/r)² (load spreading in a cone).
// 3. Creep: each wall layer follows the chosen law with a STRAIN-HARDENING rule, so the
//    pressure can redistribute while the liner conforms to the head ("conform" option).
//    Penetration w(ψ,φ) = κ·Σ ε_layer·Δr.
// 4. Loading modes (Lee 2003: a 1 Hz cycle with peak p creeps like a static p·k, k ≈ 0.65):
//    • static  — the force is held constant for the whole implantation time;
//    • dynamic — 1 Hz cyclic gait load with that peak, for the cumulative walking time.
//    A static law used in dynamic mode sees σ·k; the dynamic law (Lee) in static mode σ/k.
// 5. Temperature: the law time is t·a_T(T_in-vivo, T_law) (time–temperature superposition).
// ============================================================

import { DEG } from './constants.ts';
import type { CreepLaw, LawOptions, Loading } from './laws.ts';
import { shiftFactor } from './temperature.ts';

export interface Geometry {
  /** Femoral head radius (mm) */
  headRadiusMm: number;
  /** Radial clearance: liner radius − head radius (mm) */
  clearanceMm: number;
  /** Liner wall thickness under the load (mm) */
  thicknessMm: number;
  /** Angle between the load (penetration) axis and the cup pole axis (deg) */
  loadAngleDeg: number;
  /** Angular extent of the bearing surface measured from the pole (deg); 90 = hemisphere */
  coverageDeg: number;
}

export interface Elastic { E: number; nu: number }

export interface Resolution {
  nPsi: number; nPhi: number; nLayers: number; nSteps: number;
  /** Largest relative pressure change allowed in one integration sub-step */
  tol: number;
}

export const RES_FINE: Resolution = { nPsi: 36, nPhi: 18, nLayers: 10, nSteps: 40, tol: 0.25 };
export const RES_MC: Resolution = { nPsi: 14, nPhi: 7, nLayers: 5, nSteps: 20, tol: 0.35 };

export interface SimInput {
  law: CreepLaw;
  lawOpt: LawOptions;
  mode: Loading;
  /** Static force, or PEAK force of the 1 Hz cycle in dynamic mode (N) */
  forceN: number;
  /** Physical loading time (s): implantation time (static) or cumulative walking time (dynamic) */
  timeS: number;
  /** Lee 2003 dynamic/static equivalence factor k (≈ 0.65) */
  dynStaticRatio: number;
  /** Temperature of the creeping polyethylene (°C) */
  tempC: number;
  /** Activation energy for the temperature shift (kcal/mol) */
  eaKcal: number;
  /** Multiplier of the creep strain for the polyethylene grade */
  materialFactor: number;
  /** Confinement factor applied to the uniaxial creep strain (1 = uniaxial) */
  kappa: number;
  geometry: Geometry;
  elastic: Elastic;
  res: Resolution;
  /** Update the contact pressure as the liner creeps (strain hardening) */
  conform: boolean;
  /** Keep the time history of the maximum creep */
  history?: boolean;
}

export interface CreepGrid {
  nPsi: number;
  nPhi: number;
  /** Cell-centre angle from the load axis (rad), length nPsi */
  psi: Float64Array;
  /** Cell-centre azimuth about the load axis (rad, 0 = towards the pole, π = towards the rim), length nPhi */
  phi: Float64Array;
  /** Cell area on the liner surface (mm²), counting the mirrored half; index i*nPhi + j */
  area: Float64Array;
  /** 1 if the cell lies on the bearing surface (inside the rim) */
  inside: Uint8Array;
  /** Angle of each cell from the cup pole (rad) */
  poleAngle: Float64Array;
}

export interface SimResult {
  /** Maximum creep penetration at the end of loading (mm) */
  maxCreepMm: number;
  /** Creep penetration per cell (mm) */
  creepMap: Float64Array;
  grid: CreepGrid;
  pressureInitial: Float64Array;
  pressureFinal: Float64Array;
  peakPressureInitialMPa: number;
  peakPressureFinalMPa: number;
  contactHalfAngleInitialDeg: number;
  contactHalfAngleFinalDeg: number;
  /** ∫ w dA (mm³) */
  creepVolumeMm3: number;
  /** ∫ (w / w_max) dA (mm²): converts a creep volume into a peak creep depth with this shape */
  shapeAreaMm2: number;
  /** Stress multiplier applied for the loading-mode conversion */
  loadingFactor: number;
  /** Time multiplier of the temperature shift */
  timeShift: number;
  /** Largest stress the law was evaluated at (MPa) and longest law time (s) */
  maxLawStressMPa: number;
  lawTimeS: number;
  stressExtrapolated: boolean;
  timeExtrapolated: boolean;
  /** The contact patch reaches the rim of the liner */
  edgeLoading: boolean;
  /** Number of integration sub-steps taken */
  substeps: number;
  history?: { tS: Float64Array; maxCreepMm: Float64Array };
}

/** Foundation modulus of a thin layer bonded to a rigid backing (MPa) */
export function foundationModulus(E: number, nu: number): number {
  return ((1 - nu) * E) / ((1 + nu) * (1 - 2 * nu));
}

/** Stress-conversion factor between the requested loading mode and the law's native loading */
export function loadingFactor(mode: Loading, lawLoading: Loading, k: number): number {
  if (mode === lawLoading) return 1;
  return mode === 'dynamic' ? k : 1 / k;
}

export function buildGrid(geom: Geometry, nPsi: number, nPhi: number): CreepGrid {
  const Rc = geom.headRadiusMm + Math.max(0, geom.clearanceMm);
  const psi = new Float64Array(nPsi);
  const phi = new Float64Array(nPhi);
  const area = new Float64Array(nPsi * nPhi);
  const inside = new Uint8Array(nPsi * nPhi);
  const poleAngle = new Float64Array(nPsi * nPhi);
  const dPsi = (90 * DEG) / nPsi;
  const dPhi = Math.PI / nPhi;
  const a = geom.loadAngleDeg * DEG;
  const cov = geom.coverageDeg * DEG;
  for (let j = 0; j < nPhi; j++) phi[j] = (j + 0.5) * dPhi;
  for (let i = 0; i < nPsi; i++) {
    const lo = i * dPsi, hi = (i + 1) * dPsi;
    psi[i] = (i + 0.5) * dPsi;
    const ringArea = 2 * Rc * Rc * (Math.cos(lo) - Math.cos(hi)) * dPhi; // ×2: mirrored half
    for (let j = 0; j < nPhi; j++) {
      const k = i * nPhi + j;
      area[k] = ringArea;
      const cb = Math.cos(psi[i]) * Math.cos(a) + Math.sin(psi[i]) * Math.cos(phi[j]) * Math.sin(a);
      const beta = Math.acos(Math.max(-1, Math.min(1, cb)));
      poleAngle[k] = beta;
      inside[k] = beta <= cov ? 1 : 0;
    }
  }
  return { nPsi, nPhi, psi, phi, area, inside, poleAngle };
}

/**
 * Solve the contact pressure for a force F (N) given the current creep map w (mm).
 * Returns the head displacement e (mm) and fills `p`.
 */
export function solveContact(
  grid: CreepGrid, w: Float64Array, F: number, clearance: number, kf: number, p: Float64Array,
): number {
  const { nPsi, nPhi, psi, area, inside } = grid;
  const n = nPsi * nPhi;
  const cosPsi = new Float64Array(nPsi);
  for (let i = 0; i < nPsi; i++) cosPsi[i] = Math.cos(psi[i]);

  const force = (e: number): [number, number] => {
    let f = 0, df = 0;
    for (let i = 0; i < nPsi; i++) {
      const c = cosPsi[i];
      for (let j = 0; j < nPhi; j++) {
        const k = i * nPhi + j;
        if (!inside[k]) continue;
        const d = e * c - clearance - w[k];
        if (d > 0) {
          f += kf * d * c * area[k];
          df += kf * c * c * area[k];
        }
      }
    }
    return [f, df];
  };

  // Upper bracket
  let aEff = 0, wMax = 0;
  for (let k = 0; k < n; k++) {
    if (!inside[k]) continue;
    const c = cosPsi[Math.floor(k / nPhi)];
    aEff += c * c * area[k];
    if (w[k] > wMax) wMax = w[k];
  }
  let e = clearance + wMax + F / (kf * Math.max(aEff, 1e-9));
  for (let it = 0; it < 60 && force(e)[0] < F; it++) e = 2 * e + 1e-6;
  // Newton from the right (convex increasing function → monotone convergence)
  for (let it = 0; it < 60; it++) {
    const [f, df] = force(e);
    const r = f - F;
    if (Math.abs(r) <= 1e-9 * F || df <= 0) break;
    e -= r / df;
  }
  for (let i = 0; i < nPsi; i++) {
    const c = cosPsi[i];
    for (let j = 0; j < nPhi; j++) {
      const k = i * nPhi + j;
      const d = e * c - clearance - w[k];
      p[k] = inside[k] && d > 0 ? kf * d : 0;
    }
  }
  return e;
}

function contactHalfAngleDeg(grid: CreepGrid, p: Float64Array): number {
  let m = 0;
  for (let i = 0; i < grid.nPsi; i++) {
    for (let j = 0; j < grid.nPhi; j++) {
      if (p[i * grid.nPhi + j] > 0) { m = Math.max(m, grid.psi[i]); break; }
    }
  }
  return m / DEG;
}

export function simulate(inp: SimInput): SimResult {
  const { law, lawOpt, geometry: g, res } = inp;
  const grid = buildGrid(g, res.nPsi, res.nPhi);
  const n = res.nPsi * res.nPhi;
  const nL = res.nLayers;
  const Rc = g.headRadiusMm + Math.max(0, g.clearanceMm);
  const h = g.thicknessMm;
  const kf = foundationModulus(inp.elastic.E, inp.elastic.nu) / h;
  const conv = loadingFactor(inp.mode, law.nativeLoading, inp.dynStaticRatio);
  const aT = shiftFactor(inp.tempC, law.nativeTempC, inp.eaKcal);
  const m = inp.materialFactor;

  // Wall layers (midpoint rule) and their stress factors (R_c/r)²
  const dr = h / nL;
  const sFac = new Float64Array(nL);
  for (let l = 0; l < nL; l++) {
    const r = Rc + (l + 0.5) * dr;
    sFac[l] = (Rc / r) * (Rc / r);
  }

  const eps = new Float64Array(n * nL);
  const w = new Float64Array(n);
  const p = new Float64Array(n);
  const pInit = new Float64Array(n);

  // Log-spaced physical times from 10 s to the end of loading
  const tEnd = Math.max(inp.timeS, 11);
  const t0 = 10;
  const times: number[] = [];
  for (let s = 0; s < res.nSteps; s++) times.push(t0 * Math.pow(tEnd / t0, s / (res.nSteps - 1)));

  const histT = inp.history ? new Float64Array(times.length) : undefined;
  const histW = inp.history ? new Float64Array(times.length) : undefined;

  let maxSigma = 0;
  const clr = Math.max(0, g.clearanceMm);
  const nPhi = res.nPhi;
  const cosPsi = new Float64Array(res.nPsi);
  for (let i = 0; i < res.nPsi; i++) cosPsi[i] = Math.cos(grid.psi[i]);
  const epsTrial = new Float64Array(n * nL);
  const wTrial = new Float64Array(n);

  /** Creep increment over a law-time step dTau with the current pressure; returns the largest
   *  non-rigid part of Δw (mm), which sets the pressure change of the step. */
  const trialStep = (dTau: number): number => {
    let dwMax = 0;
    for (let k = 0; k < n; k++) {
      const pk = p[k];
      if (!(pk > 0)) { wTrial[k] = w[k]; continue; }
      let wk = 0;
      for (let l = 0; l < nL; l++) {
        const sigma = pk * conv * sFac[l];
        if (sigma > maxSigma) maxSigma = sigma;
        const idx = k * nL + l;
        const cur = eps[idx];
        let nxt = cur;
        const tStar = cur > 0 ? law.timeFor(sigma, cur / m, lawOpt) : 0;
        if (tStar !== Infinity) {
          const e2 = m * law.strain(sigma, tStar + dTau, lawOpt);
          if (e2 > cur) nxt = e2;
        }
        epsTrial[idx] = nxt;
        wk += nxt;
      }
      wTrial[k] = inp.kappa * wk * dr;
    }
    // Only the part of Δw that is not a rigid head translation (Δe·cosψ) changes the
    // pressure: Δp ≈ k_f·(λ·cosψ − Δw). Return the largest such deviation.
    let sxy = 0, sxx = 0;
    for (let k = 0; k < n; k++) {
      if (!(p[k] > 0)) continue;
      const c = cosPsi[Math.floor(k / nPhi)];
      sxy += grid.area[k] * c * (wTrial[k] - w[k]);
      sxx += grid.area[k] * c * c;
    }
    const lam = sxx > 0 ? sxy / sxx : 0;
    for (let k = 0; k < n; k++) {
      if (!(p[k] > 0)) continue;
      const c = cosPsi[Math.floor(k / nPhi)];
      const d = Math.abs(wTrial[k] - w[k] - lam * c);
      if (d > dwMax) dwMax = d;
    }
    return dwMax;
  };
  const commit = () => {
    for (let k = 0; k < n; k++) {
      if (!(p[k] > 0)) continue;
      for (let l = 0; l < nL; l++) eps[k * nL + l] = epsTrial[k * nL + l];
      w[k] = wTrial[k];
    }
  };

  // Explicit integration with adaptive sub-steps: when the liner conforms, a step whose
  // creep would change the contact pressure by more than TOL·p_max over-shoots the
  // redistribution, so such steps are split (step size remembered between steps).
  const TOL = res.tol;
  let tCur = 0;
  let budget = 4000;
  let lastDt = Infinity;
  let nSub = 0;
  solveContact(grid, w, inp.forceN, clr, kf, p);
  pInit.set(p);
  for (let s = 0; s < times.length; s++) {
    const target = times[s];
    while (tCur < target - 1e-9 * target) {
      let dt = Math.min(target - tCur, 4 * lastDt);
      if (inp.conform) {
        let pMax = 0;
        for (let k = 0; k < n; k++) if (p[k] > pMax) pMax = p[k];
        const limit = TOL * pMax / kf;
        while (budget > 0) {
          const dw = trialStep(dt * aT);
          if (dw <= limit || dt <= 1e-3 * tCur) break;
          dt *= 0.5;
          budget--;
        }
      } else {
        trialStep(dt * aT);
      }
      commit();
      tCur += dt;
      lastDt = dt;
      nSub++;
      if (inp.conform) solveContact(grid, w, inp.forceN, clr, kf, p);
    }
    if (histT && histW) {
      histT[s] = target;
      let mx = 0;
      for (let k = 0; k < n; k++) if (w[k] > mx) mx = w[k];
      histW[s] = mx;
    }
  }

  let wMax = 0, vol = 0;
  for (let k = 0; k < n; k++) {
    if (w[k] > wMax) wMax = w[k];
    vol += w[k] * grid.area[k];
  }
  let pi0 = 0, pf = 0, edge = false;
  const cov = g.coverageDeg * DEG;
  const dPsi = (90 * DEG) / res.nPsi;
  for (let k = 0; k < n; k++) {
    if (pInit[k] > pi0) pi0 = pInit[k];
    if (p[k] > pf) pf = p[k];
  }
  // Edge loading: a substantial pressure (> 50 % of the peak) on the cells next to the rim
  for (let k = 0; k < n; k++) {
    if (grid.inside[k] && grid.poleAngle[k] > cov - 1.5 * dPsi && (pInit[k] > 0.5 * pi0 || p[k] > 0.5 * pf)) edge = true;
  }
  const lawTime = tEnd * aT;
  return {
    maxCreepMm: wMax,
    creepMap: w,
    grid,
    pressureInitial: pInit,
    pressureFinal: p,
    peakPressureInitialMPa: pi0,
    peakPressureFinalMPa: pf,
    contactHalfAngleInitialDeg: contactHalfAngleDeg(grid, pInit),
    contactHalfAngleFinalDeg: contactHalfAngleDeg(grid, p),
    creepVolumeMm3: vol,
    shapeAreaMm2: wMax > 0 ? vol / wMax : 0,
    loadingFactor: conv,
    timeShift: aT,
    maxLawStressMPa: maxSigma,
    lawTimeS: lawTime,
    stressExtrapolated: maxSigma > law.testedStressRangeMPa[1] * 1.05,
    timeExtrapolated: lawTime > law.testedTimeRangeS[1] * 1.05,
    edgeLoading: edge,
    substeps: nSub,
    history: histT && histW ? { tS: histT, maxCreepMm: histW } : undefined,
  };
}

/** Bilinear sample of a per-cell field at (ψ, |φ|) in radians; 0 beyond 90°. */
export function sampleGrid(grid: CreepGrid, field: Float64Array, psi: number, phi: number): number {
  const { nPsi, nPhi } = grid;
  const dPsi = (Math.PI / 2) / nPsi;
  const dPhi = Math.PI / nPhi;
  const aphi = Math.min(Math.abs(phi), Math.PI);
  if (psi > Math.PI / 2) return 0;
  let x = psi / dPsi - 0.5, y = aphi / dPhi - 0.5;
  x = Math.max(0, Math.min(nPsi - 1, x));
  y = Math.max(0, Math.min(nPhi - 1, y));
  const i0 = Math.floor(x), j0 = Math.floor(y);
  const i1 = Math.min(nPsi - 1, i0 + 1), j1 = Math.min(nPhi - 1, j0 + 1);
  const fx = x - i0, fy = y - j0;
  const v00 = field[i0 * nPhi + j0], v01 = field[i0 * nPhi + j1];
  const v10 = field[i1 * nPhi + j0], v11 = field[i1 * nPhi + j1];
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}
