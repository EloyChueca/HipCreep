// ============================================================
// HipCreep — synthetic liner (phantom) in the HipWear export format
// ------------------------------------------------------------
// A hemispherical bearing surface (trimmed at 88°) with a known remaining creep,
// a known wear scar, a ring of creep-flow elevation and Gaussian scanner noise.
// Used for the demo case and for the regression tests.
// ============================================================

import { FORMAT_ID, FORMAT_VERSION, type HipCreepInputFile } from './hipwear.ts';
import { mulberry32, normal } from '../model/stats.ts';

export interface PhantomOptions {
  headRadiusMm: number;
  clearanceMm: number;
  loadAngleDeg: number;
  creepRemainingUm: number;
  creepHalfAngleDeg: number;
  wearUm: number;
  wearHalfAngleDeg: number;
  elevationUm: number;
  elevationAtDeg: number;
  elevationWidthDeg: number;
  noiseUm: number;
  trimDeg: number;
  dThetaDeg: number;
  dAzDeg: number;
  seed: number;
}

export const DEFAULT_PHANTOM: PhantomOptions = {
  headRadiusMm: 14,
  clearanceMm: 0.05,
  loadAngleDeg: 20,
  creepRemainingUm: 40,
  creepHalfAngleDeg: 60,
  wearUm: 60,
  wearHalfAngleDeg: 40,
  elevationUm: 15,
  elevationAtDeg: 70,
  elevationWidthDeg: 5,
  noiseUm: 4,
  trimDeg: 88,
  dThetaDeg: 0.75,
  dAzDeg: 1.5,
  seed: 7,
};

const cap = (cosPsi: number, halfDeg: number) => {
  const c = Math.cos(halfDeg * Math.PI / 180);
  return cosPsi > c ? (cosPsi - c) / (1 - c) : 0;
};

/** Penetration (µm, + into the wall) of the phantom at angle ψ from the load axis, without noise */
export function phantomField(o: PhantomOptions, psiRad: number): { creep: number; wear: number; elevation: number } {
  const cp = Math.cos(psiRad);
  const psiDeg = psiRad * 180 / Math.PI;
  return {
    creep: o.creepRemainingUm * cap(cp, o.creepHalfAngleDeg),
    wear: o.wearUm * cap(cp, o.wearHalfAngleDeg),
    elevation: o.elevationUm * Math.exp(-0.5 * ((psiDeg - o.elevationAtDeg) / o.elevationWidthDeg) ** 2),
  };
}

export function makePhantom(opt: Partial<PhantomOptions> = {}, meta: { yearsInVivo?: number; daysExVivo?: number } = {}): HipCreepInputFile {
  const o = { ...DEFAULT_PHANTOM, ...opt };
  const rng = mulberry32(o.seed);
  const R = o.headRadiusMm + o.clearanceMm;
  const a = o.loadAngleDeg * Math.PI / 180;
  const load = [Math.sin(a), 0, Math.cos(a)];
  const nT = Math.round(o.trimDeg / o.dThetaDeg);
  const nA = Math.round(360 / o.dAzDeg);
  const verts: number[] = [];
  const faces: number[] = [];
  let elevVol = 0, wearVol = 0, creepVol = 0;
  const push = (th: number, az: number) => {
    const m = [Math.sin(th) * Math.cos(az), Math.sin(th) * Math.sin(az), Math.cos(th)];
    const psi = Math.acos(Math.max(-1, Math.min(1, m[0] * load[0] + m[1] * load[1] + m[2] * load[2])));
    const f = phantomField(o, psi);
    const dev = f.creep + f.wear - f.elevation + normal(rng, 0, o.noiseUm);
    const r = R + dev / 1000;
    verts.push(r * m[0], r * m[1], r * m[2]);
    return f;
  };
  push(0, 0); // pole
  for (let i = 1; i <= nT; i++) {
    const th = (i * o.dThetaDeg) * Math.PI / 180;
    for (let j = 0; j < nA; j++) {
      const az = (j * o.dAzDeg) * Math.PI / 180;
      const f = push(th, az);
      // exact-ish volumes for the truth record (ring area element)
      const dA = R * R * Math.sin(th) * (o.dThetaDeg * Math.PI / 180) * (o.dAzDeg * Math.PI / 180);
      elevVol += f.elevation * dA * 1e-3;
      wearVol += f.wear * dA * 1e-3;
      creepVol += f.creep * dA * 1e-3;
    }
  }
  const idx = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * nA + (j % nA));
  for (let j = 0; j < nA; j++) faces.push(0, idx(1, j), idx(1, j + 1));
  for (let i = 1; i < nT; i++) {
    for (let j = 0; j < nA; j++) {
      faces.push(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1));
      faces.push(idx(i, j), idx(i + 1, j + 1), idx(i, j + 1));
    }
  }
  const D = o.creepRemainingUm + o.wearUm;
  const round = (x: number, d = 5) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    source: {
      program: 'HipCreep phantom',
      programVersion: '1',
      file: 'phantom',
      exportedAt: new Date(0).toISOString(),
      truth: {
        creepRemainingUm: o.creepRemainingUm,
        wearUm: o.wearUm,
        elevationPeakUm: o.elevationUm,
        elevationVolumeMm3: elevVol,
        wearVolumeMm3: wearVol,
        creepVolumeMm3: creepVol,
        noiseUm: o.noiseUm,
      },
    },
    case: { id: 'PHANTOM', yearsInVivo: meta.yearsInVivo ?? 0.5, daysExVivo: meta.daysExVivo ?? 30 },
    implant: { headDiameterMm: 2 * o.headRadiusMm, material: 'conventional' },
    geometry: {
      commercialRadiusMm: o.headRadiusMm,
      measuredRadiusMm: R,
      measuredRadiusReliable: true,
      originalCenter: [0, 0, 0],
      displacedCenter: [round(load[0] * D / 1000, 7), 0, round(load[2] * D / 1000, 7)],
      poleAxis: [0, 0, 1],
      rimPlane: { point: [0, 0, 0], normal: [0, 0, 1] },
      wallThicknessMm: { mean: 8, sd: 0.15, atPenetration: 8 },
      outerShellRadiusMm: R + 8,
    },
    wear: {
      model: 'two-sphere-auto',
      linearWearUm: D,
      linearWearSdUm: 8,
      volumeMm3: round(wearVol + creepVol, 4),
      volumeSdMm3: 1.5,
      directionAngleDeg: o.loadAngleDeg,
      detectionLimitUm: null,
    },
    uncertainty: { noiseSigmaUm: o.noiseUm, surfaceUncertaintyUm: 0, formRmsUm: 1 },
    mesh: { vertices: verts.map((x) => round(x, 5)), faces },
  };
}
