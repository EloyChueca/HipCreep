// ============================================================
// HipCreep — input file exported by HipWear ("hipcreep-input", version 1)
// See docs/HIPWEAR_EXPORT.md for the specification.
// ============================================================

import type { Vec3, SurfaceMesh } from '../model/surface.ts';
import type { MaterialId, Irradiation, ThermalTreatment } from '../model/materials.ts';
import { MATERIAL_IDS } from '../model/materials.ts';

export const FORMAT_ID = 'hipcreep-input';
export const FORMAT_VERSION = 1;

export interface HipCreepInputFile {
  format: typeof FORMAT_ID;
  version: number;
  source?: { program?: string; programVersion?: string; file?: string; exportedAt?: string; analysisMode?: string; truth?: Record<string, number> };
  case?: { id?: string; yearsInVivo?: number | null; daysExVivo?: number | null };
  implant?: { headDiameterMm?: number | null; material?: string | null; linerOuterDiameterMm?: number | null; radiationDoseKGy?: number | null; thermalTreatment?: string | null };
  geometry: {
    commercialRadiusMm: number;
    measuredRadiusMm?: number | null;
    measuredRadiusReliable?: boolean | null;
    /** Centre of the free-radius sphere fitted to the unworn reference (pairs with measuredRadiusMm) */
    measuredCenter?: number[] | null;
    originalCenter: number[];
    displacedCenter?: number[] | null;
    poleAxis: number[];
    rimPlane?: { point: number[]; normal: number[] } | null;
    wallThicknessMm?: { mean?: number | null; sd?: number | null; atPenetration?: number | null; sdAtPenetration?: number | null } | null;
    outerShellRadiusMm?: number | null;
  };
  wear?: {
    model?: string | null;
    linearWearUm?: number | null;
    linearWearSdUm?: number | null;
    linearWearCorrectedUm?: number | null;
    linearWearCorrectedSdUm?: number | null;
    volumeMm3?: number | null;
    volumeSdMm3?: number | null;
    directionAngleDeg?: number | null;
    detectionLimitUm?: number | null;
  };
  uncertainty?: { noiseSigmaUm?: number | null; surfaceUncertaintyUm?: number | null; formRmsUm?: number | null };
  mesh?: { vertices: number[]; faces: number[] } | null;
}

