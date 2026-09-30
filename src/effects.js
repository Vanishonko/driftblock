/* ============================================================
   EFFECTS — blocky smoke, tyre marks, sparks, speed lines.
   Everything is instanced; nothing allocates per frame.
   ============================================================ */

import * as THREE from '../vendor/three.module.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ============================================================
   PARTICLE POOL  (shared shader, billboarded squares)
   ============================================================ */
const PARTICLE_VS = /* glsl */`
  attribute vec3 iPos;
  attribute float iSize;
  attribute float iAlpha;
  attribute vec3 iColor;
  attribute float iRot;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vFog;
  uniform float fogDensity;
  void main() {
    vAlpha = iAlpha;
    vColor = iColor;
    vec3 p = position * iSize;
    float c = cos(iRot), s = sin(iRot);
    p.xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    mv.xy += p.xy;
    float d = -mv.z;
    vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FS = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  varying float vFog;
  uniform vec3 fogColor;
  uniform float fadeWithFog;
  void main() {
    if (vAlpha <= 0.002) discard;
    vec3 c = mix(vColor, fogColor, vFog * fadeWithFog);
    float a = vAlpha * (1.0 - vFog * fadeWithFog * 0.9);
    gl_FragColor = vec4(c, a);
  }
`;

class ParticlePool {
  constructor(max, { additive = false, depthWrite = false, fogColor = 0xffffff, fogDensity = 0.002, fadeWithFog = 1 } = {}) {
    this.max = max;
    this.count = 0;
    this.head = 0;
    this.live = 0;

    // simulation state
    this.px = new Float32Array(max * 3);
    this.vx = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.active = new Uint8Array(max);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = max;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aColor, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iAlpha', this.aAlpha);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iRot', this.aRot);

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: {
        fogColor: { value: new THREE.Color(fogColor) },
        fogDensity: { value: fogDensity },
        fadeWithFog: { value: fadeWithFog },
      },
      transparent: true,
      depthWrite,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 10;
    this.geo = geo;
    base.dispose();
  }

  setFog(color, density) {
    this.material.uniforms.fogColor.value.set(color);
    this.material.uniforms.fogDensity.value = density;
  }

  spawn(o) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    if (!this.active[i]) this.live++;
    this.active[i] = 1;
    this.px[i * 3] = o.x; this.px[i * 3 + 1] = o.y; this.px[i * 3 + 2] = o.z;
    this.vx[i * 3] = o.vx; this.vx[i * 3 + 1] = o.vy; this.vx[i * 3 + 2] = o.vz;
    this.life[i] = 0;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size0;
    this.size1[i] = o.size1;
    this.alpha0[i] = o.alpha;
    this.rot[i] = o.rot !== undefined ? o.rot : Math.random() * 6.28;
    this.rotV[i] = o.rotV !== undefined ? o.rotV : (Math.random() - 0.5) * 3;
    this.grav[i] = o.grav || 0;
    this.drag[i] = o.drag !== undefined ? o.drag : 1.6;
    const c0 = o.color0 || [1, 1, 1];
    this.c0[i * 3] = c0[0]; this.c0[i * 3 + 1] = c0[1]; this.c0[i * 3 + 2] = c0[2];
    const c1 = o.color1 || [1, 1, 1];
    this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
    return i;
  }

  update(dt) {
    const { px, vx, life, maxLife, size0, size1, alpha0, rot, rotV, grav, drag, c0, c1, active, aPos, aSize, aAlpha, aColor, aRot } = this;
    for (let i = 0; i < this.max; i++) {
      if (!active[i]) { aAlpha.array[i] = 0; continue; }
      let t = (life[i] += dt) / maxLife[i];
      if (t >= 1) { if (active[i]) this.live--; active[i] = 0; aAlpha.array[i] = 0; continue; }

      const d = Math.exp(-drag[i] * dt);
      vx[i * 3] *= d; vx[i * 3 + 2] *= d;
      vx[i * 3 + 1] = vx[i * 3 + 1] * d + grav[i] * dt;

      px[i * 3] += vx[i * 3] * dt;
      px[i * 3 + 1] += vx[i * 3 + 1] * dt;
      px[i * 3 + 2] += vx[i * 3 + 2] * dt;

      rot[i] += rotV[i] * dt;

      // ease-out growth
      const g = 1 - Math.pow(1 - t, 2.2);
      const sz = size0[i] + (size1[i] - size0[i]) * g;
      // fade in fast, out slow
      const a = alpha0[i] * Math.min(1, t * 7) * (1 - t) * (1 - t);

      aPos.array[i * 3] = px[i * 3];
      aPos.array[i * 3 + 1] = px[i * 3 + 1];
      aPos.array[i * 3 + 2] = px[i * 3 + 2];
      aSize.array[i] = sz;
      aAlpha.array[i] = a;
      aRot.array[i] = rot[i];
      aColor.array[i * 3] = c0[i * 3] + (c1[i * 3] - c0[i * 3]) * t;
      aColor.array[i * 3 + 1] = c0[i * 3 + 1] + (c1[i * 3 + 1] - c0[i * 3 + 1]) * t;
      aColor.array[i * 3 + 2] = c0[i * 3 + 2] + (c1[i * 3 + 2] - c0[i * 3 + 2]) * t;
    }
    aPos.needsUpdate = true;
    aSize.needsUpdate = true;
    aAlpha.needsUpdate = true;
    aColor.needsUpdate = true;
    aRot.needsUpdate = true;
  }

  clear() {
    this.active.fill(0);
    this.live = 0;
    this.aAlpha.array.fill(0);
    this.aAlpha.needsUpdate = true;
  }
}

