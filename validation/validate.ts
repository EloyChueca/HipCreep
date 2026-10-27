// HipCreep — validation against published creep data (run: npm run validate).
// Data sources: Lee & Pienkowski 1998, Takahashi et al. 2016, Estok et al. 2005, Bevill et al. 2005,
// Rochcongar et al. 2021, Galetz & Glatzel 2010, Bergmann et al. 2001 — see docs/VALIDATION.md.
import { defaultCase, type CaseInput } from '../src/model/case.ts';
import { sampleParams, nominalParams, type ScenarioParams } from '../src/model/analysis.ts';
import { simulate, RES_MC, RES_FINE } from '../src/model/creep.ts';
import { LAWS, type LawId, type Loading } from '../src/model/laws.ts';
import { shiftFactor } from '../src/model/temperature.ts';
import { recoveredFraction } from '../src/model/recovery.ts';
import { mulberry32, summarize } from '../src/model/stats.ts';
import fs from 'node:fs';

const G = 9.80665;
const LAW_IDS: LawId[] = ['lee2003', 'deng1998', 'lewis2001'];
const out: any = {};
const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// ------------------------------------------------------------ helpers
interface Setup { forceN: number; tempC: number; headD: number; t: number; clearance: { nominal: number; lo: number; hi: number };
  loadAngle: number; material: CaseInput['material']; E?: { nominal: number; lo: number; hi: number }; nu?: { nominal: number; lo: number; hi: number }; tSd?: number }

function makeCase(s: Setup): CaseInput {
  const c = defaultCase();
  c.bodyMassKg = 80;
  const bw = s.forceN / (c.bodyMassKg * G);
  c.peakForceBW = { nominal: bw, lo: bw, hi: bw };
  c.headDiameterMm = s.headD; c.thicknessMm = s.t; c.thicknessSdMm = s.tSd ?? 0.05;
  c.clearance = s.clearance; c.loadAngleDeg = s.loadAngle; c.material = s.material; c.inVivoTempC = s.tempC;
  if (s.E) c.E = s.E; if (s.nu) c.nu = s.nu;
  return c;
}

function sim(c: CaseInput, p: ScenarioParams, law: LawId, mode: Loading, timeS: number, fine = false) {
  return simulate({
    law: LAWS[law], lawOpt: { leeExtrapolation: p.leeExtrapolation }, mode, forceN: p.forceBW * c.bodyMassKg * G, timeS,
    dynStaticRatio: p.dynStaticRatio, tempC: c.inVivoTempC, eaKcal: p.eaKcal, materialFactor: p.materialFactor, kappa: c.kappa,
    geometry: { headRadiusMm: c.headDiameterMm / 2, clearanceMm: p.clearanceMm, thicknessMm: p.thicknessMm, loadAngleDeg: c.loadAngleDeg, coverageDeg: c.coverageDeg },
    elastic: { E: p.E, nu: p.nu }, res: fine ? RES_FINE : RES_MC, conform: c.conform, history: true,
  });
}

/** creep (µm) at time t (s) from a history, log-time interpolation */
function at(h: { tS: Float64Array; maxCreepMm: Float64Array }, t: number): number {
  const T = h.tS, W = h.maxCreepMm;
  if (t <= T[0]) return W[0] * 1000 * (T[0] > 0 ? t / T[0] : 0);
  for (let i = 1; i < T.length; i++) if (T[i] >= t) {
    const a = Math.log(T[i - 1]), b = Math.log(T[i]), x = (Math.log(t) - a) / (b - a || 1);
    return 1000 * (W[i - 1] + x * (W[i] - W[i - 1]));
  }
  return W[W.length - 1] * 1000;
}

