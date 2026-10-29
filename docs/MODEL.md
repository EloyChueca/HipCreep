# HipCreep — model and assumptions

HipCreep estimates the creep (cold flow) of a UHMWPE acetabular liner during its time in vivo, how much of it
recovers before the explanted liner is scanned, and how the penetration measured by HipWear splits into
**remaining creep** and **wear**. It is an analytic model (no finite elements): the whole Monte Carlo runs in the
browser in a few seconds.

```
D_measured = W + C_rem          C_rem = C_max · (1 − R)
```

* `C_max` — creep penetration at explantation (creep model, section 2)
* `R` — fraction of it recovered between explantation and scanning (section 4)
* `W` — wear (material actually removed)

With a single scan `W` and `C_rem` cannot be separated geometrically (a removed volume and a displaced volume leave
the same depression), so the split relies on the models plus the measurement uncertainty, and is reported as a
distribution. A model-independent **lower bound** of the creep comes from the elevations (section 6).

---

## 1. Contact pressure

Ball-in-socket elastic-foundation model (thin layer bonded to a rigid shell):

```
p(ψ, φ) = k_f · ⟨ e·cosψ − c − w(ψ, φ) ⟩          k_f = E_f / h,   E_f = (1 − ν) E / [(1 + ν)(1 − 2ν)]
F = Σ p · cosψ · dA                                  (solved for the head displacement e, Newton)
```

* `ψ` angle from the load axis, `φ` azimuth about it, `c` radial clearance, `h` wall thickness,
  `w` creep already accumulated.
* Without clearance this reduces to `p₀ = 3F / (2πR²)` (checked in the tests).
* Cells beyond the rim (angle from the cup pole > coverage, 90° by default) carry no load.
* Load axis = penetration direction of the HipWear two-sphere model (angle from the cup axis).
* `F = k_BW · m · g`, peak hip contact force in walking `k_BW = 2.3–2.8` (Bergmann et al., as cited by Metin & Cengil 2016).

## 2. Creep through the wall

* Stress decays through the wall as `σ(r) = p · (R/r)²` (load spreading in a cone).
* Each of the wall layers follows the chosen creep law with a **strain-hardening** rule; the contact pressure is
  re-solved as the liner creeps ("conform" option), with adaptive sub-steps so that one step never changes the
  pressure by more than 25 % (35 % in the Monte Carlo).
* Penetration `w = κ · Σ ε_layer · Δr`; `κ = 1` uses the uniaxial creep strain (upper bound for a metal-backed liner).

### Creep laws (creep part only — the elastic strain is excluded because the liner is measured unloaded)

| Law | Material / test | Native T | Loading | Creep strain |
|---|---|---|---|---|
| Lee, Pienkowski & Lee 2003 | extruded GUR 4151HP, unirradiated; 1 Hz, p_max 2–8 MPa, R = 0.1, bovine serum, 10–10⁴ min | 37 °C | dynamic | `ε = p_max·[2.076·10⁻³ + 3.897·10⁻⁴·(log₁₀ t_min − 4)]` |
| Lee & Pienkowski 1998 (v0.4) | extruded GUR 4150HP, unirradiated; static 2–8 MPa, bovine serum, 10–10⁴ min | 36.5 °C | static | `ε = p·[3.491·10⁻³ + 7.966·10⁻⁴·(log₁₀ t_min − 4)]` |
| Deng et al. 1998 (Eq. 2) | compression-moulded GUR 405; 1 MPa; master curve validated to 30 days | 37 °C | static | `ε = σ·[D(t) − D(10 s)]`, `D = 1.294·(log₁₀ t_s)^0.507` GPa⁻¹ |
| Lewis & Carroll 2001 (control) | ram-extruded GUR 1050; 6.89 MPa; 1 h, ASTM D621 | 22 °C | static | `ε = σ·0.0644·[(log₁₀ t_s)^1.4119 − 1] / 100` |

Checks against the papers (unit tests): Lee 8 MPa at 10⁴ min → 1.66·10⁻² (paper 1.637·10⁻²); Deng `D(1 month) = 3.320`,
`D(1 y) = 3.594` GPa⁻¹ (Table III); Lewis 5 MPa, 10 years → 6.5 % (Table 3).

