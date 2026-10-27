# HipCreep — validation against published data

Script: `npm run validate` (`validation/validate.ts`, results in `validation/results.json`; console output of each
version in `validation/output_v*.txt`).

**Calibration vs validation.** Since v0.4, Lee & Pienkowski 1998 (V1) is a creep law of the model and Takahashi 2016
(V2) sets the material factors, so they are calibration data. Estok 2005 (V3), Bevill 2005 (V4), Rochcongar 2021 (V5)
and Galetz 2010 (V6, the deformation-under-sliding shift) remain independent checks.
Every case is run with the model as it is (no fitting): per law with the nominal parameters, and with the
Monte Carlo (law + parameters sampled as in the app, 150–400 samples). Laboratory cases use the same
geometry, load, temperature and material preset as the paper; unknown inputs (radial clearance, load
direction) use the app defaults (clearance 0.05 mm, range 0–0.15 mm).

## Baseline — v0.3.0 (before any change)

### V1 · Lee & Pienkowski 1998 — static compression of the material (unirradiated GUR 4150HP, 36.5 °C)
Creep strain (%) measured after 5-min unloadings; paper: ε(10⁴ min) = 3.491·10⁻³·p, slopes 1.406 / 2.707 / 6.128·10⁻³ per decade.

| p (MPa) | t (min) | Measured | Lee 2003 → static (k = 0.65) | Deng 1998 | Lewis 2001 (Ea 19.3 / 53.7) |
|---|---|---|---|---|---|
| 2 | 10 | 0.28 | 0.28 | 0.17 | 0.61 / 1.00 |
| 2 | 10⁴ | 0.70 | 0.64 (−9 %) | 0.37 (−47 %) | 1.66 / 2.15 |
| 4 | 10 | 0.58 | 0.56 | 0.34 | 1.22 / 1.99 |
| 4 | 10⁴ | 1.40 | 1.28 (−9 %) | 0.74 (−47 %) | 3.32 / 4.29 |
| 8 | 10 | 0.95 | 1.12 | 0.68 | 2.44 / 3.98 |
| 8 | 10⁴ | 2.79 | 2.56 (−8 %) | 1.47 (−47 %) | 6.64 / 8.58 |

The static/dynamic conversion of Lee 2003 (k = 0.61–0.70) reproduces the static data of the same group within
≈ 10 %. Deng 1998 (linear viscoelastic, 1 MPa) gives about half; Lewis 2001 2.4–3 times more.

### V2 · Takahashi et al. 2016 — liners under 3000 N static, 25 °C, 72 h
Creep-strain rate (10⁻³ per decade of minutes). ArCom = conventional (33 kGy, argon) → preset *conventional*;
E1 = vitamin-E diffused HXLPE → preset *vite-hxlpe*. Load 48° from the cup axis (inclination 45°, anteversion 20°).

| Liner | Ø / wall (mm) | Measured | Lee 2003 | Deng 1998 | Lewis 2001 | MC median (P5–P95) |
|---|---|---|---|---|---|---|
| ArCom | 28 / 4.8 | 5.51 | 4.28 (−22 %) | 3.25 | 8.63 | 4.02 (2.36–10.1) |
| ArCom | 32 / 4.8 | 4.40 | 3.54 (−20 %) | 2.73 | 6.91 | 3.33 (1.95–8.14) |
| ArCom | 28 / 6.8 | 4.60 | 3.72 (−19 %) | 2.78 | 7.74 | 3.42 (2.05–9.05) |
| ArCom | 28 / 8.9 | 4.19 | 3.30 (−21 %) | 2.43 | 7.00 | 3.04 (1.81–8.21) |
| E1 | 28 / 4.8 | 4.76 | 4.64 (−3 %) | 3.53 | 9.50 | 3.98 (2.05–11.1) |
| E1 | 32 / 4.8 | 3.60 | 3.82 (+6 %) | 2.95 | 7.56 | 3.31 (1.70–8.79) |
| E1 | 36 / 4.8 | 3.44 | 3.23 (−6 %) | 2.53 | 6.23 | 2.85 (1.44–7.20) |
| E1 | 28 / 6.8 | 3.88 | 4.04 (+4 %) | 3.02 | 8.47 | 3.36 (1.76–9.90) |
| E1 | 28 / 8.9 | 3.52 | 3.58 (+2 %) | 2.64 | 7.66 | 2.99 (1.55–9.00) |

