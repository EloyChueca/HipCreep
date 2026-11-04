// ============================================================
// HipCreep — the scanned liner in 3D, next to the sphere → plane view
// ------------------------------------------------------------
// The HipWear surface mesh is decimated (vertex clustering) to a size the
// canvas painter's algorithm can draw interactively, and expressed in the same
// frame as the plane: X = map right, Y = map up (penetration direction),
// Z = −pole (the cup opening faces up, the dome is down). Both views are drawn
// with the same camera (yaw about the vertical axis, pitch, zoom), so turning
// one turns the other: seen from above, the plane and the inside of the cup
// show the same thing in the same place.
//
// Colour: the value of the selected field in the plane cell the vertex falls in
// (exactly what the plane shows there). Shape: the real geometry; with vertical
// exaggeration the measured deviation is magnified radially by the same factor
// as the heights of the plane.
// ============================================================

import type { SurfaceData, PolarGrid, SurfaceMesh } from '../model/surface.ts';
import { cssVar, fmt } from './format.ts';

export interface LinerDisplay {
  /** Unit direction from the sphere centre in the plane frame, per display vertex */
  ux: Float32Array; uy: Float32Array; uz: Float32Array;
  /** True distance from the centre (mm) and measured deviation r − R (µm) */
  r: Float32Array; devUm: Float32Array;
  /** Plane cell (theta × azimuth) of the vertex, −1 outside the analysed surface */
  cell: Int32Array;
  /** Whether the deviation may be exaggerated (analysed bearing surface) */
  exaggerate: Uint8Array;
  tris: Uint32Array;
  radiusMm: number;
}

/**
 * Decimate the mesh to about `target` vertices and express it in the plane frame.
 * The grid geometry (nTheta, nAz, maxThetaDeg) must be that of the plane fields.
 */
