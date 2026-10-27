// ============================================================
// HipCreep — random numbers and summary statistics
// ============================================================

import type { Range } from './materials.ts';

/** Small, fast, seedable PRNG (mulberry32) — reproducible Monte Carlo runs */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniform(rng: () => number, r: Range): number {
  return r.lo + (r.hi - r.lo) * rng();
}

export function logUniform(rng: () => number, r: Range): number {
  if (!(r.lo > 0) || !(r.hi > 0)) return uniform(rng, r);
  return Math.exp(Math.log(r.lo) + (Math.log(r.hi) - Math.log(r.lo)) * rng());
}

export function normal(rng: () => number, mean: number, sd: number): number {
  if (!(sd > 0)) return mean;
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Stats {
  n: number;
  mean: number;
  sd: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  min: number;
  max: number;
}

export function percentile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

export function summarize(values: ArrayLike<number>): Stats {
  const arr = Array.from(values).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = arr.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, p5: NaN, p25: NaN, p50: NaN, p75: NaN, p95: NaN, min: NaN, max: NaN };
  let s = 0;
  for (const x of arr) s += x;
  const mean = s / n;
  let v = 0;
  for (const x of arr) v += (x - mean) * (x - mean);
  return {
    n,
    mean,
    sd: n > 1 ? Math.sqrt(v / (n - 1)) : 0,
    p5: percentile(arr, 0.05),
    p25: percentile(arr, 0.25),
    p50: percentile(arr, 0.5),
    p75: percentile(arr, 0.75),
    p95: percentile(arr, 0.95),
    min: arr[0],
    max: arr[n - 1],
  };
}

/** Standard normal pdf and cdf */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function normCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
