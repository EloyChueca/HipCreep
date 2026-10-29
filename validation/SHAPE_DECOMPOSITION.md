# Separating creep and wear from the shape of the worn surface — feasibility test (29 Oct 2026)

**Question.** Can the HipWear deviation map of one retrieved liner be split into a creep footprint and a wear
footprint by their shape, without a creep law?

**Test.** `validation/shape_decomposition.py` fits, by least squares on the measured deviation map,

```
dev(x) = δc·n̂  +  t·n̂·[worn]  +  ρ_w·[worn]  +  ρ_u·[unworn]  +  a·S_c(x)
```

* `δc·n̂`: error of the original sphere centre (whole surface); `t·n̂·[worn]`: rigid translation of the head in the
  worn zone (two-sphere geometry, any direction); `ρ_w`, `ρ_u`: radius offsets of both zones;
* `S_c`: pressure-shaped creep footprint, `(cos ψ − cos ψ_c)/(1 − cos ψ_c)` inside the contact half-angle ψ_c about
  the penetration axis (the Winkler pressure with clearance), maximum 1. Only its non-rigid part can be identified:
  its rigid part is absorbed by the translation.
* `a` is the fitted creep depth (µm); its SE comes from a block bootstrap over 15° × 30° patches.

**Data.** The 18 RV liners with a detected penetration (`ARTICULO 3/Archivos JSON`).

| Liner | D (µm) | a, ψ_c = 50° | a, ψ_c = 65° | a, ψ_c = 80° |
|---|---|---|---|---|
| RV-H005 | 1760 | 251 ± 30 | 461 ± 53 | 1345 ± 196 |
| RV-H006 | 2943 | 296 ± 33 | 603 ± 49 | 2163 ± 127 |
| RV-H027 | 1558 | 31 ± 27 | 27 ± 25 | 85 ± 55 |
| RV-H040 | 414 | 127 ± 38 | 211 ± 53 | 550 ± 111 |
| RVH003 | 2191 | 1096 ± 274 | 1141 ± 157 | 2232 ± 374 |
| RVH013 | 2798 | 174 ± 115 | 520 ± 143 | 1916 ± 244 |
| RV-H041 | 418 | 165 ± 69 | 177 ± 79 | 348 ± 148 |
| RV-H042 | 648 | 52 ± 20 | 100 ± 28 | 327 ± 69 |
| rv-h017 | 350 | 14 ± 7 | 42 ± 14 | 178 ± 43 |
| rv-h022 | 3862 | 752 ± 106 | 1428 ± 130 | 4669 ± 352 |
| rv-h023 | 1734 | 447 ± 42 | 646 ± 67 | 1593 ± 220 |
| rv-h028 | 27 | −58 ± 23 | −51 ± 42 | 90 ± 86 |
| rv-h029 | 63 | 36 ± 19 | 53 ± 32 | 201 ± 55 |
| rv-h032 | 327 | 47 ± 35 | 129 ± 44 | 393 ± 77 |
| rv-h035 | 114 | −18 ± 17 | 8 ± 22 | 117 ± 50 |
| rv-h036 | 2509 | 570 ± 60 | 851 ± 115 | 2063 ± 307 |
| rv-h037 | 5169 | 601 ± 475 | 848 ± 615 | 2092 ± 1385 |
| rv-h038 | 450 | −103 ± 26 | −141 ± 49 | −167 ± 183 |

**Result.** The non-rigid component exists and is well above the noise in most liners, but it is **not creep**:

* it grows with the penetration D (Spearman ρ = 0.79, p < 0.001, ψ_c = 65°) and reaches 1–4 mm in the most worn
  liners, ten times the creep any law or RSA study allows (0.1–0.4 mm);
* it changes by a factor 3–5 with the assumed contact half-angle, so its value is set by the template, not by
  the data; some liners give negative values.

**Why.** Archard wear is proportional to contact pressure × sliding distance, and near the load axis the sliding
distance varies little, so early wear has the same pressure-shaped profile as creep; later both converge to the
rigid translation of a sphere (conformity), and the sum of two translations is again a translation. On a single
retrieved surface the two mechanisms therefore leave the same shape. Glyn-Jones (2008) could separate them only
with serial RSA (time and direction); Miura (2015) with Raman residual strain. The only creep-specific signature
left on the surface is the material pushed above the original sphere (elevations, volume conservation), which
HipCreep already uses as a lower bound of the remaining creep.

**Decision.** Not added to HipCreep as a creep estimate. The non-rigid component could be reported as a descriptor
of the wear shape (peaked vs conforming penetration), not as creep.
