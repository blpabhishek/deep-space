import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic periodic value noise — seamless across the horizontal (u) wrap
// so sphere textures have no visible seam.
// ---------------------------------------------------------------------------

function latticeHash(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

// Periodic value noise: sample point (x, y), lattice wraps every (px, py).
function periodicNoise(x, y, px, py, seed) {
  let xi = Math.floor(x);
  let yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const wx = (i) => ((i % px) + px) % px;
  const wy = (i) => ((i % py) + py) % py;
  const a = latticeHash(wx(xi), wy(yi), seed);
  const b = latticeHash(wx(xi + 1), wy(yi), seed);
  const c = latticeHash(wx(xi), wy(yi + 1), seed);
  const d = latticeHash(wx(xi + 1), wy(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// fbm over (u, v) in [0,1], seamless in u. bx/by = base lattice frequency.
function fbm(u, v, { octaves = 5, bx = 6, by = 3, seed = 1 } = {}) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const px = bx << o;
    const py = by << o;
    sum += amp * periodicNoise(u * px, v * py, px, py, seed + o * 13.7);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function mix3(c1, c2, t) {
  t = Math.min(Math.max(t, 0), 1);
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
  ];
}

function paintTexture(width, height, colorAt) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const [r, g, b, a] = colorAt(u, v);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a === undefined ? 255 : a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// Planet surfaces (equirectangular 2:1)
// ---------------------------------------------------------------------------

const painters = {
  earth(u, v) {
    const cont = fbm(u, v, { octaves: 5, bx: 5, by: 3, seed: 11 });
    const detail = fbm(u + 0.31, v, { octaves: 4, bx: 22, by: 11, seed: 27 });
    const h = cont * 0.72 + detail * 0.28;
    const lat = Math.abs(v - 0.5) * 2;
    let col;
    if (h > 0.53) {
      const t = (h - 0.53) / 0.3;
      col = mix3([36, 88, 46], [126, 112, 72], t);
      if (h > 0.72) col = mix3(col, [156, 146, 134], (h - 0.72) / 0.1);
    } else {
      col = mix3([7, 18, 56], [26, 66, 128], h / 0.53);
    }
    if (lat > 0.82 + detail * 0.1) col = [226, 236, 246];
    return col;
  },

  moon(u, v) {
    const n = fbm(u, v, { octaves: 6, bx: 7, by: 4, seed: 41 });
    const maria = fbm(u + 0.5, v, { octaves: 3, bx: 3, by: 2, seed: 53 });
    let g = 92 + n * 108;
    if (maria < 0.45) g *= 0.58;
    return [g, g, g * 0.97];
  },

  mars(u, v) {
    const n = fbm(u, v, { octaves: 5, bx: 6, by: 3, seed: 71 });
    const m = fbm(u + 0.2, v, { octaves: 3, bx: 3, by: 2, seed: 83 });
    const lat = Math.abs(v - 0.5) * 2;
    let col = mix3([118, 52, 28], [202, 122, 70], n);
    if (m < 0.42) col = mix3(col, [58, 30, 20], 0.5);
    if (lat > 0.88 + n * 0.05) col = [232, 224, 214];
    return col;
  },

  jupiter(u, v) {
    const turb = fbm(u, v, { octaves: 5, bx: 8, by: 4, seed: 97 });
    const band = Math.sin(v * Math.PI * 14 + (turb - 0.5) * 4.5) * 0.5 + 0.5;
    let col = mix3([206, 176, 136], [136, 98, 70], band);
    const wisp = fbm(u + 0.4, v, { octaves: 4, bx: 16, by: 6, seed: 103 });
    col = mix3(col, [226, 208, 182], wisp * 0.4);
    // Great red spot
    let du = Math.abs(u - 0.3);
    du = Math.min(du, 1 - du);
    const dv = v - 0.63;
    const e = (du * du) / (0.07 * 0.07) + (dv * dv) / (0.035 * 0.035);
    if (e < 1) col = mix3(col, [178, 84, 52], (1 - e) * 0.85);
    return col;
  },

  saturn(u, v) {
    const turb = fbm(u, v, { octaves: 4, bx: 6, by: 3, seed: 131 });
    const band = Math.sin(v * Math.PI * 11 + (turb - 0.5) * 2.5) * 0.5 + 0.5;
    let col = mix3([218, 198, 152], [182, 160, 122], band);
    col = mix3(col, [232, 218, 186], turb * 0.3);
    return col;
  },
};

export function makePlanetTexture(kind, width = 512) {
  return paintTexture(width, width / 2, painters[kind]);
}

// ---------------------------------------------------------------------------
// Saturn ring strip — u axis maps to ring radius (geometry UVs are remapped)
// ---------------------------------------------------------------------------

export function makeRingTexture() {
  return paintTexture(512, 8, (u) => {
    const stripe = fbm(u * 0.9, 0.5, { octaves: 5, bx: 12, by: 2, seed: 151 });
    let a = 0.25 + 0.75 * stripe;
    // Cassini division
    const gap = Math.exp(-((u - 0.58) * (u - 0.58)) / (0.0009));
    a *= 1 - gap * 0.92;
    // inner / outer falloff
    a *= Math.min(u / 0.1, 1) * Math.min((1 - u) / 0.08, 1);
    const col = mix3([188, 168, 138], [232, 216, 186], stripe);
    return [col[0], col[1], col[2], Math.max(a, 0) * 255];
  });
}

// ---------------------------------------------------------------------------
// Soft round sprite for glows / distant galaxies
// ---------------------------------------------------------------------------

export function makeGlowSprite(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
