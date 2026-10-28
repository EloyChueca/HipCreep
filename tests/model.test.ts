// HipCreep — regression tests of the analytic model (run with: npm test → node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAWS, RAW, DEFAULT_LAW_OPTIONS } from '../src/model/laws.ts';
import { shiftFactor, EA_BURGER_KCAL, EA_DENG_KCAL } from '../src/model/temperature.ts';
import { recoveredFraction, recoveryProgress } from '../src/model/recovery.ts';
import { simulate, RES_FINE, RES_MC, type SimInput } from '../src/model/creep.ts';
import { defaultCase } from '../src/model/case.ts';
import { runDeterministic, runMonteCarlo, verdict } from '../src/model/analysis.ts';
import { makePhantom } from '../src/io/phantom.ts';
import { parseHipWearInput } from '../src/io/hipwear.ts';
import { analyseSurface, elevationAnalysis, expectedExcess } from '../src/model/surface.ts';
import { summarize } from '../src/model/stats.ts';

const near = (a: number, b: number, rel: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg ?? ''} ${a} vs ${b} (±${rel * 100}%)`);

// ---------- Creep laws reproduce the published numbers ----------

test('Lee 2003: 8 MPa peak, 10⁴ min → 1.64·10⁻² (paper: 1.637·10⁻²)', () => {
  near(8 * RAW.leePerMPa(1e4), 1.637e-2, 0.02);
  // capped after 10⁴ min, continued with "log"
  const s = LAWS.lee2003;
  assert.equal(s.strain(8, 1e6 * 60, { leeExtrapolation: 'cap' }), s.strain(8, 1e4 * 60, { leeExtrapolation: 'cap' }));
  assert.ok(s.strain(8, 1e6 * 60, { leeExtrapolation: 'log' }) > s.strain(8, 1e4 * 60, { leeExtrapolation: 'log' }));
});

test('Deng 1998 Eq. 2: compliance at 1 month = 3.320 and 1 year = 3.594 1/GPa (Table III)', () => {
  near(RAW.dengCompliance(30 * 86400), 3.320, 0.002);
  near(RAW.dengCompliance(365 * 86400), 3.594, 0.002);
});

test('Lewis 2001: control, 5 MPa, 10 years → 6.5 % compressive strain (Table 3)', () => {
  near(5 * RAW.lewisCompliance(10 * 365.25 * 86400), 6.5, 0.02);
});

test('closed-form inverses: timeFor(strain(t)) = t; the Lee cap is unreachable', () => {
  const opt = { leeExtrapolation: 'log' as const };
  for (const law of Object.values(LAWS)) {
    for (const t of [100, 1e4, 1e6]) {
      const e = law.strain(5, t, opt);
      near(law.timeFor(5, e, opt), t, 1e-6, law.id);
    }
  }
  const capped = LAWS.lee2003.strain(5, 1e8, DEFAULT_LAW_OPTIONS);
  assert.equal(LAWS.lee2003.timeFor(5, capped, DEFAULT_LAW_OPTIONS), Infinity);
});

// ---------- Temperature ----------

test('TTS: Deng Ea gives a_T(37 °C vs 22 °C) ≈ 84; Burger Ea reproduces +31 % creep after 2 h', () => {
  near(shiftFactor(37, 22, EA_DENG_KCAL), 83.8, 0.01);
  const L = LAWS.lewis2001;
  const ratio = L.strain(8, 7200 * shiftFactor(37, 22, EA_BURGER_KCAL), DEFAULT_LAW_OPTIONS) / L.strain(8, 7200, DEFAULT_LAW_OPTIONS);
  near(ratio, 1.31, 0.01);
  assert.equal(shiftFactor(37, 37, 50), 1);
});

// ---------- Recovery ----------

test('Recovery (Lee & Pienkowski 1998): 73 % of the recovered strain at 10³ min, 51 % of the creep at 10⁴ min', () => {
  near(recoveryProgress(1000, 'plateau'), 0.73, 1e-9);
  near(recoveryProgress(1e4, 'plateau'), 1, 1e-9);
  assert.equal(recoveryProgress(1e5, 'plateau'), 1);
  near(recoveryProgress(1e5, 'log'), 1.27, 1e-9);
  near(recoveredFraction({ r10k: 0.51, timeS: 1e4 * 60, tempC: 22, eaKcal: 53.7, kinetics: 'plateau' }), 0.51, 1e-9);
  // colder storage → slower recovery
  assert.ok(recoveredFraction({ r10k: 0.51, timeS: 1000 * 60, tempC: 4, eaKcal: 53.7, kinetics: 'plateau' })
    < recoveredFraction({ r10k: 0.51, timeS: 1000 * 60, tempC: 22, eaKcal: 53.7, kinetics: 'plateau' }));
});

// ---------- Contact & creep ----------

const base = (over: Partial<SimInput> = {}): SimInput => ({
  law: LAWS.lee2003, lawOpt: DEFAULT_LAW_OPTIONS, mode: 'static', forceN: 2000, timeS: 1.5e7, dynStaticRatio: 0.65,
  tempC: 37, eaKcal: EA_DENG_KCAL, materialFactor: 1, kappa: 1,
  geometry: { headRadiusMm: 14, clearanceMm: 0, thicknessMm: 8, loadAngleDeg: 0, coverageDeg: 90 },
  elastic: { E: 650, nu: 0.43 }, res: RES_FINE, conform: true, ...over,
});

test('contact without clearance: p₀ = 3F/(2πR²)', () => {
  const r = simulate(base({ res: { nPsi: 90, nPhi: 4, nLayers: 2, nSteps: 2, tol: 0.25 }, timeS: 20 }));
  near(r.peakPressureInitialMPa, (3 * 2000) / (2 * Math.PI * 14 * 14), 0.002);
});

test('clearance concentrates the pressure and the creep; conforming relaxes it', () => {
  const c0 = simulate(base());
  const c1 = simulate(base({ geometry: { ...base().geometry, clearanceMm: 0.1 } }));
  assert.ok(c1.peakPressureInitialMPa > 1.5 * c0.peakPressureInitialMPa);
  assert.ok(c1.maxCreepMm > c0.maxCreepMm);
  assert.ok(c1.peakPressureFinalMPa < c1.peakPressureInitialMPa);
  const rigid = simulate(base({ conform: false, geometry: { ...base().geometry, clearanceMm: 0.1 } }));
  assert.ok(rigid.maxCreepMm > c1.maxCreepMm);
});

test('without clearance and a linear law the pressure does not redistribute', () => {
  const r = simulate(base());
  near(r.peakPressureFinalMPa, r.peakPressureInitialMPa, 0.01);
});

test('dynamic mode creeps ≈ k times the static mode for the same time (linear laws)', () => {
  const st = simulate(base({ law: LAWS.deng1998, timeS: 1e6 }));
  const dy = simulate(base({ law: LAWS.deng1998, timeS: 1e6, mode: 'dynamic' }));
  near(dy.maxCreepMm / st.maxCreepMm, 0.65, 0.01);
});

test('Monte Carlo resolution agrees with the fine resolution (≤ 10 %)', () => {
  for (const law of Object.values(LAWS)) {
    const g = { ...base().geometry, clearanceMm: 0.05, loadAngleDeg: 20 };
    const f = simulate(base({ law, geometry: g }));
    const c = simulate(base({ law, geometry: g, res: RES_MC }));
    near(c.maxCreepMm, f.maxCreepMm, 0.10, law.id);
  }
});

test('order of magnitude: 80 kg, 28 mm head, 8 mm liner, 6 months → creep in the published 30–400 µm band', () => {
  const det = runDeterministic(defaultCase());
  for (const r of det.rows) {
    assert.ok(r.creepUm > 15 && r.creepUm < 500, `${r.law} ${r.mode} ${r.temperature}: ${r.creepUm}`);
  }
});

// ---------- Monte Carlo & verdict ----------

test('Monte Carlo is reproducible with a seed and splits a phantom measurement', async () => {
  const c = defaultCase();
  c.samples = 40;
  c.measured = { penetrationUm: 100, sdUm: 8 };
  const a = await runMonteCarlo(c);
  const b = await runMonteCarlo(c);
  assert.deepEqual(Array.from(a.modes.static.creepUm), Array.from(b.modes.static.creepUm));
  const s = a.summary.dynamic;
  assert.ok(s.wear && s.wear.p50 > 0 && s.wear.p50 < 100);
});

test('verdict: small signal when the creep is of the order of the uncertainty', () => {
  const rem = summarize([8, 10, 12]);
  const v = verdict({ penetrationUm: 30, sdUm: 10 }, rem, summarize([18, 20, 22]), 0);
  assert.equal(v.level, 'small-signal');
  const v2 = verdict({ penetrationUm: 200, sdUm: 10 }, summarize([50, 60, 70]), summarize([130, 140, 150]), 0);
  assert.equal(v2.level, 'separable');
  const v3 = verdict({ penetrationUm: 60, sdUm: 5 }, summarize([80, 90, 100]), summarize([-40, -30, -20]), 0.9);
  assert.equal(v3.level, 'inconsistent');
});

// ---------- HipWear input & elevation analysis ----------

test('phantom round-trip: parser reads geometry, measurement and mesh', () => {
  const L = parseHipWearInput(JSON.stringify(makePhantom()), 'phantom.json');
  assert.equal(L.warnings.length, 0, L.warnings.join('; '));
  near(L.clearanceMm!, 0.05, 1e-6);
  near(L.loadAngleDeg!, 20, 1e-9);
  assert.equal(L.measured!.penetrationUm, 100);
  assert.ok(L.mesh && L.mesh.faces.length > 1000);
});

test('penetration not detected: D only bounded by the detection limit', () => {
  const ph = makePhantom() as any;
  ph.wear.linearWearUm = 0; ph.wear.linearWearSdUm = null;
  ph.wear.linearWearCorrectedUm = null; ph.wear.linearWearCorrectedSdUm = null;
  ph.wear.detectionLimitUm = 420; ph.geometry.displacedCenter = null;
  const L = parseHipWearInput(JSON.stringify(ph), 'nd.json');
  assert.equal(L.measured!.notDetected, true);
  assert.equal(L.measured!.sdUm, 210);
  const below = verdict(L.measured!, summarize([30, 45, 140]), null, null);
  assert.equal(below.level, 'small-signal');
  assert.ok(!/e-\d/.test(below.detail), below.detail);
  const above = verdict(L.measured!, summarize([400, 500, 700]), null, null);
  assert.equal(above.level, 'inconsistent');
});

test('noise floor: E[(X−a)+] matches a direct integration', () => {
  let s = 0; const sig = 3, a = 4, N = 200000;
  for (let i = 0; i < N; i++) { const x = -8 * sig + (16 * sig * (i + 0.5)) / N; const pdf = Math.exp(-0.5 * (x / sig) ** 2) / (sig * Math.sqrt(2 * Math.PI)); s += Math.max(0, x - a) * pdf * (16 * sig / N); }
  near(expectedExcess(sig, a), s, 1e-3);
});

test('elevation analysis: no elevation → net volume ≈ 0; with elevation → positive lower bound below the truth', () => {
  const flat = parseHipWearInput(JSON.stringify(makePhantom({ elevationUm: 0 })), 'p.json');
  const sf = analyseSurface(flat.mesh!, { center: flat.center, radiusMm: flat.measuredRadiusMm!, pole: flat.pole, load: flat.load });
  const ef = elevationAnalysis(sf, flat.noiseSigmaUm, 0);
  assert.ok(ef.nominal.netMm3 < 0.1, `flat: ${ef.nominal.netMm3}`);
  const ph = makePhantom();
  const el = parseHipWearInput(JSON.stringify(ph), 'p.json');
  const se = analyseSurface(el.mesh!, { center: el.center, radiusMm: el.measuredRadiusMm!, pole: el.pole, load: el.load });
  const ee = elevationAnalysis(se, el.noiseSigmaUm, 0);
  assert.ok(ee.nominal.netMm3 > 0.3, `elevated: ${ee.nominal.netMm3}`);
  assert.ok(ee.netRangeMm3[1] < ph.source!.truth!.elevationVolumeMm3);
  near(ee.elevationPsiDeg, 70, 0.05);
});

test('recovery scenarios: long loading recovers less and both are reported', async () => {
  const c = defaultCase();
  c.samples = 60; c.laws = ['lee2003']; c.mcLaws = ['lee2003'];
  const mc = await runMonteCarlo(c);
  const lp = mc.summary.dynamic.byScenario.lp!, lg = mc.summary.dynamic.byScenario.long!;
  assert.ok(lp && lg);
  assert.ok(lg.recovered.p50 < 0.2 && lp.recovered.p50 > 0.3);
  assert.ok(lg.remaining.p50 > lp.remaining.p50);
  c.recoveryScenario = 'lp';
  const only = await runMonteCarlo(c);
  assert.equal(only.summary.dynamic.byScenario.long, null);
});

// ---------- v0.6: sensitivity, recovery curve, series ----------
import { spearman, sensitivity, recoveryCurve } from '../src/model/sensitivity.ts';
import { caseFromLoaded, runSeriesCase, seriesCsv, elevationStatus } from '../src/model/series.ts';

test('spearman: monotonic = 1, reversed = −1, constant = NaN', () => {
  near(spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1, 1e-12);
  near(spearman([1, 2, 3, 4], [8, 4, 2, 1]), -1, 1e-12);
  assert.ok(Number.isNaN(spearman([1, 2, 3], [5, 5, 5])));
});

test('sensitivity ranks the recovery first for the remaining creep with both scenarios', async () => {
  const c = defaultCase();
  c.samples = 200; c.measured = { penetrationUm: 100, sdUm: 8 };
  const mc = await runMonteCarlo(c);
  const rows = sensitivity(mc, 'dynamic', 'remaining');
  assert.ok(rows.length > 5);
  assert.ok(['scenario', 'r10k'].includes(rows[0].key), rows.map((r) => r.key).join(','));
  const w = sensitivity(mc, 'dynamic', 'wear');
  assert.ok(w.some((r) => r.key === 'measuredD'));
});

test('recovery curve reproduces the Monte Carlo remaining creep at the case days', async () => {
  const c = defaultCase();
  c.samples = 150;
  const mc = await runMonteCarlo(c);
  const rc = recoveryCurve(mc, c, 'dynamic', [c.exVivoDays, 1000]);
  near(rc.byScenario.lp!.remaining.p50[0], mc.summary.dynamic.byScenario.lp!.remaining.p50, 1e-6);
  near(rc.byScenario.long!.remaining.p50[0], mc.summary.dynamic.byScenario.long!.remaining.p50, 1e-6);
  assert.ok(rc.byScenario.lp!.remaining.p50[1] <= rc.byScenario.lp!.remaining.p50[0] + 1e-9);
});

test('series: a phantom liner runs end to end and exports one CSV row per mode', async () => {
  const L = parseHipWearInput(JSON.stringify(makePhantom()), 'p.json');
  const base = defaultCase(); base.samples = 80;
  const c = caseFromLoaded(base, L);
  const r = await runSeriesCase(c, L, { refRadius: 'measured', rimBandDeg: 2 });
  assert.ok(r.modes.dynamic.byScenario.lp && r.modes.dynamic.byScenario.long);
  assert.ok(r.elevationMinCreepUm && r.elevationMinCreepUm.nominal > 0);
  const csv = seriesCsv([r]).split('\n');
  assert.equal(csv.length, 3);
  assert.equal(elevationStatus(50, summarize([10, 20, 30])), 'below');
  assert.equal(elevationStatus(5, summarize([10, 20, 30])), 'consistent');
});

// ---------- v0.7: ABG II and the dose model ----------
import { doseFactor, materialPreset } from '../src/model/materials.ts';

test('dose model reproduces its anchors and orders the treatments', () => {
  near(doseFactor({ doseKGy: 30, thermal: 'annealed' }).nominal, 1.0, 1e-9);      // Duration
  near(doseFactor({ doseKGy: 100, thermal: 'annealed' }).nominal, 0.85, 1e-9);    // Crossfire / X3
  near(doseFactor({ doseKGy: 95, thermal: 'remelted' }).nominal, 1.13, 1e-9);     // Durasul
  near(doseFactor({ doseKGy: 133, thermal: 'vitamin-e' }).nominal, 0.86, 1e-9);   // E1
  near(doseFactor({ doseKGy: 33, thermal: 'none' }).nominal, 1.0, 1e-9);          // ArCom
  assert.ok(doseFactor({ doseKGy: 100, thermal: 'remelted' }).nominal > doseFactor({ doseKGy: 100, thermal: 'annealed' }).nominal);
  assert.ok(doseFactor({ doseKGy: 300, thermal: 'remelted' }).extrapolated);
  const p = materialPreset('dose', { doseKGy: 100, thermal: 'annealed' });
  near(p.creepFactor.lo, 0.85 * 0.85, 1e-3);
  assert.equal(p.recovery10k.nominal, 0.60);
  assert.equal(materialPreset('abg2-duration').creepFactor.nominal, 1.0);
});

test('HipWear file with dose and thermal treatment', () => {
  const ph = makePhantom() as any;
  ph.implant.material = 'dose'; ph.implant.radiationDoseKGy = 75; ph.implant.thermalTreatment = 'remelted';
  const L = parseHipWearInput(JSON.stringify(ph), 'd.json');
  assert.equal(L.material, 'dose');
  assert.deepEqual(L.irradiation, { doseKGy: 75, thermal: 'remelted' });
  const c = caseFromLoaded(defaultCase(), L);
  assert.ok(materialPreset(c.material, c.irradiation).creepFactor.nominal > 1.0);
});

// ---------- v0.8: Excel export of a series ----------
import { writeXlsx } from '../src/io/xlsx.ts';
import { seriesTable, SERIES_COLUMNS } from '../src/model/series.ts';

test('xlsx writer: valid zip with the workbook parts and cell values', () => {
  const b = writeXlsx([{ name: 'Results', header: true, rows: [['a', 'b'], [1.5, 'x & <y>'], [null, 2]] }, { name: 'Info', rows: [['k', 'v']] }]);
  assert.equal(b[0], 0x50); assert.equal(b[1], 0x4b);                 // "PK"
  const txt = new TextDecoder().decode(b);
  for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/styles.xml'])
    assert.ok(txt.includes(part), part);
  assert.ok(txt.includes('<c r="A2" s="0"') || txt.includes('<c r="A2"><v>1.5</v></c>'));
  assert.ok(txt.includes('x &amp; &lt;y&gt;'));
  assert.ok(txt.includes('<c r="B3"><v>2</v></c>'));
});

test('series table: one row per mode with all columns, numbers as numbers', async () => {
  const L = parseHipWearInput(JSON.stringify(makePhantom()), 'p.json');
  const base = defaultCase(); base.samples = 60;
  const r = await runSeriesCase(caseFromLoaded(base, L), L, { refRadius: 'measured', rimBandDeg: 2 });
  const t = seriesTable([r]);
  assert.equal(t.length, 2);
  for (const row of t) assert.equal(row.length, SERIES_COLUMNS.length);
  assert.equal(typeof t[0][SERIES_COLUMNS.indexOf('Cmax_p50')], 'number');
});
