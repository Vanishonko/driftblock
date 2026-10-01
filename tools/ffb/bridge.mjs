/* ============================================================
   DRIFTBLOCK — racing wheel bridge

     node tools/ffb/bridge.mjs              serve the game + wheel + FFB
     node tools/ffb/bridge.mjs --probe      list HID devices and exit
     node tools/ffb/bridge.mjs 9000         pick a port

   Why this exists
   ---------------
   A browser cannot apply torque to a steering wheel. Chrome's
   Gamepad API exposes input, and Gamepad.vibrationActuator can
   rumble a pad, but there is no web API that pushes a wheel's rim
   around. Doing that needs a native process talking to the wheel
   over USB HID — which is what this is.

   It serves the game itself, so everything lives on one origin and
   there is no CORS or second port to think about.

   Requires:  cd tools/ffb && npm install
              and the wheel's mode switch set to PS3.
   ============================================================ */

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createStaticHandler, listenWithFallback } from '../static-server.mjs';
import { WebSocketServer } from './ws-server.mjs';
import { WheelForce, findWheelInterfaces, loadHid } from './g29.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');
const TEST = argv.includes('--test');
// SAFE default. See the header of g29.mjs: writing effect commands to the
// input interface is what made FFB work, but it appears to stop the browser
// reading the wheel at all. Opt in with --iface=input.
const IFACE = (argv.find((a) => a.startsWith('--iface=')) || '--iface=vendor').split('=')[1];
const RELEASE = argv.includes('--release');
const WATCH = argv.includes('--watch');
// Off by default: these writes are what break the wheel's mode switch.
const ALLOW_INIT = argv.includes('--allow-init');
const portArg = argv.find((a) => /^\d+$/.test(a));
const START_PORT = portArg ? Number(portArg) : 8177;

/* ------------------------------------------------------------
   Stable button indices sent to the browser. The game's setup
   screen binds against these, so the order must not change.
   ------------------------------------------------------------ */
const BUTTONS = [
  'x', 'square', 'triangle', 'circle',
  'l2', 'r2', 'l3', 'r3',
  'plus', 'minus', 'spinner', 'share', 'option', 'playstation',
  'shift_left', 'shift_right',
];
const DPAD_BASE = BUTTONS.length;          // up, right, down, left
const BUTTON_COUNT = DPAD_BASE + 4;

/* ============================================================
   HID / WHEEL
   ============================================================ */
function probe() {
  const HID = loadHid();
  if (!HID) {
    console.log('\n  node-hid is not installed.\n');
    console.log('  Run:  cd tools/ffb && npm install\n');
    return 1;
  }
  let devices = [];
  try { devices = HID.devices(); } catch (e) {
    console.log('\n  Could not enumerate HID devices:', e.message, '\n');
    return 1;
  }

  const wheels = findWheelInterfaces();
  console.log(`\n  ${devices.length} HID device(s) visible.\n`);

  if (!wheels.length) {
    console.log('  No Logitech wheel found. Things to check:');
    console.log('    · is it plugged in AND powered? (the G29 has its own power brick)');
    console.log('    · try a different USB port, and a full power cycle');
    console.log('    · is Logitech G HUB running and holding the device?');
    console.log('      (quit it — only one process can drive the wheel)\n');
    return 1;
  }

  console.log('  Wheel interfaces:');
  for (const d of wheels) {
    const kind = d.usagePage === 0xff00 ? 'force feedback'
      : d.usagePage === 0x0001 ? 'joystick input'
        : 'other';
    console.log(`    usagePage=0x${(d.usagePage || 0).toString(16).padStart(4, '0')}  ` +
      `iface=${d.interface ?? '-'}  -> ${kind}`);
  }

  const hasInput = wheels.some((d) => d.usagePage === 0x0001);
  console.log('');
  console.log(`  Force feedback will write to the ${IFACE} interface` +
    (IFACE === 'vendor' ? ' (usagePage 0xff00).' : ' (usagePage 0x0001).'));
  if (IFACE === 'input' && !hasInput) {
    console.log('  ...but no input interface was found. Try --iface=vendor');
  }
  if (IFACE === 'vendor' && !wheels.some((d) => d.usagePage === 0xff00)) {
    console.log('  ...but no vendor interface was found. Try --iface=input');
  }
  console.log('');
  return 0;
}