* Effect of diameter and wall thickness reproduced (28→32 mm: −17 to −18 % vs −20 to −24 % measured;
  4.8→8.9 mm: −23 % vs −24 to −26 %); absolute penetration grows with the wall, as measured.
* Material: measured E1/ArCom ≈ 0.84, model 0.90/0.82 = 1.10 → the *conventional* factor (0.82) is too low.
  Factor implied with Lee 2003: conventional ≈ 1.03 (1.01–1.06), vitamin-E HXLPE ≈ 0.89 (0.85–0.96).
* The rate per decade does not depend on Ea for Lee 2003 (log-linear law).

### V3 · Estok et al. 2005 — liners, 3330 N peak at 2 Hz without motion, 37 °C, measured after 48 h unloaded
Penetration (µm) at 10⁴ / 2·10⁶ / 4·10⁶ cycles. Loading time = cycles / 2 Hz; the model value is the creep left
after 48 h of recovery at 22 °C (R ≈ 0.44 conventional, 0.51 HXLPE).

| Liner | Measured | Lee 2003 (remaining) | MC remaining, median (P5–P95) at 4 M | MC creep before recovery at 4 M |
|---|---|---|---|---|
| Conventional Ø32, 9 mm | 38 / 87 / 97 | 28 / 43 / 43 | 49 (26–170) | 88 |
| HXLPE (Durasul) Ø32, 9 mm | 38 / 97 / 107 | 26 / 40 / 40 | 42 (19–160) | 85 |
| Conventional Ø28, 10.25 mm | 25 / 112 / 132 | 35 / 54 / 54 | 63 (34–219) | 110 |
| HXLPE (Durasul) Ø28, 10.25 mm | 27 / 131 / 155 | 33 / 51 / 51 | 53 (24–202) | 107 |

* Measured values fall inside the 90 % interval but well above the median: the remaining creep is
  under-predicted ≈ 2× (Lee 2003 0.33–0.44 of the measured value). The creep before recovery (70–90 % of the
  measured value) is close, so the gap is in the recovery assumed after 48 h and/or in the growth of creep
  beyond 10⁴ min (Lee 2003 capped; measured +11–18 % between 2 M and 4 M cycles).
* Ø28 > Ø32 reproduced (+25 % vs +36 %). Remelted HXLPE creeps 10–17 % MORE than conventional here, while
  the model gives it less (larger recovery).

### V4 · Bevill et al. 2005 — finite elements, 2000 min of gait loading (trends)
Static 1500 N for 2000 min, 37 °C, E = 1400 MPa, ν = 0.3, unirradiated (the FE law is Lee & Pienkowski 1998).

| Parameter | Bevill | HipCreep (Lee 2003) |
|---|---|---|
| Head 22 → 36 mm (wall 8) | creep decreases | 107 → 61 µm ✔ |
| Wall 4 → 16 mm (Ø32) | creep increases | 50 → 91 µm ✔ |
| Diametral clearance 0.01 → 0.5 mm | creep increases | 56 → 109 µm ✔ |
| Range | 10–75 µm | 50–110 µm (the FE gait loading cannot be reproduced exactly) |

### V5 · Rochcongar et al. 2021 — RSA in vivo, monoblock RM Pressfit cups
Penetration from day 7 to year 1: 160 µm (vitamin-E HXLPE), 200 µm (UHMWPE); wear rate years 1–5 20 / 60 µm/y,
so creep + bedding-in in year 1 ≈ 140 µm (RSA precision 72 µm). Model (28 mm head, 10 mm wall, 78 kg, 2.5 BW):

| Mode | Lee 2003 | Deng 1998 | Lewis 2001 | MC median (P5–P95) |
|---|---|---|---|---|
| Dynamic | 15–18 µm | 9–11 | 52–63 | 17 (8–72) |
| Static | 2–3 (Lee capped at 10⁴ min) | 11–13 | 84–105 | 16 (1–117) |

The uniaxial creep laws explain only 10–15 % of the clinical first-year penetration after day 7: bedding-in in
vivo contains more than compressive creep (settling, sliding-assisted plastic flow, run-in wear, RSA error).

### V6 · Temperature — Galetz & Glatzel 2010, Bergmann et al. 2001
* Galetz: same deformation under tribological loading after 3 M cycles at 23 °C, ≈ 0.9 M at 37 °C, ≈ 0.5 M at
  45 °C → shift 3.3 and 6 → Ea ≈ 15–16 kcal/mol for the macroscopic deformation (the yield Eyring process gives
  200 kJ/mol = 48 kcal/mol). HipCreep: nominal Ea 53.7 → shift 61.5 (23→37 °C); lower bound 19.3 → 4.4.
