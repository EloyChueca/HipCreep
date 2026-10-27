// HipCreep — number formatting helpers

export function fmt(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x).toLocaleString('en-US');
  if (a >= 100) return x.toFixed(0);
  if (a >= 10) return x.toFixed(Math.max(0, digits - 1));
  if (a >= 1) return x.toFixed(digits);
  if (a === 0) return '0';
  return x.toPrecision(digits);
}

/** Short number for running text: trailing zeros removed (6 → "6", 0.050 → "0.05") */
export function num(x: number | null | undefined, sig = 3): string {
  if (x == null || !Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString('en-US');
  return String(+x.toPrecision(sig));
}

export const um = (x: number | null | undefined) => `${fmt(x)} µm`;
export const pct = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)} %`);

export function fmtTime(s: number): string {
  if (s < 120) return `${s.toFixed(0)} s`;
  if (s < 7200) return `${(s / 60).toFixed(0)} min`;
  if (s < 2 * 86400) return `${(s / 3600).toFixed(1)} h`;
  if (s < 60 * 86400) return `${(s / 86400).toFixed(1)} d`;
  if (s < 2 * 365.25 * 86400) return `${(s / (30.44 * 86400)).toFixed(1)} mo`;
  return `${(s / (365.25 * 86400)).toFixed(1)} y`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
