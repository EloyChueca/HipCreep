// ============================================================
// HipCreep — polyethylene types
// ------------------------------------------------------------
// The creep laws were measured on UNIRRADIATED UHMWPE. The creep of other grades is
// obtained by multiplying the creep strain by a factor (v0.4, calibrated on liners):
//
//  • Conventional (γ, 25–40 kGy): Takahashi et al. 2016 (ArCom liners, 3000 N, 72 h) with the
//      two Lee laws give 0.89 (Lee 1998) – 1.33 (Lee 2003) at 0.05 mm clearance, 0.78–1.52 over
//      0–0.15 mm → nominal 1.0, range 0.85–1.2 (the low end keeps Burger 2006, 0.82–0.95, 2 h RT).
//  • Vitamin-E diffused HXLPE: Takahashi 2016, E1/ArCom = 0.86 (0.80–0.90) in all 9 sizes
//      → 0.86 × conventional.
//  • Remelted HXLPE (e-beam 95 kGy + melting, Durasul): Estok et al. 2005, 10–17 % MORE
//      penetration than conventional in identical liners; Lewis 2001 Table 3: ×1.12–1.14
//      → 1.13 × conventional.
//  • Annealed / sequentially annealed HXLPE: no liner data. Burger 2006 (125 kGy): 0.73 of
//      unirradiated at RT; Takahashi 2014 (Raman): the sequentially annealed liner has the
//      highest shape-recovery force → nominal 0.85, range 0.73–1.0.
//  • Unspecified HXLPE: envelope of the above.
//
// Recovery after unloading (fraction of the creep that recovers, see recovery.ts):
//  • Lee & Pienkowski 1998 (ASTM STP 1307): ≈ 51 % of the creep strain of unirradiated
//    GUR 4150HP after 10⁴ min of creep at 37 °C and 10⁴ min of recovery.
//  • Galetz & Glatzel 2010: the permanent part grows strongly with the loading time
//    (500 s vs 3.5 days); in vivo loading lasts months → lower bound reduced to 0.30.
//  • Cross-linked UHMWPE recovers more (Takahashi 2014, 2016: high shape-recovery force);
//    no percentage is published for liners: the HXLPE range is an assumption.
// ============================================================

export type MaterialId = 'virgin' | 'conventional' | 'hxlpe-remelted' | 'hxlpe-annealed' | 'vite-hxlpe' | 'hxlpe';

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
    recovery10k: { nominal: 0.51, lo: 0.30, hi: 0.60 },
    note: 'Same material as the creep laws.',
  },
  'conventional': {
    id: 'conventional',
    label: 'Conventional, γ-sterilised (25–40 kGy)',
    creepFactor: { nominal: 1.0, lo: 0.85, hi: 1.2 },
    recovery10k: { nominal: 0.51, lo: 0.30, hi: 0.60 },
    note: 'Creep factor from Takahashi 2016 liners (with Burger 2006 as low end). Recovery: Lee & Pienkowski 1998; low end from Galetz 2010.',
  },
  'hxlpe-remelted': {
    id: 'hxlpe-remelted',
    label: 'Highly cross-linked, remelted (e.g. Durasul, Longevity, Marathon)',
    creepFactor: { nominal: 1.13, lo: 0.96, hi: 1.36 },
    recovery10k: { nominal: 0.60, lo: 0.35, hi: 0.75 },
    note: 'Estok 2005: 10–17 % more creep than conventional in identical liners (Lewis 2001: ×1.12–1.14). Recovery range is an assumption.',
  },
  'hxlpe-annealed': {
    id: 'hxlpe-annealed',
    label: 'Highly cross-linked, annealed (e.g. Crossfire, X3)',
    creepFactor: { nominal: 0.85, lo: 0.73, hi: 1.0 },
    recovery10k: { nominal: 0.60, lo: 0.35, hi: 0.75 },
    note: 'No liner data: Burger 2006 (0.73 of unirradiated) and Takahashi 2014 (highest shape-recovery force). Recovery range is an assumption.',
  },
  'vite-hxlpe': {
    id: 'vite-hxlpe',
    label: 'Vitamin-E highly cross-linked',
    creepFactor: { nominal: 0.86, lo: 0.73, hi: 1.03 },
    recovery10k: { nominal: 0.60, lo: 0.35, hi: 0.75 },
    note: 'Takahashi 2016: 0.86 × conventional (E1 vs ArCom, 9 liner sizes). Recovery range is an assumption.',
  },
  'hxlpe': {
    id: 'hxlpe',
    label: 'Highly cross-linked, type not specified',
    creepFactor: { nominal: 1.0, lo: 0.73, hi: 1.36 },
    recovery10k: { nominal: 0.60, lo: 0.35, hi: 0.75 },
    note: 'Envelope of the annealed, vitamin-E and remelted grades. Choose the specific grade when known.',
  },
};

export const MATERIAL_IDS: MaterialId[] = ['virgin', 'conventional', 'hxlpe-remelted', 'hxlpe-annealed', 'vite-hxlpe', 'hxlpe'];
