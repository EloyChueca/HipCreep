// ============================================================
// HipCreep — interactive 3D reconstruction of the sphere → plane map
// ------------------------------------------------------------
// The azimuthal-equidistant plane (pole at the centre, penetration direction up,
// distance from the centre = arc length R·θ from the pole) is drawn as a height
// field: height = deviation (µm, vertically exaggerated), colour = same scale as
// the 2D maps. Canvas 2D renderer (painter's algorithm), no dependencies.
// Drag to rotate, wheel to zoom, double-click to reset.
// ============================================================

import type { PolarGrid } from '../model/surface.ts';
import { colorizer, type ColorScale } from './polarmap.ts';
import { cssVar, fmt } from './format.ts';
import { showTip, hideTip } from './charts.ts';

export interface Surface3DField {
  key: string;
  label: string;
  grid: PolarGrid;
  scale: ColorScale;
  unit: string;
}

export interface Surface3DOptions {
  fields: Surface3DField[];
  /** Radius used to convert the polar angle into arc length (mm) */
  radiusMm: number;
  title?: string;
}

interface Mesh3D {
  /** vertex positions in the plane (mm) and value (µm) */
  x: Float64Array; y: Float64Array; v: Float64Array;
  /** quads (or triangles with d = -1) as vertex indices */
  quads: Int32Array;
  rhoMax: number;
  vAbsMax: number;
  maxThetaDeg: number;
  /** cell (theta / azimuth) of each quad for the tooltip */
  qTheta: Float64Array; qAz: Float64Array;
}

/**
 * Fill isolated empty cells (no mesh vertex fell in them — mostly the small cells around the pole)
 * with the mean of their neighbours, so the 3D surface has no holes. A cell is filled only when most
 * of its neighbours have data, so the outer edge of the data is not extended.
 */
function fillHoles(value: ArrayLike<number>, nTheta: number, nAz: number): Float64Array {
  const v = Float64Array.from(value);
  for (let pass = 0; pass < 4; pass++) {
    const next = Float64Array.from(v);
    let changed = 0;
    for (let it = 0; it < nTheta; it++) {
      for (let ia = 0; ia < nAz; ia++) {
        const k = it * nAz + ia;
        if (Number.isFinite(v[k])) continue;
        let s = 0, n = 0, tot = 0;
        for (let dt = -1; dt <= 1; dt++) {
          const t = it + dt;
          if (t < 0 || t >= nTheta) continue;
          for (let da = -1; da <= 1; da++) {
            if (!dt && !da) continue;
            const x = v[t * nAz + ((ia + da + nAz) % nAz)];
            tot++;
            if (Number.isFinite(x)) { s += x; n++; }
          }
        }
        // the first ring closes around the pole, so two neighbours with data are enough there
        if (n >= (it === 0 ? 2 : Math.max(3, Math.ceil(0.6 * tot)))) { next[k] = s / n; changed++; }
      }
    }
    v.set(next);
    if (!changed) break;
  }
  return v;
}

