// ============================================================
// HipCreep — polyethylene types
// ------------------------------------------------------------
// The three creep laws were measured on UNIRRADIATED UHMWPE. The creep of other
// grades is obtained by multiplying the creep strain by a factor whose range
// spans what the literature reports. The literature disagrees even on the sign
// of the cross-linking effect, so the ranges are wide on purpose.
//
//  • γ-sterilised conventional (25 kGy):  Burger 2006, Table 3.3 (2 h, 8 MPa, RT):
//      air 0.60/0.79 = 0.76 · N₂ 0.65/0.79 = 0.82 · air + 80 °C anneal 0.75/0.79 = 0.95
//  • Highly cross-linked:
//      Burger 2006, Table 3.4 (125 kGy, acetylene): 0.58/0.79 = 0.73 (RT), 0.63 (50 °C), 0.55 (60 °C)
//      Lewis 2001, Table 3 (50–150 kGy in air, 5 MPa, 10 y): 7.3/6.5 = 1.12, 7.4/6.5 = 1.14
//      Glyn-Jones 2008 (RSA in vivo, bedding-in): 0.26 vs 0.27 mm → ≈ 0.96
//
// Recovery after unloading (fraction of the creep that recovers, see recovery.ts):
//  • Lee & Pienkowski 1998 (ASTM STP 1307): ≈ 51 % of the creep strain of unirradiated
//    GUR 4150HP was ultimately recovered (10⁴ min creep at 37 °C, 10⁴ min recovery in air),
//    independently of load amplitude, static/dynamic loading and specimen location.
//  • Cross-linked UHMWPE recovers MORE strain than conventional (strain-recovery tests,
//    Medical Device & Diagnostic Industry review; Takahashi et al. 2016 report "considerable"
//    shape recovery of vitamin-E HXLPE liners, half of it within 5 min). No percentage is
//    published for liners: the HXLPE range below is an assumption, centred above 51 %.
// ============================================================

export type MaterialId = 'virgin' | 'conventional' | 'hxlpe' | 'vite-hxlpe';

export interface Range { nominal: number; lo: number; hi: number }

export interface MaterialPreset {
  id: MaterialId;
  label: string;
  /** Multiplier of the creep strain relative to unirradiated UHMWPE */
  creepFactor: Range;
  /** Fraction of the creep recovered after 10⁴ min unloaded at 22 °C (plateau of Lee & Pienkowski) */
  recovery10k: Range;
  note: string;
}

export const MATERIALS: Record<MaterialId, MaterialPreset> = {
  'virgin': {
    id: 'virgin',
    label: 'Unirradiated (virgin) UHMWPE',
    creepFactor: { nominal: 1, lo: 1, hi: 1 },
    recovery10k: { nominal: 0.51, lo: 0.40, hi: 0.60 },
    note: 'Same material as the three creep laws.',
  },
  'conventional': {
    id: 'conventional',
    label: 'Conventional, γ-sterilised (25–40 kGy)',
    creepFactor: { nominal: 0.82, lo: 0.76, hi: 1.0 },
    recovery10k: { nominal: 0.51, lo: 0.40, hi: 0.60 },
    note: 'Creep factor from Burger 2006 (Table 3.3). Recovery from Lee & Pienkowski 1998.',
  },
  'hxlpe': {
    id: 'hxlpe',
    label: 'Highly cross-linked (remelted / annealed)',
    creepFactor: { nominal: 0.90, lo: 0.55, hi: 1.14 },
    recovery10k: { nominal: 0.60, lo: 0.45, hi: 0.75 },
    note: 'Creep factor spans Burger 2006, Lewis 2001 and Glyn-Jones 2008. Recovery range is an assumption (no published value).',
  },
  'vite-hxlpe': {
    id: 'vite-hxlpe',
    label: 'Vitamin-E highly cross-linked',
    creepFactor: { nominal: 0.90, lo: 0.55, hi: 1.14 },
    recovery10k: { nominal: 0.60, lo: 0.45, hi: 0.75 },
    note: 'No specific creep law; treated as HXLPE. Takahashi 2016: considerable recovery, ½ of it within 5 min.',
  },
};

export const MATERIAL_IDS: MaterialId[] = ['virgin', 'conventional', 'hxlpe', 'vite-hxlpe'];