/* ============================================================
   SKID MARKS  — ribbon ring buffers, one per wheel
   ============================================================ */
class SkidMarks {
  constructor(maxSeg = 240, ribbons = 4, width = 0.27) {
    this.maxSeg = maxSeg;
    this.ribbons = [];
    this.width = width;

    for (let r = 0; r < ribbons; r++) {
      const verts = new Float32Array(maxSeg * 4 * 3);
      const cols = new Float32Array(maxSeg * 4 * 4);
      const idx = new Uint16Array(maxSeg * 6);
      for (let i = 0; i < maxSeg; i++) {
        const v = i * 4;
        idx[i * 6 + 0] = v; idx[i * 6 + 1] = v + 1; idx[i * 6 + 2] = v + 2;
        idx[i * 6 + 3] = v + 2; idx[i * 6 + 4] = v + 1; idx[i * 6 + 5] = v + 3;
      }
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage);
      const col = new THREE.BufferAttribute(cols, 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      geo.setAttribute('color', col);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setDrawRange(0, 0);

      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      this.ribbons.push({
        mesh, pos, col, geo, head: 0, filled: 0,
        last: null, // last emitted centre, for continuity
        alphas: new Float32Array(maxSeg * 4),
      });
    }
  }

  add(group) { for (const r of this.ribbons) group.add(r.mesh); }

  /**
   * Emit one segment quad for a ribbon.
   * @param {number} r ribbon index
   * @param {number} cx,cz contact centre
   * @param {number} rx,rz unit "right" across the ribbon
   * @param {number} y ground height
   * @param {number} alpha 0..1
   * @param {number} cr,cg,cb colour
   */
  emit(r, cx, cz, rx, rz, y, alpha, cr, cg, cb) {
    const rb = this.ribbons[r];
    const i = rb.head;
    rb.head = (rb.head + 1) % this.maxSeg;
    rb.filled = Math.min(rb.filled + 1, this.maxSeg);

    const hw = this.width / 2;
    const P = rb.pos.array;
    const v = i * 4 * 3;
    // 4 verts: L-near, R-near, L-far, R-far
    P[v + 0] = cx + rx * hw; P[v + 1] = y; P[v + 2] = cz + rz * hw;
    P[v + 3] = cx - rx * hw; P[v + 4] = y; P[v + 5] = cz - rz * hw;
    const prev = rb.last;
    if (prev) {
      P[v + 6] = prev.x + prev.rx * hw; P[v + 7] = y; P[v + 8] = prev.z + prev.rz * hw;
      P[v + 9] = prev.x - prev.rx * hw; P[v + 10] = y; P[v + 11] = prev.z - prev.rz * hw;
    } else {
      for (let k = 6; k < 12; k++) P[v + k] = P[v + k - 6];
    }

    const C = rb.col.array;
    const a = i * 4 * 4;
    for (let k = 0; k < 4; k++) {
      C[a + k * 4 + 0] = cr;
      C[a + k * 4 + 1] = cg;
      C[a + k * 4 + 2] = cb;
      C[a + k * 4 + 3] = alpha;
    }
    rb.alphas[i] = alpha;

    rb.last = { x: cx, z: cz, rx, rz };
    rb.pos.needsUpdate = true;
    rb.col.needsUpdate = true;
    rb.geo.setDrawRange(0, rb.filled * 6);
  }

