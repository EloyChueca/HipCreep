// ============================================================
// HipCreep — physical constants and unit helpers
// Internal units: length mm, stress MPa (N/mm²), force N, time s.
// ============================================================

/** Standard gravity (m/s²) */
export const G = 9.80665;

/** Gas constant in kcal·mol⁻¹·K⁻¹ (the unit used by Deng et al. 1998 for Ea) */
export const R_KCAL = 1.987204e-3;

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_DAY = 86400;
export const SECONDS_PER_YEAR = 365.25 * SECONDS_PER_DAY;
export const DAYS_PER_MONTH = 365.25 / 12;

export const DEG = Math.PI / 180;

export function kelvin(tempC: number): number {
  return tempC + 273.15;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
