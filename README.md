# Into the Deep — Deep Space Scroll Visualization

A single-page, scroll-driven WebGL journey from Earth orbit to the galactic
deep field. Built from the Deep Space Scroll Visualization spec (Draft v1,
July 2026).

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## Stack

- **Three.js** — WebGL rendering
- **Lenis + GSAP ScrollTrigger** — smooth scroll and scroll-scrubbed text
- **Vanilla JS + Vite** — no framework
- **Custom GLSL** — star twinkle, fbm nebulae, atmosphere fresnel glows

## How it works

- Scroll position (normalized 0–1, starting after the intro spacer) drives the
  camera along a gently curving path from z = 0 to z = −860.
- Seven chapters — Earth, Moon, Mars, asteroid belt, Jupiter/Saturn, nebulae,
  deep field — are placed along the path; chapter text uses sticky positioning
  (natural pinning) and is scrubbed with ScrollTrigger.
- All imagery is procedural: planet textures are generated at load from
  seamless periodic value noise on a canvas; nebulae are additive fbm shader
  planes; galaxies are generated spiral point clouds.
- Fog color, fog density, and tone-mapping exposure are graded along the
  journey for per-chapter color grading.
- Additive materials (nebulae, atmosphere glows) ignore fog, so they are faded
  in by camera proximity instead.

## Accessibility & fallbacks

- `prefers-reduced-motion` is respected, plus a manual "Motion" toggle
  (persisted in localStorage). Reduced mode disables smooth scroll, the camera
  fly-through (cuts between chapter viewpoints), parallax, and twinkle time.
- Semantic HTML skeleton (h1/h2 + prose per chapter) behind an `aria-hidden`
  canvas; scroll is fully native/keyboard-operable.
- If WebGL is unavailable, the page falls back to CSS gradient scenes.

## Performance

- ~177 kB gzipped JS, zero image/network assets.
- Device pixel ratio capped (2 desktop / 1.5 mobile); mobile gets reduced
  particle counts and texture resolution.

Design & build — Abhishek