/** Deterministic per law (nominal params) + Monte Carlo pooled; returns creep (µm) at the requested times */
function run(s: Setup, mode: Loading, timeEndS: number, times: number[], n = 400, post?: (w: number[], p: ScenarioParams) => number[]) {
  const c = makeCase(s);
  const pn = nominalParams(c);
  const det: Record<string, number[]> = {};
  for (const law of LAW_IDS) {
    const r = sim(c, pn, law, mode, timeEndS, true);
    let w = times.map((t) => at(r.history!, t));
    if (post) w = post(w, pn);
    det[law] = w;
  }
  const rng = mulberry32(777);
  const nOut = det[LAW_IDS[0]].length;
  const samples: number[][] = Array.from({ length: nOut }, () => []);
  const byLaw: Record<string, number[][]> = Object.fromEntries(LAW_IDS.map((l) => [l, Array.from({ length: nOut }, () => [] as number[])]));
  for (let i = 0; i < n; i++) {
    const law = LAW_IDS[Math.min(2, Math.floor(rng() * 3))];
    const p = sampleParams(c, rng);
    const r = sim(c, p, law, mode, timeEndS);
    let w = times.map((t) => at(r.history!, t));
    if (post) w = post(w, p);
    w.forEach((v, k) => { samples[k].push(v); byLaw[law][k].push(v); });
  }
  return { det, mc: samples.map((a) => summarize(Float64Array.from(a))), byLaw: Object.fromEntries(LAW_IDS.map((l) => [l, byLaw[l].map((a) => summarize(Float64Array.from(a)))])), samples };
}

// ============================================================ V1 — Lee & Pienkowski 1998 (material, static, 36.5 °C)
{
  const T = 36.5, k = 0.65;
  const rows: any[] = [];
  for (const P of [2, 4, 8]) {
    const slope = { 2: 1.406e-3, 4: 2.707e-3, 8: 6.128e-3 }[P]!;
    const e10k = 3.491e-3 * P;
    for (const tMin of [10, 100, 1000, 10000]) {
      const meas = e10k + slope * (Math.log10(tMin) - 4);
      const t = tMin * 60;
      const lee = LAWS.lee2003.strain(P / k, t, { leeExtrapolation: 'cap' });            // static ≈ dynamic at P/k
      const leeK = [0.70, 0.61].map((kk) => LAWS.lee2003.strain(P / kk, t, { leeExtrapolation: 'cap' }));
      const deng = LAWS.deng1998.strain(P, t * shiftFactor(T, 37, 53.7), { leeExtrapolation: 'cap' });
      const lewis = [19.3, 53.7].map((ea) => LAWS.lewis2001.strain(P, t * shiftFactor(T, 22, ea), { leeExtrapolation: 'cap' }));
      rows.push({ P, tMin, meas, lee, leeK, deng, lewis });
    }
  }
  out.lee1998 = rows;
  console.log('\n=== V1 Lee & Pienkowski 1998 — static compression, unirradiated GUR 4150HP, 36.5 °C (strain %) ===');
  console.log('P  t(min)  measured | Lee2003→static (k .65 [.70–.61]) | Deng 1998 | Lewis 2001 (Ea 19.3 / 53.7)');
  for (const r of rows) console.log(`${r.P}  ${String(r.tMin).padStart(5)}  ${(r.meas * 100).toFixed(2)}   | ${(r.lee * 100).toFixed(2)} [${(r.leeK[0] * 100).toFixed(2)}–${(r.leeK[1] * 100).toFixed(2)}] | ${(r.deng * 100).toFixed(3)} | ${(r.lewis[0] * 100).toFixed(2)} / ${(r.lewis[1] * 100).toFixed(2)}`);
}

