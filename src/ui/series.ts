// ============================================================
// HipCreep — series of retrieved liners (several HipWear exports)
// Setup table (per-liner inputs not in the HipWear file), batch run, summary
// table, charts and CSV export.
// ============================================================

import type { LoadedHipWearCase } from '../io/hipwear.ts';
import { MATERIALS, MATERIAL_IDS, THERMAL_LABEL, type MaterialId, type Irradiation, type ThermalTreatment } from '../model/materials.ts';
import { cohortFits, LINEAR_OSTEOLYSIS_MM_PER_YEAR, VOLUMETRIC_OSTEOLYSIS_MM3_PER_YEAR, LAW_TESTED_MAX_MPA, type SeriesResult, type ElevationStatus, type CohortFit } from '../model/series.ts';
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
  renderElevatedZone(root, res);
  renderModeComparison(root, res);
  renderWearScenarios(root, res);
  renderWearRates(root, res);
  renderCohort(root, res);
  renderContact(root, res);
  renderBudget(root, res);
  const sec = section(root, 'Export');
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

/** Measured elevated material around the load zone of each liner (no model) */
function renderElevatedZone(root: HTMLElement, res: SeriesResult[]): void {
  if (!res.some((r) => r.elevatedZone)) return;
  const sec = section(root, 'Elevated material around the load zone — as measured',
    'Material above the original sphere counted directly on the HipWear surface (no creep or wear model), <b>only around the load zone</b>: the contact zone of the creep model about the penetration direction plus a margin (about the pole when there is no direction). Elevations elsewhere — damage at retrieval, badly scanned parts, rim contact — are left out. Wear cannot create elevations and creep conserves volume, so this volume is the minimum creep volume as measured. <b>Range</b>: with the reference radius ± its uncertainty (setting, 5 µm by default). <b>Above noise</b>: beyond 2σ of the scanner noise, minus what noise alone would give. <b>Plausible</b>: not more than the largest creep the model allows, highest point not at the edge, above the noise.');
  const body = res.map((r, i) => {
    const z = r.elevatedZone;
    if (!z) return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td><td colspan="9">no surface in the file</td></tr>`;
    const pl = z.plausibility.ok ? '<span class="badge separable">✓</span>' : `<span class="badge inconsistent" title="${escapeHtml(z.plausibility.flags.join('; '))}">!</span> <span class="range">${escapeHtml(z.plausibility.flags.join('; '))}</span>`;
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td><td>${z.zoneAboutPole ? 'pole' : 'load'} ${fmt(z.zoneHalfAngleDeg)}°</td><td>${fmt(z.areaMm2)}</td>
      <td><b>${fmt(z.volumeMm3, 3)}</b><div class="range">${fmt(z.volumeRangeMm3[0], 3)} – ${fmt(z.volumeRangeMm3[1], 3)}</div></td><td>${fmt(z.volumeAboveNoiseMm3, 3)}</td>
      <td><b>${fmt(z.peakUm)}</b><div class="range">at ${fmt(z.peakThetaDeg)}° from pole</div></td><td>${fmt(z.peak1mm2Um)}</td><td>${fmt(z.excludedVolumeMm3, 3)}</td><td>${fmt(z.sigmaUm)}</td><td class="vd">${pl}</td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th>#</th><th>Case</th><th>Load zone</th><th>Elevated area (mm²)</th><th>Elevated volume (mm³)</th><th>Above noise (mm³)</th><th>Highest point (µm)</th><th>Highest 1 mm² (µm)</th><th>Left out, outside the zone (mm³)</th><th>Noise σ (µm)</th><th>Plausible as creep</th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
}

const pctS = (s: { p50: number; p5: number; p95: number } | null | undefined) => s ? `<b>${(100 * s.p50).toFixed(0)} %</b><div class="range">${(100 * s.p5).toFixed(0)} – ${(100 * s.p95).toFixed(0)} %</div>` : '—';
/** A Stats divided by the years in vivo, as mm/year (from µm) or mm³/year */
const rateCell = (s: { p50: number; p5: number; p95: number } | null | undefined, years: number, fromUm: boolean, thr: number) => {
  if (!s || !(years > 0)) return '—';
  const k = (fromUm ? 1e-3 : 1) / years, d = fromUm ? 3 : 1;
  const hi = s.p50 * k > thr;
  return `<b${hi ? ' class="warn-v"' : ''}>${(s.p50 * k).toFixed(d)}</b><div class="range">${(s.p5 * k).toFixed(d)} – ${(s.p95 * k).toFixed(d)}</div>`;
};

/** Wear rates, volumetric wear and the share of the penetration that is creep */
function renderWearRates(root: HTMLElement, res: SeriesResult[]): void {
  const sec = section(root, 'Wear rates, volumetric wear and creep share',
    `Wear corrected for the remaining creep, both recovery scenarios pooled (median and 90 % interval). Linear wear rate = W / years in vivo (mm/year); volumetric wear = HipWear penetration volume − remaining creep volume of the model (mm³), and its rate (mm³/year). <b>Creep share</b>: remaining creep / D. Values in orange exceed ${LINEAR_OSTEOLYSIS_MM_PER_YEAR} mm/year (osteolysis rare below it; Dumbleton et al. 2002) or ${VOLUMETRIC_OSTEOLYSIS_MM3_PER_YEAR} mm³/year (osteolysis frequent above it; Oparaugo et al. 2001).`);
  const body = res.map((r, i) => {
    const d = r.modes.dynamic, st = r.modes.static;
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td><td>${fmt(r.years)}</td><td>${cellD(r)}</td>
      <td>${pctS(d.creepShare)}</td><td>${pctS(st.creepShare)}</td>
      <td>${rateCell(d.wear, r.years, true, LINEAR_OSTEOLYSIS_MM_PER_YEAR)}</td><td>${rateCell(st.wear, r.years, true, LINEAR_OSTEOLYSIS_MM_PER_YEAR)}</td>
      <td>${cellStat(d.wearVol)}</td><td>${cellStat(st.wearVol)}</td>
      <td>${rateCell(d.wearVol, r.years, false, VOLUMETRIC_OSTEOLYSIS_MM3_PER_YEAR)}</td><td>${rateCell(st.wearVol, r.years, false, VOLUMETRIC_OSTEOLYSIS_MM3_PER_YEAR)}</td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th rowspan="2">#</th><th rowspan="2">Case</th><th rowspan="2">Years</th><th rowspan="2">D (µm)</th><th colspan="2">Creep share of D</th><th colspan="2">Linear wear rate (mm/year)</th><th colspan="2">Volumetric wear (mm³)</th><th colspan="2">Volumetric wear rate (mm³/year)</th></tr>
    <tr><th>dynamic</th><th>static</th><th>dynamic</th><th>static</th><th>dynamic</th><th>static</th><th>dynamic</th><th>static</th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
}

/** Cohort: measured penetration vs years in vivo, by polyethylene */
function renderCohort(root: HTMLElement, res: SeriesResult[]): void {
  const fits = cohortFits(res);
  const sec = section(root, 'Cohort — penetration vs time in vivo',
    'Measured penetration D of the liners with a detected penetration against their years in vivo, by polyethylene (straight-line least-squares fit, groups of ≥ 3 liners). As in the clinical radiographic method, the <b>slope</b> is the penetration rate of the group and the <b>intercept</b> the early penetration (creep + bedding-in). The intercept is compared with the remaining creep the model predicts for the same liners (mean of their medians): an independent check made only with these retrievals, nothing is fitted to them. With few liners per group the intervals are wide.');
  if (!fits.length) { sec.insertAdjacentHTML('beforeend', '<p class="muted">Fewer than 3 liners with a detected penetration.</p>'); return; }
  const rows = fits.map((f) => `<tr><td><b>${escapeHtml(f.group)}</b></td><td>${f.n}</td>
    <td><b>${(f.slope / 1000).toFixed(3)}</b><div class="range">± ${(f.slopeSe / 1000).toFixed(3)} (SE)</div></td>
    <td><b>${fmt(f.intercept)}</b><div class="range">± ${fmt(f.interceptSe)} (SE)</div></td><td>${Number.isFinite(f.r2) ? f.r2.toFixed(2) : '—'}</td>
    <td>${fmt(f.modelCreepDyn)}</td><td>${fmt(f.modelCreepStat)}</td></tr>`).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th>Group</th><th>n</th><th>Penetration rate (mm/year)</th><th>Intercept: early penetration (µm)</th><th>R²</th><th>Model remaining creep, dynamic (µm)</th><th>Model remaining creep, static (µm)</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`);
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.style.marginTop = '14px';
  const groups = fits.filter((f) => f.group !== 'All liners');
  const palette = ['--series-2', '--series-1', '--series-3', '--series-4', '--text-secondary'];
  card.innerHTML = `<div class="chart-title">Measured penetration vs years in vivo</div>
    <div class="chart-sub">Points: D ± 2 SD of each liner (liners with a detected penetration). Lines: least-squares fit of each group (dashed: all liners).</div>
    <div class="legend">${groups.map((f, k) => `<span class="item"><span class="swatch" style="background:${cssVar(palette[k % palette.length])}"></span>${escapeHtml(f.group)}</span>`).join('')}<span class="item">– – all liners</span></div>`;
  cohortChart(card, fits, palette);
  sec.appendChild(card);
}

function cohortChart(container: HTMLElement, fits: CohortFit[], palette: string[]): void {
  const W = 760, H = 320, m = { l: 60, r: 20, t: 12, b: 40 };
  const all = fits.find((f) => f.group === 'All liners') ?? fits[0];
  const groups = fits.filter((f) => f.group !== 'All liners');
  const xMax = Math.max(1, ...all.points.map((p) => p.years)) * 1.05;
  const yMax = Math.max(1, ...all.points.map((p) => p.D + 2 * p.sd)) * 1.05;
  const yMin = Math.min(0, ...all.points.map((p) => p.D - 2 * p.sd), ...fits.map((f) => f.intercept));
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
  yl.textContent = 'measured penetration D (µm)';
  const line = (f: CohortFit, col: string, dash?: string) => add(s, 'line', { x1: X(0), x2: X(xMax), y1: Y(f.intercept), y2: Y(f.intercept + f.slope * xMax), stroke: col, 'stroke-width': 2, ...(dash ? { 'stroke-dasharray': dash } : {}) });
  if (all) line(all, cssVar('--text-secondary'), '6 4');
  const colOf = new Map<string, string>();
  groups.forEach((f, k) => { const col = cssVar(palette[k % palette.length]); colOf.set(f.group, col); line(f, col); });
  const seen = new Set<string>();
  for (const f of [...groups, all]) for (const p of f.points) {
    if (seen.has(p.caseId)) continue;
    seen.add(p.caseId);
    const col = colOf.get(f.group) ?? cssVar('--text-primary');
    add(s, 'line', { x1: X(p.years), x2: X(p.years), y1: Y(p.D - 2 * p.sd), y2: Y(p.D + 2 * p.sd), stroke: col, 'stroke-opacity': 0.5 });
    const dot = add(s, 'circle', { cx: X(p.years), cy: Y(p.D), r: 4.5, fill: col, stroke: 'var(--chart-surface)', 'stroke-width': 1.5 });
    dot.addEventListener('mousemove', (ev) => showTip(`<b>${escapeHtml(p.caseId)}</b><div>${fmt(p.years)} years · D ${fmt(p.D)} ± ${fmt(p.sd)} µm</div>`, ev));
    dot.addEventListener('mouseleave', hideTip);
  }
  container.appendChild(s);
}

/** Contact model against the measurement: pressure, contact area vs the penetrated area */
function renderContact(root: HTMLElement, res: SeriesResult[]): void {
  const sec = section(root, 'Contact model vs measured surface',
    `Nominal creep model in vivo (first Monte Carlo law). <b>Peak pressure</b>: at the start and at explantation (the liner creeps and conforms). The creep laws were measured at 2–${LAW_TESTED_MAX_MPA} MPa: above it the law is extrapolated. <b>Edge loading</b>: the contact patch reaches the rim. <b>Contact area</b> of the model (static, at explantation) against the <b>penetrated area</b> measured by HipWear (deviation beyond 2σ of the noise): a ratio near 1 supports the contact model; much larger penetrated areas point to wear from other sources (impingement, a moving head) or a reference error.`);
  const body = res.map((r, i) => {
    const d = r.modes.dynamic.contact, st = r.modes.static.contact;
    const ratio = r.penetratedAreaMm2 != null && st.areaMm2 > 0 ? (r.penetratedAreaMm2 / st.areaMm2).toFixed(2) : '—';
    const flags = [d.edgeLoading || st.edgeLoading ? 'edge loading' : '', st.beyondTestedPressure ? `above ${LAW_TESTED_MAX_MPA} MPa (law extrapolated)` : ''].filter(Boolean).join(' · ');
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td>
      <td><b>${fmt(d.peakInitialMPa)}</b><div class="range">→ ${fmt(d.peakFinalMPa)}</div></td><td><b>${fmt(st.peakInitialMPa)}</b><div class="range">→ ${fmt(st.peakFinalMPa)}</div></td>
      <td>${fmt(st.halfAngleDeg)}°</td><td>${fmt(st.areaMm2)}</td><td>${r.penetratedAreaMm2 != null ? fmt(r.penetratedAreaMm2) : '—'}</td><td>${ratio}</td><td class="vd">${flags || '—'}</td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th rowspan="2">#</th><th rowspan="2">Case</th><th colspan="2">Peak contact pressure (MPa), start → explantation</th><th rowspan="2">Contact half-angle</th><th rowspan="2">Model contact area (mm²)</th><th rowspan="2">Measured penetrated area (mm²)</th><th rowspan="2">Penetrated / contact</th><th rowspan="2">Flags</th></tr>
    <tr><th>dynamic</th><th>static</th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
}

/** Where the uncertainty of the wear comes from */
function renderBudget(root: HTMLElement, res: SeriesResult[]): void {
  if (!res.some((r) => r.modes.dynamic.budget)) return;
  const sec = section(root, 'Uncertainty budget of the wear',
    'Share of the variance of the estimated wear that comes from the measurement of D (HipWear) — the rest comes from the creep model (laws, recovery, force, material, geometry). Since W = D − remaining creep with both drawn independently, var(W) = var(D) + var(C<sub>rem</sub>). A measurement share near 100 % means a better measurement, not a better creep model, would narrow the wear interval.');
  const bar = (f: number | null | undefined) => f == null || !Number.isFinite(f) ? '—'
    : `<div class="budget"><span class="b-meas" style="width:${(100 * f).toFixed(1)}%"></span><span class="b-model" style="width:${(100 * (1 - f)).toFixed(1)}%"></span></div><div class="range">measurement ${(100 * f).toFixed(0)} % · model ${(100 * (1 - f)).toFixed(0)} %</div>`;
  const body = res.map((r, i) => {
    const d = r.modes.dynamic.budget, st = r.modes.static.budget;
    return `<tr><td>${i + 1}</td><td>${cellCase(r)}</td><td>${cellD(r)}</td><td>${bar(d?.measurementShare)}</td><td>${bar(st?.measurementShare)}</td><td>${bar(d?.measurementShareVolume)}</td><td>${bar(st?.measurementShareVolume)}</td></tr>`;
  }).join('');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data series-res">
    <thead><tr><th rowspan="2">#</th><th rowspan="2">Case</th><th rowspan="2">D (µm)</th><th colspan="2">Linear wear</th><th colspan="2">Volumetric wear</th></tr>
    <tr><th>dynamic</th><th>static</th><th>dynamic</th><th>static</th></tr></thead>
    <tbody>${body}</tbody></table></div>
    <div class="legend" style="margin-top:8px"><span class="item"><span class="swatch" style="background:${cssVar('--series-4')}"></span>measurement (HipWear D)</span><span class="item"><span class="swatch" style="background:${cssVar('--series-1')}"></span>creep model</span></div>`);
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
        <div class="chart-sub">Bars: 90 % interval of the wear (dot = median) with each recovery scenario. Diamond: measured D. Purple vertical line: 2·SD of that liner's measurement (a wear below it is within the measurement uncertainty). n.d.: penetration not detected, no wear estimate.</div>
        <div class="legend"><span class="item"><span class="swatch" style="background:${cssVar('--series-1')}"></span>Wear, L&amp;P recovery</span><span class="item"><span class="swatch" style="background:${cssVar('--series-2')}"></span>Wear, long-loading recovery</span><span class="item">◆ measured D</span><span class="item"><span class="vtick" style="border-color:${cssVar('--series-4')}"></span>2·SD measurement uncertainty</span></div>`;
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
    <div class="chart-sub">Bars: 90 % interval of the remaining creep (dot = median). Diamond: measured D ± 2 SD (open box: not detected, below the detection limit). Triangle: minimum creep from the elevations. Purple vertical line: 2·SD of that liner's measurement (creep or wear below it cannot be told apart from the measurement uncertainty). Wear is the gap between D and the remaining creep.</div>
    <div class="legend"><span class="item"><span class="swatch" style="background:${cssVar('--series-1')}"></span>Remaining creep, L&amp;P</span><span class="item"><span class="swatch" style="background:${cssVar('--series-2')}"></span>Remaining creep, long loading</span><span class="item">◆ measured D</span><span class="item"><span class="vtick" style="border-color:${cssVar('--series-4')}"></span>2·SD measurement uncertainty</span><span class="item">▲ elevation bound</span></div>`;
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
    if (r.measured && !r.measured.notDetected) hi = Math.max(hi, r.measured.penetrationUm, twoSd(r));
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
    uncertaintyTick(s, X, r, cy, rowH);
    const M = r.measured;
    if (M && !M.notDetected) {
      const x = X(M.penetrationUm);
      add(s, 'path', { d: `M${x},${cy - 5}L${x + 5},${cy}L${x},${cy + 5}L${x - 5},${cy}Z`, fill: CI });
    }
    const hit = add(s, 'rect', { x: m.l, y: cy - rowH / 2, width: W - m.l - m.r, height: rowH, fill: 'transparent' });
    hit.addEventListener('mousemove', (ev) => showTip(`<b>${escapeHtml(r.caseId)}</b> · ${mode}<div>D: ${M && !M.notDetected ? `${fmt(M.penetrationUm)} ± ${fmt(M.sdUm)}` : '—'} µm</div>
      <div>W L&amp;P: ${fmt(b.lp?.wear?.p50)} (${fmt(b.lp?.wear?.p5)}–${fmt(b.lp?.wear?.p95)})</div>
      <div>W long: ${fmt(b.long?.wear?.p50)} (${fmt(b.long?.wear?.p5)}–${fmt(b.long?.wear?.p95)})</div>${M && !M.notDetected ? `<div>2·SD (measurement uncertainty): ${fmt(2 * M.sdUm)} µm</div>` : ''}`, ev));
    hit.addEventListener('mouseleave', hideTip);
  });
  container.appendChild(s);
}

/** Short vertical line at 2·SD of the liner's measurement, spanning its row */
function uncertaintyTick(s: SVGSVGElement, X: (x: number) => number, r: SeriesResult, cy: number, rowH: number): void {
  const M = r.measured;
  if (!M || M.notDetected || !(M.sdUm > 0)) return;
  const x = X(2 * M.sdUm);
  add(s, 'line', { x1: x, x2: x, y1: cy - rowH / 2 + 3, y2: cy + rowH / 2 - 3, stroke: cssVar('--series-4'), 'stroke-width': 2 });
}
const twoSd = (r: SeriesResult) => (r.measured && !r.measured.notDetected ? 2 * r.measured.sdUm : 0);

function perLinerChart(container: HTMLElement, res: SeriesResult[], mode: Loading): void {
  const W = 760, rowH = 34, m = { l: 150, r: 24, t: 10, b: 38 };
  const H = m.t + m.b + res.length * rowH;
  let xMax = 1;
  for (const r of res) {
    const d = r.modes[mode];
    for (const k of ['lp', 'long'] as const) xMax = Math.max(xMax, d.byScenario[k]?.remaining.p95 ?? 0);
    if (r.measured) xMax = Math.max(xMax, r.measured.notDetected ? (r.measured.detectionLimitUm ?? 0) : r.measured.penetrationUm + 2 * r.measured.sdUm);
    if (r.elevationMinCreepUm) xMax = Math.max(xMax, r.elevationMinCreepUm.nominal);
    xMax = Math.max(xMax, twoSd(r));
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
    uncertaintyTick(s, X, r, cy, rowH);
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
      <div>Elevation bound: ${fmt(r.elevationMinCreepUm?.nominal)} µm</div>${M && !M.notDetected ? `<div>2·SD (measurement uncertainty): ${fmt(2 * M.sdUm)} µm</div>` : ''}`, ev));
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
