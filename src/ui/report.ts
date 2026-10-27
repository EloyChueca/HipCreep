// ============================================================
// HipCreep — results report
// ============================================================

import type { CaseInput } from '../model/case.ts';
import { LAWS, type LawId, type Loading } from '../model/laws.ts';
import { MATERIALS } from '../model/materials.ts';
import { gaitSeconds, implantSeconds, verdict, type DeterministicResult, type McResult, type Verdict } from '../model/analysis.ts';
import { binPolar, minCreepDepthUm, modelToPolar, syntheticBases, type ElevationResult, type SurfaceData, type PolarGrid } from '../model/surface.ts';
import type { LoadedHipWearCase } from '../io/hipwear.ts';
import type { UiSettings } from './form.ts';
import { fmt, num, pct, fmtTime, escapeHtml, cssVar } from './format.ts';
import { lineChart, rangeChart, histogram, type LineSeries, type RangeRow } from './charts.ts';
import { renderMap } from './polarmap.ts';
import { renderSurface3D, type Surface3DField } from './surface3d.ts';
import { percentileSE, type Stats } from '../model/stats.ts';

/** Display order of the loading modes (as in the summary table) */
const MODES: Loading[] = ['dynamic', 'static'];

export interface ReportData {
  c: CaseInput;
  ui: UiSettings;
  det: DeterministicResult;
  mc: McResult;
  loaded: LoadedHipWearCase | null;
  surface: SurfaceData | null;
  elevation: ElevationResult | null;
}

const LAW_COLOR: Record<LawId, string> = { lee2003: '--series-1', lee1998: '--series-4', deng1998: '--series-2', lewis2001: '--series-3' };
export const lawColor = (id: LawId) => cssVar(LAW_COLOR[id]);
const MODE_LABEL: Record<Loading, string> = { static: 'Static', dynamic: 'Dynamic' };

function section(root: HTMLElement, title: string, lead?: string): HTMLElement {
  const s = document.createElement('section');
  s.className = 'section';
  s.innerHTML = `<h2>${title}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}`;
  root.appendChild(s);
  return s;
}

function verdictHtml(v: Verdict, scope: string): string {
  const icon = v.level === 'separable' ? '✓' : v.level === 'inconsistent' ? '!' : '≈';
  return `<div class="verdict ${v.level}"><div class="t"><span class="badge ${v.level}" aria-hidden="true">${icon}</span>${escapeHtml(scope)}: ${escapeHtml(v.title)}</div><div>${escapeHtml(v.detail)}</div></div>`;
}

function noticeHtml(title: string, detail: string): string {
  return `<div class="verdict small-signal"><div class="t"><span class="badge small-signal" aria-hidden="true">i</span>${escapeHtml(title)}</div><div>${detail}</div></div>`;
}

const SC_SHORT = { lp: 'L&amp;P', long: 'Long load.' } as const;

/** One line per recovery scenario (+ envelope); falls back to a single cell with one scenario */
function scCell(mc: McResult, mode: Loading, key: 'remaining' | 'wear', all: Stats | null): string {
  const bs = mc.summary[mode].byScenario;
  const present = (['lp', 'long'] as const).filter((k) => bs[k]);
  if (present.length < 2) return mcCell(all);
  const lines = present.map((k) => {
    const st = bs[k]![key];
    return st ? `<div class="sc"><span class="sc-l">${SC_SHORT[k]}</span> <b>${fmt(st.p50)}</b> <span class="range-i">${fmt(st.p5)} – ${fmt(st.p95)}</span></div>` : '';
  }).join('');
  return `${lines}<div class="range">both: ${all ? `${fmt(all.p5)} – ${fmt(all.p95)}` : '—'} µm</div>`;
}

/** "median [P5 – P95]" cell */
const mcCell = (s: Stats | null, unit = 'µm') => s
  ? `<b>${fmt(s.p50)}</b> <span class="unit-s">${unit}</span><div class="range">${fmt(s.p5)} – ${fmt(s.p95)}</div>`
  : '—';

export function renderEmpty(root: HTMLElement): void {
  root.innerHTML = `
    <div class="report-empty">
      <h2>HipCreep</h2>
      <p>Estimates the <b>creep</b> (cold flow) of a UHMWPE acetabular liner from the patient and implant data, with the
      compressive creep laws of Lee et al. (2003) and Lee &amp; Pienkowski (1998) — with Deng et al. (1998) and Lewis &amp; Carroll (2001) as references — in a <b>static</b>
      (load held for the whole implantation time) and a <b>dynamic</b> (1 Hz gait cycles) mode. It then applies the
      <b>recovery</b> measured by Lee &amp; Pienkowski (1998) for the time the liner spent unloaded before scanning, and splits
      the penetration measured by <b>HipWear</b> into remaining creep and wear, with Monte Carlo ranges.</p>
      <p style="margin-top:10px">Load a HipWear export (HipWear → Export → <span class="mono">HipCreep Data (JSON)</span>) or try the <b>Demo case</b>,
      review the inputs on the left and press <b>Run analysis</b>.</p>
    </div>`;
}

