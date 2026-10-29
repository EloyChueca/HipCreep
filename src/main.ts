// ============================================================
// HipCreep — application entry point
// ============================================================

import { defaultCase, type CaseInput } from './model/case.ts';
import { runDeterministic } from './model/analysis.ts';
import { analyseSurface, elevationAnalysis, type SurfaceData, type ElevationResult } from './model/surface.ts';
import { parseHipWearInput, type LoadedHipWearCase } from './io/hipwear.ts';
import { makePhantom } from './io/phantom.ts';
import { caseFromLoaded, seriesCsv, type SeriesResult } from './model/series.ts';
import { computeMonteCarlo, computeSeriesCase } from './compute/client.ts';
import { yieldTask } from './compute/yield.ts';
import { renderSeriesSetup, renderSeriesResults, type SeriesItem, type SeriesCallbacks } from './ui/series.ts';
import { buildForm, writeForm, readForm, syncEnabled, showMaterialPreset, defaultUi, type UiSettings } from './ui/form.ts';
import { renderEmpty, renderReport, type ReportData } from './ui/report.ts';
import { download, resultsCsv, resultsJson, seriesXlsx } from './ui/export.ts';
import { escapeHtml, fmt } from './ui/format.ts';

const VERSION = '0.12.0';

let caseInput: CaseInput = defaultCase();
let ui: UiSettings = defaultUi();
let loaded: LoadedHipWearCase | null = null;
let surfaceCache: { key: string; surface: SurfaceData; elevation: ElevationResult } | null = null;
let lastReport: ReportData | null = null;
let running = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- theme ----------
function applyTheme(t: string | null): void {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
try { applyTheme(localStorage.getItem('hipcreep-theme')); } catch { /* storage unavailable */ }
$('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme')
    ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('hipcreep-theme', next); } catch { /* ignore */ }
  if (lastReport) render(lastReport);
});

// ---------- form ----------
$('app-version').textContent = `v${VERSION}`;
buildForm($('form-scroll'));
writeForm(caseInput, ui);
renderEmpty($('report'));

$('form-scroll').addEventListener('change', (ev) => {
  const id = (ev.target as HTMLElement).id;
  if (id === 'f-material' || id === 'f-doseKGy' || id === 'f-thermal') showMaterialPreset();
  syncEnabled();
});