Extrapolations are flagged in the results table: the Lee laws beyond 10⁴ min (default since v0.4: *continues
log-linearly* — Lee & Pienkowski 1998 report a steady creep **rate** after ≈ 4·10³ min and Estok 2005 measured further
penetration between 2 and 4 M cycles; option: *saturates*), Deng above 1 MPa (linear viscoelastic, it under-predicts
at hip stresses), Lewis beyond 1 h (its `(log t)^1.41` grows fast).

**Monte Carlo laws (v0.4).** The validation (docs/VALIDATION.md) showed that the two Lee laws reproduce the material
and liner data (Lee 2003 → static with k = 0.65 is within 10 % of Lee 1998), while Deng 1998 under-predicts by 30–50 %
and Lewis 2001 over-predicts by ×1.6–3. By default the Monte Carlo samples only Lee 2003 and Lee 1998; Deng and Lewis
are still computed and shown as references (form: second checkbox of each law).

### Loading modes

* **Static** — the peak walking force held constant during the whole implantation time (upper bound).
* **Dynamic** — 1 Hz gait cycles with that peak, during the cumulative walking time
  `t = N_cycles / f`, `N_cycles = cycles/year × years` (default 1 million cycles/year, range 0.5–2 M).
* Conversion (Lee 2003): creep under a 1 Hz cycle with peak `p` ≈ static creep at `k·p`, `k = 0.61–0.70`
  (64 %, 70 %, 61 % at 2, 4, 8 MPa). A static law in dynamic mode sees `σ·k`; the dynamic law in static mode `σ/k`.

### Long-term creep in vivo: clinical saturation (v0.12)

The laboratory laws were measured over 10⁴ min (7 days), while the liners carry load for years. RSA studies show
that in vivo the creep is practically complete within the first months: ≈ 95 % within 6 months and nearly all within
the first year (Glyn-Jones 2008, 3-year RCT), stable after 3 months (Bergvinsson 2021, 10 years). By default the
creep law is therefore run to an effective loading time

```
t_eff = t_s · (1 − e^(−T/t_s))
```

where `T` is the physical loading time (static: the time in vivo; dynamic: cycles / gait frequency) and `t_s` the
loading time accumulated during the first `y_s` years in vivo (`y_s` U(0.5, 2) years, nominal 1). Early on
`t_eff ≈ T` (the laboratory law is unchanged); for long implantation `t_eff → t_s` and the creep stops growing. With
the Lee 2003 law in dynamic mode, 94 % of the 20-year creep is reached at 6 months (80 % with the laboratory law alone), as in the RSA data. The magnitude
still comes from the laboratory law, the contact model and the material; only the time course is clinical (no data
of the analysed liners are used). Option "Laboratory law only" restores the previous behaviour. For the 30 liners of
the RV series the creep at explantation of liners implanted for more than ≈ 2 years is 10–17 % lower; liners
implanted for less than a year are unchanged.

### Inputs taken from HipWear: plausibility checks (v0.12)

* A penetration direction more than 90° from the cup axis (beyond the cup face) is not used as the load axis of
  the creep model (rim damage, subluxation or a two-sphere fit that followed the rim); the default load angle is
  used and a warning is shown.
* A wall thinner than 2 mm (back surface not separated from the bearing surface in HipWear) is ignored; the
  default or manual thickness is used.

### Temperature

Time–temperature superposition with an Arrhenius shift (Deng 1998): the creep at `T` during `t` equals the creep at
the law temperature `T₀` during `t·a_T`,

```
a_T = exp[(Ea/R)·(1/T₀ − 1/T)]
```

* `Ea ≈ 15.5 kcal/mol` — Galetz & Glatzel 2010: the same deformation under sliding (Paul-type load) after 3 M cycles
  at 23 °C, ≈ 0.9 M at 37 °C and ≈ 0.5 M at 45 °C (a_T ≈ 3.3 and 6).
* `Ea ≈ 19.3 kcal/mol` — reproduces Burger 2006 (Table 3.2: creep after 2 h at 8 MPa 0.79 mm at room temperature vs
  1.08 mm at 40 °C → +31 % at 37 °C) when applied to the Lewis law.
* v0.4 default: U(15, 20), nominal 17 kcal/mol. Deng's 53.7 kcal/mol (fitted 37–62 °C, used until v0.3) gives
  a_T(23→37 °C) = 61, twenty times the measured shift; Galetz's Eyring yield analysis (≈ 48 kcal/mol) describes the
  yield stress, not the creep penetration.