  /** abruptly stop a ribbon (wheel left the ground / stopped sliding) */
  breakRibbon(r) { this.ribbons[r].last = null; }

  /** gentle global fade so old rubber ages off */
  fade(dt, rate = 0.055) {
    for (const rb of this.ribbons) {
      const C = rb.col.array;
      let dirty = false;
      for (let i = 0; i < rb.filled; i++) {
        const a = i * 4 * 4 + 3;
        const cur = C[a];
        if (cur <= 0.001) continue;
        const next = Math.max(0, cur - rate * dt);
        for (let k = 0; k < 4; k++) C[a + k * 4] = next;
        dirty = true;
      }
      if (dirty) rb.col.needsUpdate = true;
    }
  }

  clear() {
    for (const rb of this.ribbons) {
      rb.head = 0; rb.filled = 0; rb.last = null;
      rb.geo.setDrawRange(0, 0);
      rb.col.array.fill(0);
      rb.col.needsUpdate = true;
    }
  }
}

/* ============================================================
   SPEED LINES — world space streaks that only exist at speed
   ============================================================ */
class SpeedLines {
  constructor(count = 190) {
    this.count = count;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 14;
    this.mat = mat;
    this.data = [];
    for (let i = 0; i < count; i++) {
      this.data.push({
        ang: Math.random() * Math.PI * 2,
        rad: 4 + Math.random() * 30,
        along: (Math.random() - 0.5) * 90,
        len: 5 + Math.random() * 26,
        thick: 0.05 + Math.random() * 0.15,
        sp: 0.6 + Math.random() * 1.5,
      });
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  update(dt, car, camPos) {
    const kmh = car.speed * 3.6;
    const vis = clamp((kmh - 45) / 105, 0, 1);
    this.mat.opacity = Math.pow(vis, 0.8) * 0.78;
    this.mesh.visible = vis > 0.01;
    if (!this.mesh.visible) return;

    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);   // travel axis
    const px = fz, pz = -fx;                                 // perpendicular

    for (let i = 0; i < this.count; i++) {
      const d = this.data[i];
      d.along -= (car.speed * 0.55 + 22) * d.sp * dt;
      if (d.along < -70) d.along = 40 + Math.random() * 50;

      const lat = Math.cos(d.ang) * d.rad;
      const vert = Math.sin(d.ang) * d.rad;
      const X = camPos.x + fx * d.along + px * lat;
      const Z = camPos.z + fz * d.along + pz * lat;
      const Y = camPos.y + vert * 0.32;

      this._p.set(X, Y, Z);
      this._e.set(0, Math.atan2(fx, fz), 0);
      this._q.setFromEuler(this._e);
      this._s.set(d.thick, d.thick, d.len * (0.5 + vis));
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.mesh.visible = false; }
}

/* ============================================================
   EFFECTS FACADE
   ============================================================ */
export class Effects {
  constructor(scene, palette) {
    this.scene = scene;
    this.palette = palette;

    this.smoke = new ParticlePool(700, {
      fogColor: palette.fog, fogDensity: palette.fogDensity, fadeWithFog: 0.85,
    });
    this.sparks = new ParticlePool(220, {
      additive: true, fogColor: 0x000000, fogDensity: palette.fogDensity, fadeWithFog: 0.5,
    });
    this.skids = new SkidMarks(260, 4, 0.34);
    this.lines = new SpeedLines(190);

    scene.add(this.smoke.mesh, this.sparks.mesh, this.lines.mesh);
    this.skids.add(scene);

    this._t = 0;
    this._skidAcc = 0;
    this._smokeAcc = 0;
    this._wheelSlipPrev = [0, 0, 0, 0];
  }

  setPalette(palette) {
    this.palette = palette;
    this.smoke.setFog(palette.fog, palette.fogDensity);
    this.sparks.setFog(palette.fog, palette.fogDensity);
  }

  /** wheel contact points in world space */
  static wheelPositions(s) {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const a = 1.42, b = -1.42, w = 0.86;
    return [
      { x: s.x + fx * a + rx * w, z: s.z + fz * a + rz * w, front: true, left: true },
      { x: s.x + fx * a - rx * w, z: s.z + fz * a - rz * w, front: true, left: false },
      { x: s.x + fx * b + rx * w, z: s.z + fz * b + rz * w, front: false, left: true },
      { x: s.x + fx * b - rx * w, z: s.z + fz * b - rz * w, front: false, left: false },
    ];
  }

  /**
   * @param {number} dt
   * @param {import('./physics.js').CarState} s
   * @param {object} opts { onGrass, boost, painting }
   */
  update(dt, s, opts) {
    this._t += dt;
    const { onGrass, boost } = opts;
    const wheels = Effects.wheelPositions(s);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);

    // ---- how hard each wheel is sliding -------------------------------
    const slipAmt = clamp(s.absSlip / 0.85, 0, 1);
    const spd = clamp(s.speed / 9, 0, 1);
    // A burnout produces no slide and no road speed, so the old "slip x speed"
    // measure read zero and the tyres smoked not at all while spinning on the
    // spot. Lit tyres are their own source.
    const spun = clamp(opts.wheelspin || 0, 0, 1);
    const slide = Math.max(slipAmt * spd, spun);
    // rear wheels slide more than fronts under power
    const wheelSlide = [
      slide * (onGrass ? 1.0 : 0.55),
      slide * (onGrass ? 1.0 : 0.55),
      slide * (onGrass ? 1.15 : 1.0),
      slide * (onGrass ? 1.15 : 1.0),
    ];

    // ---- tyre marks ---------------------------------------------------
    // lay a segment every ~0.55 m of travel while sliding
    const emitSpacing = 0.55;
    // distance travelled OR tyre rotation — a stationary burnout still marks
    this._skidAcc += Math.max(s.speed, spun * 9) * dt;
    const doEmit = this._skidAcc >= emitSpacing;
    if (doEmit) this._skidAcc = 0;

    const markCol = onGrass ? [0.26, 0.20, 0.13] : [0.05, 0.05, 0.07];
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const amt = wheelSlide[i];
      if (doEmit && amt > 0.13) {
        this.skids.emit(i, w.x, w.z, rx, rz, 0.035, clamp(amt * 1.15, 0, 0.92),
          markCol[0], markCol[1], markCol[2]);
      } else if (amt <= 0.10 && this._wheelSlipPrev[i] > 0.10) {
        this.skids.breakRibbon(i);
      }
      this._wheelSlipPrev[i] = amt;
    }

    // ---- smoke --------------------------------------------------------
    this._smokeAcc += dt;
    const smokeStep = 1 / 130;
    while (this._smokeAcc >= smokeStep) {
      this._smokeAcc -= smokeStep;
      const rear = [wheels[2], wheels[3]];
      for (const w of rear) {
        // a burnout has almost no slide, so the lit rear tyres are their own
        // smoke source; a sliding car smokes off the slide
        const amt = Math.max(wheelSlide[2], spun);
        // A stationary burnout pours smoke out of one spot, so without pulling
        // it back it piles into a single opaque cloud that hides the car.
        const plume = spun * (1 - slipAmt * 0.6);
        if (amt < 0.16) continue;
        if (Math.random() > amt * (1.1 - 0.62 * plume)) continue;
        // a tighter cap when sitting still, where every puff stacks in one place
        if (this.smoke.live > (spun > 0.5 && spd < 0.2 ? 150 : 430)) continue;

        const base = onGrass ? [0.62, 0.56, 0.40] : [0.92, 0.93, 0.98];
        const tint = boost > 0 ? [1.0, 0.75, 0.95] : base;
        // Puffs are smaller, thinner and quicker off the mark.
        const spread = 0.5 + amt * 2.4;
        this.smoke.spawn({
          x: w.x + (Math.random() - 0.5) * 0.5,
          y: 0.18 + Math.random() * 0.25,
          z: w.z + (Math.random() - 0.5) * 0.5,
          vx: -s.vx * 0.13 + (Math.random() - 0.5) * spread * (1 + plume * 1.4),
          vy: 0.7 + Math.random() * 1.5 * amt + plume * 0.9,
          vz: -s.vz * 0.13 + (Math.random() - 0.5) * spread * (1 + plume * 1.4),
          life: 0.34 + Math.random() * 0.38 * (0.5 + amt),
          size0: 0.11 + Math.random() * 0.12,
          size1: 0.50 + amt * 1.15 + Math.random() * 0.50,
          alpha: (0.24 + amt * 0.24) * (1 - 0.45 * plume),
          color0: tint,
          color1: onGrass ? [0.52, 0.48, 0.36] : [0.86, 0.88, 0.94],
          rotV: (Math.random() - 0.5) * 2.6,
          grav: 0.55,
          drag: 1.15,
        });
      }
      // boost exhaust puffs
      if (boost > 0 && Math.random() < 0.8) {
        const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
        const bx = s.x - fx * 2.1, bz = s.z - fz * 2.1;
        this.smoke.spawn({
          x: bx + (Math.random() - 0.5) * 0.6, y: 0.35, z: bz + (Math.random() - 0.5) * 0.6,
          vx: -s.vx * 0.25, vy: 0.5, vz: -s.vz * 0.25,
          life: 0.28 + Math.random() * 0.26,
          size0: 0.17, size1: 0.85, alpha: 0.42,
          color0: [0.5, 0.85, 1.0], color1: [0.75, 0.5, 1.0],
          drag: 2.2, grav: 0.2,
        });
      }
    }

    this.smoke.update(dt);
    this.sparks.update(dt);
    this.skids.fade(dt, 0.035);
    this.lines.update(dt, s, { x: s.x, y: 1.1, z: s.z });
  }

