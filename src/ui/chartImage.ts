// ============================================================
// HipCreep — chart card → PNG (for the Excel export)
// ------------------------------------------------------------
// A chart card on the page is a title, an explanation, an HTML legend and an
// SVG styled by the stylesheet. snapshotCard() reads all of it while the card
// is in the document (computed styles are copied into the SVG so it renders on
// its own); rasterize() draws title, explanation, legend and chart on a white
// canvas and returns the PNG bytes.
// ============================================================

export interface ChartSnapshot {
  title: string;
  sub: string;
  legend: { color: string | null; text: string }[];
  svg: string;
  w: number;
  h: number;
  font: string;
}

export interface ChartImage {
  title: string;
  sub: string;
  png: Uint8Array;
  /** Size in CSS pixels (the PNG is drawn at 2×) */
  width: number;
  height: number;
}

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap',
  'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline'];

/** Read a chart card (must be attached to the document) */
export function snapshotCard(card: HTMLElement): ChartSnapshot {
  const src = card.querySelector('svg') as SVGSVGElement | null;
  const vb = src?.viewBox?.baseVal;
  const w = vb && vb.width ? vb.width : 760, h = vb && vb.height ? vb.height : 300;
  let svgText = '';
  if (src) {
    const clone = src.cloneNode(true) as SVGSVGElement;
    const a = [src, ...Array.from(src.querySelectorAll('*'))];
    const b = [clone, ...Array.from(clone.querySelectorAll('*'))];
    a.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
      (b[i] as SVGElement).setAttribute('style', style);
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    clone.removeAttribute('class');
    svgText = new XMLSerializer().serializeToString(clone);
  }
  const legend = Array.from(card.querySelectorAll('.legend .item')).map((it) => {
    const sw = it.querySelector('.swatch') as HTMLElement | null;
    return { color: sw ? getComputedStyle(sw).backgroundColor : null, text: (it.textContent ?? '').trim() };
  });
  return {
    title: card.querySelector('.chart-title')?.textContent?.trim() ?? '',
    sub: card.querySelector('.chart-sub')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
    legend, svg: svgText, w, h,
    font: getComputedStyle(card).fontFamily || 'sans-serif',
  };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('chart image could not be drawn'));
    img.src = url;
  });
}

/** Draw a snapshot on a white canvas (2×) and return it as PNG */
export async function rasterize(s: ChartSnapshot, scale = 2): Promise<ChartImage> {
  const pad = 16, W = Math.max(s.w, 640) + 2 * pad;
  const measure = document.createElement('canvas').getContext('2d')!;
  const fTitle = `600 15px ${s.font}`, fSub = `12px ${s.font}`;
  measure.font = fSub;
  const subLines = s.sub ? wrap(measure, s.sub, W - 2 * pad) : [];
  // legend layout: items flow left to right, wrapping
  const legendRows: { x: number; item: ChartSnapshot['legend'][number] }[][] = [[]];
  let lx = 0;
  for (const it of s.legend) {
    const iw = (it.color ? 18 : 0) + measure.measureText(it.text).width + 18;
    if (lx + iw > W - 2 * pad && legendRows[legendRows.length - 1].length) { legendRows.push([]); lx = 0; }
    legendRows[legendRows.length - 1].push({ x: lx, item: it });
    lx += iw;
  }
  const nLegend = s.legend.length ? legendRows.length : 0;
  const yTitle = pad + 14, ySub = yTitle + 10, yLegend = ySub + subLines.length * 16 + 6;
  const yChart = yLegend + nLegend * 18 + 6;
  const H = Math.ceil(yChart + s.h + pad);

  const cv = document.createElement('canvas');
  cv.width = Math.ceil(W * scale); cv.height = Math.ceil(H * scale);
  const ctx = cv.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1f1f1f'; ctx.font = fTitle;
  ctx.fillText(s.title, pad, yTitle);
  ctx.fillStyle = '#5f5f5f'; ctx.font = fSub;
  subLines.forEach((l, i) => ctx.fillText(l, pad, ySub + 12 + i * 16));
  ctx.fillStyle = '#3f3f3f';
  legendRows.forEach((row, r) => {
    const y = yLegend + r * 18 + 12;
    for (const { x, item } of row) {
      let tx = pad + x;
      if (item.color) {
        ctx.fillStyle = item.color; ctx.fillRect(tx, y - 9, 12, 10); tx += 18;
      }
      ctx.fillStyle = '#3f3f3f'; ctx.fillText(item.text, tx, y);
    }
  });
  if (s.svg) {
    const url = URL.createObjectURL(new Blob([s.svg], { type: 'image/svg+xml' }));
    try {
      const img = await loadImage(url);
      ctx.drawImage(img, pad + (W - 2 * pad - s.w) / 2, yChart, s.w, s.h);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  return { title: s.title, sub: s.sub, png: new Uint8Array(await blob.arrayBuffer()), width: W, height: H };
}