* Galetz: deformation under sliding keeps growing up to 3 M cycles (≈ 100 → 250 µm at 37 °C), unlike static creep.
* Bergmann: head temperature after 1 h of walking 40.0–43.1 °C (mean 41.3 °C) with PE cups. Effect on the
  dynamic creep (6 months): 62 → 65 µm (+5 %) — small.

### Summary of the baseline
1. Lee 2003 (with the static conversion k) is the most accurate law: within 10 % of V1, 2–22 % of V2, correct trends.
2. Deng 1998 under-predicts (−30 to −50 %); Lewis 2001 over-predicts (×1.6–3); the pooled Monte Carlo is
   therefore wide and its median biased low.
3. Material factors: *conventional* 0.82 too low (data ≈ 1.0); vitamin-E HXLPE 0.90 confirmed; remelted HXLPE ≥ conventional.
4. Remaining creep after a short rest under-predicted ≈ 2× (Estok): recovery and/or creep beyond 10⁴ min.
5. Ea nominal 53.7 kcal/mol is not supported for creep; 15–20 kcal/mol is.
6. In vivo bedding-in (RSA) is much larger than the compressive creep predicted by any law.

## v0.4.0 — after the changes

Changes (all from the papers above):

| Change | v0.3.0 | v0.4.0 | Source |
|---|---|---|---|
| New law | — | Lee & Pienkowski 1998, static, 36.5 °C | Lee 1998 |
| Monte Carlo laws | Lee 2003, Deng 1998, Lewis 2001 | Lee 2003, Lee 1998 (Deng, Lewis shown as references) | V1, V2 |
| Lee laws beyond 10⁴ min | cap / log sampled | log-linear | Lee 1998 (steady rate), Estok 2005 |
| Ea | 19.3–53.7, nominal 53.7 | 15–20, nominal 17 | Galetz 2010, Burger 2006 |
| Conventional factor | 0.82 (0.76–1.0) | 1.0 (0.85–1.2) | Takahashi 2016 |
| HXLPE factor | 0.90 (0.55–1.14), one grade | remelted 1.13 · annealed 0.85 · vitamin-E 0.86 · unspecified 1.0 | Estok 2005, Takahashi 2016, Burger 2006 |
| Recovery R₁₀ₖ lower bound | 0.40 (conv.) / 0.45 (HXLPE) | 0.30 / 0.35 | Galetz 2010 (permanent strain grows with loading time) |

### Before / after

| Check | Metric | v0.3.0 | v0.4.0 |
|---|---|---|---|
| V2 Takahashi (calibration) | MC median error, ArCom | −24 to −27 % | −7 to −11 % |
| | MC median error, E1 | −8 to −17 % | −3 to −14 % |
| | 90 % interval width (ArCom Ø28/4.8) | 2.36–10.1 (×4.3) | 3.40–6.79 (×2.0) |
| | E1 / ArCom ratio (measured 0.86) | 1.10 | 0.87 |
| **V3 Estok (independent)** | creep before recovery, 4 M cycles (MC median) | −9 to −31 % | **+3 to +17 %** |
| | remaining after 48 h, 4 M cycles (MC median) | −49 to −66 % | −30 to −46 % |
| | measured inside the 90 % interval (remaining) | 4 / 4 (interval very wide) | 0 / 4 (P95 95–122 vs 97–155) |
| | remelted HXLPE vs conventional (measured +10–17 %) | −14 to −16 % | +10 % (before recovery) |
| V4 Bevill (independent) | trends with head, wall, clearance | ✔ ✔ ✔ | ✔ ✔ ✔ |
| V5 Rochcongar (independent) | creep day 7 → year 1, dynamic (≈ 140 µm creep + bedding-in) | 17 µm | 22–25 µm |
| V6 Galetz (independent) | a_T 23 → 37 °C (measured ≈ 3.3) | 61.5 | 3.2–4.6 (nominal 3.7) |

### Estok 2005 in detail (v0.4.0, MC median and 90 % interval, µm)

