// ============================================================
// HipCreep — series of retrieved liners (several HipWear exports)
// Setup table (per-liner inputs not in the HipWear file), batch run, summary
// table, charts and CSV export.
// ============================================================

import type { LoadedHipWearCase } from '../io/hipwear.ts';
import { MATERIALS, MATERIAL_IDS, THERMAL_LABEL, type MaterialId, type Irradiation, type ThermalTreatment } from '../model/materials.ts';
import type { SeriesResult, ElevationStatus } from '../model/series.ts';
import type { Loading } from '../model/laws.ts';
import { fmt, escapeHtml, cssVar } from './format.ts';
import { svg, add, niceTicks, showTip, hideTip } from './charts.ts';

export interface SeriesItem {
  L: LoadedHipWearCase;
  bodyMassKg: number;
  material: MaterialId;
  irradiation: Irradiation;
  exVivoDays: number;
  implantMonths: number;
}

export interface SeriesCallbacks {
  onRun: (items: SeriesItem[]) => void;
  onOpen: (item: SeriesItem) => void;
  onClose: () => void;
}

const MAT_COLOR: Record<MaterialId, string> = {
  'virgin': '--text-secondary', 'conventional': '--series-2', 'abg2-duration': '--series-2', 'hxlpe-remelted': '--series-1',
  'hxlpe-annealed': '--series-3', 'vite-hxlpe': '--series-4', 'hxlpe': '--text-muted', 'dose': '--text-primary',
};

function section(root: HTMLElement, title: string, lead?: string): HTMLElement {
  const s = document.createElement('section');
  s.className = 'section';
  s.innerHTML = `<h2>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}`;
  root.appendChild(s);
  return s;
}

/** Editable list of the loaded liners */
export function renderSeriesSetup(root: HTMLElement, items: SeriesItem[], cb: SeriesCallbacks): void {
  root.innerHTML = '';
  const sec = section(root, `Series of ${items.length} liners`,
    'Each liner is run with the inputs in the sidebar (loading, laws, Monte Carlo…) plus what its HipWear file provides (head, wall, clearance, load direction, penetration, surface). Complete here what the files do not contain. The analysis takes a few seconds per liner.');
  const rows = items.map((it, i) => {
    const m = it.L.measured;
    return `<tr data-i="${i}">
      <td>${i + 1}</td><td><b>${escapeHtml(it.L.caseId)}</b><div class="range">${escapeHtml(it.L.name)}</div></td>
      <td><input type="number" class="s-years" step="0.01" min="0" value="${+(it.implantMonths / 12).toFixed(2)}" aria-label="Years in vivo" /></td>
      <td><select class="s-mat" aria-label="Polyethylene">${MATERIAL_IDS.map((id) => `<option value="${id}"${id === it.material ? ' selected' : ''}>${escapeHtml(MATERIALS[id].label)}</option>`).join('')}</select></td>
      <td><input type="number" class="s-dose" step="1" min="0" value="${it.irradiation.doseKGy}" aria-label="Dose (kGy)" ${it.material === 'dose' ? '' : 'disabled'} />
        <select class="s-th" aria-label="Thermal treatment" ${it.material === 'dose' ? '' : 'disabled'}>${(Object.keys(THERMAL_LABEL) as ThermalTreatment[]).map((k) => `<option value="${k}"${k === it.irradiation.thermal ? ' selected' : ''}>${escapeHtml(THERMAL_LABEL[k].split(' (')[0])}</option>`).join('')}</select></td>
      <td><input type="number" class="s-mass" step="1" min="20" value="${it.bodyMassKg}" aria-label="Body mass" /></td>
      <td><input type="number" class="s-days" step="1" min="0" value="${it.exVivoDays}" aria-label="Days ex vivo" /></td>
      <td>${m ? (m.notDetected ? `n.d. (&lt; ${fmt(m.detectionLimitUm)})` : `${fmt(m.penetrationUm)} ± ${fmt(m.sdUm)}`) : '—'}</td>
      <td>${it.L.mesh ? '✓' : '—'}</td>
      <td>${it.L.warnings.length ? `<span title="${escapeHtml(it.L.warnings.join('\n'))}">${it.L.warnings.length} ⚠</span>` : ''}</td>
      <td><button class="btn s-del" type="button" title="Remove from the series">✕</button></td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-setup">
    <thead><tr><th>#</th><th>Case</th><th>Years in vivo</th><th>Polyethylene</th><th>Dose (kGy) / treatment<div class="range">only for “By radiation dose…”</div></th><th>Body mass (kg)</th><th>Days ex vivo</th><th>D (µm)</th><th>Surface</th><th>Notes</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <div class="export-row" style="margin-top:12px"><button class="btn primary" id="s-run">Run series</button><button class="btn" id="s-close">Back to single case</button>
    <span class="muted" id="s-status" style="font-size:12px;align-self:center"></span></div>
    <div class="progress" style="margin-top:8px"><div id="s-bar"></div></div>`);
  const tb = sec.querySelector('tbody')!;
  const sync = () => {
    tb.querySelectorAll('tr').forEach((tr) => {
      const it = items[+tr.dataset.i!];
      it.implantMonths = Math.max(0, +(tr.querySelector('.s-years') as HTMLInputElement).value * 12);
      it.material = (tr.querySelector('.s-mat') as HTMLSelectElement).value as MaterialId;
      it.irradiation = { doseKGy: Math.max(0, +(tr.querySelector('.s-dose') as HTMLInputElement).value || 0), thermal: (tr.querySelector('.s-th') as HTMLSelectElement).value as ThermalTreatment };
      it.bodyMassKg = Math.max(20, +(tr.querySelector('.s-mass') as HTMLInputElement).value || 80);
      it.exVivoDays = Math.max(0, +(tr.querySelector('.s-days') as HTMLInputElement).value || 0);
    });
  };
  tb.addEventListener('change', (ev) => {
    const t = ev.target as HTMLElement;
    if (!t.classList.contains('s-mat')) return;
    const tr = t.closest('tr')!;
    const on = (t as HTMLSelectElement).value === 'dose';
    (tr.querySelector('.s-dose') as HTMLInputElement).disabled = !on;
    (tr.querySelector('.s-th') as HTMLSelectElement).disabled = !on;
  });
  tb.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest('.s-del');
    if (!b) return;
    sync();
    items.splice(+(b.closest('tr') as HTMLElement).dataset.i!, 1);
    if (items.length) renderSeriesSetup(root, items, cb); else cb.onClose();
  });
  (sec.querySelector('#s-run') as HTMLButtonElement).addEventListener('click', () => { sync(); cb.onRun(items); });
  (sec.querySelector('#s-close') as HTMLButtonElement).addEventListener('click', cb.onClose);
}

