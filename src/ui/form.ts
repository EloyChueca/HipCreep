// ============================================================
// HipCreep — input form (sidebar)
// ============================================================

import type { CaseInput } from '../model/case.ts';
import { LAWS, LAW_IDS, type LawId } from '../model/laws.ts';
import { MATERIALS, MATERIAL_IDS, type MaterialId, type Range } from '../model/materials.ts';

export interface UiSettings {
  /** Radius of the original surface for the sphere-to-plane step */
  refRadius: 'measured' | 'commercial';
  rimBandDeg: number;
  /** Use a manual measured penetration when no HipWear file is loaded */
  manualMeasurement: boolean;
}

export const defaultUi = (): UiSettings => ({ refRadius: 'measured', rimBandDeg: 2, manualMeasurement: false });

type Field =
  | { kind: 'number'; id: string; label: string; unit?: string; step?: number; min?: number; help?: string }
  | { kind: 'range'; id: string; label: string; unit?: string; step?: number; help?: string }
  | { kind: 'select'; id: string; label: string; options: [string, string][]; help?: string }
  | { kind: 'check'; id: string; label: string; help?: string }
  | { kind: 'laws'; id: string; label: string };

interface Section { title: string; open?: boolean; id?: string; fields: Field[]; html?: string }

const SECTIONS: Section[] = [
  {
    title: 'Case', open: true, id: 'sec-case', fields: [],
    html: `
      <div class="btn-row">
        <label class="btn" for="file-input" title="File exported by HipWear (format hipcreep-input)">Load HipWear file…</label>
        <input id="file-input" type="file" accept=".json,application/json" class="hidden" />
        <button class="btn" id="btn-demo" title="Synthetic liner with known creep, wear and noise">Demo case</button>
        <button class="btn" id="btn-demo-download" title="Download the demo file to see the input format">Demo file ⭳</button>
        <button class="btn" id="btn-clear">Clear</button>
      </div>
      <div class="file-box" id="file-box">Manual inputs. Load a HipWear export to take the geometry, penetration and surface map from it.</div>`,
  },
  {
    title: 'Patient & implant', open: true, fields: [
      { kind: 'number', id: 'bodyMassKg', label: 'Body mass', unit: 'kg', step: 1, min: 20 },
      { kind: 'number', id: 'implantMonths', label: 'Time implanted', unit: 'months', step: 0.5, min: 0.1 },
      { kind: 'number', id: 'headDiameterMm', label: 'Femoral head diameter', unit: 'mm', step: 1, min: 16 },
      { kind: 'number', id: 'thicknessMm', label: 'Liner wall thickness', unit: 'mm', step: 0.1, min: 1 },
      { kind: 'number', id: 'thicknessSdMm', label: 'Wall thickness SD', unit: 'mm', step: 0.05, min: 0 },
      { kind: 'range', id: 'clearance', label: 'Radial clearance (liner − head)', unit: 'mm', step: 0.01,
        help: 'From HipWear: measured cavity radius − head radius. Concentrates the contact pressure.' },
      { kind: 'number', id: 'loadAngleDeg', label: 'Load angle from cup axis', unit: '°', step: 1, min: 0,
        help: 'Penetration direction of the HipWear two-sphere model (0° = toward the pole).' },
      { kind: 'number', id: 'coverageDeg', label: 'Bearing coverage from pole', unit: '°', step: 1, min: 45 },
      { kind: 'select', id: 'material', label: 'Polyethylene', options: MATERIAL_IDS.map((m) => [m, MATERIALS[m].label] as [string, string]) },
    ],
  },
  {
    title: 'Retrieval & temperatures', open: true, fields: [
      { kind: 'number', id: 'exVivoDays', label: 'Time from explantation to scan', unit: 'days', step: 1, min: 0 },
      { kind: 'number', id: 'recoveryTempC', label: 'Storage temperature', unit: '°C', step: 1 },
      { kind: 'number', id: 'inVivoTempC', label: 'In vivo temperature', unit: '°C', step: 0.5 },
    ],
  },
  {
    title: 'Measured penetration (HipWear)', open: true, fields: [
      { kind: 'check', id: 'manualMeasurement', label: 'Use a measured penetration', help: 'Filled automatically from a HipWear file. Without it, only the creep prediction is computed.' },
      { kind: 'number', id: 'penetrationUm', label: 'Max linear penetration D', unit: 'µm', step: 1, min: 0 },
      { kind: 'number', id: 'penetrationSdUm', label: 'Uncertainty of D (SD)', unit: 'µm', step: 1, min: 0 },
      { kind: 'number', id: 'detectionLimitUm', label: 'Detection limit (optional)', unit: 'µm', step: 1, min: 0,
        help: 'D = 0 with a detection limit means "not detected" (D below the limit).' },
    ],
  },
  {
    title: 'Loading', fields: [
      { kind: 'range', id: 'peakForceBW', label: 'Peak walking force', unit: '× BW', step: 0.05,
        help: 'Hip contact force in walking 2.3–2.8 BW (Bergmann et al.). Static mode holds this force for the whole implantation time.' },
      { kind: 'range', id: 'cyclesPerYear', label: 'Gait cycles per year', unit: 'cycles', step: 50000 },
      { kind: 'number', id: 'gaitFrequencyHz', label: 'Gait frequency', unit: 'Hz', step: 0.1, min: 0.1 },
      { kind: 'range', id: 'dynStaticRatio', label: 'Dynamic / static equivalence k', unit: '', step: 0.01,
        help: 'Lee 2003: creep under a 1 Hz cycle with peak p ≈ static creep at k·p (k = 0.61–0.70).' },
    ],
  },
  {
    title: 'Creep model', fields: [
      { kind: 'laws', id: 'laws', label: 'Creep laws — shown / used by the Monte Carlo (one law per sample)' },
      { kind: 'select', id: 'leeExtrapolation', label: 'Lee laws beyond 10⁴ min', options: [['log', 'Log-linear continues'], ['both', 'Both (sampled)'], ['cap', 'Saturates']] },
      { kind: 'select', id: 'recoveryScenario', label: 'Recovery scenario', options: [['both', 'Both (reported separately)'], ['lp', 'Lee & Pienkowski only'], ['long', 'Long loading only']],
        help: 'Lee & Pienkowski 1998: ≈ 51 % recovered after 7 days of loading. Long loading (Galetz 2010, Estok 2005): the permanent part grows with the loading time, recovery 0–15 %.' },
      { kind: 'select', id: 'recoveryKinetics', label: 'Recovery beyond 10⁴ min', options: [['both', 'Both (sampled)'], ['plateau', 'Plateau'], ['log', 'Log-linear continues']] },
      { kind: 'range', id: 'eaKcal', label: 'Activation energy Ea (TTS)', unit: 'kcal/mol', step: 0.5,
        help: '≈ 15.5 Galetz & Glatzel 2010 (deformation under sliding, 23–45 °C); 19.3 reproduces Burger 2006. Deng 1998 (53.7) overestimates the shift.' },
      { kind: 'range', id: 'E', label: 'Elastic modulus E', unit: 'MPa', step: 10 },
      { kind: 'range', id: 'nu', label: 'Poisson ratio ν', unit: '', step: 0.01 },
      { kind: 'check', id: 'creepFactorOn', label: 'Override material creep factor' },
      { kind: 'range', id: 'creepFactor', label: 'Creep factor vs unirradiated', unit: '×', step: 0.01 },
      { kind: 'check', id: 'recoveryOn', label: 'Override recovered fraction' },
      { kind: 'range', id: 'recovery', label: 'Recovered fraction at 10⁴ min', unit: '', step: 0.01 },
      { kind: 'number', id: 'kappa', label: 'Confinement factor κ', unit: '', step: 0.05, min: 0.1,
        help: '1 = uniaxial creep strain (upper bound for a metal-backed liner).' },
      { kind: 'check', id: 'conform', label: 'Contact conforms as the liner creeps', help: 'Pressure redistributes with the creep (strain-hardening integration).' },
    ],
  },
  {
    title: 'Monte Carlo', fields: [
      { kind: 'number', id: 'samples', label: 'Samples', unit: '', step: 100, min: 20 },
      { kind: 'number', id: 'seed', label: 'Random seed', unit: '', step: 1, min: 0 },
    ],
  },
  {
    title: 'Surface (sphere → plane)', fields: [
      { kind: 'select', id: 'refRadius', label: 'Reference radius (zero plane)', options: [['measured', 'Measured cavity radius'], ['commercial', 'Commercial radius']],
        help: 'r = R is the zero plane; penetration > 0, elevations < 0.' },
      { kind: 'number', id: 'rimBandDeg', label: 'Exclude band at the trim edge', unit: '°', step: 0.5, min: 0 },
    ],
  },
];

