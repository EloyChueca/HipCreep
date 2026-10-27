// ============================================================
// HipCreep — polar maps (sphere → plane), seen from the cup opening
// Azimuthal-equidistant projection about the cup pole: the pole is the centre,
// the polar angle is the radius, and the penetration direction points up.
// ============================================================

import type { PolarGrid } from '../model/surface.ts';
import { cssVar, fmt } from './format.ts';
import { showTip, hideTip } from './charts.ts';

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function ramp(stops: RGB[], t: number): RGB {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return lerp(stops[i], stops[i + 1], x - i);
}

const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
};

const SEQ_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export type ColorScale =
  | { kind: 'diverging'; limit: number }
  | { kind: 'sequential'; max: number };

/** Build a colour function once (reads the theme colours a single time) */
export function colorizer(scale: ColorScale): (v: number) => RGB {
  if (scale.kind === 'diverging') {
    const neg = hex(cssVar('--div-neg')), mid = hex(cssVar('--div-mid')), pos = hex(cssVar('--div-pos'));
    const L = scale.limit || 1;
    return (v) => {
      const t = Math.max(-1, Math.min(1, v / L));
      return t < 0 ? lerp(mid, neg, -t) : lerp(mid, pos, t);
    };
  }
  const stops = (isDark() ? [...SEQ_BLUE].reverse() : SEQ_BLUE).map(hex);
  const M = scale.max || 1;
  return (v) => ramp(stops, v / M);
}

export interface MapPanel {
  title: string;
  subtitle: string;
  grid: PolarGrid;
  scale: ColorScale;
  unit: string;
  /** Optional mask: only cells where mask(v) is true are coloured */
  mask?: (v: number) => boolean;
}

export function renderMap(container: HTMLElement, p: MapPanel): void {
  const card = document.createElement('div');
  card.className = 'chart-card map-card';
  card.innerHTML = `<div class="chart-title">${p.title}</div><div class="chart-sub">${p.subtitle}</div>`;
  const S = 480, C = S / 2, Rpx = S / 2 - 30;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', `${p.title} — polar map`);
  const g = cv.getContext('2d')!;
  const img = g.createImageData(S, S);
  const { nTheta, nAz, maxThetaDeg, value } = p.grid;
  const lookup = (x: number, y: number): number => {
    const dx = x - C, dy = C - y;
    const r = Math.hypot(dx, dy) / Rpx;
    if (r > 1) return NaN;
    const it = Math.min(nTheta - 1, Math.floor(r * nTheta));
    let az = Math.atan2(dx, dy); if (az < 0) az += 2 * Math.PI;
    const ia = Math.min(nAz - 1, Math.floor((az / (2 * Math.PI)) * nAz));
    return value[it * nAz + ia];
  };
  const missing = hex(cssVar('--bg-tertiary'));
  const midColor = hex(cssVar('--div-mid'));
  const colorFor = colorizer(p.scale);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4;
      const dx = x - C, dy = C - y;
      if (Math.hypot(dx, dy) > Rpx) { img.data[k + 3] = 0; continue; }
      const v = lookup(x, y);
      let c: RGB;
      if (!Number.isFinite(v)) c = missing;
      else if (p.mask && !p.mask(v)) c = midColor;
      else c = colorFor(v);
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // rings every 30° and the penetration arrow
  g.strokeStyle = cssVar('--text-muted');
  g.fillStyle = cssVar('--text-muted');
  g.lineWidth = 1.5;
  g.font = '22px system-ui, sans-serif';
  for (const deg of [30, 60, 90]) {
    if (deg > maxThetaDeg) continue;
    const r = (deg / maxThetaDeg) * Rpx;
    g.setLineDash([3, 4]);
    g.beginPath(); g.arc(C, C, r, 0, 2 * Math.PI); g.stroke();
    g.setLineDash([]);
    g.fillText(`${deg}°`, C + r * 0.71 + 4, C + r * 0.71 + 20);
  }
  g.beginPath(); g.moveTo(C, 20); g.lineTo(C - 7, 30); g.lineTo(C + 7, 30); g.closePath(); g.fill();
  g.textAlign = 'center';
  g.fillText('penetration', C, 17);
  card.appendChild(cv);

  // colour bar
  const bar = document.createElement('canvas');
  bar.width = 600; bar.height = 64;
  const b = bar.getContext('2d')!;
  const lo = p.scale.kind === 'diverging' ? -p.scale.limit : 0;
  const hi = p.scale.kind === 'diverging' ? p.scale.limit : p.scale.max;
  for (let x = 0; x < 560; x++) {
    const v = lo + ((hi - lo) * x) / 559;
    const c = colorFor(v);
    b.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    b.fillRect(20 + x, 4, 1, 22);
  }
  b.fillStyle = cssVar('--text-muted');
  b.font = '24px system-ui, sans-serif';
  b.textAlign = 'left'; b.fillText(`${fmt(lo)}`, 20, 54);
  b.textAlign = 'center'; b.fillText(p.scale.kind === 'diverging' ? `0 ${p.unit}` : `${fmt((lo + hi) / 2)} ${p.unit}`, 300, 54);
  b.textAlign = 'right'; b.fillText(`${fmt(hi)} ${p.unit}`, 580, 54);
  bar.style.width = '100%';
  bar.style.maxWidth = '300px';
  card.appendChild(bar);

  cv.addEventListener('mousemove', (ev) => {
    const r = cv.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * S, y = ((ev.clientY - r.top) / r.height) * S;
    const dx = x - C, dy = C - y;
    const rr = Math.hypot(dx, dy) / Rpx;
    if (rr > 1) { hideTip(); return; }
    const v = lookup(x, y);
    let az = Math.atan2(dx, dy) * 180 / Math.PI; if (az < 0) az += 360;
    showTip(`<b>${Number.isFinite(v) ? fmt(v) + ' ' + p.unit : 'no data'}</b><div class="muted">θ = ${(rr * maxThetaDeg).toFixed(1)}° from pole · azimuth ${az.toFixed(0)}°</div>`, ev);
  });
  cv.addEventListener('mouseleave', hideTip);
  container.appendChild(card);
}