function setFileInfo(): void {
  const box = $('file-box');
  if (!loaded) {
    $('file-info').textContent = 'No HipWear file loaded — manual inputs';
    box.innerHTML = 'Manual inputs. Load a HipWear export to take the geometry, penetration and surface map from it.';
    return;
  }
  const L = loaded;
  $('file-info').textContent = `${L.name} — case ${L.caseId}`;
  box.innerHTML = `<b>${escapeHtml(L.name)}</b><br/>
    Head Ø ${fmt(L.headDiameterMm)} mm · commercial R ${fmt(L.commercialRadiusMm, 3)} mm${L.measuredRadiusMm ? ` · measured R ${fmt(L.measuredRadiusMm, 3)} mm${L.measuredRadiusReliable ? '' : ' (unreliable)'}` : ''}<br/>
    ${L.measured ? (L.measured.notDetected ? `Penetration not detected (< ${fmt(L.measured.detectionLimitUm)} µm)` : `Penetration ${fmt(L.measured.penetrationUm)} ± ${fmt(L.measured.sdUm)} µm`) : 'No penetration value'} ·
    ${L.mesh ? `${(L.mesh.vertices.length / 3).toLocaleString('en-US')} vertices` : 'no mesh'} · noise σ ${fmt(L.noiseSigmaUm)} µm
    ${L.warnings.length ? `<ul class="warn-list">${L.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}`;
}

function applyLoaded(L: LoadedHipWearCase): void {
  loaded = L;
  surfaceCache = null;
  caseInput = caseFromLoaded(readForm(caseInput, ui).c, L);
  ui = { ...ui, manualMeasurement: !!L.measured };
  writeForm(caseInput, ui);
  setFileInfo();
}

$('file-input').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  try {
    applyLoaded(parseHipWearInput(await f.text(), f.name));
    $('run-status').textContent = 'File loaded. Review the inputs and run the analysis.';
  } catch (e) {
    $('run-status').textContent = `Could not read ${f.name}: ${(e as Error).message}`;
  }
  input.value = '';
});

// ---------- series of liners ----------
let seriesItems: SeriesItem[] = [];
let seriesResults: SeriesResult[] = [];

const seriesCb: SeriesCallbacks = {
  onRun: (items) => void runSeries(items),
  onOpen: (it) => {
    applyLoaded(it.L);
    caseInput = { ...caseInput, bodyMassKg: it.bodyMassKg, material: it.material, irradiation: { ...it.irradiation }, exVivoDays: it.exVivoDays, implantMonths: it.implantMonths };
    writeForm(caseInput, ui);
    void run();
  },
  onClose: () => { seriesItems = []; if (lastReport) render(lastReport); else renderEmpty($('report')); },
};

$('series-input').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (!files.length) return;
  const base = readForm(caseInput, ui).c;
  const bad: string[] = [];
  seriesItems = [];
  for (const f of files) {
    try {
      const L = parseHipWearInput(await f.text(), f.name);
      const c = caseFromLoaded(base, L);
      seriesItems.push({ L, bodyMassKg: c.bodyMassKg, material: c.material, irradiation: { ...c.irradiation }, exVivoDays: c.exVivoDays, implantMonths: c.implantMonths });
    } catch (e) { bad.push(`${f.name}: ${(e as Error).message}`); }
  }
  $('run-status').textContent = `${seriesItems.length} liners loaded${bad.length ? `; ${bad.length} file(s) could not be read (${bad.join('; ')})` : ''}.`;
  if (seriesItems.length) renderSeriesSetup($('report'), seriesItems, seriesCb);
});

async function runSeries(items: SeriesItem[]): Promise<void> {
  if (running) return;
  running = true;
  const r0 = readForm(caseInput, ui);
  caseInput = r0.c; ui = r0.ui;
  const status = document.getElementById('s-status');
  const bar = document.getElementById('s-bar');
  const t0 = performance.now();
  seriesResults = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (status) status.textContent = `Liner ${i + 1} of ${items.length}: ${it.L.caseId}…`;
      if (bar) bar.style.width = `${(100 * i / items.length).toFixed(1)}%`;
      await yieldTask();
      const c = caseFromLoaded(caseInput, it.L);
      c.bodyMassKg = it.bodyMassKg; c.material = it.material; c.irradiation = { ...it.irradiation }; c.exVivoDays = it.exVivoDays; c.implantMonths = it.implantMonths;
      seriesResults.push(await computeSeriesCase(c, it.L, { refRadius: ui.refRadius, rimBandDeg: ui.rimBandDeg }));
    }
    if (bar) bar.style.width = '100%';
    const root = $('report');
    renderSeriesSetup(root, items, seriesCb);
    const d0 = new Date(), p2 = (x: number) => String(x).padStart(2, '0');
    const stamp = `${d0.getFullYear()}${p2(d0.getMonth() + 1)}${p2(d0.getDate())}-${p2(d0.getHours())}${p2(d0.getMinutes())}`;
    const xlsxName = `hipcreep-series-${stamp}.xlsx`;
    const res = seriesResults;
    const settings = { refRadius: ui.refRadius, rimBandDeg: ui.rimBandDeg };
    const caseNow = caseInput;
    const saveXlsx = () => download(xlsxName, seriesXlsx(res, caseNow, settings, VERSION));
    renderSeriesResults(root, items, res, seriesCb, () => download('hipcreep-series.csv', seriesCsv(res), 'text/csv'), saveXlsx);
    // Excel file with the results, downloaded automatically at the end of the series
    let xlsxNote = `Excel file downloaded: ${xlsxName}`;
    try { saveXlsx(); } catch (e) { console.error(e); xlsxNote = `Excel file could not be created (${(e as Error).message}); use the Series (Excel) button`; }
    const st = document.getElementById('s-status');
    if (st) st.textContent = `Done: ${items.length} liners in ${((performance.now() - t0) / 1000).toFixed(1)} s. ${xlsxNote}.`;
    $('run-status').textContent = `Series done: ${items.length} liners. ${xlsxNote}.`;
  } catch (e) {
    console.error(e);
    if (status) status.textContent = `Error: ${(e as Error).message}`;
  } finally {
    running = false;
  }
}

$('btn-demo').addEventListener('click', () => {
  applyLoaded(parseHipWearInput(JSON.stringify(makePhantom()), 'demo-phantom.json'));
  void run();
});
$('btn-demo-download').addEventListener('click', () => download('hipcreep-demo-phantom.json', JSON.stringify(makePhantom(), null, 1)));
$('btn-clear').addEventListener('click', () => {
  loaded = null;
  surfaceCache = null;
  lastReport = null;
  caseInput = defaultCase();
  ui = defaultUi();
  writeForm(caseInput, ui);
  setFileInfo();
  renderEmpty($('report'));
  $('run-status').textContent = '';
});

// ---------- run ----------
function surfaceFor(L: LoadedHipWearCase, u: UiSettings): { surface: SurfaceData; elevation: ElevationResult } | null {
  if (!L.mesh) return null;
  // Each radius goes with the centre of its own fit: the measured radius with the free-radius
  // sphere centre (when HipWear exports it), the commercial radius with the original sphere.
  const useMeasured = u.refRadius === 'measured' && !!L.measuredRadiusMm;
  const R = useMeasured ? L.measuredRadiusMm! : L.commercialRadiusMm;
  const center = useMeasured && L.measuredCenter ? L.measuredCenter : L.center;
  const key = `${R}|${center.join(',')}|${u.rimBandDeg}`;
  if (surfaceCache?.key === key) return surfaceCache;
  const surface = analyseSurface(L.mesh, { center, radiusMm: R, pole: L.pole, load: L.load });
  const elevation = elevationAnalysis(surface, L.noiseSigmaUm, L.surfaceUncertaintyUm, u.rimBandDeg);
  surfaceCache = { key, surface, elevation };
  return surfaceCache;
}

function render(d: ReportData): void {
  const root = $('report');
  const top = root.scrollTop;
  renderReport(root, d);
  const ex = document.createElement('section');
  ex.className = 'section';
  ex.innerHTML = `<h2>Export</h2><div class="export-row">
    <button class="btn" id="btn-json">Results (JSON)</button>
    <button class="btn" id="btn-csv">Summary (CSV)</button></div>`;
  root.appendChild(ex);
  $('btn-json').addEventListener('click', () => download(`hipcreep-${d.c.caseId}.json`, resultsJson(d, VERSION)));
  $('btn-csv').addEventListener('click', () => download(`hipcreep-${d.c.caseId}.csv`, resultsCsv(d), 'text/csv'));
  root.scrollTop = top;
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  const btn = $<HTMLButtonElement>('btn-run');
  btn.disabled = true;
  const bar = $('progress-bar');
  const status = $('run-status');
  try {
    const r = readForm(caseInput, ui);
    caseInput = r.c;
    ui = r.ui;
    status.textContent = 'Deterministic table…';
    bar.style.width = '2%';
    await yieldTask();
    const det = runDeterministic(caseInput);
    status.textContent = 'Monte Carlo…';
    const mc = await computeMonteCarlo(caseInput, (f) => { bar.style.width = `${(2 + 93 * f).toFixed(1)}%`; });
    const surf = loaded ? surfaceFor(loaded, ui) : null;
    bar.style.width = '100%';
    lastReport = { c: caseInput, ui, det, mc, loaded, surface: surf?.surface ?? null, elevation: surf?.elevation ?? null };
    render(lastReport);
    status.textContent = `Done: ${mc.n} samples in ${(mc.elapsedMs / 1000).toFixed(1)} s.`;
  } catch (e) {
    console.error(e);
    status.textContent = `Error: ${(e as Error).message}`;
  } finally {
    running = false;
    btn.disabled = false;
    setTimeout(() => { bar.style.width = '0'; }, 800);
  }
}

$('btn-run').addEventListener('click', () => void run());
setFileInfo();