function buildMesh(g: PolarGrid, radiusMm: number): Mesh3D {
  const { nTheta, nAz, maxThetaDeg } = g;
  const value = fillHoles(g.value, nTheta, nAz);
  const nV = 1 + nTheta * nAz;
  const x = new Float64Array(nV), y = new Float64Array(nV), v = new Float64Array(nV);
  // pole vertex: mean of the first ring
  let s = 0, n = 0;
  for (let ia = 0; ia < nAz; ia++) { const val = value[ia]; if (Number.isFinite(val)) { s += val; n++; } }
  v[0] = n ? s / n : NaN;
  let vAbsMax = 0;
  for (let it = 0; it < nTheta; it++) {
    const th = ((it + 0.5) / nTheta) * maxThetaDeg * Math.PI / 180;
    const rho = radiusMm * th;
    for (let ia = 0; ia < nAz; ia++) {
      const az = ((ia + 0.5) / nAz) * 2 * Math.PI;
      const k = 1 + it * nAz + ia;
      x[k] = rho * Math.sin(az);
      y[k] = rho * Math.cos(az);
      v[k] = value[it * nAz + ia];
      if (Number.isFinite(v[k]) && Math.abs(v[k]) > vAbsMax) vAbsMax = Math.abs(v[k]);
    }
  }
  const quads: number[] = [], qt: number[] = [], qa: number[] = [];
  const id = (it: number, ia: number) => 1 + it * nAz + ((ia + nAz) % nAz);
  for (let ia = 0; ia < nAz; ia++) {
    const a = id(0, ia), b = id(0, ia + 1);
    if (Number.isFinite(v[0]) && Number.isFinite(v[a]) && Number.isFinite(v[b])) {
      quads.push(0, a, b, -1); qt.push(0); qa.push(((ia + 0.5) / nAz) * 360);
    }
  }
  for (let it = 0; it + 1 < nTheta; it++) {
    for (let ia = 0; ia < nAz; ia++) {
      const a = id(it, ia), b = id(it, ia + 1), c = id(it + 1, ia + 1), d = id(it + 1, ia);
      if (!(Number.isFinite(v[a]) && Number.isFinite(v[b]) && Number.isFinite(v[c]) && Number.isFinite(v[d]))) continue;
      quads.push(a, b, c, d);
      qt.push(((it + 1) / nTheta) * maxThetaDeg); qa.push(((ia + 1) / nAz) * 360);
    }
  }
  return {
    x, y, v, quads: Int32Array.from(quads), rhoMax: radiusMm * maxThetaDeg * Math.PI / 180,
    vAbsMax: vAbsMax || 1, maxThetaDeg, qTheta: Float64Array.from(qt), qAz: Float64Array.from(qa),
  };
}