| Liner | Measured 10⁴ / 2 M / 4 M | Remaining after 48 h | Creep before recovery, 4 M |
|---|---|---|---|
| Conventional Ø32 | 38 / 87 / 97 | 38 / 65 / 68 (49–95) | 113 |
| Remelted HXLPE Ø32 | 38 / 97 / 107 | 37 / 63 / 66 (42–97) | 125 |
| Conventional Ø28 | 25 / 112 / 132 | 48 / 83 / 87 (63–118) | 143 |
| Remelted HXLPE Ø28 | 27 / 131 / 155 | 46 / 79 / 84 (55–122) | 159 |

### What is left

1. **Recovery after long loading (open).** With the new creep the creep before recovery matches Estok within
   3–17 %, but the model still removes ≈ 40 % for the 48 h of rest, while Estok's penetration after 48 h equals the
   full creep. Lee & Pienkowski's 51 % was measured after 10⁴ min of loading; Galetz shows the permanent part grows with
   the loading time. A recovery that decreases with the loading duration would close the gap, but it would have to be
   fitted on Estok, which would then stop being an independent check — decision pending.
2. **In vivo bedding-in (not modelled).** The compressive creep laws explain ≈ 15–25 % of the first-year RSA
   penetration after day 7; sliding-assisted plastic flow (Galetz: deformation still growing at 3 M cycles), seating and
   run-in wear are outside the model.
3. Bevill's magnitudes (10–75 µm) are below the model (50–110 µm) because their gait loading over 2000 min cannot be
   reproduced exactly; only the trends are compared.

## v0.5.0 — recovery scenarios

Change: the recovery is reported in two scenarios instead of one (the Monte Carlo samples both, 50/50, and keeps
them apart):

* **Lee & Pienkowski** — R₁₀ₖ of the material preset (conventional 0.51, 0.30–0.60): recovery after 7 days of loading,
  the upper bound.
* **Long loading** — R₁₀ₖ ∈ [0, 0.15] for every grade: Galetz 2010 (the permanent strain grows strongly with the loading
  time) and the absence of recovery after 48 h in Estok 2005 after ≈ 23 days of loading. Not fitted: the range only
  states that the recovery of a liner loaded for months or years may be close to zero.

The report shows both scenarios in the summary table, the decomposition table and the deterministic table, and the
verdict uses their envelope. Estok is used as a consistency check (it must fall inside the envelope).

### Estok 2005 (v0.5.0, remaining after 48 h at 4 M cycles, µm, loading time = cycles / 2 Hz)

| Liner | Measured | L&P scenario | Long-loading scenario | Envelope P5–P95 | Inside |
|---|---|---|---|---|---|
| Conventional Ø32 | 97 | 68 (48–92) | 107 (82–131) | 51–128 | ✔ |
| Remelted HXLPE Ø32 | 107 | 64 (42–94) | 119 (91–150) | 46–143 | ✔ |
| Conventional Ø28 | 132 | 86 (63–116) | 135 (106–169) | 66–160 | ✔ |
| Remelted HXLPE Ø28 | 155 | 80 (54–120) | 151 (118–188) | 58–178 | ✔ |

Long-loading scenario vs measured: +10 %, +11 %, +2 %, −3 %. Same result with loading time = cycles (8 / 8 inside).

### Before / after (all versions)

| Check | Metric | v0.3.0 | v0.4.0 | v0.5.0 |
|---|---|---|---|---|
| V2 Takahashi (calibration) | MC median error ArCom / E1 | −24…−27 % / −8…−17 % | −7…−11 % / −3…−14 % | −10…−13 % / −5…−17 % |
| V3 Estok (independent) | remaining, median error | −49…−66 % | −30…−46 % | L&P −30…−48 %; long loading −3…+11 % |
| | measured inside the 90 % interval | 4 / 4 (very wide) | 0 / 4 | 4 / 4 (envelope 46–188 µm) |
| | creep before recovery | −9…−31 % | +3…+17 % | +2…+16 % |
| V4 Bevill (independent) | trends | ✔ | ✔ | ✔ |
| V5 Rochcongar (independent) | creep day 7 → year 1 (≈ 140 µm clinical) | 17 µm | 22–25 µm | 21–24 µm |
| V6 Galetz (independent) | a_T 23 → 37 °C (≈ 3.3) | 61.5 | 3.2–4.6 (nominal 3.7) | 3.2–4.6 (nominal 3.7) |

Still open: in vivo bedding-in (V5) is outside the model (sliding-assisted plastic flow, seating, run-in wear).
