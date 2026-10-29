// ============================================================
// HipCreep — editable Excel charts for a series of liners
// ------------------------------------------------------------
// Sheet "Chart data": one row per liner with every value the charts use; the
// error-bar lengths are formulas on the percentile cells, so editing a value
// updates the table and the charts. Sheets "Dynamic", "Static" and
// "Comparison" hold native charts whose series point at those cells:
//   • per liner: remaining creep (L&P and long-loading medians, 90 % interval),
//     measured D ± 2 SD, detection limit and elevation bound;
//   • wear vs years in vivo (segment = the two recovery scenarios, as on the
//     page), one series per polyethylene, each point labelled with its liner;
//   • comparison: dynamic vs static for both charts.
// ============================================================

import type { Cell, Sheet, SheetChart } from '../io/xlsx.ts';
import { colName } from '../io/xlsx.ts';
import { chartXml, type ChartSeries, type NumRef, type StrRef } from '../io/xlsxChart.ts';
import type { SeriesResult } from '../model/series.ts';
import type { Loading } from '../model/laws.ts';

export const CHART_DATA_SHEET = 'Chart data';

const C = { lp: '2A78D6', long: 'EB6834', dyn: '2A78D6', stat: 'EB6834', D: '1F1F1F', lod: '8C8C8C', elev: '1BAF7A' };
const MAT_PALETTE = ['EB6834', '2A78D6', '1BAF7A', '8A5CD6', 'C9A227', '595959', 'C2185B', '00838F'];
const CHART_W = 780, CHART_H = 430;

const ok = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const round = (x: number | null | undefined, d = 1): number | null => (ok(x) ? Number(x.toFixed(d)) : null);
const shortMat = (r: SeriesResult) => r.materialLabel.split(',')[0].split(' (')[0].trim();

interface Col { key: string; head: string; cell: (r: SeriesResult, row: number) => Cell }