const fid = (id: string) => `f-${id}`;

function fieldHtml(f: Field): string {
  const help = 'help' in f && f.help ? `<div class="help">${f.help}</div>` : '';
  switch (f.kind) {
    case 'number':
      return `<div class="row"><label for="${fid(f.id)}">${f.label} ${f.unit ? `<span class="unit">${f.unit}</span>` : ''}</label>
        <input type="number" id="${fid(f.id)}" step="${f.step ?? 'any'}" ${f.min != null ? `min="${f.min}"` : ''} />${help}</div>`;
    case 'range':
      return `<div class="row range"><label>${f.label} ${f.unit ? `<span class="unit">${f.unit}</span>` : ''}</label>
        <div class="triple"><span>nominal</span><span>min</span><span>max</span>
        <input type="number" id="${fid(f.id)}-nom" step="${f.step ?? 'any'}" aria-label="${f.label} nominal" />
        <input type="number" id="${fid(f.id)}-lo" step="${f.step ?? 'any'}" aria-label="${f.label} minimum" />
        <input type="number" id="${fid(f.id)}-hi" step="${f.step ?? 'any'}" aria-label="${f.label} maximum" /></div>${help}</div>`;
    case 'select':
      return `<div class="row"><label for="${fid(f.id)}">${f.label}</label>
        <select id="${fid(f.id)}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>${help}</div>`;
    case 'check':
      return `<label class="check"><input type="checkbox" id="${fid(f.id)}" /> ${f.label}</label>${help ? `<div class="row">${help}</div>` : ''}`;
    case 'laws':
      return `<div class="row range"><label>${f.label}</label>${LAW_IDS.map((id) => `
        <div class="law-row" title="${LAWS[id].reference}"><input type="checkbox" id="${fid('law-' + id)}" aria-label="Show ${LAWS[id].shortRef}" />
        <input type="checkbox" id="${fid('mclaw-' + id)}" aria-label="Use ${LAWS[id].shortRef} in the Monte Carlo" /> <span>${LAWS[id].label}</span></div>`).join('')}
        <div class="help">First box: shown in the tables. Second box: sampled by the Monte Carlo. By default only the two Lee laws are sampled — they reproduce the validation data; Deng under-predicts and Lewis over-predicts (docs/VALIDATION.md).</div></div>`;
  }
}