* Bergmann et al. 2001: after 1 h of walking the head reaches 40.0–43.1 °C (mean 41.3 °C, PE cups). With the
  default Ea this raises the dynamic creep by ≈ 3–5 %; the in vivo temperature stays at 37 °C by default.

## 3. Polyethylene grades

The laws were measured on unirradiated UHMWPE; other grades multiply the creep strain by a factor:

| Grade | Creep factor (nominal, range) | Source |
|---|---|---|
| Unirradiated | 1 | — |
| Conventional, γ-sterilised 25–40 kGy (e.g. ABG I, γ in air; oxidised liners: creep data are for non-oxidised PE) | 1.0 (0.85–1.2) | Takahashi 2016 (ArCom liners, 3000 N, 72 h): 0.89 (Lee 1998) – 1.33 (Lee 2003) at 0.05 mm clearance; Burger 2006 (0.82–0.95, 2 h RT) as low end |
| ABG II — Duration (γ 30 kGy N₂ + annealed 50 °C, 144 h) | 1.0 (0.85–1.15) | Röhrl 2005 RSA: same early creep as γ-in-air and 100 kGy annealed; Burger 2006: annealing ×1.16 at 2 h, RT; = dose model (annealed, 30 kGy) |
| HXLPE, remelted | 1.13 (0.96–1.36) | Estok 2005: +10–17 % vs conventional in identical liners; Lewis 2001 Table 3: ×1.12–1.14 |
| HXLPE, annealed | 0.85 (0.73–1.0) | no liner data — Burger 2006 (125 kGy: 0.73), Takahashi 2014 (highest shape-recovery force) |
| Vitamin-E HXLPE | 0.86 (0.73–1.03) | Takahashi 2016: E1/ArCom = 0.86 in 9 liner sizes |
| HXLPE, unspecified | 1.0 (0.73–1.36) | envelope of the three |

**By radiation dose and thermal treatment (v0.7).** Factor interpolated linearly between anchors (dose in kGy → factor):
none 0 → 1, 33 → 1.0 (Takahashi 2016), 50–150 → 1.12–1.14 (Lewis 2001); annealed 30 → 1.0 (Duration, Röhrl 2005),
100 → 0.85 (Crossfire/X3), 125 → 0.73 (Burger 2006); remelted 30 → 1.0, 95–150 → 1.13 (Estok 2005, Lewis 2001);
vitamin E 30 → 1.0, 133 → 0.86 (Takahashi 2016). Constant beyond the last anchor (flagged). Range ±15 %; recovery as
conventional below 50 kGy and as cross-linked above.

v0.3 used 0.82 for conventional and 0.90 (0.55–1.14) for every HXLPE; the validation showed the conventional factor
was too low and that the grades differ in sign (remelted creeps more than conventional, vitamin-E less).

## 4. Recovery after explantation

Lee & Pienkowski (1998, ASTM STP 1307): unirradiated GUR 4150HP crept 10⁴ min at 37 °C in serum (static and 1 Hz
dynamic, 2–8 MPa), then recovered unloaded **in air** (room temperature) for 10⁴ min:

* recovered strain linear in log(time);
* 73 % of the recovered strain within the first 1000 min;
* ≈ 51 % of the creep recovered in total, independently of load amplitude, static/dynamic loading and location.

```
h(t) = 0.73 + 0.27·log₁₀(t_min / 1000)      R(t) = R₁₀ₖ · h(t)
```

* `h = 1` at 10⁴ min (≈ 7 days). Liners usually wait weeks: *plateau* keeps `R = R₁₀ₖ`; *log* continues the trend
  (4 weeks → `h = 1.16`). Both are sampled.
* Creep at 37 °C, recovery at room temperature (22 °C) is exactly the condition of these tests. Another storage
  temperature shifts the recovery time with the same Arrhenius factor.
* `R₁₀ₖ`: conventional / unirradiated 0.51 (0.30–0.60). Galetz & Glatzel 2010 found that the permanent strain grows
  strongly with the loading time (500 s vs 3.5 days); in vivo loading lasts months, so the lower bound is 0.30
  (0.40 until v0.3). Cross-linked PE recovers more strain than conventional (strain-recovery tests; Takahashi et al. 2016
  report "considerable" shape recovery of vitamin-E HXLPE liners, half of it within 5 min) but no percentage is
  published: 0.60 (0.45–0.75) is an **assumption**.
