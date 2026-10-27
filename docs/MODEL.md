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
| Deng et al. 1998 (Eq. 2) | compression-moulded GUR 405; 1 MPa; master curve validated to 30 days | 37 °C | static | `ε = σ·[D(t) − D(10 s)]`, `D = 1.294·(log₁₀ t_s)^0.507` GPa⁻¹ |
| Lewis & Carroll 2001 (control) | ram-extruded GUR 1050; 6.89 MPa; 1 h, ASTM D621 | 22 °C | static | `ε = σ·0.0644·[(log₁₀ t_s)^1.4119 − 1] / 100` |

Checks against the papers (unit tests): Lee 8 MPa at 10⁴ min → 1.66·10⁻² (paper 1.637·10⁻²); Deng `D(1 month) = 3.320`,
`D(1 y) = 3.594` GPa⁻¹ (Table III); Lewis 5 MPa, 10 years → 6.5 % (Table 3).

Extrapolations are flagged in the results table: Lee beyond 10⁴ min (option: *saturates* — the authors observed a
steady state after ≈ 4·10³ min — or *continues log-linearly*), Deng above 1 MPa (linear viscoelastic, it
under-predicts at hip stresses), Lewis beyond 1 h (its `(log t)^1.41` grows fast; it is the upper end of the range).

### Loading modes

* **Static** — the peak walking force held constant during the whole implantation time (upper bound).
* **Dynamic** — 1 Hz gait cycles with that peak, during the cumulative walking time
  `t = N_cycles / f`, `N_cycles = cycles/year × years` (default 1 million cycles/year, range 0.5–2 M).
* Conversion (Lee 2003): creep under a 1 Hz cycle with peak `p` ≈ static creep at `k·p`, `k = 0.61–0.70`
  (64 %, 70 %, 61 % at 2, 4, 8 MPa). A static law in dynamic mode sees `σ·k`; the dynamic law in static mode `σ/k`.

### Temperature

Time–temperature superposition with an Arrhenius shift (Deng 1998): the creep at `T` during `t` equals the creep at
the law temperature `T₀` during `t·a_T`,

```
a_T = exp[(Ea/R)·(1/T₀ − 1/T)]
```

* `Ea = 53.7 kcal/mol` — Deng 1998, UHMWPE in compression (fitted 37–62 °C).
* `Ea ≈ 19.3 kcal/mol` — reproduces Burger 2006 (Table 3.2: creep after 2 h at 8 MPa 0.79 mm at room temperature vs
  1.08 mm at 40 °C → +31 % at 37 °C) when applied to the Lewis law.
* The Monte Carlo samples Ea between both. Lee and Deng are already at 37 °C; only Lewis (22 °C) is shifted when the
  in vivo temperature is 37 °C. The results table shows every law both at its own temperature and at 37 °C.

## 3. Polyethylene grades

The laws were measured on unirradiated UHMWPE; other grades multiply the creep strain by a factor:

| Grade | Creep factor (nominal, range) | Source |
|---|---|---|
| Unirradiated | 1 | — |
| Conventional, γ-sterilised 25–40 kGy | 0.82 (0.76–1.0) | Burger 2006, Table 3.3 (air 0.76, N₂ 0.82, annealed 0.95) |
| Highly cross-linked | 0.90 (0.55–1.14) | Burger 2006 Table 3.4 (0.55–0.73), Lewis 2001 Table 3 (1.12–1.14), Glyn-Jones 2008 RSA (≈ 0.96) |
| Vitamin-E HXLPE | as HXLPE | no specific creep law |

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
* `R₁₀ₖ`: conventional / unirradiated 0.51 (0.40–0.60; lower values allow for months-long in vivo creep being more
  plastic). Cross-linked PE recovers more strain than conventional (strain-recovery tests; Takahashi et al. 2016
  report "considerable" shape recovery of vitamin-E HXLPE liners, half of it within 5 min) but no percentage is
  published: 0.60 (0.45–0.75) is an **assumption**.