export function buildForm(container: HTMLElement): void {
  container.innerHTML = SECTIONS.map((s) => `
    <details class="sec" ${s.open ? 'open' : ''} ${s.id ? `id="${s.id}"` : ''}>
      <summary>${s.title}</summary>
      ${s.html ?? ''}
      ${s.fields.map(fieldHtml).join('')}
    </details>`).join('');
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(fid(id)) as T | null;
const setNum = (id: string, v: number | null | undefined) => { const e = el<HTMLInputElement>(id); if (e) e.value = v == null || !Number.isFinite(v) ? '' : String(+v.toPrecision(10)); };
const getNum = (id: string, fallback: number): number => { const e = el<HTMLInputElement>(id); const v = e ? parseFloat(e.value) : NaN; return Number.isFinite(v) ? v : fallback; };
const setRange = (id: string, r: Range) => { setNum(id + '-nom', r.nominal); setNum(id + '-lo', r.lo); setNum(id + '-hi', r.hi); };
const getRange = (id: string, fb: Range): Range => {
  const nominal = getNum(id + '-nom', fb.nominal);
  let lo = getNum(id + '-lo', fb.lo), hi = getNum(id + '-hi', fb.hi);
  if (lo > hi) [lo, hi] = [hi, lo];
  return { nominal, lo: Math.min(lo, nominal), hi: Math.max(hi, nominal) };
};
const setSel = (id: string, v: string) => { const e = el<HTMLSelectElement>(id); if (e) e.value = v; };
const getSel = (id: string, fb: string) => el<HTMLSelectElement>(id)?.value ?? fb;
const setChk = (id: string, v: boolean) => { const e = el<HTMLInputElement>(id); if (e) e.checked = v; };
const getChk = (id: string) => !!el<HTMLInputElement>(id)?.checked;

export function writeForm(c: CaseInput, ui: UiSettings): void {
  setNum('bodyMassKg', c.bodyMassKg);
  setNum('implantMonths', c.implantMonths);
  setNum('headDiameterMm', c.headDiameterMm);
  setNum('thicknessMm', c.thicknessMm);
  setNum('thicknessSdMm', c.thicknessSdMm);
  setRange('clearance', c.clearance);
  setNum('loadAngleDeg', c.loadAngleDeg);
  setNum('coverageDeg', c.coverageDeg);
  setSel('material', c.material);
  setNum('exVivoDays', c.exVivoDays);
  setNum('recoveryTempC', c.recoveryTempC);
  setNum('inVivoTempC', c.inVivoTempC);
  setChk('manualMeasurement', ui.manualMeasurement || !!c.measured);
  setNum('penetrationUm', c.measured?.penetrationUm);
  setNum('penetrationSdUm', c.measured?.sdUm);
  setNum('detectionLimitUm', c.measured?.detectionLimitUm ?? null);
  setRange('peakForceBW', c.peakForceBW);
  setRange('cyclesPerYear', c.cyclesPerYear);
  setNum('gaitFrequencyHz', c.gaitFrequencyHz);
  setRange('dynStaticRatio', c.dynStaticRatio);
  for (const id of LAW_IDS) { setChk('law-' + id, c.laws.includes(id)); setChk('mclaw-' + id, c.mcLaws.includes(id)); }
  setSel('leeExtrapolation', c.leeExtrapolation);
  setSel('recoveryKinetics', c.recoveryKinetics);
  setSel('recoveryScenario', c.recoveryScenario);
  setRange('eaKcal', c.eaKcal);
  setRange('E', c.E);
  setRange('nu', c.nu);
  const mat = MATERIALS[c.material];
  setChk('creepFactorOn', !!c.creepFactorOverride);
  setRange('creepFactor', c.creepFactorOverride ?? mat.creepFactor);
  setChk('recoveryOn', !!c.recoveryOverride);
  setRange('recovery', c.recoveryOverride ?? mat.recovery10k);
  setNum('kappa', c.kappa);
  setChk('conform', c.conform);
  setNum('samples', c.samples);
  setNum('seed', c.seed);
  setSel('refRadius', ui.refRadius);
  setNum('rimBandDeg', ui.rimBandDeg);
  syncEnabled();
}

/** Grey out inputs that do not apply */
export function syncEnabled(): void {
  const dis = (id: string, d: boolean) => {
    for (const s of ['', '-nom', '-lo', '-hi']) { const e = el<HTMLInputElement>(id + s); if (e) e.disabled = d; }
  };
  dis('creepFactor', !getChk('creepFactorOn'));
  dis('recovery', !getChk('recoveryOn'));
  const m = getChk('manualMeasurement');
  dis('penetrationUm', !m); dis('penetrationSdUm', !m); dis('detectionLimitUm', !m);
}

/** Show the material preset ranges in the (disabled) override fields */
export function showMaterialPreset(): void {
  const mat = MATERIALS[getSel('material', 'conventional') as MaterialId];
  if (!getChk('creepFactorOn')) setRange('creepFactor', mat.creepFactor);
  if (!getChk('recoveryOn')) setRange('recovery', mat.recovery10k);
}

export function readForm(base: CaseInput, uiBase: UiSettings): { c: CaseInput; ui: UiSettings } {
  const c: CaseInput = { ...base };
  c.bodyMassKg = getNum('bodyMassKg', base.bodyMassKg);
  c.implantMonths = Math.max(0.05, getNum('implantMonths', base.implantMonths));
  c.headDiameterMm = getNum('headDiameterMm', base.headDiameterMm);
  c.thicknessMm = Math.max(0.5, getNum('thicknessMm', base.thicknessMm));
  c.thicknessSdMm = Math.max(0, getNum('thicknessSdMm', base.thicknessSdMm));
  c.clearance = getRange('clearance', base.clearance);
  c.loadAngleDeg = getNum('loadAngleDeg', base.loadAngleDeg);
  c.coverageDeg = getNum('coverageDeg', base.coverageDeg);
  c.material = getSel('material', base.material) as MaterialId;
  c.exVivoDays = Math.max(0, getNum('exVivoDays', base.exVivoDays));
  c.recoveryTempC = getNum('recoveryTempC', base.recoveryTempC);
  c.inVivoTempC = getNum('inVivoTempC', base.inVivoTempC);
  const manual = getChk('manualMeasurement');
  const D = getNum('penetrationUm', NaN);
  const lod = Number.isFinite(getNum('detectionLimitUm', NaN)) ? getNum('detectionLimitUm', 0) : null;
  // D = 0 with a detection limit = "not detected" (as HipWear exports it)
  const notDetected = Number.isFinite(D) && D <= 0 && lod != null && lod > 0;
  c.measured = manual && Number.isFinite(D)
    ? {
      penetrationUm: notDetected ? 0 : D,
      sdUm: notDetected ? lod! / 2 : Math.max(0, getNum('penetrationSdUm', 0)),
      detectionLimitUm: lod,
      volumeMm3: base.measured?.volumeMm3 ?? null,
      volumeSdMm3: base.measured?.volumeSdMm3 ?? null,
      notDetected,
    }
    : null;
  c.peakForceBW = getRange('peakForceBW', base.peakForceBW);
  c.cyclesPerYear = getRange('cyclesPerYear', base.cyclesPerYear);
  c.gaitFrequencyHz = Math.max(0.05, getNum('gaitFrequencyHz', base.gaitFrequencyHz));
  c.dynStaticRatio = getRange('dynStaticRatio', base.dynStaticRatio);
  const mcLaws = LAW_IDS.filter((id) => getChk('mclaw-' + id));
  c.mcLaws = (mcLaws.length ? mcLaws : ['lee2003']) as LawId[];
  // a law sampled by the Monte Carlo is always shown
  const laws = LAW_IDS.filter((id) => getChk('law-' + id) || c.mcLaws.includes(id));
  c.laws = laws as LawId[];
  c.leeExtrapolation = getSel('leeExtrapolation', base.leeExtrapolation) as CaseInput['leeExtrapolation'];
  c.recoveryKinetics = getSel('recoveryKinetics', base.recoveryKinetics) as CaseInput['recoveryKinetics'];
  c.recoveryScenario = getSel('recoveryScenario', base.recoveryScenario) as CaseInput['recoveryScenario'];
  c.eaKcal = getRange('eaKcal', base.eaKcal);
  c.E = getRange('E', base.E);
  c.nu = getRange('nu', base.nu);
  c.nu = { nominal: Math.min(0.49, c.nu.nominal), lo: Math.min(0.49, c.nu.lo), hi: Math.min(0.49, c.nu.hi) };
  const mat = MATERIALS[c.material];
  c.creepFactorOverride = getChk('creepFactorOn') ? getRange('creepFactor', mat.creepFactor) : null;
  c.recoveryOverride = getChk('recoveryOn') ? getRange('recovery', mat.recovery10k) : null;
  c.kappa = Math.max(0.05, getNum('kappa', base.kappa));
  c.conform = getChk('conform');
  c.samples = Math.round(Math.min(20000, Math.max(20, getNum('samples', base.samples))));
  c.seed = Math.round(getNum('seed', base.seed));
  const ui: UiSettings = {
    ...uiBase,
    refRadius: getSel('refRadius', uiBase.refRadius) as UiSettings['refRadius'],
    rimBandDeg: Math.max(0, getNum('rimBandDeg', uiBase.rimBandDeg)),
    manualMeasurement: manual,
  };
  return { c, ui };
}
