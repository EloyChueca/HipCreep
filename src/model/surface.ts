// ============================================================
// HipCreep — measured bearing surface (from HipWear)
// ------------------------------------------------------------
// The sphere-to-plane step: every vertex v of the inner surface is expressed in
// spherical coordinates about the centre O of the ORIGINAL cavity sphere
//     r = |v − O|,  dev = r − R_ref   (µm; > 0 penetration, < 0 elevation)
// and projected azimuthally about the cup pole axis (polar angle θ from the pole,
// azimuth measured from the penetration direction). In that plane the "zero" is the
// original surface (r = R_ref); penetration shows as positive peaks and material
// pushed ABOVE the original surface (creep flow) as negative peaks (elevations).
//
// Elevations cannot be produced by wear, only by plastic flow (or by form error of
// the liner / error of the reference radius). Creep conserves volume, so the volume
// of the elevations is a LOWER BOUND of the creep volume still present in the liner.
// ============================================================

import { normCdf, normPdf } from './stats.ts';
import { sampleGrid, type CreepGrid } from './creep.ts';

export type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface SurfaceMesh {
  /** xyz interleaved (mm) */
  vertices: Float64Array;
  /** triangle vertex indices */
  faces: Uint32Array;
}

export interface Frame {
  /** Centre of the original (unworn) cavity sphere */
  center: Vec3;
  /** Reference radius of the original surface (mm) */
  radiusMm: number;
  /** Unit vector from the rim plane toward the pole */
  pole: Vec3;
  /** Penetration (load) direction — displaced − original centre; null if unknown */
  load: Vec3 | null;
}

/** Orthonormal bases derived from a frame */
export interface Bases {
  pole: Vec3;
  load: Vec3;
  /** Map "up": load direction projected on the plane ⟂ pole */
  up: Vec3;
  right: Vec3;
  /** In the load frame: e1 points from the load axis toward the pole */
  e1: Vec3;
  e2: Vec3;
  loadAngleRad: number;
}