export function renderReport(root: HTMLElement, d: ReportData): void {
  root.innerHTML = '';
  const { c, mc } = d;
  const mat = MATERIALS[c.material];
  const S = mc.summary;

  // ---------- Header + summary table ----------
  const head = section(root, `Case ${escapeHtml(c.caseId)}`);
  head.insertAdjacentHTML('beforeend', `<p class="case-line">${num(c.bodyMassKg)} kg · ${num(c.implantMonths)} months in vivo · head Ø ${num(c.headDiameterMm)} mm · wall ${num(c.thicknessMm)} mm ·
    clearance ${num(c.clearance.nominal * 1000)} µm · load ${num(c.loadAngleDeg)}° from the cup axis · ${escapeHtml(mat.label)} ·
    ${num(c.exVivoDays)} days unloaded at ${num(c.recoveryTempC)} °C before scanning · ${mc.n} Monte Carlo samples (${(mc.elapsedMs / 1000).toFixed(1)} s)</p>`);

  const m = c.measured;
  const recRow = (mode: Loading) => {
    const s = S[mode];
    const bs = s.byScenario;
    const present = (['lp', 'long'] as const).filter((k) => bs[k]);
    if (present.length === 2) {
      return present.map((k) => `<div class="sc"><span class="sc-l">${SC_SHORT[k]}</span> <b>${pct(bs[k]!.recovered.p50)}</b> <span class="range-i">${pct(bs[k]!.recovered.p5)} – ${pct(bs[k]!.recovered.p95)}</span></div>`).join('')
        + `<div class="range">of C<sub>max</sub></div>`;
    }
    return `<b>${pct(mc.recovery.p50)}</b> <span class="unit-s">of C<sub>max</sub></span><div class="range">${pct(mc.recovery.p5)} – ${pct(mc.recovery.p95)} · ${fmt(s.recovered.p50)} µm</div>`;
  };
  const rows: string[] = [
    `<tr><th scope="row">Creep at explantation <span class="sym">C<sub>max</sub></span></th><td>${mcCell(S.dynamic.creep)}</td><td>${mcCell(S.static.creep)}</td></tr>`,
    `<tr><th scope="row">Recovered before scanning <span class="sym">R</span></th><td>${recRow('dynamic')}</td><td>${recRow('static')}</td></tr>`,
    `<tr><th scope="row">Remaining creep <span class="sym">C<sub>rem</sub> = C<sub>max</sub>(1 − R)</span></th><td>${scCell(mc, 'dynamic', 'remaining', S.dynamic.remaining)}</td><td>${scCell(mc, 'static', 'remaining', S.static.remaining)}</td></tr>`,
  ];
  if (m?.notDetected) {
    const lod = m.detectionLimitUm ?? 0;
    const ub = (mode: Loading) => `<b>&lt; ${fmt(Math.max(0, lod - S[mode].remaining.p50))}</b> <span class="unit-s">µm</span><div class="range">upper bound: LoD − C<sub>rem</sub></div>`;
    rows.push(`<tr class="sep"><th scope="row">Measured penetration (HipWear) <span class="sym">D</span></th><td colspan="2" class="center"><b>not detected</b> — below the detection limit (0 ≤ D &lt; ${fmt(lod)} µm)</td></tr>`);
    rows.push(`<tr class="hl"><th scope="row">Estimated wear <span class="sym">W = D − C<sub>rem</sub></span></th><td>${ub('dynamic')}</td><td>${ub('static')}</td></tr>`);
    rows.push(`<tr><th scope="row">Samples with C<sub>rem</sub> above the detection limit</th><td><b>${pct(S.dynamic.probRemainingAboveLod)}</b></td><td><b>${pct(S.static.probRemainingAboveLod)}</b></td></tr>`);
  } else if (m) {
    rows.push(`<tr class="sep"><th scope="row">Measured penetration (HipWear) <span class="sym">D</span></th><td colspan="2" class="center"><b>${fmt(m.penetrationUm)}</b> <span class="unit-s">µm</span> ± ${fmt(m.sdUm)} µm (SD)${m.detectionLimitUm ? ` · detection limit ${fmt(m.detectionLimitUm)} µm` : ''}</td></tr>`);
    rows.push(`<tr class="hl"><th scope="row">Estimated wear <span class="sym">W = D − C<sub>rem</sub></span></th><td>${scCell(mc, 'dynamic', 'wear', S.dynamic.wear)}</td><td>${scCell(mc, 'static', 'wear', S.static.wear)}</td></tr>`);
    rows.push(`<tr><th scope="row">Share of D that is remaining creep</th><td><b>${pct(S.dynamic.creepShare?.p50)}</b></td><td><b>${pct(S.static.creepShare?.p50)}</b></td></tr>`);
  } else {
    rows.push(`<tr class="sep"><th scope="row">Measured penetration (HipWear) <span class="sym">D</span></th><td colspan="2" class="center muted">not available — only the creep prediction</td></tr>`);
  }
  head.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data summary">
    <thead><tr><th></th><th>Dynamic <span class="muted">(gait cycles)</span></th><th>Static <span class="muted">(load held, upper bound)</span></th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>
    <p class="muted" style="margin-top:6px;font-size:12px">Monte Carlo median in bold, 90 % interval (P5 – P95) beside or below, in µm. All quantities are penetrations into the liner wall (positive = surface moved away from the head centre).
    ${mc.summary.dynamic.byScenario.lp && mc.summary.dynamic.byScenario.long ? `<b>Recovery scenarios</b>: <b>L&amp;P</b> = Lee &amp; Pienkowski 1998 (≈ 51 % recovered after 7 days of loading, upper bound); <b>Long load.</b> = long loading (Galetz 2010, Estok 2005: the permanent part grows with the loading time, 0–15 % recovered). A liner loaded for years is expected between both; "both" is the envelope used for the verdict.` : ''}</p>`);
  if (m) {
    for (const mode of MODES) head.insertAdjacentHTML('beforeend', verdictHtml(verdict(m, S[mode].remaining, S[mode].wear, S[mode].probWearNegative), `${MODE_LABEL[mode]} mode`));
  } else {
    head.insertAdjacentHTML('beforeend', noticeHtml('No measured penetration',
      'Without the penetration measured by HipWear the creep cannot be compared with the liner: load a HipWear export or tick "Use a measured penetration" and enter D and its SD.'));
  }
  for (const w of d.loaded?.warnings ?? []) head.insertAdjacentHTML('beforeend', noticeHtml('HipWear file', escapeHtml(w)));

  renderLawsSection(root, d);
  renderMonteCarloSection(root, d);
  if (m) renderDecomposition(root, d);
  renderSpherePlane(root, d);
  renderMethods(root, d);
}

// ------------------------------------------------------------
// Creep at explantation: chart (left) + three-mode table (right)
// ------------------------------------------------------------
function renderLawsSection(root: HTMLElement, d: ReportData): void {
  const { c, det } = d;
  const gaitS = gaitSeconds(c, c.cyclesPerYear.nominal);
  const sec = section(root, 'Creep at explantation — laws, loading modes and build-up',
    `Nominal parameters. <b>Static</b>: the peak walking force (${num(c.peakForceBW.nominal)} × BW) held during the whole implantation time (${fmtTime(implantSeconds(c))}) — an upper bound. <b>Dynamic</b>: 1 Hz gait cycles with that peak during the cumulative walking time (${num(c.cyclesPerYear.nominal / 1e6)} M cycles/year → ${fmtTime(gaitS)} of loading). Each law is shown at the temperature of its own tests and at ${num(c.inVivoTempC)} °C (time–temperature superposition, Ea = ${num(c.eaKcal.nominal)} kcal/mol). Remaining ("rem.") = after ${pct(det.recovered)} recovery (Lee &amp; Pienkowski; ${pct(det.recoveredAlt)} if it keeps growing log-linearly) / after ${pct(det.recoveredLong)} (long loading).`);
  const split = document.createElement('div');
  split.className = 'split';
  sec.appendChild(split);

  // left: build-up chart
  const chart = document.createElement('div');
  chart.className = 'chart-card';
  chart.innerHTML = `<div class="chart-title">Creep build-up during implantation (µm)</div>
    <div class="chart-sub">At ${num(c.inVivoTempC)} °C; dynamic curves drawn against the elapsed time since surgery.</div>
    <div class="legend">${c.laws.map((id) => `<span class="item"><span class="swatch" style="background:${lawColor(id)}"></span>${LAWS[id].shortRef}</span>`).join('')}
    <span class="item"><svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" stroke-width="2"/></svg>static</span>
    <span class="item"><svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3"/></svg>dynamic</span></div>`;
  split.appendChild(chart);
  const series: LineSeries[] = [];
  const Ts = implantSeconds(c);
  for (const id of c.laws) {
    for (const mode of MODES) {
      const r = det.rows.find((x) => x.law === id && x.mode === mode && x.temperature === 'in-vivo')!;
      const h = r.sim.history!;
      const scaleT = mode === 'dynamic' ? Ts / Math.max(gaitS, 1) : 1;
      const keep = Array.from(h.tS, (t) => t * scaleT >= 60);
      series.push({
        label: `${LAWS[id].shortRef} ${mode}`,
        color: lawColor(id),
        dash: mode === 'dynamic' ? '5 3' : undefined,
        x: Array.from(h.tS, (t) => t * scaleT).filter((_, i) => keep[i]),
        y: Array.from(h.maxCreepMm, (w) => w * 1000).filter((_, i) => keep[i]),
      });
    }
  }
  lineChart(chart, {
    series, xLabel: 'time since implantation (log scale)', yLabel: 'creep (µm)', xFormat: fmtTime,
    xTicks: [60, 3600, 86400, 7 * 86400, 30.44 * 86400, 182.6 * 86400, 365.25 * 86400, 2 * 365.25 * 86400],
    marker: { x: Ts, label: 'explantation' }, height: 340,
  });

  // right: three-mode table
  const tbl = document.createElement('div');
  tbl.className = 'chart-card';
  const cell = (id: LawId, mode: Loading, t: 'native' | 'in-vivo') => {
    const r = det.rows.find((x) => x.law === id && x.mode === mode && x.temperature === t)!;
    return `<td><b>${fmt(r.creepUm)}</b><div class="range">rem. ${fmt(r.remainingUm)} / ${fmt(r.remainingLongUm)}</div></td>`;
  };
  const body = c.laws.map((id) => {
    const law = LAWS[id];
    const notes = Array.from(new Set(det.rows.filter((x) => x.law === id).flatMap((x) => x.notes))).join('; ');
    return `<tr><th scope="row"><span class="swatch" style="background:${lawColor(id)}"></span>${escapeHtml(law.shortRef)}
      <div class="range">${law.nativeTempC} °C · ${law.nativeLoading}</div>${notes ? `<div class="note-s">${escapeHtml(notes)}</div>` : ''}</th>
      ${cell(id, 'dynamic', 'native')}${cell(id, 'dynamic', 'in-vivo')}${cell(id, 'static', 'native')}${cell(id, 'static', 'in-vivo')}</tr>`;
  }).join('');
  tbl.innerHTML = `<div class="chart-title">Maximum creep penetration at explantation (µm)</div>
    <div class="chart-sub">"rem." = remaining after recovery: Lee &amp; Pienkowski / long loading. Own T = temperature of the law's tests.</div>
    <div class="table-wrap"><table class="data compact">
      <thead><tr><th rowspan="2">Law</th><th colspan="2">Dynamic</th><th colspan="2">Static</th></tr>
      <tr><th>own T</th><th>${num(c.inVivoTempC)} °C</th><th>own T</th><th>${num(c.inVivoTempC)} °C</th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <p class="muted" style="margin-top:6px;font-size:12px">Peak contact pressure at first loading ${fmt(det.rows[0]?.peakPressureInitialMPa)} MPa, ${fmt(det.rows[0]?.peakPressureFinalMPa)} MPa at explantation (the contact conforms as the liner creeps).</p>`;
  split.appendChild(tbl);
}

