/* ============================================================
   DISPLAY — sizing, device pixel ratio, UI scale and fullscreen.

   A browser window is not a screen, and a scaled display reports a
   viewport that does not match the window. This is the one place that
   knows the difference, and the readout it produces is what a display
   bug report should quote.
   ============================================================ */

import { patch as patchSettings, get as setting } from './settings.js';

/** The renderer and canvas are supplied by main; nothing here owns them. */
let ctx = null;

/** @param {{canvas:HTMLCanvasElement, renderer:object, camera:object, onResize?:Function}} deps */
export function attach(deps) {
  ctx = deps;
  for (const ev of ['resize', 'orientationchange']) addEventListener(ev, resize);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', resize);
    visualViewport.addEventListener('scroll', resize);
  }
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(ev, () => setTimeout(resize, 60));
  }
  addEventListener('resize', resize);

  // The canvas is sized to its container rather than to the window whenever
  // the container changes shape, so a fullscreen transition or a UI-scale
  // change is picked up without a reload.
  const host = ctx.canvas.parentElement;
  if (host && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(host);
  }
  resize();
}

function resize() {
  if (!ctx) return;
  const { canvas, renderer, camera } = ctx;
  // Measure the element the canvas actually lives in rather than trusting
  // window.innerWidth/innerHeight, which can disagree with the real layout
  // box on a scaled display and leave the canvas short of the viewport.
  const host = canvas.parentElement || document.documentElement;
  const box = host.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width) || window.innerWidth || 1);
  const h = Math.max(1, Math.round(box.height) || window.innerHeight || 1);

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let bw = Math.round(w * dpr);
  let bh = Math.round(h * dpr);

  // Keep the drawing buffer sane on huge or very high-dpi displays; the CSS
  // size is what the driver sees, so shrinking the buffer only costs detail.
  const MAX = 5.5e6;
  if (bw * bh > MAX) {
    const k = Math.sqrt(MAX / (bw * bh));
    bw = Math.max(1, Math.round(bw * k));
    bh = Math.max(1, Math.round(bh * k));
  }

  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  renderer.setPixelRatio(1);
  renderer.setSize(bw, bh, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  applyUiScale(w, h);
  if (ctx.onResize) ctx.onResize();
}

/**
 * Scale the HUD with the viewport.
 *
 * The HUD is authored at 1920x1080. `zoom` is used rather than a transform
 * because it scales an element's offset as well as its size, so the corner
 * positions stay relative to the viewport instead of sliding off it.
 */
function applyUiScale(w, h) {
  const auto = Math.max(0.55, Math.min(1.35, Math.min(w / 1920, h / 1080)));
  const scale = setting('uiScale') ?? auto;
  document.documentElement.style.setProperty('--ui', String(scale));
  return { auto, scale };
}

/** Everything worth quoting in a display bug report. */
export function displayInfo() {
  const host = ctx ? ctx.canvas.parentElement : null;
  const b = host ? host.getBoundingClientRect() : null;
  const canvas = ctx ? ctx.canvas : null;
  const r = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
  const auto = Math.max(0.55, Math.min(1.35,
    Math.min(window.innerWidth / 1920, window.innerHeight / 1080)));
  return {
    viewport: [window.innerWidth, window.innerHeight],
    appBox: b ? [Math.round(b.width), Math.round(b.height)] : [0, 0],
    screen: [screen.width, screen.height],
    dpr: window.devicePixelRatio || 1,
    buffer: canvas ? [canvas.width, canvas.height] : [0, 0],
    cssSize: [Math.round(r.width), Math.round(r.height)],
    autoScale: auto,
    uiScale: setting('uiScale') ?? auto,
  };
}

/* ---------------- fullscreen ---------------- */

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export function requestFullscreen() {
  const el = document.documentElement;
  const go = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!go) return false;
  try {
    const r = go.call(el, { navigationUI: 'hide' });
    if (r && r.catch) r.catch(() => { /* the driver declined; fine */ });
    return true;
  } catch { return false; }
}

export function exitFullscreen() {
  const go = document.exitFullscreen || document.webkitExitFullscreen;
  if (!go) return;
  try { go.call(document); } catch { /* already out */ }
}

export function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen(); else requestFullscreen();
}

/** Honour the saved preference, where the caller has a user gesture. */
export function applyFullscreenPreference() {
  if (setting('fullscreen') !== false && !isFullscreen()) requestFullscreen();
}

export { resize, applyUiScale };