// ============================================================ V2 — Takahashi 2016 (liners, static 3000 N, 25 °C, 72 h)
{
  console.log('\n=== V2 Takahashi 2016 — static 3000 N, 25 °C, 4320 min; creep strain rate (10⁻³ per decade of minutes) ===');
  const cases = [
    { mat: 'conventional', name: 'ArCom', d: 28, t: 4.8, meas: 5.51 }, { mat: 'conventional', name: 'ArCom', d: 32, t: 4.8, meas: 4.40 },
    { mat: 'conventional', name: 'ArCom', d: 28, t: 6.8, meas: 4.60 }, { mat: 'conventional', name: 'ArCom', d: 28, t: 8.9, meas: 4.19 },
    { mat: 'vite-hxlpe', name: 'E1', d: 28, t: 4.8, meas: 4.76 }, { mat: 'vite-hxlpe', name: 'E1', d: 32, t: 4.8, meas: 3.60 },
    { mat: 'vite-hxlpe', name: 'E1', d: 36, t: 4.8, meas: 3.44 }, { mat: 'vite-hxlpe', name: 'E1', d: 28, t: 6.8, meas: 3.88 },
    { mat: 'vite-hxlpe', name: 'E1', d: 28, t: 8.9, meas: 3.52 },
  ] as const;
  const t1 = 10 * 60, t2 = 4320 * 60, dec = Math.log10(4320 / 10);
  out.takahashi = [];
  for (const cs of cases) {
    const s: Setup = { forceN: 3000, tempC: 25, headD: cs.d, t: cs.t, clearance: { nominal: 0.05, lo: 0.0, hi: 0.15 }, loadAngle: 48, material: cs.mat as any };
    const r = run(s, 'static', t2, [t1, t2], 300);
    const rate = (w: number[]) => ((w[1] - w[0]) / 1000) / dec / cs.t * 1000; // 10⁻³ / decade
    const det = Object.fromEntries(LAW_IDS.map((l) => [l, rate(r.det[l])]));
    const mcRates = r.samples[0].map((_, i) => rate([r.samples[0][i], r.samples[1][i]]));
    const st = summarize(Float64Array.from(mcRates));
    const abs = r.mc[1];
    out.takahashi.push({ ...cs, det, mc: st, absUm: abs });
    console.log(`${cs.name.padEnd(5)} Ø${cs.d} t${cs.t}: measured ${cs.meas.toFixed(2)} | Lee ${det.lee2003.toFixed(2)}  Deng ${det.deng1998.toFixed(2)}  Lewis ${det.lewis2001.toFixed(2)} | MC ${st.p50.toFixed(2)} (${st.p5.toFixed(2)}–${st.p95.toFixed(2)}) | penetration @72h MC ${f(abs.p50)} µm (${f(abs.p5)}–${f(abs.p95)})`);
  }
}

// ============================================================ V3 — Estok 2005 (liners, cyclic 3330 N 2 Hz no motion, 37 °C)
{
  console.log('\n=== V3 Estok 2005 — cyclic 3330 N peak, 2 Hz, no motion, 37 °C; penetration (µm) measured after 48 h rest ===');
  const cases = [
    { mat: 'conventional', d: 32, t: 9, meas: { 1e4: 38, 2e6: 87, 4e6: 97 } },
    { mat: 'hxlpe', d: 32, t: 9, meas: { 1e4: 38, 2e6: 97, 4e6: 107 } },
    { mat: 'conventional', d: 28, t: 10.25, meas: { 1e4: 25, 2e6: 112, 4e6: 132 } },
    { mat: 'hxlpe', d: 28, t: 10.25, meas: { 1e4: 27, 2e6: 131, 4e6: 155 } },
  ] as const;
  const Ns = [1e4, 2e6, 4e6];
  out.estok = [];
  for (const cs of cases) {
    for (const timeRule of ['time', 'cycles'] as const) {
      // loading time: N/2 s (2 Hz, law in time) or N s (one 1 Hz-equivalent cycle per cycle)
      const toT = (N: number) => (timeRule === 'time' ? N / 2 : N);
      const s: Setup = { forceN: 3330, tempC: 37, headD: cs.d, t: cs.t, clearance: { nominal: 0.05, lo: 0.0, hi: 0.15 }, loadAngle: 10, material: cs.mat as any };
      const c = makeCase(s);
      const post = (w: number[], p: ScenarioParams) => {
        const R = recoveredFraction({ r10k: p.r10k, timeS: 48 * 3600, tempC: 22, eaKcal: p.eaKcal, kinetics: p.recoveryKinetics });
        return [...w, ...w.map((x) => x * (1 - R))];
      };
      const r = run(s, 'dynamic', toT(4e6), Ns.map(toT), 300, post);
      const row: any = { ...cs, timeRule, det: r.det, mc: r.mc };
      out.estok.push(row);
      const D = (l: string) => Ns.map((_, k) => `${f(r.det[l][k + 3])}`).join('/');
      console.log(`${cs.mat.padEnd(12)} Ø${cs.d} [${timeRule}] measured ${Ns.map((N) => (cs.meas as any)[N]).join('/')} | rem. after 48 h: Lee ${D('lee2003')} Deng ${D('deng1998')} Lewis ${D('lewis2001')} | MC rem ${Ns.map((_, k) => `${f(r.mc[k + 3].p50)} (${f(r.mc[k + 3].p5)}–${f(r.mc[k + 3].p95)})`).join(' / ')} | MC Cmax@4M ${f(r.mc[2].p50)}`);
    }
  }
}