* Other data: Metin & Cengil 2016 (tensile, room temperature, 1 h creep + 1 h recovery): 68–88 % of the total strain
  (elastic included) recovered at 5–13 MPa, less at higher stress. Crissman & Zapas (NIST reports 1983–84): recovery
  plateaus at a finite, non-recoverable ("plastic") strain. Zeman et al. 2018 waited 12 h after loading to measure only
  permanent deformation.

## 5. Monte Carlo and verdict

Each sample draws one law (uniformly among the enabled ones) and: peak force (U 2.3–2.8 BW), cycles/year (log-uniform
0.5–2 M), `k` (U 0.61–0.70), E (U 500–900 MPa), ν (U 0.40–0.46), wall thickness (N), clearance (U), Ea (U 19.3–53.7),
material factor (U), Lee extrapolation and recovery kinetics (50/50), `R₁₀ₖ` (U), and the measured `D` (N with the
HipWear SD). Static and dynamic modes are computed for every sample.

Verdict per mode:

* **Small signal** — median remaining creep ≤ 2·SD of the measurement, or `D` ≤ max(2·SD, detection limit):
  creep is of the same order as the measurement uncertainty and cannot be separated from wear.
* **Inconsistent** — in more than half of the samples the remaining creep exceeds `D`: the whole penetration is
  compatible with creep (or the model over-predicts for this liner).
* **Separable** — wear and remaining creep reported with their 90 % intervals.

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

## 7. Not modelled

Backside creep and liner seating in the shell, frictional heating, oxidation, impingement/edge loading, wear–creep
interaction during the run-in, intermittent daily unloading. In vivo RSA "bedding-in" (Glyn-Jones 2008: 0.26 ± 0.17 mm
in the first 6 months) includes some of these and is larger than material creep alone (simulator 40–50 µm after
50 000 cycles, Zeman 2018; FE 32–90 µm).

## References

* Lee K-Y, Pienkowski D, Lee S. Dynamic compressive creep of extruded ultra-high molecular weight polyethylene. KSME Int J. 2003;17(9):1332–1338.
* Deng M, Latour RA, Ogale AA, Shalaby SW. Study of creep behavior of ultra-high-molecular-weight polyethylene systems. J Biomed Mater Res. 1998;40:214–223.
* Lewis G, Carroll M. Effect of crosslinking UHMWPE on its tensile and compressive creep performance. Bio-Med Mater Eng. 2001;11:167–183.
* Lee K-Y, Pienkowski D. Viscoelastic recovery of creep-deformed ultra-high molecular weight polyethylene (UHMWPE). ASTM STP 1307, 1998:30–36.
* Burger NDL. Creep analysis for UHMWPE; Preliminary investigation of retrieved acetabular cups (Ch. 3–4). PhD thesis, University of Pretoria, 2006.
* Metin F, Cengil M. Short-term creep and recovery behavior of medical grade UHMWPE. J Achiev Mater Manuf Eng. 2016;78(2):65–70.
* Zeman J, Ranuša M, Vrbka M, Gallo J, Křupka I, Hartl M. UHMWPE acetabular cup creep deformation during the run-in phase of THA's life cycle. J Mech Behav Biomed Mater. 2018;87:30–39.
* Glyn-Jones S, McLardy-Smith P, Gill HS, Murray DW. The creep and wear of highly cross-linked polyethylene: a three-year randomised, controlled trial using radiostereometric analysis. J Bone Joint Surg Br. 2008;90-B(5). doi:10.1302/0301-620X.90B5.20545
* Takahashi et al. Post-deformation shape-recovery behavior of vitamin E-diffused, radiation crosslinked polyethylene acetabular components. J Mech Behav Biomed Mater. 2016 (PMID 27454526).
* Crissman JM, Zapas LJ. NBSIR 83-2696 and NBSIR 84-2808 (UHMWPE creep and recovery). National Bureau of Standards.
* Saffarini M, Gregory T, Vandenbussche E. Quantification of clearance and creep in acetabular wear measurements. Ann Transl Med. 2016;4(7):131.