* **Recovery scenarios (v0.5).** Lee & Pienkowski loaded for 7 days; a liner is loaded for months or years. Galetz &
  Glatzel 2010 found that the permanent strain grows strongly with the loading time, and Estok et al. 2005 measured,
  after ≈ 23 days of cyclic loading and 48 h unloaded, the full creep. HipCreep therefore reports two scenarios:
  *Lee & Pienkowski* (R₁₀ₖ of the grade, upper bound of recovery) and *long loading* (R₁₀ₖ ∈ [0, 0.15], all grades).
  The Monte Carlo samples both (50/50) and reports them separately; the verdict uses their envelope. The form allows
  one scenario only.
* Other data: Metin & Cengil 2016 (tensile, room temperature, 1 h creep + 1 h recovery): 68–88 % of the total strain
  (elastic included) recovered at 5–13 MPa, less at higher stress. Crissman & Zapas (NIST reports 1983–84): recovery
  plateaus at a finite, non-recoverable ("plastic") strain. Zeman et al. 2018 waited 12 h after loading to measure only
  permanent deformation.

## 5. Monte Carlo and verdict

Each sample draws one law (uniformly among the Monte Carlo laws, by default Lee 2003 and Lee 1998) and: peak force (U 2.3–2.8 BW), cycles/year (log-uniform
0.5–2 M), `k` (U 0.61–0.70), E (U 500–900 MPa), ν (U 0.40–0.46), wall thickness (N), clearance (U), Ea (U 15–20),
material factor (U), Lee extrapolation and recovery kinetics (50/50), `R₁₀ₖ` (U), and the measured `D` (N with the
HipWear SD). Since v0.11 the static and the dynamic modes are **two independent Monte Carlo simulations**: each draws
its own n samples of every input from its own random stream (the dynamic one keeps the case seed), so the two
results do not share sampling noise and can be compared as separate estimates.

Verdict per mode:

* **Small signal** — median remaining creep ≤ 2·SD of the measurement, or `D` ≤ max(2·SD, detection limit):
  creep is of the same order as the measurement uncertainty and cannot be separated from wear.
* **Inconsistent** — in more than half of the samples the remaining creep exceeds `D`: the whole penetration is
  compatible with creep (or the model over-predicts for this liner).
* **Separable** — wear and remaining creep reported with their 90 % intervals.

## 5b. Sensitivity and time before scanning (v0.6)

* **Sensitivity**: Spearman rank correlation ρ between each sampled input (force, cycles, k, E, ν, wall, clearance,
  Ea, material factor, R₁₀ₖ, law, recovery scenario, extrapolation and kinetics switches, measured D) and the remaining
  creep or the wear, over the Monte Carlo samples. ρ² ≈ share of the spread explained by that input (monotonic effects).
* **Time before scanning**: the creep at explantation of every sample is kept, so the remaining creep and the wear are
  recomputed for 1 hour – 3 years unloaded without new simulations, for both recovery scenarios.

## 5c. Series of liners (v0.6)

Several HipWear exports are run with the shared inputs of the sidebar plus what each file provides (head, wall,
clearance, load direction, penetration, surface); years in vivo, polyethylene, body mass and days ex vivo can be edited
per liner. Output per liner: D, creep at explantation, remaining creep and wear in each recovery scenario, elevation
bound and its consistency with each scenario, verdict; charts of D vs remaining creep and of wear vs time in vivo; CSV.

## 6. Sphere → plane and the minimum creep

Every vertex of the inner surface is expressed about the centre of the **original** sphere (two-sphere model):
`dev = |v − O| − R_ref` (positive = penetration, negative = elevation) and projected azimuthally about the cup
pole (penetration direction up). `R_ref` is the measured radius of the unworn cavity (default) or the commercial
radius.

Wear cannot create material above the original surface; creep (plastic flow) conserves volume, so the volume of the
elevations is a lower bound of the creep still present:

```
V_elev(k) = Σ A_i · ⟨−dev_i − k·σ⟩                (k = 1, 2, 3;  σ = √(σ_noise² + u_surface²), ×0.8/1/1.2)
V_noise(k) = A · [σ·φ(k) − kσ·(1 − Φ(k))]          (what pure Gaussian noise would give)
V_net = V_elev − V_noise
C_min = V_net / ∫(w / w_max) dA                     (peak depth of a creep field with the model's shape)
```

Caveats shown in the report: each µm of error in `R_ref` changes `V_elev` by `A·1 µm` (≈ 1 mm³ for a 28 mm liner), and
form error of the liner also produces elevations — they should sit at the edge of the contact zone, where creep flow is
expected (Zeman et al. 2018 measured 20–30 µm elevations at the rim after the run-in).