// ============================================================ V4 — Bevill 2005 (FE, 2000 min of gait loading, trends)
{
  console.log('\n=== V4 Bevill 2005 — trends of creep penetration (static 2000 min, 1500 N, 37 °C, virgin, E 1400, ν 0.3) ===');
  const base: Setup = { forceN: 1500, tempC: 37, headD: 32, t: 8, clearance: { nominal: 0.1, lo: 0.1, hi: 0.1 }, loadAngle: 25, material: 'virgin',
    E: { nominal: 1400, lo: 1400, hi: 1400 }, nu: { nominal: 0.3, lo: 0.3, hi: 0.3 } };
  const T = 2000 * 60;
  const one = (s: Setup) => { const r = run(s, 'static', T, [T], 150); return { det: Object.fromEntries(LAW_IDS.map((l) => [l, r.det[l][0]])), mc: r.mc[0] }; };
  out.bevill = { head: [], thick: [], clear: [] } as any;
  const line = (lab: string, r: any) => console.log(`${lab.padEnd(18)} Lee ${f(r.det.lee2003)}  Deng ${f(r.det.deng1998)}  Lewis ${f(r.det.lewis2001)} | MC ${f(r.mc.p50)} (${f(r.mc.p5)}–${f(r.mc.p95)}) µm`);
  for (const d of [22, 28, 32, 36]) { const r = one({ ...base, headD: d }); out.bevill.head.push({ d, ...r }); line(`head ${d} (t 8)`, r); }
  for (const t of [4, 8, 12, 16]) { const r = one({ ...base, t }); out.bevill.thick.push({ t, ...r }); line(`thick ${t} (Ø32)`, r); }
  for (const cd of [0.01, 0.1, 0.2, 0.5]) { const cl = cd / 2; const r = one({ ...base, t: 12, clearance: { nominal: cl, lo: cl, hi: cl } }); out.bevill.clear.push({ cd, ...r }); line(`diam. cl ${cd} (t12)`, r); }
}