export function buildLinerDisplay(
  mesh: SurfaceMesh, s: SurfaceData, center: readonly number[], radiusMm: number,
  grid: { nTheta: number; nAz: number; maxThetaDeg: number }, target = 14000,
): LinerDisplay {
  const V = mesh.vertices, F = mesh.faces;
  const n = V.length / 3;
  const B = s.bases;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < n; v++) {
    const x = V[3 * v], y = V[3 * v + 1], z = V[3 * v + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  // cell size from the surface area: about `target` occupied cells
  const h = Math.max(1e-3, Math.sqrt(Math.max(s.totalAreaMm2, 1) / target));
  const nx = Math.ceil((maxX - minX) / h) + 1, ny = Math.ceil((maxY - minY) / h) + 1;
  const key = new Map<number, number>();
  const cluster = new Int32Array(n);
  const sx: number[] = [], sy: number[] = [], sz: number[] = [], sd: number[] = [], cnt: number[] = [], inside: number[] = [];
  const maxT = grid.maxThetaDeg * Math.PI / 180;
  for (let v = 0; v < n; v++) {
    const ix = Math.floor((V[3 * v] - minX) / h), iy = Math.floor((V[3 * v + 1] - minY) / h), iz = Math.floor((V[3 * v + 2] - minZ) / h);
    const k = (iz * ny + iy) * nx + ix;
    let c = key.get(k);
    if (c === undefined) { c = sx.length; key.set(k, c); sx.push(0); sy.push(0); sz.push(0); sd.push(0); cnt.push(0); inside.push(0); }
    cluster[v] = c;
    sx[c] += V[3 * v]; sy[c] += V[3 * v + 1]; sz[c] += V[3 * v + 2];
    sd[c] += s.devUm[v]; cnt[c]++;
    if (s.theta[v] <= maxT && s.area[v] > 0) inside[c]++;
  }
  const m = sx.length;
  const ux = new Float32Array(m), uy = new Float32Array(m), uz = new Float32Array(m), r = new Float32Array(m), dev = new Float32Array(m);
  const cell = new Int32Array(m), ex = new Uint8Array(m);
  for (let c = 0; c < m; c++) {
    const px = sx[c] / cnt[c] - center[0], py = sy[c] / cnt[c] - center[1], pz = sz[c] / cnt[c] - center[2];
    const rr = Math.hypot(px, py, pz) || 1;
    const X = (px * B.right[0] + py * B.right[1] + pz * B.right[2]) / rr;
    const Y = (px * B.up[0] + py * B.up[1] + pz * B.up[2]) / rr;
    const P = (px * B.pole[0] + py * B.pole[1] + pz * B.pole[2]) / rr;
    ux[c] = X; uy[c] = Y; uz[c] = -P; r[c] = rr; dev[c] = sd[c] / cnt[c];
    const th = Math.acos(Math.max(-1, Math.min(1, P)));
    const isIn = inside[c] * 2 >= cnt[c] && th <= maxT;
    if (isIn) {
      let az = Math.atan2(X, Y); if (az < 0) az += 2 * Math.PI;
      const it = Math.min(grid.nTheta - 1, Math.floor((th / maxT) * grid.nTheta));
      const ia = Math.min(grid.nAz - 1, Math.floor((az / (2 * Math.PI)) * grid.nAz));
      cell[c] = it * grid.nAz + ia;
      ex[c] = Math.abs(dev[c]) < 5000 ? 1 : 0;
    } else cell[c] = -1;
  }
  const seen = new Set<string>();
  const tris: number[] = [];
  for (let f = 0; f + 2 < F.length; f += 3) {
    const a = cluster[F[f]], b = cluster[F[f + 1]], c = cluster[F[f + 2]];
    if (a === b || b === c || a === c) continue;
    const k = a < b ? (b < c ? `${a},${b},${c}` : a < c ? `${a},${c},${b}` : `${c},${a},${b}`) : (a < c ? `${b},${a},${c}` : b < c ? `${b},${c},${a}` : `${c},${b},${a}`);
    if (seen.has(k)) continue;
    seen.add(k);
    tris.push(a, b, c);
  }
  return { ux, uy, uz, r, devUm: dev, cell, exaggerate: ex, tris: Uint32Array.from(tris), radiusMm };
}

export interface Camera { yaw: number; pitch: number; zoom: number }

/** Draw the liner with the shared camera. `zScale`: mm per µm of the plane heights (0.001 = true scale). */
export function drawLiner(
  canvas: HTMLCanvasElement, L: LinerDisplay, cam: Camera, zScale: number,
  grid: PolarGrid, color: (v: number) => [number, number, number],
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = cssVar('--chart-surface');
  g.fillRect(0, 0, W, H);
  const n = L.ux.length;
  // positions: real distance, with the measured deviation magnified like the plane heights
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  let zMin = Infinity, zMax = -Infinity, rho = 0;
  const extra = zScale - 0.001;
  for (let i = 0; i < n; i++) {
    const rr = L.exaggerate[i] ? L.r[i] + L.devUm[i] * extra : L.r[i];
    X[i] = L.ux[i] * rr; Y[i] = L.uy[i] * rr; Z[i] = L.uz[i] * rr;
    if (Z[i] < zMin) zMin = Z[i]; if (Z[i] > zMax) zMax = Z[i];
    const h = Math.hypot(X[i], Y[i]); if (h > rho) rho = h;
  }
  const zMid = (zMin + zMax) / 2;
  const s = (0.42 * Math.min(W, H * 1.25) / Math.max(rho, 1e-6)) * cam.zoom;
  const cx = W / 2, cy = H / 2 + 10;
  const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const px = new Float64Array(n), py = new Float64Array(n), depth = new Float64Array(n);
  const RX = new Float64Array(n), RY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x1 = X[i] * cyaw - Y[i] * syaw, y1 = X[i] * syaw + Y[i] * cyaw, z = Z[i] - zMid;
    RX[i] = x1; RY[i] = y1;
    px[i] = cx + s * x1;
    py[i] = cy - s * (y1 * sp + z * cp);
    depth[i] = -y1 * cp + z * sp;
  }
  const T = L.tris, nt = T.length / 3;
  const td = new Float64Array(nt);
  for (let t = 0; t < nt; t++) td[t] = depth[T[3 * t]] + depth[T[3 * t + 1]] + depth[T[3 * t + 2]];
  const order = Array.from({ length: nt }, (_, i) => i).sort((p, q) => td[p] - td[q]);
  const Lv = [-0.35, -cp * 0.8, sp + 0.4], Ln = Math.hypot(Lv[0], Lv[1], Lv[2]);
  const grey: [number, number, number] = [176, 176, 176];
  for (const t of order) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const ux = RX[b] - RX[a], uy = RY[b] - RY[a], uz = Z[b] - Z[a];
    const vx = RX[c] - RX[a], vy = RY[c] - RY[a], vz = Z[c] - Z[a];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.55 + 0.45 * Math.abs(nx * Lv[0] + ny * Lv[1] + nz * Lv[2]) / Ln;
    let sum = 0, k = 0;
    for (const i of [a, b, c]) {
      const ci = L.cell[i];
      if (ci >= 0 && Number.isFinite(grid.value[ci])) { sum += grid.value[ci]; k++; }
    }
    const col = k ? color(sum / k) : grey;
    const fill = `rgb(${Math.round(col[0] * shade)},${Math.round(col[1] * shade)},${Math.round(col[2] * shade)})`;
    g.beginPath(); g.moveTo(px[a], py[a]); g.lineTo(px[b], py[b]); g.lineTo(px[c], py[c]); g.closePath();
    g.fillStyle = fill; g.strokeStyle = fill; g.lineWidth = 0.5;
    g.fill(); g.stroke();
  }
  // references: pole (dome) and the penetration direction at the rim, as in the plane
  const P = (x: number, y: number, z: number): [number, number] => {
    const x1 = x * cyaw - y * syaw, y1 = x * syaw + y * cyaw;
    return [cx + s * x1, cy - s * (y1 * sp + (z - zMid) * cp)];
  };
  g.fillStyle = cssVar('--text-primary'); g.strokeStyle = cssVar('--text-muted'); g.lineWidth = 1;
  g.font = '11px system-ui, sans-serif';
  const pole = P(0, 0, -L.radiusMm);
  g.beginPath(); g.arc(pole[0], pole[1], 3, 0, 2 * Math.PI); g.fill();
  g.fillText('pole', pole[0] + 5, pole[1] - 4);
  const t0 = P(0, rho * 1.02, zMax), t1 = P(0, rho * 1.16, zMax);
  g.beginPath(); g.moveTo(t0[0], t0[1]); g.lineTo(t1[0], t1[1]); g.stroke();
  g.textAlign = 'center'; g.fillStyle = cssVar('--text-muted');
  g.fillText('penetration', t1[0], t1[1] - 4);
  g.textAlign = 'left';
  g.fillText(`${(L.tris.length / 3).toLocaleString('en-US')} triangles (decimated scan)${extra > 1e-9 ? ` · deviation × ${fmt(zScale * 1000)}` : ' · true scale'}`, 8, H - 8);
}
