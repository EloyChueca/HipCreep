# HipCreep

Web tool to estimate the **creep** of UHMWPE acetabular liners and to separate creep from **wear** in retrieved
liners, using the results of [HipWear](https://github.com/jpoves-a11y/GeoWear).

* Analytic creep model of the liner (elastic-foundation contact with clearance, stress decay through the wall,
  strain-hardening creep that lets the contact conform).
* Three published compressive creep laws — Lee et al. 2003 (dynamic, 37 °C), Deng et al. 1998 (static, 37 °C),
  Lewis & Carroll 2001 (static, 22 °C) — each in **static** (load held for the whole implantation time) and
  **dynamic** (1 Hz gait cycles) mode, at its own temperature and at 37 °C (time–temperature superposition).
* **Recovery** between explantation and scanning (Lee & Pienkowski 1998: ≈ 51 % of the creep, log-time kinetics).
* **Monte Carlo** ranges over law, load, gait cycles, clearance, wall thickness, elastic constants, temperature
  shift, polyethylene grade and recovery.
* With a HipWear file: split of the measured penetration `D = wear + remaining creep`, verdict when the creep is of
  the order of the measurement uncertainty, **sphere → plane** maps and a lower bound of the creep from the volume of
  the elevations (material pushed above the original surface), with an interactive **3D view** of the unrolled
  surface. When HipWear detects no penetration, the remaining creep is compared with the detection limit instead.

The method, equations, parameter ranges and references are in [docs/MODEL.md](docs/MODEL.md); the input file
exported by HipWear is specified in [docs/HIPWEAR_EXPORT.md](docs/HIPWEAR_EXPORT.md).

## Use

1. Open the web app.
2. Load a HipWear export (HipWear → *Export* → **HipCreep Data (JSON)**), or press **Demo case** (synthetic liner with known creep, wear and
   noise), or type the inputs by hand.
3. Check body mass, implantation time, head diameter, wall thickness, clearance, polyethylene, days ex vivo.
4. **Run analysis** → results, maps, and JSON/CSV export.

## Development

```bash
npm install
npm run dev      # local server
npm test         # model regression tests (node --test, no extra dependencies)
npm run build    # type-check + production build in dist/
```

Requires Node ≥ 22.18. The model (`src/model/`) has no dependencies and runs both in the browser and in Node.

```
src/model/   laws.ts (creep laws) · creep.ts (contact + creep integration) · temperature.ts · recovery.ts
             materials.ts · analysis.ts (tables, Monte Carlo, verdict) · surface.ts (sphere → plane, elevations)
src/io/      hipwear.ts (input format) · phantom.ts (synthetic liner)
src/ui/      form, report, charts, polar maps, 3D surface view (surface3d.ts), export
tests/       model.test.ts
```

## Deployment

* **GitHub Pages**: the `Deploy to GitHub Pages` workflow publishes `dist/` at every push to `main`
  (one-time setup: *Settings → Pages → Source: GitHub Actions*).
* **Cloudflare Pages** (as HipWear): `npm run deploy`.

---

### Resumen

HipCreep estima el creep de liners de UHMWPE a partir del peso, el tiempo de implantación, el diámetro de cabeza y el
espesor del liner, con tres leyes de creep de la literatura en modo estático y dinámico, aplica la recuperación tras
la extracción y, con un fichero de HipWear, separa la penetración medida en creep remanente y desgaste, con rangos
Monte Carlo y una cota mínima de creep a partir del volumen de las elevaciones en el mapa esfera → plano.
