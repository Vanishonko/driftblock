/* Track validation.
   Run:  node tools/trackcheck.mjs
   Builds every circuit headlessly, checks the geometry is sane
   (no self-intersection, drivable corner radii, sane lap length)
   and then drives an AI lap with the real physics model to prove
   the track is actually completable. */

import * as THREE from '../vendor/three.module.js';
import { TRACK_DEFS, Track } from '../src/track.js';
import { CarState, stepCar, TUNE } from '../src/physics/index.js';

const dt = 1 / 120;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function analyse(def) {
  const t0 = Date.now();
  const track = new Track(def);
  const buildMs = Date.now() - t0;

  const S = track.samples, C = track.count, sp = track.spacing;

  // ---- self-intersection: min distance between parts of the lap that are
  //      genuinely far apart along the track (not just neighbouring samples)
  let minSep = Infinity, minSepAt = 0;
  const farCount = Math.ceil(Math.max(60, def.width * 2.5) / sp);
  for (let i = 0; i < C; i++) {
    for (let k = farCount; k < C - farCount; k++) {
      const j = (i + k) % C;
      const d = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
      if (d < minSep) { minSep = d; minSepAt = i; }
    }
  }
  const clearance = minSep - def.width;
  const crosses = clearance < 0;

  // ---- corner radii from heading change
  const radii = [];
  for (let i = 0; i < C; i++) {
    const a = S[(i - 4 + C) % C], b = S[(i + 4) % C];
    let dth = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
    while (dth > Math.PI) dth -= Math.PI * 2;
    while (dth < -Math.PI) dth += Math.PI * 2;
    const arc = sp * 8;
    if (Math.abs(dth) > 1e-6) radii.push(arc / Math.abs(dth));
  }
  radii.sort((x, y) => x - y);
  const rMin = radii[0];
  const rP10 = radii[Math.floor(radii.length * 0.10)];
  const rMed = radii[Math.floor(radii.length * 0.50)];

  // ---- how much of the lap is "tight" (needs < 25 m radius)
  const tightFrac = radii.filter((r) => r < 25).length / radii.length;

  // ---- AI lap
  const surf = TUNE.surface.road;
  const s = new CarState();
  const pose = track.startPose;
  s.reset(pose.x, pose.z, pose.heading);
  let hint = 0;

  const LAT = 13.5;          // m/s^2 the AI is willing to pull
  let laps = 0, prevProg = 0, prog = 0, maxProg = 0;
  let offTrack = 0, wallHits = 0, steps = 0;
  let lapStart = 0, lapTimes = [];
  let stuck = 0;

  const maxSteps = Math.round(180 / dt);
  for (let i = 0; i < maxSteps; i++) {
    steps = i;
    const q = track.nearest(s.x, s.z, hint);
    hint = q.i;

    // progress bookkeeping
    const d = ((q.s - prevProg) + track.length) % track.length;
    if (d < track.length * 0.5) prog += d;
    prevProg = q.s;
    maxProg = Math.max(maxProg, prog);
    if (Math.abs(q.lateral) > track.halfWidth) offTrack++;
    if (Math.abs(q.lateral) > track.wallDist) { wallHits++; }

    if (prog - lapStart * track.length >= track.length) {
      laps++;
      lapTimes.push((i - lapStart * 0) * dt);
      lapStart = laps;
      if (laps >= 2) break;
    }

    // ---- speed target from upcoming curvature
    const look = clamp(14 + s.speed * 1.15, 18, 62);
    let maxCurv = 0;
    const nAhead = Math.round(look / sp);
    for (let k = 0; k < nAhead; k++) {
      const idx = (q.i + k) % C;
      const a = S[(idx - 4 + C) % C], b = S[(idx + 4) % C];
      let dth = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
      while (dth > Math.PI) dth -= Math.PI * 2;
      while (dth < -Math.PI) dth += Math.PI * 2;
      const w = 1 - k / nAhead;
      maxCurv = Math.max(maxCurv, Math.abs(dth) / (sp * 8) * w * w);
    }
    const vTarget = Math.min(TUNE.topSpeed * 0.96, Math.sqrt(LAT / Math.max(1e-5, maxCurv)));

    // ---- pure pursuit steering
    const ahead = clamp(7 + s.speed * 0.75, 10, 40);
    const ai = (q.i + Math.round(ahead / sp)) % C;
    const tgt = S[ai];
    // aim slightly inside the corner
    const insideBias = clamp(S[ai].curv * 0.02, -0.45, 0.45) * track.halfWidth * 0.55;
    const tx = tgt.x + tgt.nx * insideBias;
    const tz = tgt.z + tgt.nz * insideBias;

    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const dx = tx - s.x, dz = tz - s.z;
    const localF = dx * fx + dz * fz;
    const localR = dx * rx + dz * rz;
    let steerCmd = clamp(Math.atan2(localR, Math.max(1, localF)) * 1.9, -1, 1);
    // counter-steer correction: point the wheels back down the velocity vector
    steerCmd = clamp(steerCmd - clamp(s.slip, -1.2, 1.2) * 0.85, -1, 1);
    // nudge the AI toward the middle of the road if it drifts wide
    steerCmd = clamp(steerCmd - clamp(q.lateral / track.halfWidth, -1, 1) * 0.35, -1, 1);

    const kmh = s.speed;
    let throttle = 0, brake = 0;
    if (kmh < vTarget) throttle = clamp((vTarget - kmh) * 0.5, 0, 1);
    else brake = clamp((kmh - vTarget) * 0.35, 0, 1);

    stepCar(s, {
      steer: steerCmd, throttle, brake, handbrake: 0,
      handbrakeEdge: false, boost: 0,
    }, dt, surf);

    if (s.speed < 1.5 && i > 120) { stuck++; } else stuck = 0;
    if (stuck > 400) break;
  }

  const completed = laps >= 1;

  return {
    def, track, buildMs, crosses, clearance, rMin, rP10, rMed, tightFrac,
    laps, lapTime: lapTimes[0] || null, offTrackFrac: offTrack / Math.max(1, steps),
    wallHits, stuck: stuck > 400, topSpeed: 0,
  };
}