export function makeBases(f: Frame): Bases {
  const pole = unit(f.pole);
  let load = f.load ? unit(f.load) : pole;
  if (dot(load, pole) < 0) load = scale(load, -1);
  let up = sub(load, scale(pole, dot(load, pole)));
  if (norm(up) < 1e-6) up = Math.abs(pole[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  up = unit(sub(up, scale(pole, dot(up, pole))));
  const right = cross(pole, up);
  const a = Math.acos(Math.max(-1, Math.min(1, dot(load, pole))));
  let e1 = sub(pole, scale(load, Math.cos(a)));
  if (norm(e1) < 1e-6) e1 = scale(up, -1);
  e1 = unit(e1);
  const e2 = cross(load, e1);
  return { pole, load, up, right, e1, e2, loadAngleRad: a };
}

export interface SurfaceData {
  n: number;
  devUm: Float64Array;
  area: Float64Array;
  /** Polar angle from the cup pole (rad) */
  theta: Float64Array;
  /** Azimuth about the pole, 0 = penetration direction (rad, −π…π) */
  azimuth: Float64Array;
  /** Angle from the load axis (rad) */
  psi: Float64Array;
  /** |Azimuth| about the load axis, 0 toward the pole (rad) */
  phiLoad: Float64Array;
  totalAreaMm2: number;
  maxThetaRad: number;
  bases: Bases;
}

export function analyseSurface(mesh: SurfaceMesh, frame: Frame): SurfaceData {
  const V = mesh.vertices, F = mesh.faces;
  const n = V.length / 3;
  const area = new Float64Array(n);
  let total = 0;
  for (let f = 0; f + 2 < F.length; f += 3) {
    const i = F[f], j = F[f + 1], k = F[f + 2];
    const a: Vec3 = [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
    const b: Vec3 = [V[3 * j], V[3 * j + 1], V[3 * j + 2]];
    const c: Vec3 = [V[3 * k], V[3 * k + 1], V[3 * k + 2]];
    const A = 0.5 * norm(cross(sub(b, a), sub(c, a)));
    area[i] += A / 3; area[j] += A / 3; area[k] += A / 3;
    total += A;
  }
  const B = makeBases(frame);
  const devUm = new Float64Array(n);
  const theta = new Float64Array(n);
  const azimuth = new Float64Array(n);
  const psi = new Float64Array(n);
  const phiLoad = new Float64Array(n);
  let maxTheta = 0;
  for (let v = 0; v < n; v++) {
    const d: Vec3 = [V[3 * v] - frame.center[0], V[3 * v + 1] - frame.center[1], V[3 * v + 2] - frame.center[2]];
    const r = norm(d);
    devUm[v] = (r - frame.radiusMm) * 1000;
    const m = scale(d, 1 / (r || 1));
    theta[v] = Math.acos(Math.max(-1, Math.min(1, dot(m, B.pole))));
    azimuth[v] = Math.atan2(dot(m, B.right), dot(m, B.up));
    psi[v] = Math.acos(Math.max(-1, Math.min(1, dot(m, B.load))));
    phiLoad[v] = Math.abs(Math.atan2(dot(m, B.e2), dot(m, B.e1)));
    if (area[v] > 0 && theta[v] > maxTheta) maxTheta = theta[v];
  }
  return { n, devUm, area, theta, azimuth, psi, phiLoad, totalAreaMm2: total, maxThetaRad: maxTheta, bases: B };
}

// ------------------------------------------------------------
// Elevation volume → minimum creep
// ------------------------------------------------------------

export interface ElevationRow {
  k: number;
  sigmaUm: number;
  thresholdUm: number;
  rawMm3: number;
  noiseFloorMm3: number;
  netMm3: number;
  elevatedAreaMm2: number;
}

export interface ElevationResult {
  sigmaEffUm: number;
  analysedAreaMm2: number;
  rows: ElevationRow[];
  nominal: ElevationRow;
  netRangeMm3: [number, number];
  /** Volume above the threshold on the penetration side (≈ HipWear penetration volume) */
  penetrationVolumeMm3: number;
  /** Area-weighted mean angle of the elevations from the load axis and from the pole (deg) */
  elevationPsiDeg: number;
  elevationThetaDeg: number;
  /** Change of the elevation volume per µm of error in the reference radius (mm³/µm) */
  radiusSensitivityMm3PerUm: number;
  /** Measured elevated zone, no model and no threshold: everything above the original sphere */
  raw: ElevatedZone;
}

/** The material above the original surface as measured (v0.13) */
export interface ElevatedZone {
  /** Volume above the original sphere (mm³), no threshold */
  volumeMm3: number;
  /** Area above the original sphere (mm²) */
  areaMm2: number;
  /** Highest point: elevation (µm) and its angle from the cup pole (deg) */
  peakUm: number;
  peakThetaDeg: number;
  /** Mean elevation of the highest 1 mm² (µm): the peak, less sensitive to a single noisy vertex */
  peak1mm2Um: number;
}

/** Volume, area and peak of the material above the original sphere (rim band excluded) */
export function elevatedZone(s: SurfaceData, rimBandDeg = 2): ElevatedZone {
  const thetaMax = s.maxThetaRad - rimBandDeg * Math.PI / 180;
  let vol = 0, area = 0, peak = 0, peakTheta = NaN;
  const idx: number[] = [];
  for (let v = 0; v < s.n; v++) {
    if (s.theta[v] > thetaMax) continue;
    const e = -s.devUm[v];
    if (e <= 0) continue;
    vol += s.area[v] * e; area += s.area[v]; idx.push(v);
    if (e > peak) { peak = e; peakTheta = s.theta[v]; }
  }
  idx.sort((a, b) => s.devUm[a] - s.devUm[b]);       // highest elevation first
  let a1 = 0, w1 = 0;
  for (const v of idx) {
    if (a1 >= 1) break;
    const da = Math.min(s.area[v], 1 - a1);
    w1 += da * -s.devUm[v]; a1 += da;
  }
  return { volumeMm3: vol * 1e-3, areaMm2: area, peakUm: peak, peakThetaDeg: peakTheta * 180 / Math.PI, peak1mm2Um: a1 > 0 ? w1 / a1 : 0 };
}

/** E[(X − a)+] for X ~ N(0, σ) */
export function expectedExcess(sigma: number, a: number): number {
  if (!(sigma > 0)) return 0;
  const z = a / sigma;
  return sigma * normPdf(z) - a * (1 - normCdf(z));
}

/**
 * Volume of the elevations (material above the original surface) beyond a threshold
 * k·σ_eff, minus the volume pure measurement noise would give (noise floor).
 * σ_eff combines scanner noise and the surface (paint) uncertainty.
 */
export function elevationAnalysis(
  s: SurfaceData, noiseSigmaUm: number, surfaceUncUm: number, rimBandDeg = 2, kList = [2, 1, 3], sigmaScales = [0.8, 1, 1.2],
): ElevationResult {
  const sigmaEff = Math.sqrt(noiseSigmaUm * noiseSigmaUm + surfaceUncUm * surfaceUncUm) || 1;
  const thetaMax = s.maxThetaRad - rimBandDeg * Math.PI / 180;
  let A = 0;
  for (let v = 0; v < s.n; v++) if (s.theta[v] <= thetaMax) A += s.area[v];
  const rows: ElevationRow[] = [];
  for (const k of kList) {
    for (const sc of sigmaScales) {
      const sig = sigmaEff * sc;
      const thr = k * sig;
      let raw = 0, ea = 0;
      for (let v = 0; v < s.n; v++) {
        if (s.theta[v] > thetaMax) continue;
        const e = -s.devUm[v] - thr;
        if (e > 0) { raw += s.area[v] * e; ea += s.area[v]; }
      }
      const rawMm3 = raw * 1e-3;
      const floor = A * expectedExcess(sig, thr) * 1e-3;
      rows.push({ k, sigmaUm: sig, thresholdUm: thr, rawMm3, noiseFloorMm3: floor, netMm3: Math.max(0, rawMm3 - floor), elevatedAreaMm2: ea });
    }
  }
  const nominal = rows.find((r) => r.k === kList[0] && Math.abs(r.sigmaUm - sigmaEff) < 1e-9) ?? rows[0];
  const nets = rows.map((r) => r.netMm3);
  // Penetration side and location of the elevations at the nominal threshold
  let pen = 0, wPsi = 0, wTheta = 0, wSum = 0;
  for (let v = 0; v < s.n; v++) {
    if (s.theta[v] > thetaMax) continue;
    const e = s.devUm[v] - nominal.thresholdUm;
    if (e > 0) pen += s.area[v] * e;
    const el = -s.devUm[v] - nominal.thresholdUm;
    if (el > 0) { const w = s.area[v] * el; wPsi += w * s.psi[v]; wTheta += w * s.theta[v]; wSum += w; }
  }
  return {
    sigmaEffUm: sigmaEff,
    analysedAreaMm2: A,
    rows,
    nominal,
    netRangeMm3: [Math.min(...nets), Math.max(...nets)],
    penetrationVolumeMm3: pen * 1e-3,
    elevationPsiDeg: wSum > 0 ? (wPsi / wSum) * 180 / Math.PI : NaN,
    elevationThetaDeg: wSum > 0 ? (wTheta / wSum) * 180 / Math.PI : NaN,
    radiusSensitivityMm3PerUm: A * 1e-3,
    raw: elevatedZone(s, rimBandDeg),
  };
}

/** Peak depth of a creep field with the model's shape whose volume equals `volumeMm3` (µm) */
export function minCreepDepthUm(volumeMm3: number, shapeAreaMm2: number): number {
  return shapeAreaMm2 > 0 ? (volumeMm3 / shapeAreaMm2) * 1000 : NaN;
}

// ------------------------------------------------------------
// Polar maps (azimuthal-equidistant projection about the pole)
// ------------------------------------------------------------

export interface PolarGrid {
  nTheta: number;
  nAz: number;
  maxThetaDeg: number;
  /** Area-weighted mean per cell (NaN = no data); index it*nAz + ia */
  value: Float64Array;
  weight: Float64Array;
}

export function binPolar(s: SurfaceData, values: Float64Array, nTheta = 60, nAz = 120, maxThetaDeg?: number): PolarGrid {
  const mt = maxThetaDeg ?? Math.min(100, Math.ceil(s.maxThetaRad * 180 / Math.PI));
  const value = new Float64Array(nTheta * nAz);
  const weight = new Float64Array(nTheta * nAz);
  for (let v = 0; v < s.n; v++) {
    const t = s.theta[v] * 180 / Math.PI;
    if (t > mt || !(s.area[v] > 0)) continue;
    const it = Math.min(nTheta - 1, Math.floor((t / mt) * nTheta));
    let az = s.azimuth[v]; if (az < 0) az += 2 * Math.PI;
    const ia = Math.min(nAz - 1, Math.floor((az / (2 * Math.PI)) * nAz));
    const k = it * nAz + ia;
    value[k] += values[v] * s.area[v];
    weight[k] += s.area[v];
  }
  for (let k = 0; k < value.length; k++) value[k] = weight[k] > 0 ? value[k] / weight[k] : NaN;
  return { nTheta, nAz, maxThetaDeg: mt, value, weight };
}

/** Polar grid of a model field (on the load-axis grid), mapped through the bases */
export function modelToPolar(
  grid: CreepGrid, field: Float64Array, bases: Bases, nTheta: number, nAz: number, maxThetaDeg: number, coverageDeg: number,
): PolarGrid {
  const value = new Float64Array(nTheta * nAz);
  const weight = new Float64Array(nTheta * nAz);
  for (let it = 0; it < nTheta; it++) {
    const th = ((it + 0.5) / nTheta) * maxThetaDeg * Math.PI / 180;
    for (let ia = 0; ia < nAz; ia++) {
      const az = ((ia + 0.5) / nAz) * 2 * Math.PI;
      const k = it * nAz + ia;
      if (th * 180 / Math.PI > coverageDeg) { value[k] = NaN; continue; }
      const m: Vec3 = [
        Math.cos(th) * bases.pole[0] + Math.sin(th) * (Math.cos(az) * bases.up[0] + Math.sin(az) * bases.right[0]),
        Math.cos(th) * bases.pole[1] + Math.sin(th) * (Math.cos(az) * bases.up[1] + Math.sin(az) * bases.right[1]),
        Math.cos(th) * bases.pole[2] + Math.sin(th) * (Math.cos(az) * bases.up[2] + Math.sin(az) * bases.right[2]),
      ];
      const psi = Math.acos(Math.max(-1, Math.min(1, dot(m, bases.load))));
      const phi = Math.atan2(dot(m, bases.e2), dot(m, bases.e1));
      value[k] = sampleGrid(grid, field, psi, phi);
      weight[k] = 1;
    }
  }
  return { nTheta, nAz, maxThetaDeg, value, weight };
}

/** Bases for a model-only map (no measured frame): pole = z, load tilted by the load angle */
export function syntheticBases(loadAngleDeg: number): Bases {
  const a = loadAngleDeg * Math.PI / 180;
  return makeBases({ center: [0, 0, 0], radiusMm: 1, pole: [0, 0, 1], load: [Math.sin(a), 0, Math.cos(a)] });
}
