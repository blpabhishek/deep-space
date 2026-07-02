import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { makePlanetTexture, makeRingTexture, makeGlowSprite } from './textures.js';

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const JOURNEY = 860; // camera travels z: 0 → -JOURNEY over the full scroll
const CHAPTER_COUNT = 7;
const CHAPTER_MID = Array.from(
  { length: CHAPTER_COUNT },
  (_, i) => (i + 0.5) / CHAPTER_COUNT
);

const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');

const stored = localStorage.getItem('reduce-motion');
let reducedMotion = stored === null ? prefersReduced.matches : stored === '1';

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
} catch (e) {
  document.documentElement.classList.add('no-webgl');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  isMobile ? 70 : 60,
  innerWidth / innerHeight,
  0.1,
  600
);

const uniformsToTick = []; // { uTime } uniforms updated each frame

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('webgl').appendChild(renderer.domElement);

  scene.fog = new THREE.FogExp2(0x050a1e, 0.01);
  scene.background = new THREE.Color(0x020209);

  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.position.set(200, 90, 180);
  sun.target.position.set(0, 0, -450);
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0x445577, 0.35));
}

// ---------------------------------------------------------------------------
// Star field — custom shader with per-star twinkle
// ---------------------------------------------------------------------------

let starMaterial;

function buildStars() {
  const count = isMobile ? 2600 : 6500;
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const col = new Float32Array(count * 3);

  const palette = [
    [1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0],
    [0.67, 0.77, 1.0],
    [1.0, 0.85, 0.69],
    [1.0, 0.62, 0.5],
  ];

  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 300;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 300;
    pos[i * 3 + 2] = 40 - Math.random() * 1180;
    size[i] = 0.6 + Math.pow(Math.random(), 3) * 2.4;
    phase[i] = Math.random() * Math.PI * 2;
    speed[i] = 0.4 + Math.random() * 2.2;
    const c = palette[Math.floor(Math.random() * palette.length)];
    const b = 0.7 + Math.random() * 0.3;
    col[i * 3] = c[0] * b;
    col[i * 3 + 1] = c[1] * b;
    col[i * 3 + 2] = c[2] * b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));

  starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute float aSpeed;
      attribute vec3 aColor;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vPhase;
      varying float vSpeed;
      void main() {
        vColor = aColor;
        vPhase = aPhase;
        vSpeed = aSpeed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uPixelRatio * (260.0 / -mv.z), 0.0, 14.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vColor;
      varying float vPhase;
      varying float vSpeed;
      void main() {
        float tw = 0.72 + 0.28 * sin(uTime * vSpeed + vPhase);
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.06, d) * tw;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  uniformsToTick.push(starMaterial.uniforms.uTime);

  scene.add(new THREE.Points(geo, starMaterial));
}

// ---------------------------------------------------------------------------
// Planets
// ---------------------------------------------------------------------------

const spinners = []; // { obj, rate }
const atmospheres = []; // { mesh, baseStrength } — additive glows, faded by proximity

function addAtmosphere(planet, radius, color, strength = 0.9) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        gl_FragColor = vec4(uColor, f * uStrength);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.18, 48, 32), mat);
  glow.position.copy(planet.position);
  scene.add(glow);
  atmospheres.push({ mesh: glow, baseStrength: strength });
}

function addPlanet({ kind, radius, position, spin, tilt = 0, atmosphere }) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, isMobile ? 40 : 56, isMobile ? 26 : 36),
    new THREE.MeshStandardMaterial({
      map: makePlanetTexture(kind, isMobile ? 256 : 512),
      roughness: 1,
      metalness: 0,
    })
  );
  mesh.position.copy(position);
  mesh.rotation.z = tilt;
  scene.add(mesh);
  spinners.push({ obj: mesh, rate: spin });
  if (atmosphere) addAtmosphere(mesh, radius, atmosphere);
  return mesh;
}

