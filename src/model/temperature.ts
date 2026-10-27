// ============================================================
// HipCreep — time–temperature superposition (TTS)
// ------------------------------------------------------------
// Deng et al. (1998) showed that UHMWPE compressive creep curves at 37–62 °C
// superpose on the log-time axis with an Arrhenius shift factor:
//     ln a_T = −Ea/(R·T) + ln A,   Ea = 53.7 kcal/mol (UHMWPE, compression)
// so that the creep reached at temperature T in a time t equals the creep at the
// reference temperature T0 in a time t·a_T(T, T0).
//
// Using it below 37 °C (e.g. to bring the 22 °C law of Lewis 2001 to 37 °C) is an
// extrapolation. Burger (2006, Table 3.2) gives an independent check: creep after
// 2 h at 8 MPa rose from 0.79 mm (room temperature) to 1.08 mm (40 °C), i.e. ≈ +31 %
// at 37 °C by linear interpolation. With the Lewis law that ratio corresponds to
// Ea ≈ 19 kcal/mol (see EA_BURGER_KCAL).
//
// Galetz & Glatzel (2010) loaded UHMWPE under sliding (Paul-type twin-peak load) at 23,
// 37 and 45 °C: the same permanent deformation needed 3 M cycles at 23 °C, ≈ 0.9 M at
// 37 °C and ≈ 0.5 M at 45 °C → a_T ≈ 3.3 and 6 → Ea ≈ 15–16 kcal/mol for the macroscopic
// deformation (their Eyring yield analysis gives 200 kJ/mol ≈ 48 kcal/mol, the order of
// Deng's value, but that describes the yield stress, not the creep penetration).
// Since v0.4 the default range is 15–20 kcal/mol (Galetz – Burger), nominal 17.
// Deng's 53.7 kcal/mol gave a_T(23→37 °C) = 61, twenty times the measured shift.
// ============================================================

import { R_KCAL, kelvin } from './constants.ts';

/** Apparent activation energy for compressive creep of UHMWPE (Deng 1998, Table II) */
export const EA_DENG_KCAL = 53.7;

/** Activation energy that reproduces Burger's (2006) +31 % creep at 37 °C vs 22 °C after 2 h
 *  when applied to the Lewis (2001) law (computed and checked in the tests). */
export const EA_BURGER_KCAL = 19.3;

/** Macroscopic deformation under tribological loading, 23–45 °C (Galetz & Glatzel 2010, Fig. 18) */
export const EA_GALETZ_KCAL = 15.5;

/**
 * Shift factor a_T: creep at temperature `tempC` during t ≡ creep at `refTempC` during t·a_T.
 * a_T > 1 when tempC > refTempC.
 */
export function shiftFactor(tempC: number, refTempC: number, eaKcal: number): number {
  if (tempC === refTempC || !(eaKcal > 0)) return 1;
  return Math.exp((eaKcal / R_KCAL) * (1 / kelvin(refTempC) - 1 / kelvin(tempC)));
}