  /** wall scrape / impact burst */
  burst(x, y, z, strength, dirX = 0, dirZ = 0, color = [1.0, 0.72, 0.25]) {
    const n = Math.round(6 + strength * 26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 2.6 * (0.5 + strength);
      this.sparks.spawn({
        x, y: y + Math.random() * 0.5, z,
        vx: Math.cos(a) * (2 + Math.random() * 9) * (0.5 + strength) + dirX * 3,
        vy: up,
        vz: Math.sin(a) * (2 + Math.random() * 9) * (0.5 + strength) + dirZ * 3,
        life: 0.25 + Math.random() * 0.5,
        size0: 0.10 + Math.random() * 0.16,
        size1: 0.02,
        alpha: 0.85 + Math.random() * 0.15,
        color0: color,
        color1: [0.45, 0.10, 0.02],
        grav: -9.0,
        drag: 1.1,
        rotV: (Math.random() - 0.5) * 14,
      });
    }
    // puff of dust
    for (let i = 0; i < Math.round(3 + strength * 9); i++) {
      this.smoke.spawn({
        x: x + (Math.random() - 0.5) * 1.2, y: y + Math.random() * 0.6, z: z + (Math.random() - 0.5) * 1.2,
        vx: (Math.random() - 0.5) * 4, vy: 0.8 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 4,
        life: 0.42 + Math.random() * 0.42,
        size0: 0.24, size1: 1.15, alpha: 0.38,
        color0: [0.85, 0.84, 0.82], color1: [0.7, 0.7, 0.72],
        drag: 1.6, grav: 0.4,
      });
    }
  }

