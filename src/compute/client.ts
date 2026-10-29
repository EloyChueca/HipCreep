// ============================================================
// HipCreep — run the heavy computations in a Web Worker
// ------------------------------------------------------------
// Falls back to the main thread if the worker cannot be started (old browser,
// page opened from file://). While a computation runs, the page holds a Web
// Lock, which also asks the browser not to freeze the background tab.
// ============================================================

import type { CaseInput } from '../model/case.ts';
import type { LoadedHipWearCase } from '../io/hipwear.ts';
import { runMonteCarlo, type McResult } from '../model/analysis.ts';
import { runSeriesCase, type SeriesResult } from '../model/series.ts';

type SeriesOpt = { refRadius: 'measured' | 'commercial'; rimBandDeg: number; loadZoneMarginDeg?: number; radiusUncUm?: number };

export type WorkerRequest =
  | { id: number; type: 'mc'; c: CaseInput }
  | { id: number; type: 'series'; c: CaseInput; L: LoadedHipWearCase; opt: SeriesOpt };
export type WorkerResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; message: string };

/** A request without its id (distributes over the union) */
type NewRequest = WorkerRequest extends infer T ? (T extends WorkerRequest ? Omit<T, 'id'> : never) : never;

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const m = ev.data, p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.progress?.(m.fraction);
    else { pending.delete(m.id); m.type === 'done' ? p.resolve(m.result) : p.reject(new Error(m.message)); }
  };
  worker.onerror = (ev) => {
    // The worker script failed to load or crashed: reject what is pending and use the main thread from now on
    ev.preventDefault?.();
    workerBroken = true;
    worker?.terminate();
    worker = null;
    const err = new Error('worker-failed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return worker;
}

function inWorker<T>(req: NewRequest, progress?: (f: number) => void): Promise<T> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    w.postMessage({ ...req, id } as WorkerRequest);
  });
}

/** Hold a Web Lock while `fn` runs (browsers avoid freezing tabs that hold one) */
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as any).locks;
  if (!locks?.request) return fn();
  return locks.request('hipcreep-compute', { mode: 'shared' }, fn);
}

async function run<T>(req: NewRequest, fallback: () => Promise<T>, progress?: (f: number) => void): Promise<T> {
  return withLock(async () => {
    const p = inWorker<T>(req, progress);
    if (!p) return fallback();
    try {
      return await p;
    } catch (e) {
      if ((e as Error).message === 'worker-failed') return fallback();
      throw e;
    }
  });
}

export function computeMonteCarlo(c: CaseInput, progress?: (f: number) => void): Promise<McResult> {
  return run<McResult>({ type: 'mc', c }, () => runMonteCarlo(c, progress), progress);
}

export function computeSeriesCase(c: CaseInput, L: LoadedHipWearCase, opt: SeriesOpt): Promise<SeriesResult> {
  return run<SeriesResult>({ type: 'series', c, L, opt }, () => runSeriesCase(c, L, opt));
}

/** True when computations run in the worker (for the status line) */
export function workerActive(): boolean { return !!worker && !workerBroken; }
