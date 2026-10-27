// ============================================================
// HipCreep — small SVG charts (line with hover, range bars, histogram)
// Thin marks, recessive grid, one y-axis, text in ink colours, legend for ≥ 2 series.
// ============================================================

import { fmt, escapeHtml } from './format.ts';

const NS = 'http://www.w3.org/2000/svg';
const tip = () => document.getElementById('tooltip') as HTMLDivElement;

export function showTip(html: string, ev: MouseEvent): void {
  const t = tip();
  t.innerHTML = html;
  t.classList.remove('hidden');
  const pad = 14;
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > window.innerWidth - 4) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight - 4) y = ev.clientY - h - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
export function hideTip(): void { tip().classList.add('hidden'); }

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const step0 = span / n;
  const p = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= step0) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9 * span; v += step) out.push(+v.toPrecision(12));
  return out;
}

function svg(w: number, h: number): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('width', '100%');
  s.style.display = 'block';
  s.style.maxHeight = `${h * 1.4}px`;
  return s;
}
function add<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

export interface LineSeries {
  label: string;
  color: string;
  dash?: string;
  x: number[];
  y: number[];
}

export interface LineChartOptions {
  series: LineSeries[];
  xLabel: string;
  yLabel: string;
  xFormat: (x: number) => string;
  xTicks: number[];
  marker?: { x: number; label: string };
  height?: number;
}

