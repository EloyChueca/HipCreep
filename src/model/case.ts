// ============================================================
// HipCreep — case definition (inputs) and defaults
// ============================================================

import type { LawId } from './laws.ts';
import type { MaterialId, Range } from './materials.ts';
import { EA_BURGER_KCAL, EA_DENG_KCAL } from './temperature.ts';

export type Either<T extends string> = T | 'both';

export interface MeasuredPenetration {
  /** Maximum linear penetration measured by HipWear (µm) — wear + remaining creep */
  penetrationUm: number;
  /** Its standard uncertainty (µm) */
  sdUm: number;
  /** Detection limit reported by HipWear (µm), if any */
  detectionLimitUm?: number | null;
  /** Penetration (wear) volume (mm³) and its SD, if available */
  volumeMm3?: number | null;
  volumeSdMm3?: number | null;
}

export interface CaseInput {
  caseId: string;
  // Patient & implant
  bodyMassKg: number;
  implantMonths: number;
  headDiameterMm: number;
  thicknessMm: number;
  thicknessSdMm: number;
  /** Radial clearance liner − head (mm): nominal and Monte Carlo range */
  clearance: Range;
  /** Angle between the load (penetration) direction and the cup axis (deg) */
  loadAngleDeg: number;
  /** Angular extent of the bearing surface from the pole (deg) */
  coverageDeg: number;
  material: MaterialId;
  // Retrieval
  exVivoDays: number;
  recoveryTempC: number;
  inVivoTempC: number;
  // Loading
  /** Peak hip contact force during walking, in body weights */
  peakForceBW: Range;
  /** Gait cycles per year (each cycle loads the hip once) */
  cyclesPerYear: Range;
  gaitFrequencyHz: number;
  /** Lee 2003: dynamic creep at p_max ≈ static creep at k·p_max */
  dynStaticRatio: Range;
  // Material model
  laws: LawId[];
  leeExtrapolation: Either<'cap' | 'log'>;
  recoveryKinetics: Either<'plateau' | 'log'>;
  eaKcal: Range;
  E: Range;
  nu: Range;
  kappa: number;
  conform: boolean;
  // Override of the material preset ranges (null = use preset)
  creepFactorOverride: Range | null;
  recoveryOverride: Range | null;
  // Measurement
  measured: MeasuredPenetration | null;
  // Monte Carlo
  samples: number;
  seed: number;
}

export function defaultCase(): CaseInput {
  return {
    caseId: 'manual',
    bodyMassKg: 80,
    implantMonths: 6,
    headDiameterMm: 28,
    thicknessMm: 8,
    thicknessSdMm: 0.2,
    clearance: { nominal: 0.05, lo: 0.0, hi: 0.15 },
    loadAngleDeg: 20,
    coverageDeg: 90,
    material: 'conventional',
    exVivoDays: 30,
    recoveryTempC: 22,
    inVivoTempC: 37,
    // Hip contact force in walking: 2.3–2.8 BW (Bergmann et al. 2001, 2016, as cited by Metin & Cengil 2016)
    peakForceBW: { nominal: 2.5, lo: 2.3, hi: 2.8 },
    // ≈ 1 million cycles per year is the usual assumption; range covers sedentary to active patients
    cyclesPerYear: { nominal: 1.0e6, lo: 0.5e6, hi: 2.0e6 },
    gaitFrequencyHz: 1,
    // Lee 2003: 64 %, 70 %, 61 % at 2, 4, 8 MPa
    dynStaticRatio: { nominal: 0.65, lo: 0.61, hi: 0.70 },
    laws: ['lee2003', 'deng1998', 'lewis2001'],
    leeExtrapolation: 'both',
    recoveryKinetics: 'both',
    eaKcal: { nominal: EA_DENG_KCAL, lo: EA_BURGER_KCAL, hi: EA_DENG_KCAL },
    E: { nominal: 650, lo: 500, hi: 900 },
    nu: { nominal: 0.43, lo: 0.40, hi: 0.46 },
    kappa: 1,
    conform: true,
    creepFactorOverride: null,
    recoveryOverride: null,
    measured: null,
    samples: 400,
    seed: 12345,
  };
}
