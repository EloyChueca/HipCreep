// ============================================================
// HipCreep — case definition (inputs) and defaults
// ============================================================

import type { LawId } from './laws.ts';
import type { MaterialId, Range, Irradiation } from './materials.ts';
import { EA_BURGER_KCAL } from './temperature.ts';
import { LAW_IDS, MC_LAW_IDS } from './laws.ts';

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
  /** HipWear found no directional penetration: D is only known to be below the detection limit */
  notDetected?: boolean;
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
  /** Radiation dose and thermal treatment (used when material = 'dose') */
  irradiation: Irradiation;
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
  /** Laws shown in the tables and charts */
  laws: LawId[];
  /** Laws sampled by the Monte Carlo (subset of `laws`) */
  mcLaws: LawId[];
  leeExtrapolation: Either<'cap' | 'log'>;
  recoveryKinetics: Either<'plateau' | 'log'>;
  /** Recovery scenario: Lee & Pienkowski, long loading (near zero) or both (sampled 50/50) */
  recoveryScenario: Either<'lp' | 'long'>;
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
    irradiation: { doseKGy: 30, thermal: 'none' },
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
    laws: [...LAW_IDS],
    mcLaws: [...MC_LAW_IDS],
    // Lee & Pienkowski 1998: steady creep rate after ≈4·10³ min; Estok 2005: penetration still grows
    leeExtrapolation: 'log',
    recoveryKinetics: 'both',
    recoveryScenario: 'both',
    // Galetz & Glatzel 2010 (≈ 15.5) – Burger 2006 (19.3), see temperature.ts
    eaKcal: { nominal: 17, lo: 15, hi: EA_BURGER_KCAL + 0.7 },
    E: { nominal: 650, lo: 500, hi: 900 },
    nu: { nominal: 0.43, lo: 0.40, hi: 0.46 },
    kappa: 1,
    conform: true,
    creepFactorOverride: null,
    recoveryOverride: null,
    measured: null,
    samples: 1000,
    seed: 12345,
  };
}
