/* ============================================================
   SLK GEO — reusable low-poly geometry helpers for the R170 model.
   Pure maths and THREE meshes; no game state.
   ============================================================ */

import * as THREE from '../../vendor/three.module.js';

/**
 * A mesh box with the project's shadow defaults.
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {THREE.Material} mat
 * @returns {THREE.Mesh}
 */
export function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Signed area of a 2-D polygon, used to keep extruded shapes facing out. */
function area(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

function ccw(points) {
  return area(points) < 0 ? points.slice().reverse() : points;
}

/**
 * Extrude a side silhouette (points in [z, y]) to a width along x.
 * Concave outlines such as wheel arches are supported.
 * @param {Array<[number, number]>} points
 * @param {number} width
 * @param {THREE.Material} mat
 * @param {number} [x]
 * @returns {THREE.Mesh}
 */
export function profile(points, width, mat, x = 0) {
  const pts = ccw(points);
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.x = x;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * A flat plate facing forward (+z) or rearward (-z).
 * @param {Array<[number, number]>} points
 * @param {number} depth
 * @param {THREE.Material} mat
 * @param {number} z
 * @param {boolean} [rear]
 * @returns {THREE.Mesh}
 */
export function plate(points, depth, mat, z, rear = false) {
  const src = rear ? points.map(([x, y]) => [-x, y]) : points;
  const pts = ccw(src);
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  if (rear) g.rotateY(Math.PI);
  const m = new THREE.Mesh(g, mat);
  m.position.z = z;
  m.userData.noShadow = true;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/**
 * An octagon that reads as an oval lamp, reflector or grille.
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} [n]
 * @returns {Array<[number, number]>}
 */
export function oval(cx, cy, rx, ry, n = 10) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = i * Math.PI * 2 / n;
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}

/**
 * Mirror target-left points for the right side, keeping the winding.
 * @param {Array<[number, number]>} pts
 * @param {number} side
 * @returns {Array<[number, number]>}
 */
export function mirrorPts(pts, side) {
  return side > 0 ? pts : pts.map(([x, y]) => [-x, y]).reverse();
}

/**
 * Sample a circular arc, inclusive of both ends.
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} a0 radians
 * @param {number} a1 radians
 * @param {number} [n]
 * @returns {Array<[number, number]>}
 */
export function arcPoints(cx, cy, r, a0, a1, n = 12) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return p;
}

/**
 * A curved fender-lip band: outer arc out, inner arc back.
 * @param {number} cx
 * @param {number} cy
 * @param {number} rIn
 * @param {number} rOut
 * @param {number} a0
 * @param {number} a1
 * @param {number} [n]
 * @returns {Array<[number, number]>}
 */
export function archBandPoints(cx, cy, rIn, rOut, a0, a1, n = 14) {
  const outer = arcPoints(cx, cy, rOut, a0, a1, n);
  const inner = arcPoints(cx, cy, rIn, a1, a0, n);
  return outer.concat(inner);
}

/**
 * Scale a point cloud around a centre, for bezels and inset lenses.
 * @param {Array<[number, number]>} pts
 * @param {number} cx
 * @param {number} cy
 * @param {number} s
 * @returns {Array<[number, number]>}
 */
export function scalePts(pts, cx, cy, s) {
  return pts.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}

/**
 * Build a lofted shoulder strip between two edges along z.
 * @param {number[]} zs stations from front to rear
 * @param {number} xIn inner x
 * @param {number} xOut outer x
 * @param {number[]} yIn top edge heights
 * @param {number[]} yOut outer edge heights
 * @param {THREE.Material} mat
 * @returns {THREE.Mesh}
 */
export function strip(zs, xIn, xOut, yIn, yOut, mat) {
  const pos = [];
  for (let i = 0; i < zs.length; i++) {
    pos.push(xIn, yIn[i], zs[i], xOut, yOut[i], zs[i]);
  }
  const idx = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Lofted bumper bar with a curved front/rear face and rounded edges.
 * @param {number} xMax half-width
 * @param {number} yTop top edge height
 * @param {number} yBot bottom edge height
 * @param {number} zCentre outer face at centre
 * @param {number} zEdge outer face at the corners
 * @param {number} zInner inner face
 * @param {THREE.Material} mat
 * @returns {THREE.Mesh}
 */
export function bumper(xMax, yTop, yBot, zCentre, zEdge, zInner, mat) {
  const fracs = [-1, -0.82, -0.60, -0.35, -0.12, 0.12, 0.35, 0.60, 0.82, 1];
  const pos = [];
  for (const f of fracs) {
    const x = f * xMax;
    const zO = zCentre + (zEdge - zCentre) * f * f;
    const ring = [
      [x, yTop, zInner], [x, yTop, zO - 0.02], [x, yTop - 0.02, zO],
      [x, yBot + 0.02, zO], [x, yBot, zO - 0.02], [x, yBot, zInner],
    ];
    for (const p of ring) pos.push(...p);
  }
  const idx = [];
  for (let i = 0; i < fracs.length - 1; i++) {
    for (let k = 0; k < 6; k++) {
      const a = i * 6 + k;
      const b = i * 6 + (k + 1) % 6;
      const c = (i + 1) * 6 + k;
      const d = (i + 1) * 6 + (k + 1) % 6;
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (base, flip) => {
    for (let k = 1; k < 5; k++) {
      if (flip) idx.push(base, base + k + 1, base + k);
      else idx.push(base, base + k, base + k + 1);
    }
  };
  cap(0, false);
  cap((fracs.length - 1) * 6, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