/**
 * --release: undo everything this tool could have left behind.
 * Force off, shift lights off, auto-centring handed back to the wheel, and
 * rotation range back to 900. Use this if the wheel is left pulling, or with
 * its lights stuck on.
 */
async function releaseWheel() {
  const wf = new WheelForce({ verbose: true, iface: IFACE });
  if (!wf.open()) {
    console.log('\n  Could not open the wheel:', wf.lastError);
    console.log('  If the lights are stuck or it is pulling, a full power cycle');
    console.log('  (pull the power brick, not just USB) will clear it.\n');
    return 1;
  }
  wf.restoreWheelDefaults();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(200);
  wf.release();
  console.log('\n  Force off, lights off, auto-centring and range restored.\n');
  return 0;
}

/** --test: nudge the rim left, right, centre and flash the LEDs, so you can
    confirm the hardware responds before trusting the whole chain. */
async function selfTest() {
  const wf = new WheelForce({ verbose: true, iface: IFACE, allowInit: ALLOW_INIT });
  if (!wf.open()) {
    console.log('\n  Could not open the wheel:', wf.lastError, '\n');
    return 1;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  console.log('\n  Watch and feel the wheel. A gentle pull each way, then it releases.\n');

  wf.setLeds(31);
  wf.forceConstant(0.5);
  wf.forceFriction(0.0);
  wf.autoCenterOff();
  await wait(600);

  for (const [label, value] of [['left', 0.34], ['right', 0.66], ['centre', 0.5]]) {
    console.log(`    nudging ${label}`);
    wf.forceConstant(value);
    await wait(900);
  }

  wf.forceConstant(0.5);
  wf.forceFriction(0.5);
  console.log('    LEDs off, releasing');
  await wait(300);
  wf.release();

  console.log(`\n  ${wf.writes} writes, ${wf.writeErrors} errors.`);
  if (wf.writes > 0 && wf.writeErrors === 0) {
    console.log('  Commands reached the device. If you felt nothing, the wheel is');
    console.log('  probably stuck in a bad mode — power-cycle it (pull the brick).\n');
  } else {
    console.log('  Writes failed:', wf.lastError, '\n');
  }
  return 0;
}

if (PROBE) process.exit(probe());
/**
 * --watch: print the raw HID input report so we can see which bytes carry the
 * wheel and pedals on THIS unit.
 *
 * Chrome will not expose a gamepad to a page until the driver physically
 * touches it, and some wheels never appear at all. Reading the report here
 * sidesteps that entirely: the bridge owns the device and can forward the
 * values over the websocket, so the game stops depending on the Gamepad API.
 * To do that we need the byte layout for this exact wheel, which is what this
 * prints. Turn the wheel slowly lock to lock, then press each pedal.
 */
async function watchReports() {
  const HID = loadHid();
  if (!HID) { console.log('\n  node-hid is not installed.\n'); return 1; }

  const all = findWheelInterfaces();
  const input = all.find((d) => d.usagePage === 0x0001 || d.interface === 0);
  if (!input) { console.log('\n  No joystick interface found.\n'); return 1; }

  const dev = new HID.HID(input.path);
  console.log(`\n  Reading ${PRODUCTS[input.productId] || 'wheel'} — turn the wheel slowly`);
  console.log('  lock to lock, then press the throttle, brake and clutch in turn.');
  console.log('  Ctrl+C when done.\n');
  console.log('  Only bytes that CHANGE are shown, so the quiet ones are not noise.\n');

  let prev = null;
  let n = 0;
  dev.on('data', (buf) => {
    if (!prev) { prev = Buffer.from(buf); console.log('  first report, ' + buf.length + ' bytes'); return; }
    const moves = [];
    for (let i = 0; i < buf.length; i++) if (buf[i] !== prev[i]) moves.push(`${i}:${prev[i]}->${buf[i]}`);
    prev = Buffer.from(buf);
    if (!moves.length) return;
    if (++n > 60) return;
    console.log('  ' + moves.join('  '));
  });

  process.on('SIGINT', () => {
    try { dev.close(); } catch { /* gone */ }
    console.log('\n  done — send those lines over.\n');
    process.exit(0);
  });
  return new Promise(() => {});
}

if (WATCH) watchReports().then((c) => process.exit(c));
if (RELEASE) releaseWheel().then((c) => process.exit(c));
if (TEST) selfTest().then((c) => process.exit(c));

/* ============================================================
   WHEEL STATE
   ============================================================ */
const wheelState = {
  present: false,
  name: '',
  steer: 0,        // -1 right .. +1 left, matching the game's convention
  throttle: 0,
  brake: 0,
  clutch: 0,
  buttons: new Array(BUTTON_COUNT).fill(0),
  rawTurn: null,
  turnEvents: 0,
  lastTurnAt: 0,
};

let wheelForce = null;
let wsRef = null;
let retryTimer = null;
let connectAttempted = false;
let lastForceAt = 0;
let appliedForce = 0.5;      // 0.5 = no force
let appliedFriction = -1;
// diagnostics — lets you confirm the browser is actually talking to us
const diag = { forceFrames: 0, lastTorque: null, lastFriction: null, peakTorque: 0 };

function initWheel(ws) {
  const HID = loadHid();
  if (!HID) {
    console.log('  node-hid is not installed — serving without force feedback.');
    console.log('  Enable it with:  cd tools/ffb && npm install\n');
    return;
  }
  tryConnect(ws);
}

/**
 * Open the wheel for force output.
 *
 * Deliberately conservative: no mode/init commands (those switch the
 * wheel into a native mode that breaks its own mode switch and needs a
 * power cycle to undo), no input reads, and a clean release on exit.
 */
function tryConnect(ws) {
  if (!wsRef) return;

  // A wheel that has gone away must be released, or we keep writing into a
  // dead handle forever while the status endpoint still claims it is there.
  if (wheelForce && !wheelForce.connected) {
    console.log('  Wheel disconnected — releasing it and looking again.');
    wheelForce = null;
    wheelState.present = false;
    wheelState.name = '';
    ws.broadcast({ t: 'hello', wheel: '', ffb: false });
    scheduleRetry();
    return;
  }
  if (wheelForce) return;

  const wf = new WheelForce({ verbose: true, iface: IFACE, allowInit: ALLOW_INIT });
  if (!wf.open()) {
    if (!connectAttempted) {
      console.log('  No wheel yet — will keep looking. (plug it in and power it on)\n');
      connectAttempted = true;
    }
    scheduleRetry();
    return;
  }

  wheelForce = wf;
  wheelState.present = true;
  wheelState.name = wf.name;

  if (ALLOW_INIT) {
    console.log('  !! sending wheel init commands — if the mode switch stops');
    console.log('     responding afterwards, power-cycle the wheel.\n');
    wf.sendInit();
  }
  // Auto-centring off is needed or the wheel fights the torque model.
  // The rotation range is deliberately NOT touched here — the wheel
  // remembers it, so it is only sent when the game asks.
  wf.autoCenterOff();
  wf.forceConstant(0.5);
  wf.forceFriction(0.25);
  wf.setLeds(0);

  const kind = wf.usagePage === 0x0001 ? 'input' : wf.usagePage === 0xff00 ? 'vendor' : 'other';
  console.log(`  ${wf.name} connected (${kind} interface, usagePage 0x${(wf.usagePage || 0).toString(16)}).`);
  console.log('  Force feedback live. The browser keeps reading the pedals and wheel.\n');
  ws.broadcast({ t: 'hello', wheel: wf.name, ffb: true, buttons: BUTTON_COUNT });
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    tryConnect(wsRef);
  }, 3000);
}