console.log('\n================ TRACK VALIDATION ================\n');
let bad = 0;
for (const def of TRACK_DEFS) {
  const r = analyse(def);
  const ok = (b) => (b ? 'OK  ' : 'FAIL');
  console.log(`${r.def.name}  [${r.def.difficulty}]`);
  console.log(`  length            : ${(r.track.length).toFixed(0)} m   (${r.track.count} samples)`);
  console.log(`  width / wall dist : ${r.def.width} m / ${(r.track.wallDist * 2).toFixed(0)} m`);
  console.log(`  self-clearance    : ${r.clearance.toFixed(1)} m   ${ok(!r.crosses)}${r.crosses ? '  <-- TRACK OVERLAPS ITSELF' : ''}`);
  console.log(`  corner radius     : min ${r.rMin.toFixed(1)}  p10 ${r.rP10.toFixed(1)}  median ${r.rMed.toFixed(1)} m`);
  console.log(`  tight (<25m)      : ${(r.tightFrac * 100).toFixed(1)}% of the lap`);
  console.log(`  build time        : ${r.buildMs} ms   triangles≈${JSON.stringify(triCount(r.track))}`);
  console.log(`  AI lap            : ${r.laps >= 1 ? 'COMPLETED in ' + r.lapTime.toFixed(2) + 's' : 'DID NOT COMPLETE'}`);
  console.log(`  time off track    : ${(r.offTrackFrac * 100).toFixed(1)}%   wall contacts: ${r.wallHits}${r.stuck ? '   <-- GOT STUCK' : ''}`);
  if (r.crosses || !r.laps || r.stuck) bad++;
  console.log('');
}
console.log(bad === 0 ? 'All tracks valid.\n' : `${bad} track(s) need attention.\n`);

function triCount(track) {
  let tris = 0;
  track.group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    const n = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(tris);
}