export interface LoadedHipWearCase {
  file: HipCreepInputFile;
  name: string;
  caseId: string;
  implantMonths: number | null;
  exVivoDays: number | null;
  headDiameterMm: number;
  material: MaterialId | null;
  /** Radiation dose and thermal treatment, when the file gives them */
  irradiation: Irradiation | null;
  thicknessMm: number | null;
  thicknessSdMm: number | null;
  clearanceMm: number | null;
  loadAngleDeg: number | null;
  measured: { penetrationUm: number; sdUm: number; detectionLimitUm: number | null; volumeMm3: number | null; volumeSdMm3: number | null; notDetected: boolean;
    /** Detection limit computed by HipCreep with HipWear's formula (the file only gives it when nothing is detected) */
    detectionLimitComputed?: boolean } | null;
  center: Vec3;
  /** Centre of the measured-radius sphere (null if not exported) */
  measuredCenter: Vec3 | null;
  pole: Vec3;
  load: Vec3 | null;
  commercialRadiusMm: number;
  measuredRadiusMm: number | null;
  measuredRadiusReliable: boolean;
  noiseSigmaUm: number;
  surfaceUncertaintyUm: number;
  mesh: SurfaceMesh | null;
  warnings: string[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const vec3 = (a: unknown, what: string): Vec3 => {
  if (!Array.isArray(a) || a.length !== 3 || !a.every(isNum)) throw new Error(`${what} must be an array of 3 numbers`);
  return [a[0], a[1], a[2]];
};

export function parseHipWearInput(text: string, name = 'input.json'): LoadedHipWearCase {
  let j: HipCreepInputFile;
  try { j = JSON.parse(text); } catch { throw new Error('The file is not valid JSON.'); }
  if (!j || j.format !== FORMAT_ID) throw new Error(`Not a HipCreep input file (expected "format": "${FORMAT_ID}").`);
  if (!isNum(j.version) || j.version > FORMAT_VERSION) throw new Error(`Unsupported version ${j.version} (this HipCreep reads version ≤ ${FORMAT_VERSION}).`);
  const g = j.geometry;
  if (!g) throw new Error('Missing "geometry".');
  if (!isNum(g.commercialRadiusMm) || g.commercialRadiusMm <= 0) throw new Error('geometry.commercialRadiusMm must be a positive number.');
  const warnings: string[] = [];
  const center = vec3(g.originalCenter, 'geometry.originalCenter');
  const pole = vec3(g.poleAxis, 'geometry.poleAxis');
  const displaced = g.displacedCenter ? vec3(g.displacedCenter, 'geometry.displacedCenter') : null;
  const measuredCenter = g.measuredCenter ? vec3(g.measuredCenter, 'geometry.measuredCenter') : null;
  let load: Vec3 | null = displaced ? [displaced[0] - center[0], displaced[1] - center[1], displaced[2] - center[2]] : null;
  if (load && Math.hypot(...load) < 1e-9) load = null;

  const w = j.wear ?? {};
  let loadAngleDeg: number | null = isNum(w.directionAngleDeg) ? w.directionAngleDeg : null;
  if (loadAngleDeg == null && load) {
    const pl = Math.hypot(...pole), ll = Math.hypot(...load);
    loadAngleDeg = Math.acos(Math.max(-1, Math.min(1, (pole[0] * load[0] + pole[1] * load[1] + pole[2] * load[2]) / (pl * ll)))) * 180 / Math.PI;
  }
  if (loadAngleDeg == null) warnings.push('No penetration direction: the load angle from the cup axis must be entered manually (default 20°).');

  const Rc = g.commercialRadiusMm;
  const headDiameterMm = isNum(j.implant?.headDiameterMm) ? j.implant!.headDiameterMm! : 2 * Rc;
  const Rm = isNum(g.measuredRadiusMm) ? g.measuredRadiusMm : null;
  const reliable = !!g.measuredRadiusReliable && Rm != null;
  let clearanceMm: number | null = null;
  if (Rm != null && reliable) clearanceMm = Math.max(0, Rm - headDiameterMm / 2);
  else if (Rm != null) warnings.push('Measured cavity radius flagged as unreliable: clearance not taken from it.');

  let thicknessMm: number | null = null, thicknessSdMm: number | null = null;
  const wt = g.wallThicknessMm;
  if (wt && isNum(wt.atPenetration)) thicknessMm = wt.atPenetration;
  else if (wt && isNum(wt.mean)) thicknessMm = wt.mean;
  else if (isNum(g.outerShellRadiusMm)) thicknessMm = g.outerShellRadiusMm - (Rm ?? Rc);
  // Uncertainty of the wall under the load: the local dispersion (HipWear ≥ 1.1). Older exports only
  // carry the SD over the whole back surface, which mixes in the shape of the back: cap it.
  if (wt && isNum(wt.sdAtPenetration)) thicknessSdMm = wt.sdAtPenetration;
  else if (wt && isNum(wt.sd) && thicknessMm != null) {
    const cap = 0.05 * thicknessMm;
    thicknessSdMm = Math.min(wt.sd, cap);
    if (wt.sd > cap) warnings.push(`Wall-thickness SD of the whole back surface (${wt.sd.toFixed(2)} mm) capped at ${cap.toFixed(2)} mm for the Monte Carlo (re-export from the latest HipWear for the local value).`);
  }
  if (thicknessMm == null) warnings.push('No wall thickness in the file: enter it manually.');

  let measured: LoadedHipWearCase['measured'] = null;
  const useCorr = isNum(w.linearWearCorrectedUm);
  const D = useCorr ? w.linearWearCorrectedUm! : w.linearWearUm;
  const Dsd = useCorr ? w.linearWearCorrectedSdUm : w.linearWearSdUm;
  const lod = isNum(w.detectionLimitUm) ? w.detectionLimitUm : null;
  if (isNum(D) && D <= 0 && lod != null) {
    // Two-Sphere Auto found no directional penetration: D is only known to be below the detection limit
    measured = { penetrationUm: 0, sdUm: lod / 2, detectionLimitUm: lod, volumeMm3: null, volumeSdMm3: null, notDetected: true };
    warnings.push(`HipWear did not detect a directional penetration (below the detection limit of ${lod.toFixed(0)} µm).`);
  } else if (isNum(D)) {
    measured = {
      penetrationUm: D,
      sdUm: isNum(Dsd) ? Dsd : 0,
      detectionLimitUm: lod,
      volumeMm3: isNum(w.volumeMm3) ? w.volumeMm3 : null,
      volumeSdMm3: isNum(w.volumeSdMm3) ? w.volumeSdMm3 : null,
      notDetected: false,
    };
    // HipWear writes the detection limit only when nothing is detected; for a detected penetration compute it
    // with HipWear's own calibration (WearAnalysis.detectionLimitUm): max(50 + 6σ + 16f, 50 + 1.3e), up to 10 µm
    if (lod == null && isNum(j.uncertainty?.noiseSigmaUm)) {
      const sig = Math.max(0, j.uncertainty!.noiseSigmaUm!), form = Math.max(0, isNum(j.uncertainty?.formRmsUm) ? j.uncertainty!.formRmsUm! : 0);
      const excess = Rm != null ? Math.abs(Rm - Rc) * 1000 : 0;
      measured.detectionLimitUm = Math.ceil(Math.max(50 + 6 * sig + 16 * form, 50 + 1.3 * excess) / 10) * 10;
      measured.detectionLimitComputed = true;
    }
    if (!isNum(Dsd)) warnings.push('No uncertainty for the linear penetration: set it manually.');
    if (useCorr) warnings.push('Using the linear penetration corrected for the cavity-radius excess.');
  } else {
    warnings.push('No linear penetration in the file: only the creep prediction will be computed.');
  }

  let mesh: SurfaceMesh | null = null;
  if (j.mesh && Array.isArray(j.mesh.vertices) && Array.isArray(j.mesh.faces)) {
    if (j.mesh.vertices.length % 3 || j.mesh.faces.length % 3) throw new Error('mesh.vertices and mesh.faces must have a multiple of 3 entries.');
    const nv = j.mesh.vertices.length / 3;
    const faces = Uint32Array.from(j.mesh.faces);
    for (const f of faces) if (f >= nv) throw new Error('mesh.faces references a vertex that does not exist.');
    mesh = { vertices: Float64Array.from(j.mesh.vertices), faces };
  } else {
    warnings.push('No mesh in the file: the elevation (minimum-creep) analysis and the measured maps are not available.');
  }

  const mat = j.implant?.material;
  const material = mat && (MATERIAL_IDS as string[]).includes(mat) ? (mat as MaterialId) : null;
  const years = j.case?.yearsInVivo;
  const u = j.uncertainty ?? {};
  return {
    file: j,
    name,
    caseId: j.case?.id || name.replace(/\.json$/i, ''),
    implantMonths: isNum(years) && years > 0 ? years * 12 : null,
    exVivoDays: isNum(j.case?.daysExVivo) ? j.case!.daysExVivo! : null,
    headDiameterMm,
    material,
    irradiation: isNum(j.implant?.radiationDoseKGy)
      ? { doseKGy: j.implant!.radiationDoseKGy!, thermal: (['none', 'annealed', 'remelted', 'vitamin-e'].includes(j.implant?.thermalTreatment ?? '') ? j.implant!.thermalTreatment : 'none') as ThermalTreatment }
      : null,
    thicknessMm,
    thicknessSdMm,
    clearanceMm,
    loadAngleDeg,
    measured,
    center,
    measuredCenter,
    pole,
    load,
    commercialRadiusMm: Rc,
    measuredRadiusMm: Rm,
    measuredRadiusReliable: reliable,
    noiseSigmaUm: isNum(u.noiseSigmaUm) ? u.noiseSigmaUm : 0,
    surfaceUncertaintyUm: isNum(u.surfaceUncertaintyUm) ? u.surfaceUncertaintyUm : 0,
    mesh,
    warnings,
  };
}