/* ============================================================
   SERVER
   ============================================================ */
const staticHandler = createStaticHandler(ROOT);
const ws = new WebSocketServer({ path: '/ffb' });

const server = http.createServer((req, res) => {
  if (req.url === '/ffb-status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      wheel: !!(wheelForce && wheelForce.connected), name: wheelState.name,
      clients: ws.clients.size, buttons: BUTTON_COUNT,
      forceFrames: diag.forceFrames,
      lastTorque: diag.lastTorque,
      lastFriction: diag.lastFriction,
      peakTorque: diag.peakTorque,
      // live raw values, so you can tell a stale cached frame from the
      // wheel's actual current position
      live: {
        steer: +wheelState.steer.toFixed(4),
        throttle: +wheelState.throttle.toFixed(3),
        brake: +wheelState.brake.toFixed(3),
        rawTurn: wheelState.rawTurn,
        turnEvents: wheelState.turnEvents,
        msSinceTurn: wheelState.lastTurnAt ? Date.now() - wheelState.lastTurnAt : null,
      },
      writes: wheelForce ? wheelForce.writes : 0,
      writeErrors: wheelForce ? wheelForce.writeErrors : 0,
      interface: wheelForce ? (wheelForce.usagePage === 0x0001 ? 'input' : wheelForce.usagePage === 0xff00 ? 'vendor' : 'other') : null,
      lastWriteError: wheelForce ? wheelForce.lastError : '',
    }));
    return;
  }
  staticHandler(req, res);
});