export function renderSurface3D(container: HTMLElement, o: Surface3DOptions): void {
  const card = document.createElement('div');
  card.className = 'chart-card surface3d';
  card.innerHTML = `
    <div class="chart-title">${o.title ?? '3D reconstruction of the plane'}</div>
    <div class="chart-sub">Height = deviation from the original sphere (vertically exaggerated), colour = same scale as the 2D maps. Drag to rotate · wheel to zoom · double-click to reset.</div>
    <div class="map-controls">
      <label>Field <select class="s3-field">${o.fields.map((f) => `<option value="${f.key}">${f.label}</option>`).join('')}</select></label>
      <label>Vertical exaggeration <input class="s3-exag" type="range" min="-2" max="2" step="0.05" value="0" style="vertical-align:middle;width:140px"> <span class="s3-exag-val num"></span></label>
      <button class="btn s3-reset" type="button">Reset view</button>
    </div>`;
  const canvas = document.createElement('canvas');
  canvas.className = 's3-canvas';
  canvas.style.width = '100%';
  canvas.style.height = '460px';
  canvas.style.display = 'block';
  canvas.style.cursor = 'grab';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D height map of the deviation from the original sphere');
  card.appendChild(canvas);
  const legend = document.createElement('canvas');
  legend.width = 600; legend.height = 64;
  legend.style.width = '100%'; legend.style.maxWidth = '300px';
  card.appendChild(legend);
  container.appendChild(card);

  const fieldSel = card.querySelector('.s3-field') as HTMLSelectElement;
  const exagIn = card.querySelector('.s3-exag') as HTMLInputElement;
  const exagVal = card.querySelector('.s3-exag-val') as HTMLSpanElement;

  let field = o.fields[0];
  let mesh = buildMesh(field.grid, o.radiusMm);
  let color = colorizer(field.scale);
  let yaw = -0.5, pitch = 50 * Math.PI / 180, zoom = 1;
  let projX = new Float64Array(0), projY = new Float64Array(0);
  let order: number[] = [];
  let raf = 0;

  const drawLegend = () => {
    const b = legend.getContext('2d')!;
    b.clearRect(0, 0, legend.width, legend.height);
    const lo = field.scale.kind === 'diverging' ? -field.scale.limit : 0;
    const hi = field.scale.kind === 'diverging' ? field.scale.limit : field.scale.max;
    for (let px = 0; px < 560; px++) {
      const c = color(lo + ((hi - lo) * px) / 559);
      b.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      b.fillRect(20 + px, 4, 1, 22);
    }
    b.fillStyle = cssVar('--text-muted');
    b.font = '24px system-ui, sans-serif';
    b.textAlign = 'left'; b.fillText(`${fmt(lo)}`, 20, 54);
    b.textAlign = 'center'; b.fillText(field.scale.kind === 'diverging' ? `0 ${field.unit}` : `${fmt((lo + hi) / 2)} ${field.unit}`, 300, 54);
    b.textAlign = 'right'; b.fillText(`${fmt(hi)} ${field.unit}`, 580, 54);
  };

  const draw = () => {
    raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar('--chart-surface');
    g.fillRect(0, 0, W, H);
    const exag = Math.pow(10, parseFloat(exagIn.value));
    const zScale = (0.2 * mesh.rhoMax / mesh.vAbsMax) * exag;   // mm per µm
    exagVal.textContent = `×${fmt(zScale * 1000)} vs true scale`;
    const s = (0.42 * Math.min(W, H * 1.25) / mesh.rhoMax) * zoom;
    const cx = W / 2, cy = H / 2 + 20;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const n = mesh.x.length;
    projX = new Float64Array(n); projY = new Float64Array(n);
    const depth = new Float64Array(n);
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const vi = Number.isFinite(mesh.v[i]) ? mesh.v[i] : 0;
      z[i] = vi * zScale;
      const x1 = mesh.x[i] * cyaw - mesh.y[i] * syaw;
      const y1 = mesh.x[i] * syaw + mesh.y[i] * cyaw;
      projX[i] = cx + s * x1;
      projY[i] = cy - s * (y1 * sp + z[i] * cp);
      depth[i] = -y1 * cp + z[i] * sp;
    }
    const Q = mesh.quads, nq = Q.length / 4;
    const qd = new Float64Array(nq);
    for (let q = 0; q < nq; q++) {
      const a = Q[q * 4], b = Q[q * 4 + 1], c = Q[q * 4 + 2], d = Q[q * 4 + 3];
      qd[q] = d >= 0 ? (depth[a] + depth[b] + depth[c] + depth[d]) / 4 : (depth[a] + depth[b] + depth[c]) / 3;
    }
    order = Array.from({ length: nq }, (_, i) => i).sort((p, q) => qd[p] - qd[q]);
    // light from the viewer, slightly from above-left
    const L = [-0.35, -cp * 0.8, sp + 0.4];
    const Ln = Math.hypot(L[0], L[1], L[2]);
    for (const q of order) {
      const a = Q[q * 4], b = Q[q * 4 + 1], c = Q[q * 4 + 2], d = Q[q * 4 + 3];
      // normal in the yaw-rotated frame
      const ax = mesh.x[a] * cyaw - mesh.y[a] * syaw, ay = mesh.x[a] * syaw + mesh.y[a] * cyaw;
      const bx = mesh.x[b] * cyaw - mesh.y[b] * syaw, by = mesh.x[b] * syaw + mesh.y[b] * cyaw;
      const cxw = mesh.x[c] * cyaw - mesh.y[c] * syaw, cyw = mesh.x[c] * syaw + mesh.y[c] * cyaw;
      const ux = bx - ax, uy = by - ay, uz = z[b] - z[a];
      const vx = cxw - ax, vy = cyw - ay, vz = z[c] - z[a];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const lam = Math.abs(nx * L[0] + ny * L[1] + nz * L[2]) / Ln;
      const shade = 0.6 + 0.4 * lam;
      const val = d >= 0 ? (mesh.v[a] + mesh.v[b] + mesh.v[c] + mesh.v[d]) / 4 : (mesh.v[a] + mesh.v[b] + mesh.v[c]) / 3;
      const col = color(val);
      const fill = `rgb(${Math.round(col[0] * shade)},${Math.round(col[1] * shade)},${Math.round(col[2] * shade)})`;
      g.beginPath();
      g.moveTo(projX[a], projY[a]); g.lineTo(projX[b], projY[b]); g.lineTo(projX[c], projY[c]);
      if (d >= 0) g.lineTo(projX[d], projY[d]);
      g.closePath();
      g.fillStyle = fill; g.strokeStyle = fill; g.lineWidth = 0.6;
      g.fill(); g.stroke();
    }
    // reference rings at z = 0 (30°, 60°, 90° from the pole) and the penetration arrow
    g.strokeStyle = cssVar('--text-muted');
    g.fillStyle = cssVar('--text-muted');
    g.lineWidth = 1;
    g.font = '11px system-ui, sans-serif';
    const P = (x: number, y: number, zz: number): [number, number] => {
      const x1 = x * cyaw - y * syaw, y1 = x * syaw + y * cyaw;
      return [cx + s * x1, cy - s * (y1 * sp + zz * cp)];
    };
    for (const deg of [30, 60, 90]) {
      if (deg > mesh.maxThetaDeg) continue;
      const rho = o.radiusMm * deg * Math.PI / 180;
      g.setLineDash([3, 4]);
      g.beginPath();
      for (let k = 0; k <= 96; k++) { const az = (k / 96) * 2 * Math.PI; const [px, py] = P(rho * Math.sin(az), rho * Math.cos(az), 0); if (k) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
      g.setLineDash([]);
      const [lx, ly] = P(rho * Math.sin(2.4), rho * Math.cos(2.4), 0);
      g.fillText(`${deg}°`, lx + 3, ly);
    }
    const tip0 = P(0, mesh.rhoMax * 1.02, 0), tip1 = P(0, mesh.rhoMax * 1.16, 0);
    g.beginPath(); g.moveTo(tip0[0], tip0[1]); g.lineTo(tip1[0], tip1[1]); g.stroke();
    g.textAlign = 'center';
    g.fillText('penetration', tip1[0], tip1[1] - 4);
    g.textAlign = 'left';
    // peak markers
    let iMax = -1, iMin = -1;
    for (let i = 1; i < n; i++) {
      if (!Number.isFinite(mesh.v[i])) continue;
      if (iMax < 0 || mesh.v[i] > mesh.v[iMax]) iMax = i;
      if (iMin < 0 || mesh.v[i] < mesh.v[iMin]) iMin = i;
    }
    g.font = '12px system-ui, sans-serif';
    for (const [i, lab] of [[iMax, 'max'], [iMin, 'min']] as const) {
      if (i < 0) continue;
      g.fillStyle = cssVar('--text-primary');
      g.beginPath(); g.arc(projX[i], projY[i], 3.5, 0, 2 * Math.PI); g.fill();
      g.fillText(`${lab} ${fmt(mesh.v[i])} ${field.unit}`, projX[i] + 6, projY[i] - 6);
    }
  };
  const request = () => { if (!raf) raf = requestAnimationFrame(draw); };

  const pointIn = (px: number, py: number, idx: number[]): boolean => {
    let inside = false;
    for (let i = 0, j = idx.length - 1; i < idx.length; j = i++) {
      const xi = projX[idx[i]], yi = projY[idx[i]], xj = projX[idx[j]], yj = projY[idx[j]];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; hideTip(); });
  canvas.addEventListener('pointerup', (e) => { drag = null; canvas.releasePointerCapture(e.pointerId); canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      yaw += (e.clientX - drag.x) * 0.01;
      pitch = Math.max(0.05, Math.min(Math.PI / 2, pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      request();
      return;
    }
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const Q = mesh.quads;
    for (let k = order.length - 1; k >= 0; k--) {
      const q = order[k];
      const idx = Q[q * 4 + 3] >= 0 ? [Q[q * 4], Q[q * 4 + 1], Q[q * 4 + 2], Q[q * 4 + 3]] : [Q[q * 4], Q[q * 4 + 1], Q[q * 4 + 2]];
      if (pointIn(px, py, idx)) {
        const val = idx.reduce((sum, i) => sum + mesh.v[i], 0) / idx.length;
        showTip(`<b>${fmt(val)} ${field.unit}</b><div class="muted">θ ≈ ${fmt(mesh.qTheta[q])}° from pole · azimuth ≈ ${fmt(mesh.qAz[q])}°</div>`, e);
        return;
      }
    }
    hideTip();
  });
  canvas.addEventListener('mouseleave', hideTip);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.0015))); request(); }, { passive: false });
  const reset = () => { yaw = -0.5; pitch = 50 * Math.PI / 180; zoom = 1; exagIn.value = '0'; request(); };
  canvas.addEventListener('dblclick', reset);
  (card.querySelector('.s3-reset') as HTMLButtonElement).addEventListener('click', reset);
  exagIn.addEventListener('input', request);
  fieldSel.addEventListener('change', () => {
    field = o.fields.find((f) => f.key === fieldSel.value) ?? o.fields[0];
    mesh = buildMesh(field.grid, o.radiusMm);
    color = colorizer(field.scale);
    drawLegend();
    request();
  });
  new ResizeObserver(request).observe(canvas);
  drawLegend();
  request();
}