// ------------------------------------------------------------
// Monte Carlo
// ------------------------------------------------------------
function renderMonteCarloSection(root: HTMLElement, d: ReportData): void {
  const { c, mc } = d;
  const S = mc.summary;
  const sec = section(root, 'Monte Carlo ranges',
    `Each sample draws one law and every uncertain parameter from its range (force ${num(c.peakForceBW.lo)}–${num(c.peakForceBW.hi)} BW, gait cycles, k, E, ν, wall thickness, clearance, Ea, material creep factor, extrapolations, recovery). Bars: 90 % interval, box: 50 %, dot: median.`);
  const rr: RangeRow[] = [];
  for (const mode of MODES) {
    mc.laws.forEach((id) => {
      const s = S[mode].byLaw[id];
      if (s && s.n) rr.push({ label: `${LAWS[id].shortRef} · ${mode}`, color: lawColor(id), ...s });
    });
  }
  const mcCard = document.createElement('div');
  mcCard.className = 'chart-card';
  mcCard.innerHTML = `<div class="chart-title">Creep at explantation by law and loading mode (µm)</div>`;
  sec.appendChild(mcCard);
  const mk = c.measured
    ? (c.measured.notDetected ? { x: c.measured.detectionLimitUm ?? 0, label: 'detection limit' } : { x: c.measured.penetrationUm, label: 'measured D' })
    : undefined;
  rangeChart(mcCard, rr, 'creep at explantation (µm)', mk);
  const statRow = (name: string, s: Stats | null) => s ? `<tr><td>${name}</td><td>${fmt(s.p5)}</td><td>${fmt(s.p25)}</td><td><b>${fmt(s.p50)}</b></td><td>${fmt(s.p75)}</td><td>${fmt(s.p95)}</td></tr>` : '';
  // sampling precision of the reported percentiles (batch means)
  const prec = MODES.map((mode) => {
    const v = mc.modes[mode].remainingUm;
    return `${mode}: median ± ${fmt(percentileSE(v, 0.5))} µm, P5 ± ${fmt(percentileSE(v, 0.05))} µm, P95 ± ${fmt(percentileSE(v, 0.95))} µm`;
  }).join(' · ');
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap" style="margin-top:12px"><table class="data">
    <thead><tr><th>Quantity (µm)</th><th>P5</th><th>P25</th><th>Median</th><th>P75</th><th>P95</th></tr></thead><tbody>
    ${MODES.map((mm) => statRow(`Creep at explantation · ${mm}`, S[mm].creep) + statRow(`Recovered before scan · ${mm}`, S[mm].recovered) + statRow(`Remaining creep · ${mm}`, S[mm].remaining)).join('')}
    ${statRow('Remaining creep · both modes pooled', mc.pooled.remaining)}
    </tbody></table></div>
    <p class="muted" style="margin-top:6px;font-size:12px"><b>Sampling precision</b> of the remaining creep with ${mc.n} samples (±1 SE): ${prec}.
    More samples make these numbers more stable (the error falls as 1/√n: 4× the samples halves it) but do not narrow the 90 % interval, which comes from the uncertainty of the inputs and of the laws.</p>`);
}

// ------------------------------------------------------------
// D = W + C_rem
// ------------------------------------------------------------
function renderDecomposition(root: HTMLElement, d: ReportData): void {
  const { c, mc } = d;
  const m = c.measured!;
  const S = mc.summary;
  const sec = section(root, 'Penetration = remaining creep + wear');
  if (m.notDetected) { renderNotDetected(sec, d); return; }
  sec.insertAdjacentHTML('beforeend', `
    <div class="signs">
      <div><span class="sym">D</span> measured penetration (HipWear): how far the bearing surface has moved away from the head centre, <b>always ≥ 0</b> (± ${fmt(m.sdUm)} µm SD).</div>
      <div><span class="sym">C<sub>max</sub></span> creep at explantation, <span class="sym">R</span> fraction recovered before scanning (0–1), <span class="sym">C<sub>rem</sub> = C<sub>max</sub>(1 − R)</span> creep still in the liner, <b>all ≥ 0</b>.</div>
      <div><span class="sym">W = D − C<sub>rem</sub></span> wear (material removed): <b>W &gt; 0</b> part of D is wear · <b>W ≈ 0</b> all of D is explained by remaining creep · <b>W &lt; 0</b> physically impossible — the predicted remaining creep is larger than what was measured (model over-predicts for this liner, or more creep recovered).</div>
    </div>`);
  const shareRow = (mode: Loading) => {
    const s = S[mode];
    return `<tr><td>${MODE_LABEL[mode]}</td><td>${fmt(s.creep.p50)}</td><td>${fmt(s.recovered.p50)}</td><td>${fmt(s.remaining.p50)}</td>
      <td><b>${fmt(s.wear!.p50)}</b></td><td>${fmt(s.wear!.p5)} to ${fmt(s.wear!.p95)}</td><td>${pct(s.creepShare!.p50)}</td><td>${pct(s.probWearNegative)}</td></tr>`;
  };
  const cmax = mc.pooled.creep.p50;
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap" style="margin-top:10px"><table class="data">
    <thead><tr><th>Mode</th><th>C<sub>max</sub></th><th>Recovered</th><th>C<sub>rem</sub></th><th>Wear W</th><th>W, 90 %</th><th>C<sub>rem</sub> / D</th><th>P(W &lt; 0)</th></tr></thead>
    <tbody>${shareRow('dynamic')}${shareRow('static')}</tbody></table></div>
    ${(() => {
      const rows = MODES.flatMap((mode) => (['lp', 'long'] as const).map((k) => {
        const b = S[mode].byScenario[k];
        return b && b.wear ? `<tr><td>${MODE_LABEL[mode]}</td><td>${k === 'lp' ? 'Lee &amp; Pienkowski' : 'Long loading'}</td><td>${pct(b.recovered.p50)}</td><td>${fmt(b.remaining.p50)}</td><td><b>${fmt(b.wear.p50)}</b></td><td>${fmt(b.wear.p5)} to ${fmt(b.wear.p95)}</td><td>${pct(b.probWearNegative)}</td></tr>` : '';
      })).join('');
      return rows ? `<div class="table-wrap" style="margin-top:10px"><table class="data"><thead><tr><th>Mode</th><th>Recovery scenario</th><th>R</th><th>C<sub>rem</sub></th><th>Wear W</th><th>W, 90 %</th><th>P(W &lt; 0)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
    })()}
    <p class="muted" style="margin-top:6px;font-size:12px">Medians in µm; the first table pools both recovery scenarios. Without any recovery model the bounds would only be: wear between ${fmt(Math.max(0, m.penetrationUm - cmax))} and ${fmt(m.penetrationUm)} µm, remaining creep between 0 and ${fmt(Math.min(m.penetrationUm, cmax))} µm (pooled median C<sub>max</sub> = ${fmt(cmax)} µm).</p>`);
  const grid = document.createElement('div');
  grid.className = 'grid2';
  grid.style.marginTop = '12px';
  sec.appendChild(grid);
  for (const mode of MODES) {
    const s = S[mode];
    const cardH = document.createElement('div');
    cardH.className = 'chart-card';
    cardH.innerHTML = `<div class="chart-title">Estimated wear W — ${mode}</div>
      <div class="chart-sub">Median ${fmt(s.wear!.p50)} µm · 90 % ${fmt(s.wear!.p5)} to ${fmt(s.wear!.p95)} µm · ${pct(s.probWearNegative)} of the samples left of 0</div>`;
    grid.appendChild(cardH);
    histogram(cardH, mc.modes[mode].wearUm!, lawColor('lee2003'), 'wear W = D − Crem (µm)', [{ x: 0, label: 'W = 0' }, { x: m.penetrationUm, label: 'W = D' }]);
  }
  sec.insertAdjacentHTML('beforeend', `<details class="explain"><summary>How to read the W histograms</summary>
    <ul class="notes">
      <li>Each bar counts the Monte Carlo samples whose estimated wear falls in that interval (hover a bar for the count). In every sample the creep model, the recovery and the measured D are drawn from their uncertainty ranges, so the width of the histogram is the uncertainty of the wear estimate.</li>
      <li><b>Dashed line W = 0</b>: the whole measured penetration would be remaining creep. Samples to its <b>left</b> (W &lt; 0) predict more remaining creep than was measured — impossible, so a large fraction there means the creep model over-predicts for this liner.</li>
      <li><b>Dashed line W = D</b>: no creep left at all — the whole penetration is wear. The distance between this line and the bulk of the histogram is the remaining creep.</li>
      <li>With both recovery scenarios the histogram pools them and may show two humps: the left one is long loading (little recovery → more creep left → less wear), the right one Lee &amp; Pienkowski. The table above gives each scenario separately.</li>
      <li>The <b>dynamic</b> histogram (gait loading) is the realistic scenario; the <b>static</b> one (load held 24 h a day) gives the most creep and therefore the lowest wear estimate.</li>
      <li>If D is not clearly larger than its uncertainty, the histogram is dominated by the measurement noise and the verdict above reports a small signal.</li>
    </ul></details>`);
}

/** D below the detection limit: compare the remaining creep with the limit instead of splitting D */
function renderNotDetected(sec: HTMLElement, d: ReportData): void {
  const { c, mc } = d;
  const m = c.measured!;
  const S = mc.summary;
  const lod = m.detectionLimitUm ?? 0;
  sec.insertAdjacentHTML('beforeend', `
    <div class="signs">
      <div><span class="sym">D</span> measured penetration: <b>not detected</b> by HipWear — it is only known that 0 ≤ D &lt; ${fmt(lod)} µm (detection limit, LoD).</div>
      <div><span class="sym">C<sub>rem</sub> = C<sub>max</sub>(1 − R)</span> creep still in the liner at scanning, <b>≥ 0</b>. If the model is right it must be below the LoD, otherwise HipWear would have seen it.</div>
      <div><span class="sym">W = D − C<sub>rem</sub></span> wear: cannot be estimated, only bounded — <b>0 ≤ W &lt; LoD − C<sub>rem</sub></b>.</div>
    </div>`);
  const row = (mode: Loading) => {
    const s = S[mode];
    return `<tr><td>${MODE_LABEL[mode]}</td><td>${fmt(s.creep.p50)}</td><td><b>${fmt(s.remaining.p50)}</b></td><td>${fmt(s.remaining.p5)} – ${fmt(s.remaining.p95)}</td>
      <td>${fmt(lod)}</td><td>${pct(s.probRemainingAboveLod)}</td><td>&lt; ${fmt(Math.max(0, lod - s.remaining.p50))}</td></tr>`;
  };
  sec.insertAdjacentHTML('beforeend', `<div class="table-wrap" style="margin-top:10px"><table class="data">
    <thead><tr><th>Mode</th><th>C<sub>max</sub></th><th>C<sub>rem</sub></th><th>C<sub>rem</sub>, 90 %</th><th>LoD</th><th>P(C<sub>rem</sub> &gt; LoD)</th><th>Wear bound</th></tr></thead>
    <tbody>${row('dynamic')}${row('static')}</tbody></table></div>
    <p class="muted" style="margin-top:6px;font-size:12px">Medians in µm. The wear / creep histograms are not drawn because D has no value to subtract from; instead the remaining creep is compared with the detection limit.</p>`);
  const grid = document.createElement('div');
  grid.className = 'grid2';
  grid.style.marginTop = '12px';
  sec.appendChild(grid);
  for (const mode of MODES) {
    const s = S[mode];
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<div class="chart-title">Remaining creep vs detection limit — ${mode}</div>
      <div class="chart-sub">Median ${fmt(s.remaining.p50)} µm · 90 % ${fmt(s.remaining.p5)}–${fmt(s.remaining.p95)} µm · ${pct(s.probRemainingAboveLod)} of the samples above the LoD</div>`;
    grid.appendChild(card);
    histogram(card, mc.modes[mode].remainingUm, lawColor('lee2003'), 'remaining creep C_rem (µm)', [{ x: lod, label: 'LoD' }]);
  }
  sec.insertAdjacentHTML('beforeend', `<details class="explain"><summary>How to read these histograms</summary>
    <ul class="notes">
      <li>Each bar counts the Monte Carlo samples whose remaining creep falls in that interval. The width is the uncertainty of the creep prediction (law, load, material, recovery…).</li>
      <li><b>Dashed line LoD</b>: the smallest penetration HipWear can detect on this liner. Samples to its <b>left</b> are consistent with "not detected"; samples to its <b>right</b> predict a penetration that HipWear should have seen, so a large fraction there means the model over-predicts for this liner.</li>
    </ul></details>`);
}