/** Line chart with a logarithmic x axis and a crosshair tooltip */
export function lineChart(container: HTMLElement, o: LineChartOptions): void {
  const W = 760, H = o.height ?? 300, m = { l: 56, r: 140, t: 12, b: 40 };
  const xs = o.series.flatMap((s) => s.x).filter((x) => x > 0);
  const ys = o.series.flatMap((s) => s.y);
  const x0 = Math.log10(Math.min(...xs)), x1 = Math.log10(Math.max(...xs, o.marker?.x ?? 0));
  const yMax = Math.max(1e-9, ...ys) * 1.08;
  const X = (x: number) => m.l + ((Math.log10(x) - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - (y / yMax) * (H - m.t - m.b);
  const s = svg(W, H);
  for (const t of niceTicks(0, yMax, 5)) {
    add(s, 'line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'gridline' });
    add(s, 'text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }).textContent = fmt(t);
  }
  add(s, 'line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axisline' });
  for (const t of o.xTicks) {
    if (Math.log10(t) < x0 - 1e-9 || Math.log10(t) > x1 + 1e-9) continue;
    add(s, 'line', { x1: X(t), x2: X(t), y1: H - m.b, y2: H - m.b + 4, class: 'axisline' });
    add(s, 'text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }).textContent = o.xFormat(t);
  }
  add(s, 'text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = o.xLabel;
  const yl = add(s, 'text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` });
  yl.textContent = o.yLabel;
  if (o.marker) {
    const mx = X(o.marker.x);
    add(s, 'line', { x1: mx, x2: mx, y1: m.t, y2: H - m.b, stroke: 'var(--text-muted)', 'stroke-dasharray': '2 3', 'stroke-width': 1 });
    add(s, 'text', { x: mx - 4, y: m.t + 10, 'text-anchor': 'end' }).textContent = o.marker.label;
  }
  // series + direct end labels (stacked to avoid collisions)
  const ends: { y: number; label: string; color: string }[] = [];
  for (const se of o.series) {
    const d = se.x.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(se.y[i]).toFixed(1)}`).join('');
    add(s, 'path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-dasharray': se.dash ?? 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    ends.push({ y: Y(se.y[se.y.length - 1]), label: se.label, color: se.color });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  for (const e of ends) add(s, 'text', { x: W - m.r + 6, y: e.y + 4 }).textContent = e.label;

  // hover layer
  const cross = add(s, 'line', { x1: 0, x2: 0, y1: m.t, y2: H - m.b, stroke: 'var(--text-muted)', 'stroke-width': 1, visibility: 'hidden' });
  const dots = o.series.map((se) => add(s, 'circle', { r: 4, fill: se.color, stroke: 'var(--chart-surface)', 'stroke-width': 2, visibility: 'hidden' }));
  const hit = add(s, 'rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  hit.addEventListener('mousemove', (ev) => {
    const r = s.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const lx = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    const xv = Math.pow(10, lx);
    cross.setAttribute('x1', String(px)); cross.setAttribute('x2', String(px)); cross.setAttribute('visibility', 'visible');
    const rows: string[] = [];
    o.series.forEach((se, k) => {
      const yv = interpLog(se.x, se.y, xv);
      if (yv == null) { dots[k].setAttribute('visibility', 'hidden'); return; }
      dots[k].setAttribute('cx', String(X(xv))); dots[k].setAttribute('cy', String(Y(yv))); dots[k].setAttribute('visibility', 'visible');
      rows.push(`<div><span class="swatch" style="background:${se.color}"></span>${escapeHtml(se.label)}: <b>${fmt(yv)}</b></div>`);
    });
    showTip(`<div class="muted">${o.xFormat(xv)}</div>${rows.join('')}`, ev);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); });
  container.appendChild(s);
}

function interpLog(x: number[], y: number[], xv: number): number | null {
  if (!x.length || xv < x[0] || xv > x[x.length - 1]) return null;
  for (let i = 1; i < x.length; i++) {
    if (xv <= x[i]) {
      const f = (Math.log(xv) - Math.log(x[i - 1])) / (Math.log(x[i]) - Math.log(x[i - 1]) || 1);
      return y[i - 1] + f * (y[i] - y[i - 1]);
    }
  }
  return y[y.length - 1];
}

export interface RangeRow {
  label: string;
  color: string;
  p5: number; p25: number; p50: number; p75: number; p95: number;
  n: number;
}

/** Horizontal interval chart: P5–P95 whisker, P25–P75 bar, median dot */
export function rangeChart(container: HTMLElement, rows: RangeRow[], xLabel: string, ref?: { x: number; label: string }): void {
  const W = 760, rowH = 26, m = { l: 190, r: 24, t: 24, b: 38 };
  const H = m.t + m.b + rows.length * rowH;
  const xMax = Math.max(1e-9, ...rows.map((r) => r.p95), ref?.x ?? 0) * 1.06;
  const X = (x: number) => m.l + (Math.max(0, x) / xMax) * (W - m.l - m.r);
  const s = svg(W, H);
  for (const t of niceTicks(0, xMax, 6)) {
    add(s, 'line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: 'gridline' });
    add(s, 'text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }).textContent = fmt(t);
  }
  add(s, 'text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = xLabel;
  if (ref) {
    add(s, 'line', { x1: X(ref.x), x2: X(ref.x), y1: m.t, y2: H - m.b, stroke: 'var(--text-secondary)', 'stroke-dasharray': '4 3', 'stroke-width': 1.5 });
    add(s, 'text', { x: X(ref.x), y: m.t - 8, 'text-anchor': 'middle' }).textContent = ref.label;
  }
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    add(s, 'text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end' }).textContent = r.label;
    const g = add(s, 'g', {});
    add(g, 'line', { x1: X(r.p5), x2: X(r.p95), y1: cy, y2: cy, stroke: r.color, 'stroke-width': 2, 'stroke-linecap': 'round' });
    add(g, 'rect', { x: X(r.p25), y: cy - 6, width: Math.max(2, X(r.p75) - X(r.p25)), height: 12, rx: 4, fill: r.color, 'fill-opacity': 0.35, stroke: r.color, 'stroke-width': 1 });
    add(g, 'circle', { cx: X(r.p50), cy, r: 5, fill: r.color, stroke: 'var(--chart-surface)', 'stroke-width': 2 });
    const hit = add(g, 'rect', { x: m.l, y: cy - rowH / 2, width: W - m.l - m.r, height: rowH, fill: 'transparent' });
    hit.addEventListener('mousemove', (ev) => showTip(
      `<b>${escapeHtml(r.label)}</b> (n = ${r.n})<div>median ${fmt(r.p50)}</div><div>50 %: ${fmt(r.p25)} – ${fmt(r.p75)}</div><div>90 %: ${fmt(r.p5)} – ${fmt(r.p95)}</div>`, ev));
    hit.addEventListener('mouseleave', hideTip);
  });
  container.appendChild(s);
}

/** Histogram of one sample set, with optional reference lines */
export function histogram(container: HTMLElement, values: ArrayLike<number>, color: string, xLabel: string, refs: { x: number; label: string }[] = [], nBins = 30): void {
  const arr = Array.from(values).filter(Number.isFinite);
  if (!arr.length) return;
  let lo = Math.min(...arr, ...refs.map((r) => r.x)), hi = Math.max(...arr, ...refs.map((r) => r.x));
  if (hi === lo) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
  const counts = new Array(nBins).fill(0);
  for (const v of arr) counts[Math.min(nBins - 1, Math.floor(((v - lo) / (hi - lo)) * nBins))]++;
  const W = 380, H = 200, m = { l: 40, r: 10, t: 22, b: 38 };
  const cMax = Math.max(...counts);
  const X = (x: number) => m.l + ((x - lo) / (hi - lo)) * (W - m.l - m.r);
  const Y = (c: number) => H - m.b - (c / cMax) * (H - m.t - m.b);
  const s = svg(W, H);
  for (const t of niceTicks(0, cMax, 4)) {
    add(s, 'line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'gridline' });
    add(s, 'text', { x: m.l - 5, y: Y(t) + 4, 'text-anchor': 'end' }).textContent = fmt(t, 0);
  }
  for (const t of niceTicks(lo, hi, 5)) add(s, 'text', { x: X(t), y: H - m.b + 15, 'text-anchor': 'middle' }).textContent = fmt(t);
  add(s, 'text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = xLabel;
  const bw = (W - m.l - m.r) / nBins;
  counts.forEach((c, i) => {
    if (!c) return;
    const x = m.l + i * bw;
    const r = add(s, 'rect', { x: x + 1, y: Y(c), width: Math.max(1, bw - 2), height: H - m.b - Y(c), rx: 2, fill: color });
    const a = lo + (i / nBins) * (hi - lo), b = lo + ((i + 1) / nBins) * (hi - lo);
    r.addEventListener('mousemove', (ev) => showTip(`${fmt(a)} – ${fmt(b)}: <b>${c}</b> samples (${((100 * c) / arr.length).toFixed(1)} %)`, ev));
    r.addEventListener('mouseleave', hideTip);
  });
  add(s, 'line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axisline' });
  for (const rf of refs) {
    add(s, 'line', { x1: X(rf.x), x2: X(rf.x), y1: m.t, y2: H - m.b, stroke: 'var(--text-secondary)', 'stroke-dasharray': '4 3', 'stroke-width': 1.5 });
    add(s, 'text', { x: X(rf.x), y: m.t - 8, 'text-anchor': 'middle' }).textContent = rf.label;
  }
  container.appendChild(s);
}
