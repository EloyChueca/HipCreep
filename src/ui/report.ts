// ============================================================
// HipCreep — results report
// ============================================================

import type { CaseInput } from '../model/case.ts';
import { LAWS, type LawId, type Loading } from '../model/laws.ts';
import { MATERIALS } from '../model/materials.ts';
import { MODES, gaitSeconds, implantSeconds, verdict, type DeterministicResult, type McResult, type Verdict } from '../model/analysis.ts';
import { binPolar, minCreepDepthUm, modelToPolar, syntheticBases, type ElevationResult, type SurfaceData, type PolarGrid } from '../model/surface.ts';
import type { LoadedHipWearCase } from '../io/hipwear.ts';
import type { UiSettings } from './form.ts';
import { fmt, num, pct, fmtTime, escapeHtml, cssVar } from './format.ts';
import { lineChart, rangeChart, histogram, type LineSeries, type RangeRow } from './charts.ts';
import { renderMap } from './polarmap.ts';
import type { Stats } from '../model/stats.ts';

export interface ReportData {
  c: CaseInput;
  ui: UiSettings;
  det: DeterministicResult;
  mc: McResult;
  loaded: LoadedHipWearCase | null;
  surface: SurfaceData | null;
  elevation: ElevationResult | null;
}

const LAW_COLOR: Record<LawId, string> = { lee2003: '--series-1', deng1998: '--series-2', lewis2001: '--series-3' };
export const lawColor = (id: LawId) => cssVar(LAW_COLOR[id]);
const MODE_LABEL: Record<Loading, string> = { static: 'Static', dynamic: 'Dynamic' };
const iv = (s: Stats) => `${fmt(s.p50)} <small>µm</small>`;
const ci = (s: Stats) => `90 %: ${fmt(s.p5)} – ${fmt(s.p95)} µm`;

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

export function renderEmpty(root: HTMLElement): void {
  root.innerHTML = `
    <div class="report-empty">
      <h2>HipCreep</h2>
      <p>Estimates the <b>creep</b> (cold flow) of a UHMWPE acetabular liner from the patient and implant data, with the
      compressive creep laws of Lee et al. (2003), Deng et al. (1998) and Lewis &amp; Carroll (2001), in a <b>static</b>
      (load held for the whole implantation time) and a <b>dynamic</b> (1 Hz gait cycles) mode. It then applies the
      <b>recovery</b> measured by Lee &amp; Pienkowski (1998) for the time the liner spent unloaded before scanning, and splits
      the penetration measured by <b>HipWear</b> into remaining creep and wear, with Monte Carlo ranges.</p>
      <p style="margin-top:10px">Load a HipWear export (<span class="mono">hipcreep-input</span> JSON) or try the <b>Demo case</b>,
      review the inputs on the left and press <b>Run analysis</b>.</p>
    </div>`;
}

