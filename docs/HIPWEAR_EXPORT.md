# HipWear → HipCreep input file (`hipcreep-input`, version 1)

HipCreep reads one JSON file per liner, exported by HipWear after a **Two-Sphere Auto** analysis. All lengths in mm
unless the key says `Um` (µm), angles in degrees. Unknown values may be omitted or set to `null`. Click
**Demo file ⭳** in HipCreep to download a complete example.

```jsonc
{
  "format": "hipcreep-input",
  "version": 1,
  "source": { "program": "HipWear", "programVersion": "1.0", "file": "SERH020.stl", "exportedAt": "2026-10-27T12:00:00Z" },
  "case": { "id": "SERH020", "yearsInVivo": 0.5, "daysExVivo": 30 },
  "implant": { "headDiameterMm": 28, "material": "conventional" },
  "geometry": {
    "commercialRadiusMm": 14.0,
    "measuredRadiusMm": 14.05,
    "measuredRadiusReliable": true,
    "originalCenter": [x, y, z],
    "displacedCenter": [x, y, z],
    "poleAxis": [x, y, z],
    "rimPlane": { "point": [x, y, z], "normal": [x, y, z] },
    "wallThicknessMm": { "mean": 7.9, "sd": 0.15, "atPenetration": 7.8 },
    "outerShellRadiusMm": 22.0
  },
  "wear": {
    "model": "two-sphere-auto",
    "linearWearUm": 100, "linearWearSdUm": 8,
    "linearWearCorrectedUm": null, "linearWearCorrectedSdUm": null,
    "volumeMm3": 21.1, "volumeSdMm3": 1.5,
    "directionAngleDeg": 20,
    "detectionLimitUm": null
  },
  "uncertainty": { "noiseSigmaUm": 4, "surfaceUncertaintyUm": 0, "formRmsUm": 1 },
  "mesh": { "vertices": [x0, y0, z0, x1, ...], "faces": [i0, j0, k0, ...] }
}
```

## Fields and where they come from in HipWear

| Field | Required | HipWear source (`src/types/index.ts`) | Used for |
|---|---|---|---|
| `case.yearsInVivo` | recommended | `AnalysisParams.yearsInVivo` | implantation time |
| `case.daysExVivo` | recommended | **new input** — days from revision surgery to scanning | creep recovery |
| `implant.headDiameterMm` | optional | 2 × `CommercialSphereInfo.commercialRadius` if not given | contact pressure |
| `implant.material` | optional | **new input**: `virgin`, `conventional`, `hxlpe`, `vite-hxlpe` | creep factor, recovery |
| `geometry.commercialRadiusMm` | **yes** | `TwoSphereResult.radius` | head radius |
| `geometry.measuredRadiusMm`, `measuredRadiusReliable` | recommended | `WearVolumeResult.measuredRadius.radius`, `.reliable` | radial clearance; zero plane of the sphere → plane step |
| `geometry.originalCenter` | **yes** | `TwoSphereResult.originalCenter` | centre for `r = |v − O|` |
| `geometry.displacedCenter` | recommended | `TwoSphereResult.displacedCenter` | load (penetration) direction |
| `geometry.poleAxis` | **yes** | `SeparationResult.cupAxis` (rim → pole) | map orientation, load angle |
| `geometry.rimPlane` | optional | `RimPlaneResult.point`, `.normal` | (future: coverage) |
| `geometry.wallThicknessMm` | recommended | wall-thickness computation of `MeshViewer` (inner ↔ outer surface), at the penetration point and mean/SD | through-wall creep |
| `geometry.outerShellRadiusMm` | fallback | `TwoSphereResult.outerShell.radius` | thickness = outer − inner radius |
| `wear.linearWearUm`, `linearWearSdUm` | recommended | `TwoSphereResult.linearWearMm`, `.linearWearSdMm` (× 1000) | measured penetration D |
| `wear.linearWearCorrectedUm`, `…SdUm` | optional | `TwoSphereResult.linearCorrectedMm`, `.linearCorrectedSdMm` | used instead of D when present |
| `wear.volumeMm3`, `volumeSdMm3` | optional | `WearVolumeResult.wearVolume`, `TwoSphereResult.volumeSdMm3` | reported |
| `wear.directionAngleDeg` | recommended | `TwoSphereResult.directionAngleDeg` | load angle |
| `wear.detectionLimitUm` | optional | `TwoSphereResult.detectionLimitUm` | small-signal verdict |
| `uncertainty.noiseSigmaUm` | recommended | `TwoSphereResult.noiseSigmaUm` | elevation thresholds, noise floor |
| `uncertainty.surfaceUncertaintyUm` | optional | `TwoSphereResult.surfaceUncertaintyUm` | added to σ |
| `uncertainty.formRmsUm` | optional | `TwoSphereResult.formRmsUm` | reported |
| `mesh.vertices`, `mesh.faces` | recommended | trimmed inner bearing surface (`TrimResult.mesh`), positions in the same frame as the centres | measured map, elevation volume |

HipCreep computes `dev = |v − O| − R_ref` itself, so the exporter does not need per-vertex deviations.

## Validation done by HipCreep

`format` and `version`, presence of `commercialRadiusMm`, `originalCenter`, `poleAxis`, 3-vectors, face indices
within range. Missing optional data produce warnings in the *Case* panel and the related analysis is skipped
(e.g. no mesh → no maps and no elevation bound).