// ------------------------------------------------------------
// Sphere → plane: main values, 3D reconstruction, 2D maps
// ------------------------------------------------------------
function renderSpherePlane(root: HTMLElement, d: ReportData): void {
  const { c, det, mc } = d;
  const S = mc.summary;
  const sec = section(root, 'Sphere → plane',
    d.surface
      ? 'Every point of the bearing surface is expressed as its radial deviation from the original sphere (r − R) and laid out on a plane seen from the cup opening: pole at the centre, penetration direction up, distance from the centre = angle from the pole. Penetration is positive, material pushed above the original surface (elevations) is negative. Wear cannot create elevations; creep conserves volume, so the elevation volume is a lower bound of the creep still in the liner.'
      : 'Predicted remaining creep laid out on a plane seen from the cup opening (pole at the centre, penetration direction up). Load a HipWear file to compare it with the measured surface and to obtain the minimum creep from the elevations.');

  // ---- main values ----
  if (d.elevation && d.surface) {
    const e = d.elevation;
    const ref = d.ui.refRadius === 'measured' && d.loaded?.measuredRadiusMm
      ? `measured cavity radius ${fmt(d.loaded.measuredRadiusMm, 3)} mm${d.loaded.measuredCenter ? ' (centre of its own fit)' : ''}`
      : `commercial radius ${fmt(d.loaded?.commercialRadiusMm, 3)} mm`;
    const dyn = det.rows.find((r) => r.law === c.laws[0] && r.mode === 'dynamic' && r.temperature === 'in-vivo')!;
    const shape = dyn.sim.shapeAreaMm2;
    const minNom = minCreepDepthUm(e.nominal.netMm3, shape);
    const minLo = minCreepDepthUm(e.netRangeMm3[0], shape), minHi = minCreepDepthUm(e.netRangeMm3[1], shape);
    const remDyn = S.dynamic.remaining;
    const consistency = minNom > remDyn.p95 ? 'model remaining creep is BELOW the elevation bound (model under-predicts)'
      : minNom > remDyn.p50 ? 'model median is below the elevation bound' : 'model consistent with the elevation bound';
    const radiusEq = e.radiusSensitivityMm3PerUm > 0 ? e.nominal.netMm3 / e.radiusSensitivityMm3PerUm : NaN;
    const rowsE = [...e.rows].sort((a, b) => a.k - b.k || a.sigmaUm - b.sigmaUm).map((r) => `<tr><td>${r.k}·σ (σ = ${fmt(r.sigmaUm)} µm)</td><td>${fmt(r.thresholdUm)}</td><td>${fmt(r.rawMm3, 3)}</td><td>${fmt(r.noiseFloorMm3, 3)}</td><td><b>${fmt(r.netMm3, 3)}</b></td><td>${fmt(r.elevatedAreaMm2)}</td></tr>`).join('');
    sec.insertAdjacentHTML('beforeend', `
      <div class="table-wrap"><table class="data summary">
        <tbody>
          <tr><th scope="row">Net elevation volume</th><td><b>${fmt(e.nominal.netMm3, 3)}</b> mm³ <span class="range-i">(${fmt(e.netRangeMm3[0], 3)} – ${fmt(e.netRangeMm3[1], 3)})</span></td></tr>
          <tr class="hl"><th scope="row">Minimum remaining creep (from the elevations)</th><td><b>${fmt(minNom)}</b> µm <span class="range-i">(${fmt(minLo)} – ${fmt(minHi)})</span></td></tr>
          <tr><th scope="row">Model remaining creep, dynamic / static</th><td><b>${fmt(remDyn.p50)}</b> / <b>${fmt(S.static.remaining.p50)}</b> µm — ${consistency}</td></tr>
          <tr><th scope="row">Location of the elevations</th><td>${fmt(e.elevationPsiDeg)}° from the load axis, ${fmt(e.elevationThetaDeg)}° from the pole</td></tr>
          <tr><th scope="row">Robustness</th><td>the same volume would appear with a ${fmt(radiusEq)} µm error in the reference radius (${fmt(e.radiusSensitivityMm3PerUm, 3)} mm³ per µm)</td></tr>
          <tr><th scope="row">Reference (zero plane)</th><td>${ref}; noise σ = ${fmt(e.sigmaEffUm)} µm</td></tr>
        </tbody></table></div>
      <details class="explain"><summary>Threshold details</summary>
        <div class="table-wrap" style="margin-top:8px"><table class="data">
          <thead><tr><th>Threshold</th><th>µm</th><th>Raw volume (mm³)</th><th>Noise floor (mm³)</th><th>Net (mm³)</th><th>Elevated area (mm²)</th></tr></thead>
          <tbody>${rowsE}</tbody></table></div>
        <p class="muted" style="margin-top:6px;font-size:12px">Elevation volume above k·σ (k = 1, 2, 3; σ ± 20 %) minus the volume pure Gaussian noise would give above the same threshold. Analysed area ${fmt(e.analysedAreaMm2)} mm² (band of ${fmt(d.ui.rimBandDeg)}° at the trim edge excluded). Elevations can also come from form error of the liner: they should sit at the edge of the contact zone. The minimum creep is the peak depth of a creep field with the model's shape (${fmt(shape)} mm²) and that volume.</p>
      </details>`);
  }

  // ---- shared fields for 3D and 2D ----
  const controls = document.createElement('div');
  controls.className = 'map-controls';
  controls.innerHTML = `<label>Predicted creep: law <select class="map-law">${c.laws.map((id) => `<option value="${id}">${LAWS[id].shortRef}</option>`).join('')}</select></label>
    <label>mode <select class="map-mode"><option value="dynamic">dynamic</option><option value="static">static</option></select></label>
    <label>amplitude <select class="map-amp"><option value="mc">Monte Carlo median of the mode</option><option value="nominal">nominal of this law</option></select></label>`;
  sec.appendChild(controls);
  const holder3d = document.createElement('div');
  sec.appendChild(holder3d);
  const h2 = document.createElement('h3');
  h2.className = 'subhead';
  h2.textContent = '2D maps';
  sec.appendChild(h2);
  const holder = document.createElement('div');
  holder.className = 'maps';
  sec.appendChild(holder);

  const draw = () => {
    holder.innerHTML = '';
    holder3d.innerHTML = '';
    const law = (controls.querySelector('.map-law') as HTMLSelectElement).value as LawId;
    const mode = (controls.querySelector('.map-mode') as HTMLSelectElement).value as Loading;
    const amp = (controls.querySelector('.map-amp') as HTMLSelectElement).value;
    const row = det.rows.find((r) => r.law === law && r.mode === mode && r.temperature === 'in-vivo')!;
    const sim = row.sim;
    const peak = sim.maxCreepMm * 1000;
    const target = amp === 'mc' ? mc.summary[mode].remaining.p50 : row.remainingUm;
    const field = new Float64Array(sim.creepMap.length);
    for (let k = 0; k < field.length; k++) field[k] = peak > 0 ? (sim.creepMap[k] * 1000 / peak) * target : 0;
    const bases = d.surface?.bases ?? syntheticBases(c.loadAngleDeg);
    const maxTheta = d.surface ? Math.min(100, Math.ceil(d.surface.maxThetaRad * 180 / Math.PI)) : c.coverageDeg;
    const nT = 60, nA = 120;
    const pred = modelToPolar(sim.grid, field, bases, nT, nA, maxTheta, c.coverageDeg);
    const radius = d.loaded?.measuredRadiusMm ?? d.loaded?.commercialRadiusMm ?? c.headDiameterMm / 2;
    const predLabel = `${LAWS[law].shortRef}, ${mode}, peak ${fmt(target)} µm`;
    if (d.surface) {
      const meas = binPolar(d.surface, d.surface.devUm, nT, nA, maxTheta);
      const wear: PolarGrid = { ...meas, value: meas.value.map((v, k) => v - (Number.isFinite(pred.value[k]) ? pred.value[k] : 0)) };
      const lim = robustAbsMax(meas.value);
      const fields: Surface3DField[] = [
        { key: 'meas', label: 'Measured deviation r − R', grid: meas, scale: { kind: 'diverging', limit: lim }, unit: 'µm' },
        { key: 'wear', label: 'Estimated wear (measured − predicted creep)', grid: wear, scale: { kind: 'diverging', limit: lim }, unit: 'µm' },
        { key: 'pred', label: `Predicted remaining creep (${predLabel})`, grid: pred, scale: { kind: 'diverging', limit: lim }, unit: 'µm' },
      ];
      renderSurface3D(holder3d, { fields, radiusMm: radius });
      renderMap(holder, { title: 'Measured deviation', subtitle: 'r − R (µm): + penetration, − elevation', grid: meas, scale: { kind: 'diverging', limit: lim }, unit: 'µm' });
      renderMap(holder, { title: 'Predicted remaining creep', subtitle: predLabel, grid: pred, scale: { kind: 'diverging', limit: lim }, unit: 'µm' });
      renderMap(holder, { title: 'Estimated wear', subtitle: 'measured − predicted remaining creep (µm)', grid: wear, scale: { kind: 'diverging', limit: lim }, unit: 'µm' });
      const thr = d.elevation ? d.elevation.nominal.thresholdUm : 0;
      renderMap(holder, { title: 'Elevations', subtitle: `material above the original surface beyond ${fmt(thr)} µm`, grid: meas, scale: { kind: 'diverging', limit: Math.max(thr * 2, robustAbsMax(meas.value.map((v) => Math.min(0, v)))) }, unit: 'µm', mask: (v) => v < -thr });
    } else {
      const scale = { kind: 'sequential' as const, max: Math.max(target, 1e-6) };
      renderSurface3D(holder3d, { fields: [{ key: 'pred', label: `Predicted remaining creep (${predLabel})`, grid: pred, scale, unit: 'µm' }], radiusMm: radius });
      renderMap(holder, { title: 'Predicted remaining creep', subtitle: predLabel, grid: pred, scale, unit: 'µm' });
    }
  };
  controls.addEventListener('change', draw);
  draw();
}

