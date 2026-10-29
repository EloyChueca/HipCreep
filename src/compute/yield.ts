// ============================================================
// HipCreep — yield to the event loop without timers
// ------------------------------------------------------------
// Browsers throttle setTimeout in background tabs (≥ 1 s per call, and once a
// minute after 5 min hidden), which stalls a long Monte Carlo that yields
// between chunks. A MessageChannel message is not a timer and is not throttled.
// ============================================================

let channel: MessageChannel | null = null;
const queue: (() => void)[] = [];

export function yieldTask(): Promise<void> {
  // Node (tests, validation): setImmediate; an open MessageChannel would keep the process alive
  const si = (globalThis as any).setImmediate as ((f: () => void) => void) | undefined;
  if (typeof si === 'function') return new Promise((r) => si(r));
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => { queue.shift()?.(); };
  }
  return new Promise((r) => { queue.push(r); channel!.port2.postMessage(0); });
}