export function renderReport(root: HTMLElement, d: ReportData): void {
  root.innerHTML = '';
  const { c, det, mc } = d;
  const mat = MATERIALS[c.material];
  const gaitS = gaitSeconds(c, c.cyclesPerYear.nominal);

  // ---------- Header ----------
  const head = section(root, `Case ${escapeHtml(c.caseId)}`);
  head.insertAdjacentHTML('beforeend', `<p class="case-line">${num(c.bodyMassKg)} kg · ${num(c.implantMonths)} months in vivo · head Ø ${num(c.headDiameterMm)} mm · wall ${num(c.thicknessMm)} mm ·
    clearance ${num(c.clearance.nominal * 1000)} µm · load ${num(c.loadAngleDeg)}° from the cup axis · ${escapeHtml(mat.label)} ·
    ${num(c.exVivoDays)} days unloaded at ${num(c.recoveryTempC)} °C before scanning · ${mc.n} Monte Carlo samples (${(mc.elapsedMs / 1000).toFixed(1)} s)</p>`);

  // ---------- Key results ----------
  const cards = document.createElement('div');
  cards.className = 'cards';
  const S = mc.summary;
  const card = (k: string, v: string, s: string) => `<div class="card"><div class="k">${k}</div><div class="v num">${v}</div><div class="s num">${s}</div></div>`;
  let html = card('Creep at explantation · static', iv(S.static.creep), ci(S.static.creep))
    + card('Creep at explantation · dynamic', iv(S.dynamic.creep), ci(S.dynamic.creep))
    + card('Recovered before scanning', pct(mc.recovery.p50), `90 %: ${pct(mc.recovery.p5)} – ${pct(mc.recovery.p95)} of the creep`)
    + card('Remaining creep · dynamic', iv(S.dynamic.remaining), ci(S.dynamic.remaining));
  if (c.measured) {
    html += card('Measured penetration (HipWear)', `${fmt(c.measured.penetrationUm)} <small>µm</small>`, `± ${fmt(c.measured.sdUm)} µm (SD)${c.measured.detectionLimitUm ? ` · LoD ${fmt(c.measured.detectionLimitUm)} µm` : ''}`)
      + card('Estimated wear · dynamic', iv(S.dynamic.wear!), ci(S.dynamic.wear!))
      + card('Estimated wear · static', iv(S.static.wear!), ci(S.static.wear!));
  }
  cards.innerHTML = html;
  head.appendChild(cards);
  if (c.measured) {
    for (const mode of MODES) {
      head.insertAdjacentHTML('beforeend', verdictHtml(verdict(c.measured, S[mode].remaining, S[mode].wear, S[mode].probWearNegative), `${MODE_LABEL[mode]} mode`));
    }
  }

  // ---------- Three modes ----------
  const t3 = section(root, 'Creep at explantation — three modes per law',
    `Nominal parameters. <b>Static</b>: the peak walking force (${num(c.peakForceBW.nominal)} × BW) held during the whole implantation time (${fmtTime(implantSeconds(c))}) — an upper bound. <b>Dynamic</b>: 1 Hz gait cycles with that peak during the cumulative walking time (${num(c.cyclesPerYear.nominal / 1e6)} M cycles/year → ${fmtTime(gaitS)} of loading). Each law is shown at the temperature of its own tests and brought to ${num(c.inVivoTempC)} °C by time–temperature superposition (Ea = ${num(c.eaKcal.nominal)} kcal/mol). Remaining = after ${pct(det.recovered)} recovery (${pct(det.recoveredAlt)} if recovery keeps growing log-linearly).`);
  const rowsHtml = c.laws.map((id) => {
    const law = LAWS[id];
    const cell = (mode: Loading, t: 'native' | 'in-vivo') => {
      const r = det.rows.find((x) => x.law === id && x.mode === mode && x.temperature === t)!;
      return `<td>${fmt(r.creepUm)}<div class="muted" style="font-size:11px">rem. ${fmt(r.remainingUm)}</div></td>`;
    };
    const notes = Array.from(new Set(det.rows.filter((x) => x.law === id).flatMap((x) => x.notes))).join('; ');
    return `<tr><td><span class="swatch" style="background:${lawColor(id)}"></span>${escapeHtml(law.shortRef)}<div class="muted" style="font-size:11px">${escapeHtml(law.material)} · ${law.nativeTempC} °C · ${law.nativeLoading}</div></td>
      ${cell('static', 'native')}${cell('static', 'in-vivo')}${cell('dynamic', 'native')}${cell('dynamic', 'in-vivo')}<td class="note">${escapeHtml(notes)}</td></tr>`;
  }).join('');
  const lawT = (id: LawId) => LAWS[id].nativeTempC;
  t3.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data">
    <thead><tr><th>Law</th><th>Static · own T</th><th>Static · ${num(c.inVivoTempC)} °C</th><th>Dynamic · own T</th><th>Dynamic · ${num(c.inVivoTempC)} °C</th><th style="text-align:left">Notes</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></div>
    <p class="muted" style="margin-top:6px;font-size:12px">Maximum creep penetration in µm (instantaneous elastic deformation excluded). "Own T" = ${c.laws.map((id) => `${LAWS[id].shortRef} ${lawT(id)} °C`).join(', ')}.
    Peak contact pressure ${fmt(det.rows[0]?.peakPressureInitialMPa)} MPa at first loading.</p>`);

  // ---------- Creep vs time ----------
  const tc = section(root, 'Creep build-up during implantation', `Nominal parameters at ${num(c.inVivoTempC)} °C. The dynamic curves are drawn against the elapsed time since surgery (walking is spread over the whole period). Creep grows with log(time): most of it develops in the first weeks.`);
  const chart = document.createElement('div');
  chart.className = 'chart-card';
  chart.innerHTML = `<div class="chart-title">Maximum creep penetration (µm) vs time since implantation</div>
    <div class="legend">${c.laws.map((id) => `<span class="item"><span class="swatch" style="background:${lawColor(id)}"></span>${LAWS[id].shortRef}</span>`).join('')}
    <span class="item"><svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" stroke-width="2"/></svg>static</span>
    <span class="item"><svg width="26" height="6"><line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3"/></svg>dynamic</span></div>`;
  tc.appendChild(chart);
  const series: LineSeries[] = [];
  const Ts = implantSeconds(c);
  for (const id of c.laws) {
    for (const mode of MODES) {
      const r = det.rows.find((x) => x.law === id && x.mode === mode && x.temperature === 'in-vivo')!;
      const h = r.sim.history!;
      const scaleT = mode === 'dynamic' ? Ts / Math.max(gaitS, 1) : 1;
      series.push({
        label: `${LAWS[id].shortRef} ${mode}`,
        color: lawColor(id),
        dash: mode === 'dynamic' ? '5 3' : undefined,
        x: Array.from(h.tS, (t) => t * scaleT).filter((_, i) => h.tS[i] * scaleT >= 60),
        y: Array.from(h.maxCreepMm, (w) => w * 1000).filter((_, i) => h.tS[i] * scaleT >= 60),
      });
    }
  }
  lineChart(chart, {
    series, xLabel: 'time since implantation (log scale)', yLabel: 'creep (µm)', xFormat: fmtTime,
    xTicks: [60, 3600, 86400, 7 * 86400, 30.44 * 86400, 182.6 * 86400, 365.25 * 86400, 2 * 365.25 * 86400],
    marker: { x: Ts, label: 'explantation' },
  });

  // ---------- Monte Carlo ----------
  const mcs = section(root, 'Monte Carlo ranges',
    `Each sample draws one law and every uncertain parameter from its range (force ${num(c.peakForceBW.lo)}–${num(c.peakForceBW.hi)} BW, cycles, k, E, ν, wall thickness, clearance, Ea, material creep factor, extrapolations, recovery). Bars: 90 % interval, box: 50 %, dot: median.`);
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
  mcs.appendChild(mcCard);
  rangeChart(mcCard, rr, 'creep at explantation (µm)', c.measured ? { x: c.measured.penetrationUm, label: 'measured D' } : undefined);
  const statRow = (name: string, s: Stats | null) => s ? `<tr><td>${name}</td><td>${fmt(s.p5)}</td><td>${fmt(s.p25)}</td><td><b>${fmt(s.p50)}</b></td><td>${fmt(s.p75)}</td><td>${fmt(s.p95)}</td></tr>` : '';
  mcs.insertAdjacentHTML('beforeend', `<div class="table-wrap" style="margin-top:12px"><table class="data">
    <thead><tr><th>Quantity (µm)</th><th>P5</th><th>P25</th><th>Median</th><th>P75</th><th>P95</th></tr></thead><tbody>
    ${MODES.map((m) => statRow(`Creep at explantation · ${m}`, S[m].creep) + statRow(`Recovered before scan · ${m}`, S[m].recovered) + statRow(`Remaining creep · ${m}`, S[m].remaining)).join('')}
    ${statRow('Remaining creep · both modes pooled', mc.pooled.remaining)}
    </tbody></table></div>`);

  // ---------- Decomposition ----------
  if (c.measured) {
    const m = c.measured;
    const dec = section(root, 'Penetration = remaining creep + wear',
      `HipWear measures the penetration D left in the liner when it was scanned: D = W + C<sub>rem</sub>, with C<sub>rem</sub> = C<sub>max</sub>·(1 − R). The creep model gives C<sub>max</sub>, the recovery model R; the measured D is sampled with its uncertainty (± ${fmt(m.sdUm)} µm).`);
    const shareRow = (mode: Loading) => {
      const s = S[mode];
      return `<tr><td>${MODE_LABEL[mode]}</td><td>${fmt(s.creep.p50)}</td><td>${fmt(s.recovered.p50)}</td><td>${fmt(s.remaining.p50)}</td>
        <td><b>${fmt(s.wear!.p50)}</b></td><td>${fmt(s.wear!.p5)} – ${fmt(s.wear!.p95)}</td><td>${pct(s.creepShare!.p50)}</td><td>${pct(s.probWearNegative)}</td></tr>`;
    };
    const cmax = mc.pooled.creep.p50;
    dec.insertAdjacentHTML('beforeend', `<div class="table-wrap"><table class="data">
      <thead><tr><th>Mode</th><th>C<sub>max</sub></th><th>Recovered</th><th>C<sub>rem</sub></th><th>Wear W</th><th>W, 90 %</th><th>Creep share of D</th><th>P(W &lt; 0)</th></tr></thead>
      <tbody>${shareRow('static')}${shareRow('dynamic')}</tbody></table></div>
      <p class="muted" style="margin-top:6px;font-size:12px">Medians in µm. Without any recovery model the bounds would only be: wear between ${fmt(Math.max(0, m.penetrationUm - cmax))} and ${fmt(m.penetrationUm)} µm, remaining creep between 0 and ${fmt(Math.min(m.penetrationUm, cmax))} µm (pooled median C<sub>max</sub> = ${fmt(cmax)} µm).</p>`);
    const grid = document.createElement('div');
    grid.className = 'grid2';
    grid.style.marginTop = '12px';
    dec.appendChild(grid);
    for (const mode of MODES) {
      const cardH = document.createElement('div');
      cardH.className = 'chart-card';
      cardH.innerHTML = `<div class="chart-title">Estimated wear W — ${mode}</div><div class="chart-sub">Monte Carlo distribution (µm)</div>`;
      grid.appendChild(cardH);
      histogram(cardH, mc.modes[mode].wearUm!, lawColor('lee2003'), 'wear W (µm)', [{ x: 0, label: '0' }, { x: m.penetrationUm, label: 'D' }]);
    }
  }

  // ---------- Elevations ----------
  if (d.elevation && d.surface) {
    const e = d.elevation;
    const ref = d.ui.refRadius === 'measured' && d.loaded?.measuredRadiusMm
      ? `measured cavity radius ${fmt(d.loaded.measuredRadiusMm, 3)} mm${d.loaded.measuredCenter ? ', centre of its own fit' : ', centre of the original sphere'}`
      : `commercial radius ${fmt(d.loaded?.commercialRadiusMm, 3)} mm, centre of the original sphere`;
    const el = section(root, 'Minimum creep from the elevations (sphere → plane)',
      `In the plane r = R (${ref}) penetration appears as positive peaks and material pushed above the original surface as negative peaks. Wear cannot create elevations; creep (plastic flow) conserves volume, so the elevation volume is a <b>lower bound</b> of the creep volume still in the liner. The noise floor is the volume pure noise (σ = ${fmt(e.sigmaEffUm)} µm) would produce above the same threshold.`);
    const dyn = det.rows.find((r) => r.law === c.laws[0] && r.mode === 'dynamic' && r.temperature === 'in-vivo')!;
    const shape = dyn.sim.shapeAreaMm2;
    const minNom = minCreepDepthUm(e.nominal.netMm3, shape);
    const minLo = minCreepDepthUm(e.netRangeMm3[0], shape), minHi = minCreepDepthUm(e.netRangeMm3[1], shape);
    const rowsE = [...e.rows].sort((a, b) => a.k - b.k || a.sigmaUm - b.sigmaUm).map((r) => `<tr><td>${r.k}·σ (σ = ${fmt(r.sigmaUm)} µm)</td><td>${fmt(r.thresholdUm)}</td><td>${fmt(r.rawMm3, 3)}</td><td>${fmt(r.noiseFloorMm3, 3)}</td><td><b>${fmt(r.netMm3, 3)}</b></td><td>${fmt(r.elevatedAreaMm2)}</td></tr>`).join('');
    const remDyn = S.dynamic.remaining;
    el.insertAdjacentHTML('beforeend', `
      <div class="cards">
        ${card('Net elevation volume', `${fmt(e.nominal.netMm3, 3)} <small>mm³</small>`, `range ${fmt(e.netRangeMm3[0], 3)} – ${fmt(e.netRangeMm3[1], 3)} mm³ (k = 1–3, σ ± 20 %)`)}
        ${card('Minimum remaining creep', `${fmt(minNom)} <small>µm</small>`, `range ${fmt(minLo)} – ${fmt(minHi)} µm, with the model creep shape (${fmt(shape)} mm²)`)}
        ${card('Model remaining creep · dynamic', iv(remDyn), minNom > remDyn.p95 ? 'BELOW the elevation bound — model under-predicts' : minNom > remDyn.p50 ? 'median below the elevation bound' : 'consistent with the elevation bound')}
        ${card('Where the elevations are', `${fmt(e.elevationPsiDeg)}°`, `from the load axis (${fmt(e.elevationThetaDeg)}° from the pole); creep flow is expected at the edge of the contact`)}
      </div>
      <div class="table-wrap" style="margin-top:12px"><table class="data">
        <thead><tr><th>Threshold</th><th>µm</th><th>Raw volume (mm³)</th><th>Noise floor (mm³)</th><th>Net (mm³)</th><th>Elevated area (mm²)</th></tr></thead>
        <tbody>${rowsE}</tbody></table></div>
      <p class="muted" style="margin-top:6px;font-size:12px">Analysed area ${fmt(e.analysedAreaMm2)} mm² (band of ${fmt(d.ui.rimBandDeg)}° at the trim edge excluded). Systematic sensitivity: each 1 µm error in the reference radius shifts the elevation volume by up to ${fmt(e.radiusSensitivityMm3PerUm, 3)} mm³, so the bound is only meaningful with a reliable radius of the original surface.
      Elevations may also come from form error of the liner (sphericity) — check that they sit at the edge of the contact zone.</p>`);
  }

  // ---------- Maps ----------
  renderMapsSection(root, d);

  // ---------- Methods ----------
  const meth = section(root, 'Model, assumptions and references');
  meth.insertAdjacentHTML('beforeend', `
    <ul class="notes">
      <li><b>Contact</b>: elastic-foundation model of the head in a spherical liner with radial clearance; p = k<sub>f</sub>·(e·cosψ − c − w), k<sub>f</sub> = (1−ν)E/[(1+ν)(1−2ν)h]. Without clearance p<sub>0</sub> = 3F/(2πR²). Cells beyond the rim carry no load.</li>
      <li><b>Through the wall</b>: σ(r) = p·(R/r)²; creep penetration w = κ·∫ε dr, with a strain-hardening integration so the contact conforms as the liner creeps.</li>
      <li><b>Laws</b> (creep part only, linear in stress): ${c.laws.map((id) => `${LAWS[id].shortRef}: <span class="mono">${escapeHtml(LAWS[id].formula)}</span>`).join('; ')}.</li>
      <li><b>Static ↔ dynamic</b>: Lee 2003 — a 1 Hz cycle with peak p creeps like a static load k·p (k = 0.61–0.70).</li>
      <li><b>Temperature</b>: time–temperature superposition with an Arrhenius shift (Deng 1998: Ea = 53.7 kcal/mol; Burger 2006 data imply ≈ 19 kcal/mol between 22 and 37 °C).</li>
      <li><b>Recovery</b>: Lee &amp; Pienkowski 1998 — recovered strain linear in log(time), 73 % of it in the first 1000 min, ≈ 51 % of the creep recovered after 10⁴ min at room temperature, independent of load. Cross-linked PE recovers more (no published percentage; assumed ${pct(MATERIALS.hxlpe.recovery10k.lo)}–${pct(MATERIALS.hxlpe.recovery10k.hi)}).</li>
      <li><b>Material</b>: ${escapeHtml(mat.label)} — ${escapeHtml(mat.note)}</li>
      <li><b>Not modelled</b>: backside deformation and liner seating in the shell, frictional heating, oxidation, edge loading by impingement, wear–creep interaction during the run-in.</li>
    </ul>
    <ul class="refs">
      ${c.laws.map((id) => `<li>${escapeHtml(LAWS[id].reference)}</li>`).join('')}
      <li>Lee K-Y, Pienkowski D. Viscoelastic recovery of creep-deformed UHMWPE. ASTM STP 1307, 1998:30–36.</li>
      <li>Burger NDL. Creep analysis for UHMWPE (Ch. 3). PhD thesis, University of Pretoria, 2006.</li>
      <li>Metin F, Cengil M. Short-term creep and recovery behavior of medical grade UHMWPE. J Achiev Mater Manuf Eng. 2016;78(2):65–70.</li>
      <li>Zeman J, et al. UHMWPE acetabular cup creep deformation during the run-in phase of THA's life cycle. J Mech Behav Biomed Mater. 2018;87:30–39.</li>
      <li>Glyn-Jones S, McLardy-Smith P, Gill HS, Murray DW. The creep and wear of highly cross-linked polyethylene: a three-year randomised, controlled trial using radiostereometric analysis. J Bone Joint Surg Br. 2008;90-B(5). doi:10.1302/0301-620X.90B5.20545</li>
      <li>Takahashi et al. Post-deformation shape-recovery behavior of vitamin E-diffused, radiation crosslinked polyethylene acetabular components. J Mech Behav Biomed Mater. 2016 (PMID 27454526).</li>
    </ul>`);
}

