/* ============================================================
   TRACK / WORLD BUILDER
   Procedural closed circuits generated from radial harmonics
   (guaranteed non-self-intersecting), then dressed with blocky
   curbs, barriers, scenery, sky and lighting.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---------------- deterministic RNG ---------------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
   TRACK DEFINITIONS
   ============================================================ */
export const TRACK_DEFS = [
  {
    id: 'sunset',
    name: 'SUNSET STRIP',
    desc: 'Long, flowing sweepers that link into each other. The friendliest place to learn how a drift should feel — and the best place to chain a huge multiplier.',
    difficulty: 'EASY',
    length: '1.1 km',
    seed: 1337,
    R0: 220,
    harmonics: [
      { k: 2, a: 30, p: 0.45 },
      { k: 3, a: 27, p: 1.95 },
      { k: 5, a: 17, p: 0.90 },
    ],
    squash: [1.16, 0.87],
    rot: 0.30,
    width: 20,
    runoff: 4.5,
    palette: {
      name: 'sunset',
      skyTop: 0x2a1a5e, skyBot: 0xffa861, sun: 0xffd28a, sunPos: [-0.35, 0.10],
      fog: 0xf08a5d, fogDensity: 0.0026,
      ground: 0x47785f, groundAlt: [0x548a6c, 0x3b6a54, 0x62997a, 0x477860],
      road: 0x353947, roadAlt: 0x454b5e,
      curbA: 0xf2f2f2, curbB: 0xe8453c,
      barrier: 0xd9dbe6, barrierTop: 0xff2e7e,
      props: [0xf2a65a, 0xe8734a, 0x2a9d8f, 0xe9c46a, 0x8e6fbf, 0xf4f1de],
      foliage: [0x3f8f6a, 0x2f7355, 0x57a878, 0x275c46],
      hemiSky: 0xffc79a, hemiGround: 0x4a7a68, hemiInt: 1.75,
      sunColor: 0xffd7a8, sunInt: 2.5, sunDir: [-0.55, 0.78, 0.42],
      ambient: 0x8a7ab0, ambientInt: 0.95,
      grassGrip: 0.40, grassDrag: 1.9,
      cloud: 0xffc9a3,
    },
  },
  {
    id: 'harbor',
    name: 'HARBOR HAIRPINS',
    desc: 'Tight, technical and relentless. Second-gear hairpins punish greedy throttle, but a clean exit fires you into the next one. Big points for big commitment.',
    difficulty: 'HARD',
    length: '0.9 km',
    seed: 90210,
    R0: 196,
    harmonics: [
      { k: 2, a: 34, p: 1.25 },
      { k: 3, a: 30, p: 0.18 },
      { k: 5, a: 22, p: 2.45 },
      { k: 7, a: 14, p: 0.80 },
    ],
    squash: [1.0, 1.0],
    rot: 1.1,
    width: 16.5,
    runoff: 3.0,
    palette: {
      name: 'noon',
      skyTop: 0x1f7fd4, skyBot: 0xbfe9ff, sun: 0xfff6d0, sunPos: [0.42, 0.55],
      fog: 0xa9d8ef, fogDensity: 0.0022,
      ground: 0x9cb4c4, groundAlt: [0xabc2d0, 0x8ca6b8, 0xb6cad6, 0x97b0c0],
      road: 0x30353f, roadAlt: 0x3e4551,
      curbA: 0xffffff, curbB: 0x1e6fd9,
      barrier: 0xe8ecf2, barrierTop: 0x2fe0ff,
      props: [0xe4572e, 0x3d5a80, 0x98c1d9, 0xee6c4d, 0xf4d35e, 0xe0fbfc],
      foliage: [0x4a9d6a, 0x357a51, 0x63b380, 0x2c6644],
      hemiSky: 0xe8f6ff, hemiGround: 0x8fa2b0, hemiInt: 1.7,
      sunColor: 0xfff6e0, sunInt: 2.6, sunDir: [0.45, 0.85, 0.28],
      ambient: 0xb8cfe0, ambientInt: 0.95,
      grassGrip: 0.42, grassDrag: 2.0,
      cloud: 0xffffff,
    },
  },
  {
    id: 'neon',
    name: 'NEON DOCKS',
    desc: 'A long, fast, deliberately awkward lap under a violet sky. Blind crests hidden behind the fog, wide entries, and one enormous final sweep you can hold forever.',
    difficulty: 'MEDIUM',
    length: '1.4 km',
    seed: 4242,
    R0: 252,
    harmonics: [
      { k: 2, a: 44, p: 2.10 },
      { k: 3, a: 28, p: 0.90 },
      { k: 4, a: 34, p: 0.60 },
      { k: 6, a: 20, p: 1.40 },
    ],
    squash: [1.05, 1.08],
    rot: 2.4,
    width: 18,
    runoff: 5.0,
    palette: {
      name: 'neon',
      skyTop: 0x0b0a30, skyBot: 0x8a2196, sun: 0xff7ec0, sunPos: [0.15, 0.09],
      fog: 0x41205e, fogDensity: 0.0036,
      ground: 0x2f2856, groundAlt: [0x393064, 0x241f42, 0x423970, 0x2f2856],
      road: 0x2f2b45, roadAlt: 0x3d3757,
      curbA: 0x59ecff, curbB: 0xff4f92,
      barrier: 0x4a4170, barrierTop: 0x35ffd0,
      props: [0x4d3d80, 0x60509c, 0x2fe0ff, 0xff2e7e, 0xb06bff, 0x35ffd0],
      foliage: [0x2f6a5e, 0x3d8a73, 0x24564c, 0x4a9d80],
      hemiSky: 0xb08ff0, hemiGround: 0x2a2248, hemiInt: 1.55,
      sunColor: 0xffb0e4, sunInt: 2.0, sunDir: [0.35, 0.66, -0.60],
      ambient: 0x8f7fd8, ambientInt: 1.25,
      grassGrip: 0.36, grassDrag: 2.2,
      cloud: 0x6a3f9a,
      emissive: true,
    },
  },
  {
    id: 'bowl',
    name: 'THE BOWL',
    desc: 'Not a circuit — a playground. A walled arena the size of a stadium with scattered blocks to thread. Perfect for freestyle figure-eights and endless donuts.',
    difficulty: 'FREESTYLE',
    length: 'OPEN',
    seed: 777,
    R0: 148,
    harmonics: [
      { k: 2, a: 16, p: 0.0 },
      { k: 3, a: 6, p: 1.0 },
    ],
    squash: [1.0, 1.0],
    rot: 0.0,
    width: 74,
    runoff: 0,
    arena: true,
    palette: {
      name: 'dusk',
      skyTop: 0x241a4d, skyBot: 0xffb35c, sun: 0xffe9a8, sunPos: [0.0, 0.16],
      fog: 0xd99a6c, fogDensity: 0.0020,
      ground: 0x5d5670, groundAlt: [0x6a6382, 0x504a62, 0x776f8c, 0x5d5670],
      road: 0x2e2b3a, roadAlt: 0x3b3749,
      curbA: 0xffe9a8, curbB: 0xff6b3d,
      barrier: 0xdcd6e8, barrierTop: 0xffb35c,
      props: [0xffb35c, 0xe8734a, 0x6a5fa8, 0xf4f1de, 0x2a9d8f],
      foliage: [0x4a7a63, 0x35604f, 0x5f8f75],
      hemiSky: 0xffd7a0, hemiGround: 0x50496a, hemiInt: 1.6,
      sunColor: 0xffe4b4, sunInt: 2.3, sunDir: [-0.30, 0.80, 0.52],
      ambient: 0x9080b8, ambientInt: 0.95,
      grassGrip: 0.75, grassDrag: 1.2,
      cloud: 0xffd2a8,
    },
  },
];