const ELEV_TXT: Record<ElevationStatus, string> = { consistent: '✓', 'median-below': '≈', below: '✗' };

/** Results of the whole series: one section per loading mode (independent Monte Carlo), then the comparisons */
export function renderSeriesResults(root: HTMLElement, items: SeriesItem[], res: SeriesResult[], cb: SeriesCallbacks, csv: () => void, xlsx?: () => void): void {
  for (const mode of ['dynamic', 'static'] as Loading[]) renderModeSection(root, items, res, cb, mode);
  renderModeComparison(root, res);
  const sec = renderWearScenarios(root, res);
  sec.insertAdjacentHTML('beforeend', `<div class="export-row" style="margin-top:12px"><button class="btn primary" id="s-xlsx">Series (Excel)</button><button class="btn" id="s-csv">Series (CSV)</button><button class="btn" id="s-back">Edit series</button></div>`);
  (sec.querySelector('#s-csv') as HTMLButtonElement).addEventListener('click', csv);
  const bx = sec.querySelector('#s-xlsx') as HTMLButtonElement;
  if (xlsx) bx.addEventListener('click', xlsx); else bx.remove();
  (sec.querySelector('#s-back') as HTMLButtonElement).addEventListener('click', () => renderSeriesSetup(root, items, cb));
}

const cellStat = (s: { p50: number; p5: number; p95: number } | null | undefined) => s ? `<b>${fmt(s.p50)}</b><div class="range">${fmt(s.p5)} – ${fmt(s.p95)}</div>` : '—';
const cellD = (r: SeriesResult) => r.measured ? (r.measured.notDetected ? `n.d.<div class="range">&lt; ${fmt(r.measured.detectionLimitUm)}</div>` : `<b>${fmt(r.measured.penetrationUm)}</b><div class="range">± ${fmt(r.measured.sdUm)}</div>`) : '—';
const cellCase = (r: SeriesResult) => `<b>${escapeHtml(r.caseId)}</b><div class="range"><span class="swatch" style="background:${cssVar(MAT_COLOR[r.material])}"></span>${escapeHtml(r.materialLabel.split(',')[0])}</div>`;
const diffCell = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && Number.isFinite(a) && Number.isFinite(b) ? fmt(a - b) : '—');