function buildPlanets() {
  addPlanet({
    kind: 'earth',
    radius: 14,
    position: new THREE.Vector3(-9, -6, -48),
    spin: 0.05,
    tilt: 0.41,
    atmosphere: 0x4d8fff,
  });

  addPlanet({
    kind: 'moon',
    radius: 5,
    position: new THREE.Vector3(12, 4, -184),
    spin: 0.012,
  });

  addPlanet({
    kind: 'mars',
    radius: 9,
    position: new THREE.Vector3(-16, -5, -307),
    spin: 0.03,
    tilt: 0.44,
    atmosphere: 0xcc7744,
  });

  addPlanet({
    kind: 'jupiter',
    radius: 17,
    position: new THREE.Vector3(21, 3, -553),
    spin: 0.07,
    tilt: 0.06,
  });

  const saturn = addPlanet({
    kind: 'saturn',
    radius: 11,
    position: new THREE.Vector3(-23, -4, -604),
    spin: 0.06,
    tilt: 0.47,
  });

  // Rings — remap ring UVs so texture u = radial fraction
  const inner = 14.5;
  const outer = 25;
  const ringGeo = new THREE.RingGeometry(inner, outer, 128, 1);
  const p = ringGeo.attributes.position;
  const uv = ringGeo.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    uv.setXY(i, (v3.length() - inner) / (outer - inner), 0.5);
  }
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({
      map: makeRingTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.position.copy(saturn.position);
  ring.rotation.x = Math.PI / 2 - 0.38;
  ring.rotation.y = 0.15;
  scene.add(ring);
}

// ---------------------------------------------------------------------------
// Asteroid belt
// ---------------------------------------------------------------------------

let beltGroup;

function buildAsteroidBelt() {
  beltGroup = new THREE.Group();
  const count = isMobile ? 160 : 440;
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6e6152, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const hero = i < 14; // a few big ones near the flight path
    const angle = Math.random() * Math.PI * 2;
    const radius = hero ? 6 + Math.random() * 10 : 20 + Math.random() * 42;
    t.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      -352 - Math.random() * 150
    );
    e.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    q.setFromEuler(e);
    const sc = hero
      ? 0.5 + Math.random() * 1.6
      : 0.18 + Math.pow(Math.random(), 2) * 1.2;
    s.set(sc, sc * (0.6 + Math.random() * 0.7), sc);
    m.compose(t, q, s);
    mesh.setMatrixAt(i, m);
  }
  beltGroup.add(mesh);
  scene.add(beltGroup);
}

// ---------------------------------------------------------------------------
// Nebulae — additive fbm shader planes
// ---------------------------------------------------------------------------

const nebulae = []; // { mesh, baseAlpha } — faded in by camera proximity

const nebulaShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uSeed;
    uniform float uAlpha;
    uniform vec3 uColA;
    uniform vec3 uColB;
    uniform vec3 uColC;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        s += a * noise(p);
        p *= 2.04;
        a *= 0.5;
      }
      return s;
    }
    void main() {
      vec2 uv = vUv * 3.0 + uSeed * 17.31;
      float q = fbm(uv + uTime * 0.02);
      float n = fbm(uv + q * 1.8 + vec2(uTime * 0.016, -uTime * 0.011));
      vec3 col = mix(uColA, uColB, smoothstep(0.25, 0.75, n));
      col += uColC * pow(n, 3.0) * 1.4;
      float edge = smoothstep(0.0, 0.32, vUv.x) * smoothstep(1.0, 0.68, vUv.x)
                 * smoothstep(0.0, 0.32, vUv.y) * smoothstep(1.0, 0.68, vUv.y);
      float a = smoothstep(0.32, 0.8, n) * uAlpha * edge;
      gl_FragColor = vec4(col, a);
    }
  `,
};

function buildNebulae() {
  const configs = [
    { z: -642, x: -30, y: 18, w: 300, h: 190, a: 0.5, cols: ['#7a3fa8', '#e06a9a', '#ffd8c2'], seed: 1 },
    { z: -686, x: 42, y: -14, w: 340, h: 220, a: 0.55, cols: ['#2a4fa8', '#31b8c4', '#d0f0ff'], seed: 2 },
    { z: -726, x: -18, y: -24, w: 320, h: 200, a: 0.6, cols: ['#8a2f6a', '#e0475a', '#ffc9a0'], seed: 3 },
    { z: -768, x: 24, y: 22, w: 380, h: 250, a: 0.55, cols: ['#3a2a7a', '#7a52c8', '#e8d2ff'], seed: 4 },
  ];
  for (const c of configs) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: c.seed },
        uAlpha: { value: c.a },
        uColA: { value: new THREE.Color(c.cols[0]) },
        uColB: { value: new THREE.Color(c.cols[1]) },
        uColC: { value: new THREE.Color(c.cols[2]) },
      },
      vertexShader: nebulaShader.vertexShader,
      fragmentShader: nebulaShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    uniformsToTick.push(mat.uniforms.uTime);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.scale.set(c.w, c.h, 1);
    mesh.position.set(c.x, c.y, c.z);
    mesh.rotation.z = c.seed * 0.7;
    scene.add(mesh);
    nebulae.push({ mesh, baseAlpha: c.a });
  }
}

// ---------------------------------------------------------------------------
// Deep field — spiral galaxies + distant galaxy sprites
// ---------------------------------------------------------------------------

function makeSpiralGalaxy({ radius, branches, spin, inner, outer, count, map }) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const cIn = new THREE.Color(inner);
  const cOut = new THREE.Color(outer);
  for (let i = 0; i < count; i++) {
    const r = Math.pow(Math.random(), 1.6) * radius;
    const branch = ((i % branches) / branches) * Math.PI * 2;
    const spinAngle = (r / radius) * spin;
    const rnd = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1);
    const spread = 0.28 * radius * (r / radius + 0.08);
    pos[i * 3] = Math.cos(branch + spinAngle) * r + rnd() * spread;
    pos[i * 3 + 1] = Math.sin(branch + spinAngle) * r + rnd() * spread;
    pos[i * 3 + 2] = rnd() * spread * 0.3;
    const c = cIn.clone().lerp(cOut, r / radius);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.3,
    map,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

function buildDeepField() {
  const glow = makeGlowSprite();
  const galaxyConfigs = [
    { p: [-42, 20, -930], s: 1.0, rx: 1.1, rz: 0.4, inner: '#ffd9a0', outer: '#5a7bff' },
    { p: [50, -12, -965], s: 1.3, rx: 0.5, rz: 1.9, inner: '#ffe8d0', outer: '#b06aff' },
    { p: [-8, -30, -1000], s: 0.8, rx: 1.4, rz: 3.0, inner: '#fff2e0', outer: '#4ab8d8' },
  ];
  for (const g of galaxyConfigs) {
    const gal = makeSpiralGalaxy({
      radius: 26,
      branches: 4,
      spin: 3.2,
      inner: g.inner,
      outer: g.outer,
      count: isMobile ? 3200 : 7000,
      map: glow,
    });
    gal.position.set(...g.p);
    gal.scale.setScalar(g.s);
    gal.rotation.set(g.rx, 0, g.rz);
    scene.add(gal);
    spinners.push({ obj: gal, rate: 0.008 });

    // soft core glow
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: g.inner,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    core.position.set(...g.p);
    core.scale.setScalar(18 * g.s);
    scene.add(core);
  }

  // distant background galaxies
  const count = isMobile ? 260 : 520;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tints = ['#ffe2c0', '#c0d0ff', '#e8c0ff', '#ffffff', '#a0e0e8'];
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 560;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 560;
    pos[i * 3 + 2] = -900 - Math.random() * 260;
    tmp.set(tints[Math.floor(Math.random() * tints.length)]);
    const b = 0.5 + Math.random() * 0.5;
    col[i * 3] = tmp.r * b;
    col[i * 3 + 1] = tmp.g * b;
    col[i * 3 + 2] = tmp.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(
    new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 5,
        map: glow,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
  );
}

if (renderer) {
  buildStars();
  buildPlanets();
  buildAsteroidBelt();
  buildNebulae();
  buildDeepField();
}

// ---------------------------------------------------------------------------
// Color grading — fog color / density / exposure graded along the journey
// ---------------------------------------------------------------------------

const GRADE = [
  { p: 0.0, color: '#071233', density: 0.010, exposure: 1.05 },
  { p: 0.1, color: '#04060f', density: 0.008, exposure: 1.0 },
  { p: 0.25, color: '#160805', density: 0.008, exposure: 1.05 },
  { p: 0.4, color: '#0d0805', density: 0.007, exposure: 1.0 },
  { p: 0.55, color: '#0c0b16', density: 0.006, exposure: 1.05 },
  { p: 0.7, color: '#1c0c2e', density: 0.005, exposure: 1.15 },
  { p: 0.85, color: '#060512', density: 0.0025, exposure: 1.1 },
  { p: 1.0, color: '#010104', density: 0.0012, exposure: 1.1 },
];
const gradeColors = GRADE.map((g) => new THREE.Color(g.color));
const fogColor = new THREE.Color();

function applyGrade(p) {
  let i = 0;
  while (i < GRADE.length - 2 && p > GRADE[i + 1].p) i++;
  const a = GRADE[i];
  const b = GRADE[i + 1];
  const t = Math.min(Math.max((p - a.p) / (b.p - a.p), 0), 1);
  fogColor.copy(gradeColors[i]).lerp(gradeColors[i + 1], t);
  scene.fog.color.copy(fogColor);
  scene.background.copy(fogColor).multiplyScalar(0.5);
  scene.fog.density = a.density + (b.density - a.density) * t;
  renderer.toneMappingExposure = a.exposure + (b.exposure - a.exposure) * t;
}

// ---------------------------------------------------------------------------
// Scroll → camera
// ---------------------------------------------------------------------------

let lenis = null;

function initLenis() {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  window.__lenis = lenis;
}

gsap.ticker.add((t) => {
  if (lenis) lenis.raf(t * 1000);
});
gsap.ticker.lagSmoothing(0);

const mouse = { x: 0, y: 0 };
const mouseSmooth = { x: 0, y: 0 };
if (!isMobile) {
  addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / innerHeight - 0.5) * 2;
  });
}

const camPos = new THREE.Vector3();
const lookPos = new THREE.Vector3();

function pathAt(p, out) {
  out.set(
    Math.sin(p * Math.PI * 1.7) * 7,
    Math.cos(p * Math.PI * 2.3) * 3 - 0.5,
    -p * JOURNEY
  );
}

function chapterAt(p) {
  return Math.min(Math.floor(p * CHAPTER_COUNT), CHAPTER_COUNT - 1);
}

let progress = 0;
let elapsed = 0;
let lastChapter = -1;
let spacerHeight = 0;
const clock = new THREE.Clock();
const introEl = document.getElementById('intro');
const spacerEl = document.querySelector('.spacer');

function measureSpacer() {
  spacerHeight = spacerEl ? spacerEl.offsetHeight : 0;
}
measureSpacer();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!reducedMotion) elapsed += dt;

  const doc = document.documentElement;
  // The journey starts once the intro spacer has scrolled past.
  const max = Math.max(doc.scrollHeight - innerHeight - spacerHeight, 1);
  const target = Math.min(Math.max((scrollY - spacerHeight) / max, 0), 1);

  if (reducedMotion) {
    // No fly-through: cut directly to each chapter's viewpoint.
    const c = chapterAt(target);
    if (c !== lastChapter) {
      lastChapter = c;
      progress = target < 0.02 ? 0 : CHAPTER_MID[c];
    }
  } else {
    progress += (target - progress) * Math.min(1, dt * 4.2);
  }

  // Intro fades away while the spacer scrolls past
  const introOpacity = Math.min(
    Math.max(1 - scrollY / Math.max(spacerHeight * 0.8, 1), 0),
    1
  );
  introEl.style.opacity = introOpacity;
  introEl.style.visibility = introOpacity <= 0.01 ? 'hidden' : 'visible';

  if (!renderer) return;

  pathAt(progress, camPos);
  pathAt(Math.min(progress + 0.035, 1.02), lookPos);
  lookPos.z -= 30;

  if (!reducedMotion && !isMobile) {
    mouseSmooth.x += (mouse.x - mouseSmooth.x) * Math.min(1, dt * 3);
    mouseSmooth.y += (mouse.y - mouseSmooth.y) * Math.min(1, dt * 3);
    camPos.x += mouseSmooth.x * 1.6;
    camPos.y -= mouseSmooth.y * 1.1;
  }

  camera.position.copy(camPos);
  camera.lookAt(lookPos);

  applyGrade(progress);

  for (const u of uniformsToTick) u.value = elapsed;
  for (const s of spinners) s.obj.rotation.y = elapsed * s.rate;
  if (beltGroup) beltGroup.rotation.z = elapsed * 0.025;

  // Additive nebula planes ignore fog, so fade them in by proximity instead
  for (const n of nebulae) {
    const d = Math.abs(camera.position.z - n.mesh.position.z);
    const f = Math.min(Math.max((260 - d) / 160, 0), 1);
    n.mesh.material.uniforms.uAlpha.value = n.baseAlpha * f;
    n.mesh.visible = f > 0.001;
  }

  // Same for additive atmosphere glows
  for (const a of atmospheres) {
    const d = Math.abs(camera.position.z - a.mesh.position.z);
    const f = Math.min(Math.max((190 - d) / 110, 0), 1);
    a.mesh.material.uniforms.uStrength.value = a.baseStrength * f;
    a.mesh.visible = f > 0.001;
  }

  renderer.render(scene, camera);
}

gsap.ticker.add(tick);

// ---------------------------------------------------------------------------
// Chapter text — sticky sections scrubbed with ScrollTrigger
// ---------------------------------------------------------------------------

gsap.utils.toArray('.chapter').forEach((section) => {
  const content = section.querySelector('.content');
  gsap
    .timeline({
      scrollTrigger: {
        trigger: section,
        start: 'top 62%',
        end: 'bottom 60%',
        scrub: 0.4,
      },
    })
    .fromTo(
      content,
      { autoAlpha: 0, y: 48 },
      { autoAlpha: 1, y: 0, duration: 0.25, ease: 'none' }
    )
    .to(content, { autoAlpha: 1, duration: 0.5, ease: 'none' })
    .to(content, { autoAlpha: 0, y: -36, duration: 0.25, ease: 'none' });
});

// ---------------------------------------------------------------------------
// Reduced-motion toggle
// ---------------------------------------------------------------------------

const toggleBtn = document.getElementById('motion-toggle');

function applyMotionPref() {
  toggleBtn.setAttribute('aria-pressed', String(!reducedMotion));
  toggleBtn.textContent = reducedMotion ? 'Motion: off' : 'Motion: on';
  document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  lastChapter = -1; // force viewpoint refresh
  if (reducedMotion) {
    if (lenis) {
      lenis.destroy();
      lenis = null;
    }
  } else if (!lenis) {
    initLenis();
  }
}

toggleBtn.addEventListener('click', () => {
  reducedMotion = !reducedMotion;
  localStorage.setItem('reduce-motion', reducedMotion ? '1' : '0');
  applyMotionPref();
});

prefersReduced.addEventListener('change', (e) => {
  if (localStorage.getItem('reduce-motion') === null) {
    reducedMotion = e.matches;
    applyMotionPref();
  }
});

applyMotionPref();

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

addEventListener('resize', () => {
  measureSpacer();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (renderer) {
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
    starMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  }
  ScrollTrigger.refresh();
});