### Elevated zone as measured (v0.13)

Reported for every liner with a surface, without any creep or wear model and without threshold: the area and the
volume of all the material above the original sphere (rim band excluded), the highest point and its angle from the
pole, and the mean elevation of the highest 1 mm² (less sensitive to a single noisy vertex). The volume above 2σ of
the scanner noise with the noise floor subtracted (the value used for the minimum creep) is given next to it. On the
phantom the measured volume is within 4 % of the true elevation volume; the highest point exceeds the true peak by
about 3σ of the noise. Elevations also come from errors of the reference radius or centre (≈ analysed area × radius
error: ≈ 0.5–0.8 mm³ per µm), out-of-roundness and rim or flange features, so large volumes on short implantations
or peaks next to the rim point to the reference rather than to creep.

## 7. Not modelled

Backside creep and liner seating in the shell, frictional heating, oxidation, impingement/edge loading, wear–creep
interaction during the run-in, intermittent daily unloading. In vivo RSA "bedding-in" (Glyn-Jones 2008: 0.26 ± 0.17 mm
in the first 6 months) includes some of these and is larger than material creep alone (simulator 40–50 µm after
50 000 cycles, Zeman 2018; FE 32–90 µm).

## References

* Lee K-Y, Pienkowski D, Lee S. Dynamic compressive creep of extruded ultra-high molecular weight polyethylene. KSME Int J. 2003;17(9):1332–1338.
* Deng M, Latour RA, Ogale AA, Shalaby SW. Study of creep behavior of ultra-high-molecular-weight polyethylene systems. J Biomed Mater Res. 1998;40:214–223.
* Lee K-Y, Pienkowski D. Compressive creep characteristics of extruded ultrahigh-molecular-weight polyethylene. J Biomed Mater Res. 1998;39:261–265.
* Takahashi Y, et al. Size and thickness effect on creep behavior in conventional and vitamin E-diffused highly crosslinked polyethylene for total hip arthroplasty. J Mech Behav Biomed Mater. 2016;62:399–406.
* Estok DM, et al. The measurement of creep in ultrahigh molecular weight polyethylene. J Arthroplasty. 2005;20:239–243.
* Galetz MC, Glatzel U. An activated energy approach for accelerated testing of the deformation of UHMWPE in artificial joints. J Mech Behav Biomed Mater. 2010;3:331–338.
* Bergmann G, et al. Frictional heating of total hip implants. Part 1: measurements in patients. J Biomech. 2001;34:421–428.
* Lewis G, Carroll M. Effect of crosslinking UHMWPE on its tensile and compressive creep performance. Bio-Med Mater Eng. 2001;11:167–183.
* Lee K-Y, Pienkowski D. Viscoelastic recovery of creep-deformed ultra-high molecular weight polyethylene (UHMWPE). ASTM STP 1307, 1998:30–36.
* Burger NDL. Creep analysis for UHMWPE; Preliminary investigation of retrieved acetabular cups (Ch. 3–4). PhD thesis, University of Pretoria, 2006.
* Metin F, Cengil M. Short-term creep and recovery behavior of medical grade UHMWPE. J Achiev Mater Manuf Eng. 2016;78(2):65–70.
* Zeman J, Ranuša M, Vrbka M, Gallo J, Křupka I, Hartl M. UHMWPE acetabular cup creep deformation during the run-in phase of THA's life cycle. J Mech Behav Biomed Mater. 2018;87:30–39.
* Glyn-Jones S, McLardy-Smith P, Gill HS, Murray DW. The creep and wear of highly cross-linked polyethylene: a three-year randomised, controlled trial using radiostereometric analysis. J Bone Joint Surg Br. 2008;90-B(5). doi:10.1302/0301-620X.90B5.20545
* Takahashi et al. Post-deformation shape-recovery behavior of vitamin E-diffused, radiation crosslinked polyethylene acetabular components. J Mech Behav Biomed Mater. 2016 (PMID 27454526).
* Crissman JM, Zapas LJ. NBSIR 83-2696 and NBSIR 84-2808 (UHMWPE creep and recovery). National Bureau of Standards.
* Saffarini M, Gregory T, Vandenbussche E. Quantification of clearance and creep in acetabular wear measurements. Ann Transl Med. 2016;4(7):131.
