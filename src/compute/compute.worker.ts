// ============================================================
// HipCreep — computation worker
// ------------------------------------------------------------
// Runs the Monte Carlo and the per-liner series analysis off the page's main
// thread, so the calculation keeps its speed when the tab is in the background
// and the page stays responsive while it runs.
// ============================================================

import { runMonteCarlo } from '../model/analysis.ts';
import { runSeriesCase } from '../model/series.ts';
import type { WorkerRequest, WorkerResponse } from './client.ts';

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const q = ev.data;
  try {
    if (q.type === 'mc') {
      const mc = await runMonteCarlo(q.c, (f) => post({ id: q.id, type: 'progress', fraction: f }));
      post({ id: q.id, type: 'done', result: mc });
    } else if (q.type === 'series') {
      const r = await runSeriesCase(q.c, q.L, q.opt);
      post({ id: q.id, type: 'done', result: r });
    }
  } catch (e) {
    post({ id: q.id, type: 'error', message: (e as Error).message ?? String(e) });
  }
};