server.on('upgrade', (req, socket) => ws.handleUpgrade(req, socket));

ws.on('connection', (client) => {
  client.send({
    t: 'hello',
    wheel: wheelState.present ? wheelState.name : '',
    ffb: !!wheelForce && wheelState.present,
    buttons: BUTTON_COUNT,
    buttonNames: [...BUTTONS, 'dpad_up', 'dpad_right', 'dpad_down', 'dpad_left'],
  });
});

ws.on('message', (client, raw) => {
  let m;
  try { m = JSON.parse(raw); } catch { return; }

  if (m.t === 'force') {
    const v0 = Math.max(0, Math.min(1, Number(m.v) || 0));
    diag.forceFrames++;
    diag.lastTorque = +(v0 * 2 - 1).toFixed(3);
    diag.lastFriction = Math.max(0, Math.min(1, Number(m.f) || 0));
    diag.peakTorque = Math.max(diag.peakTorque, Math.abs(diag.lastTorque));
  }

  if (!wheelForce || !wheelForce.connected) return;

  if (m.t === 'force') {
    lastForceAt = Date.now();
    wheelForce.forceConstant(Math.max(0, Math.min(1, Number(m.v) || 0)));
    wheelForce.forceFriction(Math.max(0, Math.min(1, Number(m.f) || 0)));
  } else if (m.t === 'range') {
    wheelForce.setRange(Number(m.deg) || 540);
  } else if (m.t === 'leds') {
    wheelForce.setLeds(Math.max(0, Math.min(1, Number(m.v) || 0)));
  } else if (m.t === 'recenter') {
    wheelForce.forceConstant(0.5);
  }
});

/* ---- SAFETY: never leave the wheel pulling --------------------
   If the browser tab dies, or the game is paused, nothing would
   ever tell the wheel to stop. Force is cut automatically.        */
setInterval(() => {
  // Recover from a wheel that was unplugged or powered off mid-session.
  if (!wheelForce || !wheelForce.connected) { tryConnect(ws); return; }
  // If the browser goes away nothing would ever tell the wheel to stop.
  if (Date.now() - lastForceAt > 600) {
    wheelForce.forceConstant(0.5);
    wheelForce.forceFriction(0.25);
  }
}, 250);

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  Shutting down — releasing the wheel.');
  if (retryTimer) clearTimeout(retryTimer);
  // Always hand the wheel back in a neutral state: force off, lights off,
  // auto-centring restored. Otherwise it is left pulling or with its shift
  // lights stuck on.
  if (wheelForce) {
    try { wheelForce.release(); } catch { /* nothing more we can do */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
// A crash must not leave the wheel pulling against the driver's hands.
process.on('uncaughtException', (e) => {
  console.error('\n  Unexpected error:', e && e.message);
  shutdown(1);
});
process.on('unhandledRejection', () => shutdown(1));

staticHandler; // (kept for clarity)

listenWithFallback(server, START_PORT, 20, (port) => {
  console.log('\n  DRIFTBLOCK — wheel bridge\n');
  console.log(`    http://127.0.0.1:${port}/\n`);
  console.log('  This process only writes force and shift-light commands to the');
  console.log('  wheel. Steering and pedals are still read by the browser.');
  console.log('  It never sends mode/init commands, so your wheel\'s own mode');
  console.log('  switch keeps working. Ctrl+C releases the wheel cleanly.');
  console.log('');
  console.log(`  Interface: ${IFACE}` +
    (IFACE === 'vendor'
      ? '   (safe: leaves the browser\'s wheel reads alone)'
      : '   !! input interface — may stop the game seeing the wheel'));
  console.log('');
  console.log('  No force feedback?  node bridge.mjs --test');
  console.log('  Wheel stuck?        node bridge.mjs --release');
  console.log('  Want to try the working-but-risky path:  --iface=input');
  console.log('  Press Ctrl+C to stop.\n');
  wsRef = ws;
  initWheel(ws);
});