function renderMapsSection(root: HTMLElement, d: ReportData): void {
  const { c, det, mc } = d;
  const sec = section(root, 'Maps (sphere → plane)',
    d.surface ? 'Seen from the cup opening; the pole is the centre and the penetration direction points up. Measured deviation from the original sphere, predicted remaining creep, their difference (estimated wear) and the elevations.' : 'Predicted remaining creep seen from the cup opening (pole at the centre, penetration direction up). Load a HipWear file to compare with the measured surface.');
  const controls = document.createElement('div');
  controls.className = 'map-controls';
  controls.innerHTML = `<label>Predicted map: law <select id="map-law">${c.laws.map((id) => `<option value="${id}">${LAWS[id].shortRef}</option>`).join('')}</select></label>
    <label>mode <select id="map-mode"><option value="dynamic">dynamic</option><option value="static">static</option></select></label>
    <label>amplitude <select id="map-amp"><option value="mc">Monte Carlo median of the mode</option><option value="nominal">nominal of this law</option></select></label>`;
  sec.appendChild(controls);
  const holder = document.createElement('div');
  holder.className = 'maps';
  sec.appendChild(holder);

  const draw = () => {
    holder.innerHTML = '';
    const law = (controls.querySelector('#map-law') as HTMLSelectElement).value as LawId;
    const mode = (controls.querySelector('#map-mode') as HTMLSelectElement).value as Loading;
    const amp = (controls.querySelector('#map-amp') as HTMLSelectElement).value;
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
    if (d.surface) {
      const meas = binPolar(d.surface, d.surface.devUm, nT, nA, maxTheta);
      const wear: PolarGrid = { ...meas, value: meas.value.map((v, k) => v - (Number.isFinite(pred.value[k]) ? pred.value[k] : 0)) };
      const lim = robustAbsMax(meas.value);
      renderMap(holder, { title: 'Measured deviation', subtitle: 'r − R (µm): + penetration, − elevation', grid: meas, scale: { kind: 'diverging', limit: lim }, unit: 'µm' });
      renderMap(holder, { title: 'Predicted remaining creep', subtitle: `${LAWS[law].shortRef}, ${mode}, peak ${fmt(target)} µm`, grid: pred, scale: { kind: 'diverging', limit: lim }, unit: 'µm' });
      renderMap(holder, { title: 'Estimated wear', subtitle: 'measured − predicted remaining creep (µm)', grid: wear, scale: { kind: 'diverging', limit: lim }, unit: 'µm' });
      const thr = d.elevation ? d.elevation.nominal.thresholdUm : 0;
      renderMap(holder, { title: 'Elevations', subtitle: `material above the original surface beyond ${fmt(thr)} µm`, grid: meas, scale: { kind: 'diverging', limit: Math.max(thr * 2, robustAbsMax(meas.value.map((v) => Math.min(0, v)))) }, unit: 'µm', mask: (v) => v < -thr });
    } else {
      renderMap(holder, { title: 'Predicted remaining creep', subtitle: `${LAWS[law].shortRef}, ${mode}, peak ${fmt(target)} µm`, grid: pred, scale: { kind: 'sequential', max: Math.max(target, 1e-6) }, unit: 'µm' });
    }
  };
  controls.addEventListener('change', draw);
  draw();
}

function robustAbsMax(values: ArrayLike<number>): number {
  const a = Array.from(values).filter(Number.isFinite).map(Math.abs).sort((x, y) => x - y);
  if (!a.length) return 1;
  return Math.max(1, a[Math.floor(0.99 * (a.length - 1))]);
}