/** One loading mode: its own Monte Carlo, table and charts */
function renderModeSection(root: HTMLElement, items: SeriesItem[], res: SeriesResult[], cb: SeriesCallbacks, mode: Loading): void {
  const sec = section(root, `Series results — ${mode} mode (independent Monte Carlo)`,
    `${mode === 'dynamic' ? 'Gait cycles at 1 Hz during the walking time' : 'The peak walking force held during the whole implantation (upper bound)'}; this mode has its own Monte Carlo simulation, independent of the ${mode === 'dynamic' ? 'static' : 'dynamic'} one. Median and 90 % interval for each liner, in µm. <b>L&amp;P</b> and <b>long</b> are the two recovery scenarios (Lee &amp; Pienkowski / long loading). <b>Elevation bound</b>: minimum remaining creep from the material pushed above the original sphere (sphere → plane); ✓ the model is consistent with it in that scenario, ≈ the model median is below it, ✗ the model is below it (under-predicts).`);
  const body = res.map((r, i) => {
    const m = r.modes[mode], lp = m.byScenario.lp, lg = m.byScenario.long;
    const ev = r.elevationMinCreepUm ? `<b>${fmt(r.elevationMinCreepUm.nominal)}</b><div class="range">${fmt(r.elevationMinCreepUm.lo)} – ${fmt(r.elevationMinCreepUm.hi)}</div><div class="range">L&amp;P ${lp?.elevation ? ELEV_TXT[lp.elevation] : '—'} · long ${lg?.elevation ? ELEV_TXT[lg.elevation] : '—'}</div>` : '—';
    const vd = m.verdict ? `<span class="badge ${m.verdict.level}" title="${escapeHtml(m.verdict.detail)}">${m.verdict.level === 'separable' ? '✓' : m.verdict.level === 'inconsistent' ? '!' : '≈'}</span> ${escapeHtml(m.verdict.title)}` : '—';
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td>
      <td>${fmt(r.years)}</td><td>${cellD(r)}</td><td>${cellStat(m.creep)}</td><td>${cellStat(lp?.remaining)}</td><td>${cellStat(lg?.remaining)}</td>
      <td>${cellStat(lp?.wear)}</td><td>${cellStat(lg?.wear)}</td><td>${ev}</td><td class="vd">${vd}</td>
      <td><button class="btn s-open" data-i="${i}" type="button">Open</button></td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th rowspan="2">#</th><th rowspan="2">Case</th><th rowspan="2">Years</th><th rowspan="2">D</th><th rowspan="2">C<sub>max</sub></th><th colspan="2">Remaining creep</th><th colspan="2">Wear W</th><th rowspan="2">Elevation bound</th><th rowspan="2">Verdict</th><th rowspan="2"></th></tr>
    <tr><th>L&amp;P</th><th>long</th><th>L&amp;P</th><th>long</th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
  sec.querySelectorAll('.s-open').forEach((b) => b.addEventListener('click', () => cb.onOpen(items[+(b as HTMLElement).dataset.i!])));
  for (const card of seriesChartCards(res, mode)) sec.appendChild(card);
}

/** Dynamic vs static, liner by liner */
function renderModeComparison(root: HTMLElement, res: SeriesResult[]): void {
  const sec = section(root, 'Dynamic vs static — per liner',
    'Results of the two independent simulations side by side (median and 90 % interval, µm; remaining creep and wear with both recovery scenarios pooled). <b>Static / dynamic</b>: ratio of the medians of the creep at explantation. <b>Δ</b>: dynamic − static median.');
  const body = res.map((r, i) => {
    const d = r.modes.dynamic, s = r.modes.static;
    const ratio = d.creep.p50 > 0 ? (s.creep.p50 / d.creep.p50).toFixed(2) : '—';
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td><td>${fmt(r.years)}</td><td>${cellD(r)}</td>
      <td>${cellStat(d.creep)}</td><td>${cellStat(s.creep)}</td><td>${ratio}</td>
      <td>${cellStat(d.remaining)}</td><td>${cellStat(s.remaining)}</td><td>${diffCell(d.remaining.p50, s.remaining.p50)}</td>
      <td>${cellStat(d.wear)}</td><td>${cellStat(s.wear)}</td><td>${diffCell(d.wear?.p50, s.wear?.p50)}</td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th rowspan="2">#</th><th rowspan="2">Case</th><th rowspan="2">Years</th><th rowspan="2">D</th><th colspan="3">Creep at explantation C<sub>max</sub></th><th colspan="3">Remaining creep at the scan</th><th colspan="3">Wear W</th></tr>
    <tr><th>dynamic</th><th>static</th><th>static / dynamic</th><th>dynamic</th><th>static</th><th>Δ</th><th>dynamic</th><th>static</th><th>Δ</th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
}

/** Wear with each recovery scenario, both modes: table and charts */
function renderWearScenarios(root: HTMLElement, res: SeriesResult[]): HTMLElement {
  const sec = section(root, 'Wear — Lee &amp; Pienkowski vs long-loading recovery',
    'Wear W = D − remaining creep for each recovery scenario (median and 90 % interval, µm). <b>L&amp;P</b>: recovery of the laboratory tests (about half of the creep within a week); <b>long</b>: almost no recovery after years of loading (Estok 2005). <b>Δ</b>: L&amp;P − long median, i.e. how much the recovery assumption changes the wear. Liners whose penetration was not detected have no wear estimate.');
  const body = res.map((r, i) => {
    const cells = (['dynamic', 'static'] as Loading[]).map((mode) => {
      const b = r.modes[mode].byScenario;
      return `<td>${cellStat(b.lp?.wear)}</td><td>${cellStat(b.long?.wear)}</td><td>${diffCell(b.lp?.wear?.p50, b.long?.wear?.p50)}</td>`;
    }).join('');
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td><td>${fmt(r.years)}</td><td>${cellD(r)}</td>${cells}</tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th rowspan="2">#</th><th rowspan="2">Case</th><th rowspan="2">Years</th><th rowspan="2">D</th><th colspan="3">Dynamic: wear W</th><th colspan="3">Static: wear W</th></tr>
    <tr><th>L&amp;P</th><th>long</th><th>Δ</th><th>L&amp;P</th><th>long</th><th>Δ</th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
  if (res.some((r) => r.modes.dynamic.wear || r.modes.static.wear)) {
    for (const mode of ['dynamic', 'static'] as Loading[]) {
      const card = document.createElement('div');
      card.className = 'chart-card';
      card.style.marginTop = '14px';
      card.innerHTML = `<div class="chart-title">Estimated wear per liner, L&amp;P vs long loading (${mode})</div>
        <div class="chart-sub">Bars: 90 % interval of the wear (dot = median) with each recovery scenario. Diamond: measured D (the wear cannot exceed it by more than the uncertainty). n.d.: penetration not detected, no wear estimate.</div>
        <div class="legend"><span class="item"><span class="swatch" style="background:${cssVar('--series-1')}"></span>Wear, L&amp;P recovery</span><span class="item"><span class="swatch" style="background:${cssVar('--series-2')}"></span>Wear, long-loading recovery</span><span class="item">◆ measured D</span></div>`;
      wearPerLinerChart(card, res, mode);
      sec.appendChild(card);
    }
  }
  return sec;
}

/** The charts of one loading mode (title, explanation, legend and SVG) */
export function seriesChartCards(res: SeriesResult[], mode: Loading): HTMLElement[] {
  const cards: HTMLElement[] = [];
  // ---- chart: each liner, measured D vs remaining creep in both scenarios + elevation bound ----
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.style.marginTop = '14px';
  card.innerHTML = `<div class="chart-title">Measured penetration vs remaining creep, per liner (${mode})</div>
    <div class="chart-sub">Bars: 90 % interval of the remaining creep (dot = median). Diamond: measured D ± 2 SD (open box: not detected, below the detection limit). Triangle: minimum creep from the elevations. Wear is the gap between D and the remaining creep.</div>
    <div class="legend"><span class="item"><span class="swatch" style="background:${cssVar('--series-1')}"></span>Remaining creep, L&amp;P</span><span class="item"><span class="swatch" style="background:${cssVar('--series-2')}"></span>Remaining creep, long loading</span><span class="item">◆ measured D</span><span class="item">▲ elevation bound</span></div>`;
  perLinerChart(card, res, mode);
  cards.push(card);

  // ---- chart: wear vs years by material ----
  if (res.some((r) => r.modes[mode].wear)) {
    const c2 = document.createElement('div');
    c2.className = 'chart-card';
    c2.style.marginTop = '14px';
    const mats = Array.from(new Map(res.map((r) => [r.materialLabel, r.material])).entries());
    c2.innerHTML = `<div class="chart-title">Estimated wear vs time in vivo (${mode})</div>
      <div class="chart-sub">Vertical segment: from the long-loading to the L&amp;P median (the recovery uncertainty); dot: envelope median. Colour = polyethylene.</div>
      <div class="legend">${mats.map(([lab, m]) => `<span class="item"><span class="swatch" style="background:${cssVar(MAT_COLOR[m])}"></span>${escapeHtml(lab.split(',')[0])}</span>`).join('')}</div>`;
    wearVsYears(c2, res, mode);
    cards.push(c2);
  }
  return cards;
}

/** Wear per liner with each recovery scenario (horizontal 90 % bars) and the measured D */
function wearPerLinerChart(container: HTMLElement, res: SeriesResult[], mode: Loading): void {
  const W = 760, rowH = 34, m = { l: 150, r: 24, t: 10, b: 38 };
  const H = m.t + m.b + res.length * rowH;
  let lo = 0, hi = 1;
  for (const r of res) {
    for (const k of ['lp', 'long'] as const) {
      const w = r.modes[mode].byScenario[k]?.wear;
      if (w) { lo = Math.min(lo, w.p5); hi = Math.max(hi, w.p95); }
    }
    if (r.measured && !r.measured.notDetected) hi = Math.max(hi, r.measured.penetrationUm);
  }
  const span = hi - lo; lo -= 0.03 * span; hi += 0.03 * span;
  const X = (x: number) => m.l + ((x - lo) / (hi - lo)) * (W - m.l - m.r);
  const s = svg(W, H);
  for (const t of niceTicks(lo, hi, 6)) {
    add(s, 'line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: t === 0 ? 'axisline' : 'gridline' });
    add(s, 'text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }).textContent = fmt(t);
  }
  add(s, 'text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = 'estimated wear W (µm)';
  const C1 = cssVar('--series-1'), C2 = cssVar('--series-2'), CI = cssVar('--text-primary'), CM = cssVar('--text-muted');
  res.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    add(s, 'text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end' }).textContent = r.caseId.length > 18 ? r.caseId.slice(0, 17) + '…' : r.caseId;
    const b = r.modes[mode].byScenario;
    if (!b.lp?.wear && !b.long?.wear) {
      add(s, 'text', { x: X(Math.max(lo, 0)) + 6, y: cy + 4, fill: CM }).textContent = r.measured?.notDetected ? `n.d. (< ${fmt(r.measured.detectionLimitUm)} µm)` : 'no measurement';
      return;
    }
    ([['lp', C1, -6], ['long', C2, 6]] as const).forEach(([k, col, dy]) => {
      const w = b[k]?.wear;
      if (!w) return;
      add(s, 'line', { x1: X(w.p5), x2: X(w.p95), y1: cy + dy, y2: cy + dy, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-opacity': 0.55 });
      add(s, 'circle', { cx: X(w.p50), cy: cy + dy, r: 4, fill: col, stroke: 'var(--chart-surface)', 'stroke-width': 1.5 });
    });
    const M = r.measured;
    if (M && !M.notDetected) {
      const x = X(M.penetrationUm);
      add(s, 'path', { d: `M${x},${cy - 5}L${x + 5},${cy}L${x},${cy + 5}L${x - 5},${cy}Z`, fill: CI });
    }
    const hit = add(s, 'rect', { x: m.l, y: cy - rowH / 2, width: W - m.l - m.r, height: rowH, fill: 'transparent' });
    hit.addEventListener('mousemove', (ev) => showTip(`<b>${escapeHtml(r.caseId)}</b> · ${mode}<div>D: ${M && !M.notDetected ? `${fmt(M.penetrationUm)} ± ${fmt(M.sdUm)}` : '—'} µm</div>
      <div>W L&amp;P: ${fmt(b.lp?.wear?.p50)} (${fmt(b.lp?.wear?.p5)}–${fmt(b.lp?.wear?.p95)})</div>
      <div>W long: ${fmt(b.long?.wear?.p50)} (${fmt(b.long?.wear?.p5)}–${fmt(b.long?.wear?.p95)})</div>`, ev));
    hit.addEventListener('mouseleave', hideTip);
  });
  container.appendChild(s);
}

function perLinerChart(container: HTMLElement, res: SeriesResult[], mode: Loading): void {
  const W = 760, rowH = 34, m = { l: 150, r: 24, t: 10, b: 38 };
  const H = m.t + m.b + res.length * rowH;
  let xMax = 1;
  for (const r of res) {
    const d = r.modes[mode];
    for (const k of ['lp', 'long'] as const) xMax = Math.max(xMax, d.byScenario[k]?.remaining.p95 ?? 0);
    if (r.measured) xMax = Math.max(xMax, r.measured.notDetected ? (r.measured.detectionLimitUm ?? 0) : r.measured.penetrationUm + 2 * r.measured.sdUm);
    if (r.elevationMinCreepUm) xMax = Math.max(xMax, r.elevationMinCreepUm.nominal);
  }
  xMax *= 1.05;
  // liners with millimetre penetrations next to creep of tens of µm: switch to a log axis
  const meds = res.map((r) => r.modes[mode].remaining.p50).filter((v) => v > 0).sort((a, b) => a - b);
  const logX = meds.length > 0 && xMax > 20 * meds[Math.floor(meds.length / 2)];
  const lows = [meds[0] ?? 10, ...res.map((r) => r.elevationMinCreepUm?.nominal ?? Infinity), ...res.map((r) => r.modes[mode].byScenario.lp?.remaining.p5 ?? Infinity)].filter((v) => v > 0 && Number.isFinite(v));
  const xMin = logX ? Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, Math.min(...lows) / 1.5))))) : 0;
  const X = (x: number) => logX
    ? m.l + ((Math.log10(Math.max(xMin, x)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * (W - m.l - m.r)
    : m.l + (Math.max(0, x) / xMax) * (W - m.l - m.r);
  const s = svg(W, H);
  const ticks = logX ? (() => { const t: number[] = []; for (let e = Math.log10(xMin); Math.pow(10, e) <= xMax; e++) for (const k of [1, 2, 5]) { const v = k * Math.pow(10, e); if (v >= xMin && v <= xMax) t.push(v); } return t; })() : niceTicks(0, xMax, 6);
  for (const t of ticks) {
    add(s, 'line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: 'gridline' });
    add(s, 'text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }).textContent = fmt(t);
  }
  add(s, 'text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = logX ? 'µm (log scale)' : 'µm';
  const C1 = cssVar('--series-1'), C2 = cssVar('--series-2'), C3 = cssVar('--series-3'), CI = cssVar('--text-primary');
  res.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    add(s, 'text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end' }).textContent = r.caseId.length > 18 ? r.caseId.slice(0, 17) + '…' : r.caseId;
    const d = r.modes[mode];
    ([['lp', C1, -6], ['long', C2, 6]] as const).forEach(([k, col, dy]) => {
      const b = d.byScenario[k];
      if (!b) return;
      add(s, 'line', { x1: X(b.remaining.p5), x2: X(b.remaining.p95), y1: cy + dy, y2: cy + dy, stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-opacity': 0.55 });
      add(s, 'circle', { cx: X(b.remaining.p50), cy: cy + dy, r: 4, fill: col, stroke: 'var(--chart-surface)', 'stroke-width': 1.5 });
    });
    const M = r.measured;
    if (M && !M.notDetected) {
      add(s, 'line', { x1: X(M.penetrationUm - 2 * M.sdUm), x2: X(M.penetrationUm + 2 * M.sdUm), y1: cy, y2: cy, stroke: CI, 'stroke-width': 1.2 });
      const x = X(M.penetrationUm);
      add(s, 'path', { d: `M${x},${cy - 6}L${x + 6},${cy}L${x},${cy + 6}L${x - 6},${cy}Z`, fill: CI });
    } else if (M?.notDetected && M.detectionLimitUm) {
      add(s, 'rect', { x: X(0), y: cy - 5, width: X(M.detectionLimitUm) - X(0), height: 10, fill: 'none', stroke: CI, 'stroke-dasharray': '3 2' });
    }
    if (r.elevationMinCreepUm && r.elevationMinCreepUm.nominal > 0) {
      const x = X(r.elevationMinCreepUm.nominal);
      add(s, 'path', { d: `M${x},${cy - 12}L${x + 6},${cy - 2}L${x - 6},${cy - 2}Z`, fill: C3 });
    }
    const hit = add(s, 'rect', { x: m.l, y: cy - rowH / 2, width: W - m.l - m.r, height: rowH, fill: 'transparent' });
    hit.addEventListener('mousemove', (ev) => showTip(`<b>${escapeHtml(r.caseId)}</b><div>D: ${M ? (M.notDetected ? `not detected (&lt; ${fmt(M.detectionLimitUm)})` : `${fmt(M.penetrationUm)} ± ${fmt(M.sdUm)}`) : '—'} µm</div>
      <div>C<sub>rem</sub> L&amp;P: ${fmt(d.byScenario.lp?.remaining.p50)} (${fmt(d.byScenario.lp?.remaining.p5)}–${fmt(d.byScenario.lp?.remaining.p95)})</div>
      <div>C<sub>rem</sub> long: ${fmt(d.byScenario.long?.remaining.p50)} (${fmt(d.byScenario.long?.remaining.p5)}–${fmt(d.byScenario.long?.remaining.p95)})</div>
      <div>Elevation bound: ${fmt(r.elevationMinCreepUm?.nominal)} µm</div>`, ev));
    hit.addEventListener('mouseleave', hideTip);
  });
  container.appendChild(s);
}

function wearVsYears(container: HTMLElement, res: SeriesResult[], mode: Loading): void {
  const W = 760, H = 300, m = { l: 56, r: 20, t: 12, b: 40 };
  const pts = res.filter((r) => r.modes[mode].wear);
  const ys = pts.flatMap((r) => [r.modes[mode].byScenario.lp?.wear?.p50 ?? 0, r.modes[mode].byScenario.long?.wear?.p50 ?? 0, r.modes[mode].wear!.p50]);
  const yMin = Math.min(0, ...ys) * 1.1, yMax = Math.max(1, ...ys) * 1.1;
  const xMax = Math.max(1, ...pts.map((r) => r.years)) * 1.08;
  const X = (x: number) => m.l + (x / xMax) * (W - m.l - m.r);
  const Y = (y: number) => H - m.b - ((y - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const s = svg(W, H);
  for (const t of niceTicks(yMin, yMax, 5)) {
    add(s, 'line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axisline' : 'gridline' });
    add(s, 'text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }).textContent = fmt(t);
  }
  for (const t of niceTicks(0, xMax, 6)) add(s, 'text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle' }).textContent = fmt(t);
  add(s, 'text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }).textContent = 'years in vivo';
  const yl = add(s, 'text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` });
  yl.textContent = 'estimated wear W (µm)';
  for (const r of pts) {
    const col = cssVar(MAT_COLOR[r.material]);
    const d = r.modes[mode], a = d.byScenario.long?.wear?.p50, b = d.byScenario.lp?.wear?.p50;
    if (a != null && b != null) add(s, 'line', { x1: X(r.years), x2: X(r.years), y1: Y(a), y2: Y(b), stroke: col, 'stroke-width': 3, 'stroke-opacity': 0.5, 'stroke-linecap': 'round' });
    const dot = add(s, 'circle', { cx: X(r.years), cy: Y(d.wear!.p50), r: 5, fill: col, stroke: 'var(--chart-surface)', 'stroke-width': 1.5 });
    dot.addEventListener('mousemove', (ev) => showTip(`<b>${escapeHtml(r.caseId)}</b><div>${fmt(r.years)} years · ${escapeHtml(r.materialLabel.split(',')[0])}</div><div>W median ${fmt(d.wear!.p50)} µm (long ${fmt(a)} · L&amp;P ${fmt(b)})</div><div>≈ ${fmt(d.wear!.p50 / Math.max(r.years, 0.01))} µm/year</div>`, ev));
    dot.addEventListener('mouseleave', hideTip);
  }
  container.appendChild(s);
}