// ------------------------------------------------------------
// Methods & references (collapsed)
// ------------------------------------------------------------
function renderMethods(root: HTMLElement, d: ReportData): void {
  const { c } = d;
  const mat = MATERIALS[c.material];
  const s = document.createElement('section');
  s.className = 'section';
  s.innerHTML = `<details class="explain big"><summary>Model, assumptions and references</summary>
    <ul class="notes">
      <li><b>Contact</b>: elastic-foundation model of the head in a spherical liner with radial clearance; p = k<sub>f</sub>·(e·cosψ − c − w), k<sub>f</sub> = (1−ν)E/[(1+ν)(1−2ν)h]. Without clearance p<sub>0</sub> = 3F/(2πR²). Cells beyond the rim carry no load.</li>
      <li><b>Through the wall</b>: σ(r) = p·(R/r)²; creep penetration w = κ·∫ε dr, with a strain-hardening integration so the contact conforms as the liner creeps.</li>
      <li><b>Laws</b> (creep part only, linear in stress): ${c.laws.map((id) => `${LAWS[id].shortRef}: <span class="mono">${escapeHtml(LAWS[id].formula)}</span>`).join('; ')}.</li>
      <li><b>Monte Carlo laws</b>: ${c.mcLaws.map((id) => LAWS[id].shortRef).join(', ')} (one per sample). Deng 1998 under-predicts the validation data by 30–50 % and Lewis 2001 over-predicts by ×1.6–3, so by default they are shown only as references (docs/VALIDATION.md).</li>
      <li><b>Static ↔ dynamic</b>: Lee 2003 — a 1 Hz cycle with peak p creeps like a static load k·p (k = 0.61–0.70); Lee 1998 (static) and Lee 2003 (dynamic) agree through k ≈ 0.6.</li>
      <li><b>Beyond 10⁴ min</b> the Lee laws continue log-linearly (steady creep rate, Lee &amp; Pienkowski 1998; growth between 2 and 4 M cycles, Estok 2005).</li>
      <li><b>Temperature</b>: time–temperature superposition with an Arrhenius shift, Ea = ${num(c.eaKcal.lo)}–${num(c.eaKcal.hi)} kcal/mol (Galetz &amp; Glatzel 2010: ≈ 15.5 from the deformation under sliding at 23–45 °C; Burger 2006: 19.3). Deng's 53.7 kcal/mol overestimates the shift ×20.</li>
      <li><b>Recovery</b>: Lee &amp; Pienkowski 1998 — recovered strain linear in log(time), 73 % of it in the first 1000 min, ≈ 51 % of the creep recovered after 10⁴ min at room temperature, independent of load. Galetz 2010: the permanent part grows with the loading time; Estok 2005 measured, after ≈ 23 days of cyclic loading and 48 h unloaded, the full creep. Two scenarios are therefore reported: <b>Lee &amp; Pienkowski</b> (upper bound of recovery) and <b>long loading</b> (0–15 % recovered); a liner loaded for years is expected between both. Cross-linked PE recovers more (no published percentage; assumed ${pct(MATERIALS.hxlpe.recovery10k.lo)}–${pct(MATERIALS.hxlpe.recovery10k.hi)}).</li>
      <li><b>Material</b>: ${escapeHtml(mat.label)} — ${escapeHtml(mat.note)}</li>
      <li><b>Not modelled</b>: backside deformation and liner seating in the shell, frictional heating, oxidation, edge loading by impingement, wear–creep interaction during the run-in.</li>
    </ul>
    <ul class="refs">
      ${c.laws.map((id) => `<li>${escapeHtml(LAWS[id].reference)}</li>`).join('')}
      <li>Lee K-Y, Pienkowski D. Viscoelastic recovery of creep-deformed UHMWPE. ASTM STP 1307, 1998:30–36.</li>
      <li>Takahashi Y, Tateiwa T, Shishido T, et al. Size and thickness effect on creep behavior in conventional and vitamin E-diffused highly crosslinked polyethylene for total hip arthroplasty. J Mech Behav Biomed Mater. 2016;62:399–406.</li>
      <li>Estok DM, Bragdon CR, Plank GR, et al. The measurement of creep in ultrahigh molecular weight polyethylene: a comparison of conventional versus highly cross-linked polyethylene. J Arthroplasty. 2005;20:239–243.</li>
      <li>Galetz MC, Glatzel U. An activated energy approach for accelerated testing of the deformation of UHMWPE in artificial joints. J Mech Behav Biomed Mater. 2010;3:331–338.</li>
      <li>Bevill SL, et al. Finite element simulation of early creep and wear in total hip arthroplasty. J Biomech. 2005;38:2365–2374.</li>
      <li>Bergmann G, et al. Frictional heating of total hip implants. Part 1: measurements in patients. J Biomech. 2001;34:421–428.</li>
      <li>Rochcongar G, et al. Reduced wear in vitamin E-infused highly cross-linked polyethylene cups: 5-year results of a randomized controlled trial. Acta Orthop. 2021;92:151–155.</li>
      <li>Burger NDL. Creep analysis for UHMWPE (Ch. 3). PhD thesis, University of Pretoria, 2006.</li>
      <li>Metin F, Cengil M. Short-term creep and recovery behavior of medical grade UHMWPE. J Achiev Mater Manuf Eng. 2016;78(2):65–70.</li>
      <li>Zeman J, et al. UHMWPE acetabular cup creep deformation during the run-in phase of THA's life cycle. J Mech Behav Biomed Mater. 2018;87:30–39.</li>
      <li>Glyn-Jones S, McLardy-Smith P, Gill HS, Murray DW. The creep and wear of highly cross-linked polyethylene: a three-year randomised, controlled trial using radiostereometric analysis. J Bone Joint Surg Br. 2008;90-B(5). doi:10.1302/0301-620X.90B5.20545</li>
      <li>Takahashi et al. Post-deformation shape-recovery behavior of vitamin E-diffused, radiation crosslinked polyethylene acetabular components. J Mech Behav Biomed Mater. 2016 (PMID 27454526).</li>
      <li>Geerdink CH, et al. Crosslinked polyethylene compared to conventional polyethylene in total hip replacement (ABG II, Duration). Acta Orthop. 2006.</li>
    </ul></details>`;
  root.appendChild(s);
}

function robustAbsMax(values: ArrayLike<number>): number {
  const a = Array.from(values).filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return 1;
  return Math.max(1, a[Math.floor(0.99 * (a.length - 1))]);
}