  /** one-off puff when a mini-turbo fires */
  boostBlast(x, y, z, yaw, tier) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const cols = [[0.45, 0.9, 1.0], [1.0, 0.82, 0.30], [1.0, 0.42, 0.85]];
    const c = cols[clamp(tier, 0, 2)];
    for (let i = 0; i < 44; i++) {
      const spread = 1.4 + tier * 0.6;
      this.smoke.spawn({
        x: x - fx * 2.0 + (Math.random() - 0.5) * 1.4,
        y: y + (Math.random() - 0.5) * 0.7,
        z: z - fz * 2.0 + (Math.random() - 0.5) * 1.4,
        vx: -fx * (4 + Math.random() * 8) + (Math.random() - 0.5) * spread,
        vy: 0.6 + Math.random() * 2,
        vz: -fz * (4 + Math.random() * 8) + (Math.random() - 0.5) * spread,
        life: 0.34 + Math.random() * 0.42,
        size0: 0.20, size1: 1.30 + tier * 0.45,
        alpha: 0.62,
        color0: c, color1: [0.9, 0.9, 1.0],
        drag: 2.0, grav: 0.3,
      });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.spawn({
        x, y: y + 0.3, z,
        vx: Math.cos(a) * 6, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 6,
        life: 0.3, size0: 0.18, size1: 0.02, alpha: 1,
        color0: c, color1: [1, 1, 1], grav: -4, drag: 2,
      });
    }
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
    this.lines.clear();
  }
}