/** Build the data sheet and the three chart sheets */
export function seriesChartSheets(res: SeriesResult[]): Sheet[] {
  const n = res.length;
  const first = 2, last = first + n - 1;              // 1-based data rows (row 1 = headers)
  const cols: Col[] = [];
  const idx = new Map<string, number>();
  const add = (key: string, head: string, cell: Col['cell']) => { idx.set(key, cols.length); cols.push({ key, head, cell }); };
  const L = (key: string) => colName(idx.get(key)!);
  const ref = (key: string) => `'${CHART_DATA_SHEET}'!$${L(key)}$${first}:$${L(key)}$${last}`;

  // value of a column for liner i (numbers only; formulas give their cached value)
  const values = new Map<string, (number | null)[]>();
  const val = (key: string, i: number): number | null => values.get(key)?.[i] ?? null;

  // ---- base columns ----
  const meas = (r: SeriesResult) => (r.measured && !r.measured.notDetected ? r.measured : null);
  add('liner', 'Liner', (r) => r.caseId);
  add('mat', 'Polyethylene', (r) => shortMat(r));
  add('years', 'Years in vivo', (r) => round(r.years, 2));
  add('D', 'Measured penetration D (µm)', (r) => round(meas(r)?.penetrationUm));
  add('Dsd', 'SD of D (µm)', (r) => round(meas(r)?.sdUm));
  add('D2sd', '2 × SD of D (µm)', (r, row) => (meas(r) ? { f: `2*${L('Dsd')}${row}`, v: round(2 * meas(r)!.sdUm, 2) } : null));
  add('nd', 'D not detected', (r) => (r.measured?.notDetected ? 'yes' : r.measured ? 'no' : ''));
  add('lod', 'Detection limit (µm)', (r) => round(r.measured?.detectionLimitUm ?? null, 0));
  add('elev', 'Elevation bound: minimum remaining creep (µm)', (r) => round(r.elevationMinCreepUm?.nominal));

  const minusF = (lo: string, mid: string) => (_r: SeriesResult, row: number, i: number) =>
    ok(val(lo, i)) && ok(val(mid, i)) ? { f: `MAX(0,${L(mid)}${row}-${L(lo)}${row})`, v: round(Math.max(0, val(mid, i)! - val(lo, i)!), 2) } : null;
  const plusF = (mid: string, hi: string) => (_r: SeriesResult, row: number, i: number) =>
    ok(val(hi, i)) && ok(val(mid, i)) ? { f: `MAX(0,${L(hi)}${row}-${L(mid)}${row})`, v: round(Math.max(0, val(hi, i)! - val(mid, i)!), 2) } : null;

  const MODE_NAME: Record<Loading, string> = { dynamic: 'Dynamic', static: 'Static' };
  const groups = Array.from(new Set(res.map(shortMat)));
  // formula columns need the row index too: wrap
  const addI = (key: string, head: string, fn: (r: SeriesResult, row: number, i: number) => Cell) =>
    add(key, head, (r, row) => fn(r, row, row - first));

  for (const mode of ['dynamic', 'static'] as Loading[]) {
    const p = mode === 'dynamic' ? 'd' : 's', M = MODE_NAME[mode];
    const sc = (r: SeriesResult, k: 'lp' | 'long') => r.modes[mode].byScenario[k];
    for (const [k, lab] of [['lp', 'L&P'], ['long', 'long loading'], ['env', 'both scenarios']] as const) {
      const st = (r: SeriesResult) => (k === 'env' ? r.modes[mode].remaining : sc(r, k)?.remaining);
      add(`${p}_${k}_p5`, `${M} · remaining creep, ${lab} · P5 (µm)`, (r) => round(st(r)?.p5));
      add(`${p}_${k}_p50`, `${M} · remaining creep, ${lab} · median (µm)`, (r) => round(st(r)?.p50));
      add(`${p}_${k}_p95`, `${M} · remaining creep, ${lab} · P95 (µm)`, (r) => round(st(r)?.p95));
      addI(`${p}_${k}_minus`, `${M} · ${lab} · error bar below = median − P5`, minusF(`${p}_${k}_p5`, `${p}_${k}_p50`));
      addI(`${p}_${k}_plus`, `${M} · ${lab} · error bar above = P95 − median`, plusF(`${p}_${k}_p50`, `${p}_${k}_p95`));
    }
    add(`${p}_wlp`, `${M} · wear W, L&P · median (µm)`, (r) => round(sc(r, 'lp')?.wear?.p50));
    add(`${p}_wlong`, `${M} · wear W, long loading · median (µm)`, (r) => round(sc(r, 'long')?.wear?.p50));
    add(`${p}_w`, `${M} · wear W, both scenarios · median (µm)`, (r) => round(r.modes[mode].wear?.p50));
    add(`${p}_w_p5`, `${M} · wear W, both scenarios · P5 (µm)`, (r) => round(r.modes[mode].wear?.p5));
    add(`${p}_w_p95`, `${M} · wear W, both scenarios · P95 (µm)`, (r) => round(r.modes[mode].wear?.p95));
    const has3 = (i: number) => ok(val(`${p}_w`, i)) && ok(val(`${p}_wlp`, i)) && ok(val(`${p}_wlong`, i));
    addI(`${p}_wseg_minus`, `${M} · wear segment below = median − lower scenario median`, (_r, row, i) => has3(i)
      ? { f: `MAX(0,${L(`${p}_w`)}${row}-MIN(${L(`${p}_wlp`)}${row},${L(`${p}_wlong`)}${row}))`, v: round(Math.max(0, val(`${p}_w`, i)! - Math.min(val(`${p}_wlp`, i)!, val(`${p}_wlong`, i)!)), 2) } : null);
    addI(`${p}_wseg_plus`, `${M} · wear segment above = higher scenario median − median`, (_r, row, i) => has3(i)
      ? { f: `MAX(0,MAX(${L(`${p}_wlp`)}${row},${L(`${p}_wlong`)}${row})-${L(`${p}_w`)}${row})`, v: round(Math.max(0, Math.max(val(`${p}_wlp`, i)!, val(`${p}_wlong`, i)!) - val(`${p}_w`, i)!), 2) } : null);
    // one column per polyethylene (cells of the other liners stay empty, so each series has its own colour)
    groups.forEach((g, gi) => {
      const mine = (r: SeriesResult) => shortMat(r) === g;
      addI(`${p}_g${gi}_w`, `${M} · wear W median · ${g} (µm)`, (r, row, i) => mine(r) && ok(val(`${p}_w`, i)) ? { f: `${L(`${p}_w`)}${row}`, v: val(`${p}_w`, i) } : null);
      addI(`${p}_g${gi}_minus`, `${M} · segment below · ${g}`, (r, row, i) => mine(r) && ok(val(`${p}_wseg_minus`, i)) ? { f: `${L(`${p}_wseg_minus`)}${row}`, v: val(`${p}_wseg_minus`, i) } : null);
      addI(`${p}_g${gi}_plus`, `${M} · segment above · ${g}`, (r, row, i) => mine(r) && ok(val(`${p}_wseg_plus`, i)) ? { f: `${L(`${p}_wseg_plus`)}${row}`, v: val(`${p}_wseg_plus`, i) } : null);
    });
  }

  // ---- fill the table column by column (formulas read the values of earlier columns) ----
  const table: Cell[][] = res.map(() => []);
  cols.forEach((c, j) => {
    const vs: (number | null)[] = [];
    res.forEach((r, i) => {
      const cell = c.cell(r, first + i);
      table[i][j] = cell;
      vs.push(typeof cell === 'number' ? cell : cell && typeof cell === 'object' ? cell.v : null);
    });
    values.set(c.key, vs);
  });
  const dataSheet: Sheet = {
    name: CHART_DATA_SHEET, header: true,
    widths: cols.map((_c, j) => (j === 0 ? 16 : j === 1 ? 22 : 14)),
    rows: [cols.map((c) => c.head), ...table],
  };

  // ---- references ----
  const num = (key: string): NumRef => ({ f: ref(key), cache: values.get(key)! });
  const liners: StrRef = { f: ref('liner'), cache: res.map((r) => r.caseId) };
  /** Liner name on every point that has a value in that column */
  const labelsFor = (key: string) => res.map((r, i) => (ok(val(key, i)) ? r.caseId : null));
  const logFor = (keys: string[]) => {
    const meds = keys.flatMap((k) => values.get(k)!.filter(ok)).filter((v) => v > 0).sort((a, b) => a - b);
    if (!meds.length) return false;
    const max = Math.max(...keys.flatMap((k) => values.get(k)!.filter(ok)));
    return max > 20 * meds[Math.floor(meds.length / 2)];
  };
  const measured = (): ChartSeries[] => [
    { kind: 'line', name: 'Measured D ± 2 SD', color: C.D, marker: 'diamond', markerSize: 9, val: num('D'), err: { plus: num('D2sd'), minus: num('D2sd'), color: C.D, widthPt: 1.25 } },
    { kind: 'line', name: 'Detection limit', color: C.lod, marker: 'dash', markerSize: 14, val: num('lod') },
    { kind: 'line', name: 'Elevation bound (min. remaining creep)', color: C.elev, marker: 'triangle', markerSize: 8, val: num('elev') },
  ];
  const creepChart = (mode: Loading): string => {
    const p = mode === 'dynamic' ? 'd' : 's', M = MODE_NAME[mode];
    const keys = [`${p}_lp_p95`, `${p}_long_p95`, 'D', 'lod', 'elev', `${p}_lp_p50`, `${p}_long_p50`];
    const log = logFor(keys);
    return chartXml({
      title: `${M}: measured penetration vs remaining creep, per liner`, layout: 'category', categories: liners, logY: log,
      yTitle: log ? 'µm (log scale)' : 'µm', xTitle: 'liner',
      series: [
        { kind: 'bar', name: 'Remaining creep, L&P (median, 90 % interval)', color: C.lp, alpha: 0.75, val: num(`${p}_lp_p50`), err: { plus: num(`${p}_lp_plus`), minus: num(`${p}_lp_minus`), color: '1F4E8C' } },
        { kind: 'bar', name: 'Remaining creep, long loading (median, 90 % interval)', color: C.long, alpha: 0.75, val: num(`${p}_long_p50`), err: { plus: num(`${p}_long_plus`), minus: num(`${p}_long_minus`), color: '9C3D16' } },
        ...measured(),
      ],
    });
  };
  const wearChart = (mode: Loading): string => {
    const p = mode === 'dynamic' ? 'd' : 's', M = MODE_NAME[mode];
    return chartXml({
      title: `${M}: estimated wear vs time in vivo`, layout: 'scatter', xTitle: 'years in vivo', yTitle: 'estimated wear W (µm)',
      series: groups.map((g, gi) => ({
        kind: 'scatter' as const, name: g, color: MAT_PALETTE[gi % MAT_PALETTE.length], marker: 'circle' as const, markerSize: 8,
        x: num('years'), y: num(`${p}_g${gi}_w`),
        err: { plus: num(`${p}_g${gi}_plus`), minus: num(`${p}_g${gi}_minus`), widthPt: 2.25, noEndCap: true },
        labels: labelsFor(`${p}_g${gi}_w`),
      })),
    });
  };
  const compareCreep = (): string => {
    const keys = ['d_env_p95', 's_env_p95', 'D', 'lod', 'elev', 'd_env_p50', 's_env_p50'];
    const log = logFor(keys);
    return chartXml({
      title: 'Dynamic vs static: remaining creep per liner (both recovery scenarios)', layout: 'category', categories: liners, logY: log,
      yTitle: log ? 'µm (log scale)' : 'µm', xTitle: 'liner',
      series: [
        { kind: 'bar', name: 'Dynamic (median, 90 % interval)', color: C.dyn, alpha: 0.75, val: num('d_env_p50'), err: { plus: num('d_env_plus'), minus: num('d_env_minus'), color: '1F4E8C' } },
        { kind: 'bar', name: 'Static (median, 90 % interval)', color: C.stat, alpha: 0.75, val: num('s_env_p50'), err: { plus: num('s_env_plus'), minus: num('s_env_minus'), color: '9C3D16' } },
        ...measured(),
      ],
    });
  };
  const compareWear = (): string => chartXml({
    title: 'Dynamic vs static: estimated wear vs time in vivo', layout: 'scatter', xTitle: 'years in vivo', yTitle: 'estimated wear W (µm)',
    series: [
      { kind: 'scatter', name: 'Dynamic', color: C.dyn, marker: 'circle', markerSize: 8, x: num('years'), y: num('d_w'), err: { plus: num('d_wseg_plus'), minus: num('d_wseg_minus'), widthPt: 2.25, noEndCap: true }, labels: labelsFor('d_w') },
      { kind: 'scatter', name: 'Static', color: C.stat, marker: 'square', markerSize: 7, x: num('years'), y: num('s_w'), err: { plus: num('s_wseg_plus'), minus: num('s_wseg_minus'), widthPt: 2.25, noEndCap: true }, labels: labelsFor('s_w') },
    ],
  });

  const hasWear = (p: string) => (values.get(`${p}_w`) ?? []).some(ok);
  const CREEP_NOTE = 'Bars: median remaining creep at the scan; whiskers: 90 % interval (P5–P95). Diamond: measured D ± 2 SD (missing when not detected). Dash: detection limit. Triangle: minimum remaining creep from the elevations. Wear is the gap between D and the remaining creep.';
  const WEAR_NOTE = 'Dot: median wear (both recovery scenarios); vertical segment: from the long-loading to the L&P median (the recovery uncertainty). Labels: liner. 90 % intervals in the Chart data sheet.';
  const chartSheet = (name: string, heading: string, parts: { note: string; xml: string; title: string }[]): Sheet => {
    // explanations first, charts below them (a chart never covers a text row)
    const rows: Cell[][] = [[heading], [`Editable charts: the series point at the '${CHART_DATA_SHEET}' sheet (values in µm).`]];
    parts.forEach((p, i) => rows.push([`Chart ${i + 1} — ${p.title}: ${p.note}`]));
    const boldRows = [0];
    const charts: SheetChart[] = [];
    let r = rows.length + 2;
    for (const p of parts) {
      charts.push({ xml: p.xml, col: 0, row: r, widthPx: CHART_W, heightPx: CHART_H, name: p.title });
      r += Math.ceil(CHART_H / 15) + 4;
    }
    return { name, rows, boldRows, charts, fitWidth: true };
  };
  const modeSheet = (mode: Loading) => {
    const p = mode === 'dynamic' ? 'd' : 's', M = MODE_NAME[mode];
    const parts = [{ note: CREEP_NOTE, xml: creepChart(mode), title: `${M} creep per liner` }];
    if (hasWear(p)) parts.push({ note: WEAR_NOTE, xml: wearChart(mode), title: `${M} wear vs years` });
    return chartSheet(M, `${M} loading mode`, parts);
  };
  const cmpParts = [{ note: 'Remaining creep with both recovery scenarios pooled. ' + CREEP_NOTE.replace('Bars: median remaining creep at the scan; ', 'Bars: median; '), xml: compareCreep(), title: 'Dynamic vs static creep' }];
  if (hasWear('d') || hasWear('s')) cmpParts.push({ note: WEAR_NOTE.replace('Labels: liner.', 'Labels: liner (dynamic: circles, static: squares).'), xml: compareWear(), title: 'Dynamic vs static wear' });

  return [modeSheet('dynamic'), modeSheet('static'), chartSheet('Comparison', 'Dynamic vs static', cmpParts), dataSheet];
}
