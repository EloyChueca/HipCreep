// ============================================================
// HipCreep — native Excel charts (DrawingML chart parts)
// ------------------------------------------------------------
// Builds the XML of an editable chart whose series point at worksheet cells
// (c:numRef / c:strRef with the formula and a cache of the values, so the
// chart shows before the program recalculates). Two layouts:
//   • 'category': liners on the horizontal axis (names from cells), bars with
//     custom error bars + marker-only line series (measured D, limits…);
//   • 'scatter' : x/y values, custom error bars, and a text label per point
//     (the liner name).
// Element order follows the ECMA-376 schema (Excel is strict about it).
// ============================================================

import { xmlEsc } from './xlsx.ts';

/** Numbers in a sheet range, with their current values (null = empty cell) */
export interface NumRef { f: string; cache: (number | null)[] }
/** Text in a sheet range or cell */
export interface StrRef { f: string; cache: string[] }

export type MarkerSymbol = 'circle' | 'diamond' | 'triangle' | 'square' | 'dash' | 'x' | 'none';

export interface ErrBars {
  /** Distance above / right of the point, and below / left (cell ranges) */
  plus: NumRef;
  minus: NumRef;
  /** Scatter only: direction of the bars (default y) */
  dir?: 'x' | 'y';
  color?: string;
  widthPt?: number;
  noEndCap?: boolean;
}

export interface ChartSeries {
  kind: 'bar' | 'line' | 'scatter';
  /** Series name: a header cell or a fixed text */
  name: StrRef | string;
  /** Hex colour without # */
  color: string;
  marker?: MarkerSymbol;
  markerSize?: number;
  /** Marker without fill (outline only) */
  hollow?: boolean;
  /** Category layout: values per liner */
  val?: NumRef;
  /** Scatter layout */
  x?: NumRef;
  y?: NumRef;
  err?: ErrBars;
  /** Bar transparency 0–1 */
  alpha?: number;
  /** Text label of each point (index = point index); null/'' = no label */
  labels?: (string | null)[];
}