// ============================================================ V5 — Rochcongar 2021 (RSA in vivo, 7 d → 1 y)
{
  console.log('\n=== V5 Rochcongar 2021 — in vivo RSA, penetration 7 d → 1 y (µm); creep ≈ penetration − first-year wear ===');
  out.rochcongar = [];
  const yr = 365.25 * 86400, d7 = 7 * 86400;
  for (const mat of ['virgin', 'conventional', 'vite-hxlpe'] as const) {
    for (const mode of ['dynamic', 'static'] as const) {
      const s: Setup = { forceN: 2.5 * 78 * G, tempC: 37, headD: 28, t: 10, clearance: { nominal: 0.05, lo: 0.0, hi: 0.15 }, loadAngle: 20, material: mat, tSd: 1.5 };
      // dynamic: 1 M cycles/year at 1 Hz → loading time ∝ calendar time
      const scale = mode === 'dynamic' ? 1e6 / yr : 1;
      const r = run(s, mode, yr * scale, [d7 * scale, yr * scale], 300);
      const diff = r.samples[0].map((_, i) => r.samples[1][i] - r.samples[0][i]);
      const st = summarize(Float64Array.from(diff));
      const det = Object.fromEntries(LAW_IDS.map((l) => [l, r.det[l][1] - r.det[l][0]]));
      out.rochcongar.push({ mat, mode, det, mc: st });
      console.log(`${mat.padEnd(12)} ${mode.padEnd(7)} Lee ${f(det.lee2003)} Deng ${f(det.deng1998)} Lewis ${f(det.lewis2001)} | MC ${f(st.p50)} (${f(st.p5)}–${f(st.p95)})`);
    }
  }
  console.log('measured: penetration 1 y = 160 (VE-HXLPE) / 200 (UHMWPE); wear 1–5 y = 20 / 60 µm/y → creep+bedding ≈ 140 / 140 µm');
}

// ============================================================ V6 — temperature: Galetz 2010, Bergmann 2001
{
  console.log('\n=== V6 Temperature shift ===');
  for (const ea of [19.3, 36.5, 53.7]) console.log(`Ea ${ea} kcal/mol: aT(37 vs 23) = ${shiftFactor(37, 23, ea).toFixed(1)}  aT(45 vs 23) = ${shiftFactor(45, 23, ea).toFixed(1)}  aT(37 vs 22) = ${shiftFactor(37, 22, ea).toFixed(1)}`);
  console.log('Galetz 2010 tribological test: same deformation 3 M cycles @23 °C ≈ 0.9 M @37 °C ≈ 0.5 M @45 °C → aT ≈ 3.3 and 6');
  const ea37 = Math.log(3 / 0.9) * 1.98720425864083e-3 / (1 / 296.15 - 1 / 310.15);
  const ea45 = Math.log(3 / 0.5) * 1.98720425864083e-3 / (1 / 296.15 - 1 / 318.15);
  console.log(`  → implied Ea ≈ ${ea37.toFixed(1)} (37 °C) and ${ea45.toFixed(1)} (45 °C) kcal/mol; Eyring yield Ea ≈ 200 kJ/mol = ${(200 / 4.184).toFixed(1)} kcal/mol`);
  out.galetz = { ea37, ea45 };
  // Bergmann: walking raises the head to 40–43 °C (mean 41.3). Dynamic creep sensitivity:
  const s: Setup = { forceN: 2.5 * 80 * G, tempC: 37, headD: 28, t: 8, clearance: { nominal: 0.05, lo: 0, hi: 0.15 }, loadAngle: 20, material: 'conventional' };
  const T = 0.5e6;  // 6 months of walking at 1 Hz
  const r37 = run(s, 'dynamic', T, [T], 300), r41 = run({ ...s, tempC: 41.3 }, 'dynamic', T, [T], 300);
  console.log(`Dynamic creep, 6 months: 37 °C ${f(r37.mc[0].p50)} (${f(r37.mc[0].p5)}–${f(r37.mc[0].p95)}) µm vs 41.3 °C ${f(r41.mc[0].p50)} (${f(r41.mc[0].p5)}–${f(r41.mc[0].p95)}) µm`);
  console.log(`  per law at 37 / 41.3 °C: ${LAW_IDS.map((l) => `${l} ${f(r37.det[l][0])}/${f(r41.det[l][0])}`).join('  ')}`);
  out.bergmann = { r37: r37.mc[0], r41: r41.mc[0], det37: r37.det, det41: r41.det };
}

fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 1));