/* ============================================================
   TRACK
   ============================================================ */

/** Lightweight centreline for menu minimaps — no meshes, no THREE. */
export function previewOutline(def, n = 160) {
  const pts = [];
  const c = Math.cos(def.rot), s = Math.sin(def.rot);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    let r = def.R0;
    for (const h of def.harmonics) r += h.a * Math.sin(h.k * th + h.p);
    r = Math.max(45, r);
    const x = Math.cos(th) * r * def.squash[0];
    const z = Math.sin(th) * r * def.squash[1];
    pts.push({ x: x * c - z * s, z: x * s + z * c });
  }
  return pts;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.palette = def.palette;
    this.halfWidth = def.width / 2;
    this.runoff = def.runoff;
    this.wallDist = this.halfWidth + def.runoff;
    this.group = new THREE.Group();
    this.lights = [];

    const rng = this.rng = mulberry32(def.seed);

    this._buildCenterline();
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildRoad();
    this._buildCurbs();
    this._buildBarriers();
    this._buildStartGate();
    this._buildScenery();
    this._buildClouds();

    this._grid = null;
  }

  /* ---------------- centerline from radial harmonics ---------------- */
  _buildCenterline() {
    const d = this.def;
    const N = 1400;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      let r = d.R0;
      for (const h of d.harmonics) r += h.a * Math.sin(h.k * th + h.p);
      r = Math.max(45, r);
      let x = Math.cos(th) * r * d.squash[0];
      let z = Math.sin(th) * r * d.squash[1];
      const c = Math.cos(d.rot), s = Math.sin(d.rot);
      const rx = x * c - z * s;
      const rz = x * s + z * c;
      pts.push({ x: rx, z: rz });
    }

    // resample to uniform arc length
    const spacing = 2.0;
    const raw = [];
    let total = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      raw.push({ a, b, seg, at: total });
      total += seg;
    }
    this.length = total;

    const count = Math.floor(total / spacing);
    const samples = [];
    let ri = 0;
    for (let i = 0; i < count; i++) {
      const target = i * spacing;
      while (ri < raw.length - 1 && raw[ri].at + raw[ri].seg < target) ri++;
      const seg = raw[ri];
      const t = seg.seg > 0 ? clamp((target - seg.at) / seg.seg, 0, 1) : 0;
      const x = seg.a.x + (seg.b.x - seg.a.x) * t;
      const z = seg.a.z + (seg.b.z - seg.a.z) * t;
      samples.push({ x, z, s: target, tx: 0, tz: 0, nx: 0, nz: 0 });
    }
    // smooth tangents + normals
    for (let i = 0; i < count; i++) {
      const p0 = samples[(i - 2 + count) % count];
      const p1 = samples[(i + 2) % count];
      let tx = p1.x - p0.x, tz = p1.z - p0.z;
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      samples[i].tx = tx; samples[i].tz = tz;
      samples[i].nx = -tz; samples[i].nz = tx;
    }
    this.samples = samples;
    this.count = count;
    this.spacing = spacing;

    // curvature (signed) for AI-ish hints & scenery placement
    for (let i = 0; i < count; i++) {
      const a = samples[(i - 3 + count) % count];
      const b = samples[i];
      const c = samples[(i + 3) % count];
      const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      samples[i].curv = cross;
    }

    this.bounds = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    for (const s of samples) {
      this.bounds.minX = Math.min(this.bounds.minX, s.x);
      this.bounds.maxX = Math.max(this.bounds.maxX, s.x);
      this.bounds.minZ = Math.min(this.bounds.minZ, s.z);
      this.bounds.maxZ = Math.max(this.bounds.maxZ, s.z);
    }
  }

  /* ---------------- fast nearest-sample query ---------------- */
  _buildGrid() {
    const cell = 24;
    const map = new Map();
    const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
    for (let i = 0; i < this.count; i++) {
      const s = this.samples[i];
      const cx = Math.floor(s.x / cell), cz = Math.floor(s.z / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const k = key(cx + ox, cz + oz);
        let arr = map.get(k);
        if (!arr) { arr = []; map.set(k, arr); }
        arr.push(i);
      }
    }
    this._grid = { cell, map, key };
  }

  /**
   * Nearest point on the centerline.
   * @returns {{i:number, s:number, lateral:number, x:number, z:number, tx:number, tz:number}}
   */
  nearest(x, z, hint = -1) {
    const S = this.samples, C = this.count;
    let best = Infinity, bi = 0;

    if (hint >= 0) {
      // local search around previous index
      for (let o = -22; o <= 22; o++) {
        const i = (hint + o + C) % C;
        const dx = x - S[i].x, dz = z - S[i].z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bi = i; }
      }
      // if we landed on the edge of the window, do a full search
      const off = Math.abs(((bi - hint) + C) % C);
      if (off < 20) return this._finishQuery(x, z, bi);
    }

    best = Infinity;
    for (let i = 0; i < C; i++) {
      const dx = x - S[i].x, dz = z - S[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = i; }
    }
    return this._finishQuery(x, z, bi);
  }

  _finishQuery(x, z, i) {
    const s = this.samples[i];
    const dx = x - s.x, dz = z - s.z;
    const lateral = dx * s.nx + dz * s.nz;   // signed: + is left
    return {
      i, s: s.s, lateral,
      x: s.x, z: s.z,
      tx: s.tx, tz: s.tz,
      nx: s.nx, nz: s.nz,     // surface normal — required by the wall response
      curv: s.curv,
    };
  }

  /** world position + heading at arc length s */
  posAt(s, lateral = 0) {
    const C = this.count;
    let f = (s / this.spacing) % C;
    if (f < 0) f += C;
    const i0 = Math.floor(f), i1 = (i0 + 1) % C, t = f - i0;
    const a = this.samples[i0], b = this.samples[i1];
    const x = a.x + (b.x - a.x) * t + (a.nx + (b.nx - a.nx) * t) * lateral;
    const z = a.z + (b.z - a.z) * t + (a.nz + (b.nz - a.nz) * t) * lateral;
    const heading = Math.atan2(a.tx + (b.tx - a.tx) * t, a.tz + (b.tz - a.tz) * t);
    return { x, z, heading };
  }

  get startPose() {
    const p = this.posAt(8, 0);
    return { x: p.x, z: p.z, heading: p.heading };
  }

  /* ============================================================
     VISUALS
     ============================================================ */
  _mat(color, opts = {}) {
    return new THREE.MeshLambertMaterial({ color, ...opts });
  }

  _buildSky() {
    const p = this.palette;
    const geo = new THREE.SphereGeometry(2600, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(p.skyTop) },
        bot: { value: new THREE.Color(p.skyBot) },
      },
      vertexShader: `
        varying float vH;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vH = normalize(wp.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bot; varying float vH;
        void main(){
          float t = clamp(vH * 1.85 + 0.015, 0.0, 1.0);
          t = pow(t, 1.28);
          vec3 c = mix(bot, top, t);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    this.sky = sky;
    this.group.add(sky);

    // sun disc
    const sunGeo = new THREE.CircleGeometry(150, 4); // diamond = blocky sun
    const sunMat = new THREE.MeshBasicMaterial({ color: p.sun, fog: false, transparent: true, opacity: 0.95 });
    const sun = new THREE.Mesh(sunGeo, sunMat);
    const dir = new THREE.Vector3(p.sunPos[0], p.sunPos[1], p.sunPos[1] * 0.5 - 0.6).normalize();
    sun.position.copy(dir.multiplyScalar(2100));
    sun.lookAt(0, 0, 0);
    sun.rotation.z = Math.PI / 4;
    sun.frustumCulled = false;
    sun.renderOrder = -99;
    this.group.add(sun);

    // sun halo
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(320, 4),
      new THREE.MeshBasicMaterial({ color: p.sun, fog: false, transparent: true, opacity: 0.14, depthWrite: false })
    );
    halo.position.copy(sun.position).multiplyScalar(0.98);
    halo.lookAt(0, 0, 0);
    halo.rotation.z = Math.PI / 4;
    halo.frustumCulled = false;
    halo.renderOrder = -99;
    this.group.add(halo);
  }

  _buildLights() {
    const p = this.palette;
    const hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiInt);
    const amb = new THREE.AmbientLight(p.ambient, p.ambientInt);
    const sun = new THREE.DirectionalLight(p.sunColor, p.sunInt);
    sun.position.set(p.sunDir[0] * 200, p.sunDir[1] * 200, p.sunDir[2] * 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 70;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 620;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.55;
    this.sun = sun;
    this.group.add(hemi, amb, sun, sun.target);
    this.lights = [hemi, amb, sun];
  }

  /** keep the shadow frustum tight around the car */
  updateShadow(target) {
    if (!this.sun) return;
    const p = this.palette;
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.position.set(
      target.x + p.sunDir[0] * 160,
      p.sunDir[1] * 160,
      target.z + p.sunDir[2] * 160
    );
    this.sun.target.updateMatrixWorld();
  }

  _buildGround() {
    const p = this.palette;
    const b = this.bounds;
    const pad = 900;
    const w = (b.maxX - b.minX) + pad * 2;
    const h = (b.maxZ - b.minZ) + pad * 2;
    const cx = (b.maxX + b.minX) / 2, cz = (b.maxZ + b.minZ) / 2;

    const base = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this._mat(p.ground));
    base.rotation.x = -Math.PI / 2;
    base.position.set(cx, -0.06, cz);
    base.receiveShadow = true;
    this.group.add(base);

    // patchwork tiles for blocky texture + speed readability
    const rng = this.rng;
    const TILE = 26;
    const cols = Math.floor(w / TILE), rows = Math.floor(h / TILE);
    const maxTiles = 2600;
    const picks = [];
    for (let i = 0; i < maxTiles; i++) {
      const gx = Math.floor(rng() * cols), gz = Math.floor(rng() * rows);
      const x = cx - w / 2 + gx * TILE + TILE / 2 + (rng() - .5) * 5;
      const z = cz - h / 2 + gz * TILE + TILE / 2 + (rng() - .5) * 5;
      // skip anything on the track
      const q = this.nearest(x, z);
      if (Math.abs(q.lateral) < this.wallDist + 8) continue;
      picks.push({ x, z, r: rng() });
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, this._mat(0xffffff), picks.length);
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    picks.forEach((t, i) => {
      const s = TILE * (0.62 + t.r * 0.5);
      pos.set(t.x, 0.05 + t.r * 0.18, t.z);
      sc.set(s, 0.10 + t.r * 0.38, s);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(i, m);
      col.setHex(p.groundAlt[Math.floor(t.r * p.groundAlt.length) % p.groundAlt.length]);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  _buildRoad() {
    const p = this.palette;
    const S = this.samples, C = this.count, hw = this.halfWidth;

    const verts = [], cols = [], idx = [];
    const cA = new THREE.Color(p.road), cB = new THREE.Color(p.roadAlt);
    const STRIPE = 3; // samples per shade stripe

    for (let i = 0; i < C; i++) {
      const s = S[i];
      const shade = (Math.floor(i / STRIPE) % 2 === 0);
      const c = shade ? cA : cB;
      verts.push(s.x + s.nx * hw, 0, s.z + s.nz * hw);
      verts.push(s.x - s.nx * hw, 0, s.z - s.nz * hw);
      for (let k = 0; k < 2; k++) cols.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < C; i++) {
      const a = i * 2, b = a + 1;
      const n = ((i + 1) % C) * 2, d = n + 1;
      idx.push(a, n, b, b, n, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    road.receiveShadow = true;
    road.position.y = 0.02;
    this.group.add(road);
    this.roadMesh = road;

    // ---- lane dashes: hard-edged, high-contrast marks that stream past and
    // give the eye something unambiguous to judge speed against
    if (!this.def.arena) {
      const dashList = [];
      const period = 8;                       // metres between dashes
      const dashLen = 3.2;
      const lanes = this.halfWidth > 12 ? [-0.34, 0.34] : [-0.28, 0.28];
      for (let i = 0; i < C; i += 1) {
        const s0 = S[i];
        if (s0.s % period > dashLen) continue;
        for (const lane of lanes) {
          dashList.push({
            x: s0.x + s0.nx * this.halfWidth * lane,
            z: s0.z + s0.nz * this.halfWidth * lane,
            yaw: Math.atan2(s0.tx, s0.tz),
          });
        }
      }
      const dashGeo = new THREE.BoxGeometry(0.34, 0.02, 3.2);
      const dashMat = new THREE.MeshBasicMaterial({ color: p.curbA, transparent: true, opacity: 0.5 });
      const dashes = new THREE.InstancedMesh(dashGeo, dashMat, Math.max(1, dashList.length));
      const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler();
      const ds = new THREE.Vector3(1, 1, 1), dp = new THREE.Vector3();
      dashList.forEach((d, i) => {
        de.set(0, d.yaw, 0); dq.setFromEuler(de);
        dp.set(d.x, 0.035, d.z);
        dm.compose(dp, dq, ds);
        dashes.setMatrixAt(i, dm);
      });
      dashes.count = dashList.length;
      dashes.instanceMatrix.needsUpdate = true;
      dashes.frustumCulled = false;
      this.group.add(dashes);
    }
  }

  _buildCurbs() {
    const p = this.palette;
    const S = this.samples, C = this.count, hw = this.halfWidth;
    const step = 2; // every 4m
    const list = [];
    for (let i = 0; i < C; i += step) {
      const s = S[i];
      const even = (Math.floor(i / step) % 2 === 0);
      for (const side of [1, -1]) {
        list.push({
          x: s.x + s.nx * hw * side + s.nx * 1.0 * side,
          z: s.z + s.nz * hw * side + s.nz * 1.0 * side,
          yaw: Math.atan2(s.tx, s.tz),
          col: even ? p.curbA : p.curbB,
        });
      }
    }
    const geo = new THREE.BoxGeometry(2.0, 0.5, 4.0);
    const mesh = new THREE.InstancedMesh(geo, this._mat(0xffffff), list.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    const col = new THREE.Color();
    list.forEach((c, i) => {
      e.set(0, c.yaw, 0); q.setFromEuler(e);
      pos.set(c.x, 0.22, c.z);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(c.col));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  _buildBarriers() {
    const p = this.palette;
    const S = this.samples, C = this.count;
    const D = this.wallDist;
    const step = 2;
    const list = [];
    for (let i = 0; i < C; i += step) {
      const s = S[i];
      for (const side of [1, -1]) {
        list.push({
          x: s.x + s.nx * (D + 0.6) * side,
          z: s.z + s.nz * (D + 0.6) * side,
          yaw: Math.atan2(s.tx, s.tz),
        });
      }
    }
    const geo = new THREE.BoxGeometry(1.2, 2.0, 4.0);
    const mesh = new THREE.InstancedMesh(geo, this._mat(p.barrier), list.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    list.forEach((c, i) => {
      e.set(0, c.yaw, 0); q.setFromEuler(e);
      pos.set(c.x, 1.0, c.z);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);

    // glowing top rail
    const railGeo = new THREE.BoxGeometry(1.35, 0.22, 4.05);
    const railMat = new THREE.MeshBasicMaterial({ color: p.barrierTop });
    if (p.emissive) { railMat.color.multiplyScalar(1.0); }
    const rail = new THREE.InstancedMesh(railGeo, railMat, list.length);
    list.forEach((c, i) => {
      e.set(0, c.yaw, 0); q.setFromEuler(e);
      pos.set(c.x, 2.0, c.z);
      m.compose(pos, q, sc);
      rail.setMatrixAt(i, m);
    });
    rail.instanceMatrix.needsUpdate = true;
    this.group.add(rail);
  }

  _buildStartGate() {
    const p = this.palette;
    const { x, z, heading } = this.startPose;
    const s0 = this.samples[0];

    const g = new THREE.Group();
    g.position.set(s0.x, 0, s0.z);
    g.rotation.y = Math.atan2(s0.tx, s0.tz);

    // checkered start line
    const tiles = 12;
    const w = this.halfWidth * 2;
    const tw = w / tiles;
    const tileGeo = new THREE.BoxGeometry(tw, 0.06, 1.6);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const black = new THREE.MeshBasicMaterial({ color: 0x14161f });
    const startMesh = new THREE.InstancedMesh(tileGeo, white, tiles * 2);
    const darkMesh = new THREE.InstancedMesh(tileGeo, black, tiles * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    let wi = 0, di = 0;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < tiles; c++) {
        pos.set(-w / 2 + tw / 2 + c * tw, 0.05, r * 1.6 - 0.8);
        m.compose(pos, q, sc);
        if ((r + c) % 2 === 0) startMesh.setMatrixAt(wi++, m);
        else darkMesh.setMatrixAt(di++, m);
      }
    }
    startMesh.count = wi; darkMesh.count = di;
    startMesh.instanceMatrix.needsUpdate = true;
    darkMesh.instanceMatrix.needsUpdate = true;
    g.add(startMesh, darkMesh);

    // arch
    const postGeo = new THREE.BoxGeometry(0.9, 8, 0.9);
    const postMat = this._mat(p.barrier);
    const postL = new THREE.Mesh(postGeo, postMat);
    postL.position.set(-this.halfWidth - 1.4, 4, 0);
    const postR = new THREE.Mesh(postGeo, postMat);
    postR.position.set(this.halfWidth + 1.4, 4, 0);
    postL.castShadow = postR.castShadow = true;

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfWidth * 2 + 3.8, 1.6, 0.9),
      this._mat(p.barrierTop)
    );
    beam.position.set(0, 8.6, 0);
    beam.castShadow = true;

    g.add(postL, postR, beam);
    this.group.add(g);
    this.startGate = g;
  }

  _buildScenery() {
    const p = this.palette;
    const rng = this.rng;
    const b = this.bounds;
    const cx = (b.maxX + b.minX) / 2, cz = (b.maxZ + b.minZ) / 2;
    const R = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 260;

    const buildings = [];
    const trees = [];
    const tries = 4200;

    for (let i = 0; i < tries; i++) {
      const th = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * R;
      const x = cx + Math.cos(th) * rr;
      const z = cz + Math.sin(th) * rr;

      const q = this.nearest(x, z);
      const dist = Math.abs(q.lateral);
      if (dist < this.wallDist + 11) continue;

      const roll = rng();
      const far = dist > 45;
      if (roll < (far ? 0.42 : 0.22)) {
        // building
        const w = 8 + rng() * 22;
        const d = 8 + rng() * 22;
        const h = 7 + rng() * (far ? 62 : 26);
        buildings.push({ x, z, w, d, h, col: p.props[Math.floor(rng() * p.props.length) % p.props.length] });
      } else if (roll < 0.86) {
        // tree
        const s = 1.1 + rng() * 2.4;
        trees.push({ x, z, s, col: p.foliage[Math.floor(rng() * p.foliage.length) % p.foliage.length] });
      }
      if (buildings.length + trees.length > 1500) break;
    }

    const col = new THREE.Color();

    // --- buildings
    if (buildings.length) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(geo, this._mat(0xffffff), buildings.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
      buildings.forEach((bd, i) => {
        pos.set(bd.x, 0, bd.z);
        sc.set(bd.w, bd.h, bd.d);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setHex(bd.col));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);

      // rooftop caps for a blockier silhouette
      const capGeo = new THREE.BoxGeometry(1, 1, 1);
      const cap = new THREE.InstancedMesh(capGeo, this._mat(0xffffff), buildings.length);
      cap.castShadow = true;
      buildings.forEach((bd, i) => {
        pos.set(bd.x, bd.h + 0.6, bd.z);
        sc.set(bd.w * 0.55, 1.2, bd.d * 0.55);
        m.compose(pos, q, sc);
        cap.setMatrixAt(i, m);
        col.setHex(bd.col).multiplyScalar(1.35);
        cap.setColorAt(i, col);
      });
      cap.instanceMatrix.needsUpdate = true;
      if (cap.instanceColor) cap.instanceColor.needsUpdate = true;
      this.group.add(cap);
    }

    // --- trees (trunk + cube canopy baked as two instanced meshes)
    if (trees.length) {
      const trunkGeo = new THREE.BoxGeometry(0.7, 1, 0.7);
      trunkGeo.translate(0, 0.5, 0);
      const trunk = new THREE.InstancedMesh(trunkGeo, this._mat(0x51402f), trees.length);
      trunk.castShadow = true;
      const leafGeo = new THREE.BoxGeometry(3.6, 3.6, 3.6);
      const leaf = new THREE.InstancedMesh(leafGeo, this._mat(0xffffff), trees.length);
      leaf.castShadow = true; leaf.receiveShadow = true;

      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
      trees.forEach((t, i) => {
        const trunkH = 2.6 * t.s;
        pos.set(t.x, 0, t.z); sc.set(t.s, trunkH, t.s);
        m.compose(pos, q, sc); trunk.setMatrixAt(i, m);

        pos.set(t.x, trunkH + 1.8 * t.s, t.z);
        const ls = t.s * (1 + (i % 3) * 0.12);
        sc.set(ls, ls * (1.05 + (i % 4) * 0.1), ls);
        m.compose(pos, q, sc); leaf.setMatrixAt(i, m);
        leaf.setColorAt(i, col.setHex(t.col));
      });
      trunk.instanceMatrix.needsUpdate = true;
      leaf.instanceMatrix.needsUpdate = true;
      if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
      this.group.add(trunk, leaf);
    }

    // --- arena obstacles for the bowl
    if (this.def.arena) {
      const obs = [];
      for (let i = 0; i < 130; i++) {
        const th = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * (this.halfWidth - 16);
        const x = Math.cos(th) * rr * this.def.squash[0];
        const z = Math.sin(th) * rr * this.def.squash[1];
        const q = this.nearest(x, z);
        if (Math.abs(q.lateral) < 16) continue;
        obs.push({ x, z, w: 3 + rng() * 14, h: 1.5 + rng() * 9, d: 3 + rng() * 14 });
      }
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(geo, this._mat(0xffffff), obs.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
      obs.forEach((o, i) => {
        pos.set(o.x, 0, o.z); sc.set(o.w, o.h, o.d);
        m.compose(pos, q, sc); mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setHex(p.props[i % p.props.length]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  _buildClouds() {
    const p = this.palette;
    const rng = this.rng;
    const clouds = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: p.cloud, emissive: p.cloud, emissiveIntensity: 0.62,
      fog: false, transparent: true, opacity: 0.94,
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const N = 46;
    const mesh = new THREE.InstancedMesh(geo, mat, N * 5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let k = 0;
    this.cloudData = [];
    for (let i = 0; i < N; i++) {
      const bx = (rng() - 0.5) * 2400;
      const bz = (rng() - 0.5) * 2400;
      const by = 190 + rng() * 130;
      const s = 14 + rng() * 30;
      this.cloudData.push({ bx, bz, by, s, sp: 0.6 + rng() * 1.4 });
      for (let j = 0; j < 5; j++) {
        pos.set(bx + (rng() - 0.5) * s * 2.6, by + (rng() - 0.5) * s * 0.5, bz + (rng() - 0.5) * s * 2.0);
        const ss = s * (0.5 + rng() * 0.9);
        sc.set(ss, ss * (0.4 + rng() * 0.3), ss);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.cloudMesh = mesh;
    this.clouds = clouds;
    this.group.add(mesh);
  }

  updateClouds(dt) {
    if (!this.cloudMesh) return;
    this._cloudT = (this._cloudT || 0) + dt * 1.6;
    this.cloudMesh.position.x = (this._cloudT % 2400);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}
