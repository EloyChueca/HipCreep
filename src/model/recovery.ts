// ============================================================
// HipCreep — creep recovery after explantation
// ------------------------------------------------------------
// Pattern from Lee & Pienkowski (1998, ASTM STP 1307, pp. 30–36): unirradiated
// GUR 4150HP crept 10⁴ min at 37 °C (static and 1 Hz dynamic, 2–8 MPa) and was then
// left unloaded in air while its thickness was measured for 10⁴ min:
//   • the recovered strain grows linearly with log(time);
//   • 73 % of the recovered strain appears in the first 1000 min;
//   • ≈ 51 % of the creep is ultimately recovered, whatever the load.
// Log-linear through (10³ min, 0.73) and (10⁴ min, 1):
//   h(t) = 0.73 + 0.27 · log₁₀(t_min / 1000)
//   R(t) = R₁₀ₖ · h(t)
// h reaches 1 at 10⁴ min (≈ 7 days). Explanted liners usually wait weeks, so two
// scenarios are kept: 'plateau' (recovery stops at 10⁴ min, as the authors describe
// it) and 'log' (the log-linear trend continues; e.g. 4 weeks → h = 1.16).
//
// Temperatures: the creep happened at 37 °C and the liner recovers at room
// temperature (22 °C), the same condition as Lee & Pienkowski. If the recovery
// temperature differs, the recovery time is shifted with the Arrhenius factor.
// The ultimate fraction that can be recovered is not shifted.
// ============================================================

import { SECONDS_PER_MINUTE, clamp } from './constants.ts';
import { shiftFactor } from './temperature.ts';

export type RecoveryKinetics = 'plateau' | 'log';

export interface RecoveryInput {
  /** Fraction of the creep recovered after 10⁴ min at 22 °C */
  r10k: number;
  /** Time unloaded between explantation and scanning (s) */
  timeS: number;
  /** Temperature during that time (°C) */
  tempC: number;
  /** Activation energy for the time shift (kcal/mol) */
  eaKcal: number;
  kinetics: RecoveryKinetics;
}

/** Reference temperature of the recovery data (Lee & Pienkowski 1998: laboratory air) */
export const RECOVERY_REF_TEMP_C = 22;

/** Normalised recovery h(t): 0.73 at 10³ min and 1 at 10⁴ min */
export function recoveryProgress(tMin: number, kinetics: RecoveryKinetics): number {
  if (!(tMin > 0)) return 0;
  const h = 0.73 + 0.27 * Math.log10(tMin / 1000);
  return kinetics === 'plateau' ? clamp(h, 0, 1) : Math.max(0, h);
}

/** Fraction of the creep (deformation present at explantation) recovered at scanning */
export function recoveredFraction(inp: RecoveryInput): number {
  const aT = shiftFactor(inp.tempC, RECOVERY_REF_TEMP_C, inp.eaKcal);
  const tMin = (inp.timeS / SECONDS_PER_MINUTE) * aT;
  return clamp(inp.r10k * recoveryProgress(tMin, inp.kinetics), 0, 0.95);
}