export interface ChartSpec {
  title: string;
  layout: 'category' | 'scatter';
  /** Category layout: the liner names */
  categories?: StrRef;
  series: ChartSeries[];
  xTitle?: string;
  yTitle?: string;
  logY?: boolean;
  /** Scatter: lower bound of the x axis (default 0) */
  xMin?: number;
}

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function numRef(r: NumRef): string {
  const pts = r.cache.map((v, i) => (v != null && Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
  return `<c:numRef><c:f>${xmlEsc(r.f)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${r.cache.length}"/>${pts}</c:numCache></c:numRef>`;
}
function strRef(r: StrRef): string {
  const pts = r.cache.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(v)}</c:v></c:pt>`).join('');
  return `<c:strRef><c:f>${xmlEsc(r.f)}</c:f><c:strCache><c:ptCount val="${r.cache.length}"/>${pts}</c:strCache></c:strRef>`;
}
const tx = (n: StrRef | string) => typeof n === 'string'
  ? `<c:tx><c:v>${xmlEsc(n)}</c:v></c:tx>`
  : `<c:tx>${strRef(n)}</c:tx>`;

function rich(text: string, sz = 1000, bold = false): string {
  return `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${sz}" b="${bold ? 1 : 0}"/><a:t>${xmlEsc(text)}</a:t></a:r></a:p></c:rich></c:tx>`;
}
const title = (t: string, sz = 1200) => `<c:title>${rich(t, sz, true)}<c:overlay val="0"/></c:title>`;
const solid = (hex: string, alpha?: number) => `<a:solidFill><a:srgbClr val="${hex}">${alpha != null && alpha < 1 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : ''}</a:srgbClr></a:solidFill>`;
const line = (hex: string | null, wPt = 1) => hex ? `<a:ln w="${Math.round(wPt * 12700)}">${solid(hex)}</a:ln>` : '<a:ln><a:noFill/></a:ln>';

function marker(s: ChartSeries): string {
  const sym = s.marker ?? 'none';
  if (sym === 'none') return '<c:marker><c:symbol val="none"/></c:marker>';
  const fill = s.hollow ? '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' : solid(s.color);
  return `<c:marker><c:symbol val="${sym}"/><c:size val="${s.markerSize ?? 7}"/><c:spPr>${fill}${line(s.color, 1.25)}</c:spPr></c:marker>`;
}

function errBars(e: ErrBars | undefined, seriesColor: string, withDir: boolean): string {
  if (!e) return '';
  return '<c:errBars>'
    + (withDir ? `<c:errDir val="${e.dir ?? 'y'}"/>` : '')
    + '<c:errBarType val="both"/><c:errValType val="cust"/>'
    + `<c:noEndCap val="${e.noEndCap ? 1 : 0}"/>`
    + `<c:plus>${numRef(e.plus)}</c:plus><c:minus>${numRef(e.minus)}</c:minus>`
    + `<c:spPr>${line(e.color ?? seriesColor, e.widthPt ?? 1)}</c:spPr></c:errBars>`;
}

/** One label per point (e.g. the liner name), written as label text so that Excel, LibreOffice and
 *  Google Sheets all show it; points without a label (empty cells) get none */
function pointLabels(s: ChartSeries): string {
  if (!s.labels) return '';
  const flags = (v: number) => `<c:showLegendKey val="0"/><c:showVal val="${v}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>`;
  const txPr = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
  const one = s.labels.map((t, i) => t
    ? `<c:dLbl><c:idx val="${i}"/><c:layout/><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="800"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:rPr><a:t>${xmlEsc(t)}</a:t></a:r></a:p></c:rich></c:tx>`
      + `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:dLblPos val="r"/>${flags(1)}</c:dLbl>`
    : `<c:dLbl><c:idx val="${i}"/><c:delete val="1"/></c:dLbl>`).join('');
  return `<c:dLbls>${one}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr}<c:dLblPos val="r"/>${flags(0)}</c:dLbls>`;
}

function serXml(s: ChartSeries, i: number, cats: StrRef | undefined): string {
  const head = `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(s.name)}`;
  if (s.kind === 'bar') {
    return head + `<c:spPr>${solid(s.color, s.alpha)}${line(null)}</c:spPr><c:invertIfNegative val="0"/>`
      + errBars(s.err, s.color, false)
      + (cats ? `<c:cat>${strRef(cats)}</c:cat>` : '') + `<c:val>${numRef(s.val!)}</c:val></c:ser>`;
  }
  if (s.kind === 'line') {
    return head + `<c:spPr>${line(null)}</c:spPr>${marker(s)}` + pointLabels(s)
      + errBars(s.err, s.color, true)
      + (cats ? `<c:cat>${strRef(cats)}</c:cat>` : '') + `<c:val>${numRef(s.val!)}</c:val><c:smooth val="0"/></c:ser>`;
  }
  return head + `<c:spPr>${line(null)}</c:spPr>${marker(s)}` + pointLabels(s)
    + errBars(s.err, s.color, true)
    + `<c:xVal>${numRef(s.x!)}</c:xVal><c:yVal>${numRef(s.y!)}</c:yVal><c:smooth val="0"/></c:ser>`;
}

const AX_TXT = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
const GRID = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E3E3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
const AX_LINE = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></a:ln></c:spPr>';

function valAx(id: number, cross: number, pos: 'l' | 'b', t: string | undefined, opt: { log?: boolean; min?: number; grid?: boolean; crossBetween?: boolean }): string {
  return `<c:valAx><c:axId val="${id}"/><c:scaling>${opt.log ? '<c:logBase val="10"/>' : ''}<c:orientation val="minMax"/>${opt.min != null ? `<c:min val="${opt.min}"/>` : ''}</c:scaling>`
    + `<c:delete val="0"/><c:axPos val="${pos}"/>${opt.grid ? GRID : ''}${t ? title(t, 1000) : ''}`
    + '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>'
    + `${AX_LINE}${AX_TXT}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/>`
    + `<c:crossBetween val="${opt.crossBetween ? 'between' : 'midCat'}"/></c:valAx>`;
}

/** The chart part (xl/charts/chartN.xml) */
export function chartXml(c: ChartSpec): string {
  let plot = '';
  if (c.layout === 'category') {
    const bars = c.series.filter((s) => s.kind === 'bar');
    const lines = c.series.filter((s) => s.kind === 'line');
    let k = 0;
    if (bars.length) {
      plot += '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
        + bars.map((s) => serXml(s, k++, c.categories)).join('')
        + '<c:gapWidth val="60"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>';
    }
    if (lines.length) {
      plot += '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
        + lines.map((s) => serXml(s, k++, c.categories)).join('')
        + '<c:marker val="1"/><c:axId val="1001"/><c:axId val="1002"/></c:lineChart>';
    }
    plot += '<c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>'
      + (c.xTitle ? title(c.xTitle, 1000) : '')
      + '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>'
      + `${AX_LINE}${AX_TXT}<c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + valAx(1002, 1001, 'l', c.yTitle, { log: c.logY, grid: true, crossBetween: true });
  } else {
    plot += '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>'
      + c.series.map((s, i) => serXml(s, i, undefined)).join('')
      + '<c:axId val="2001"/><c:axId val="2002"/></c:scatterChart>'
      + valAx(2001, 2002, 'b', c.xTitle, { min: c.xMin ?? 0 })
      + valAx(2002, 2001, 'l', c.yTitle, { log: c.logY, grid: true });
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + '<c:roundedCorners val="0"/>'
    + `<c:chart>${title(c.title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>`
    + '<c:legend><c:legendPos val="b"/><c:overlay val="0"/>' + AX_TXT + '</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
    + `<c:spPr>${solid('FFFFFF')}<a:ln><a:noFill/></a:ln></c:spPr>`
    + '</c:chartSpace>';
}
