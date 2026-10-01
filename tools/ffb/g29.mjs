/* ============================================================
   Minimal Logitech wheel force-feedback driver.

   WHY THIS EXISTS
   ---------------
   The obvious library for this (logitech-g29) does two things that
   matter here:

     · It sends wheel MODE/INIT commands on connect
       (0xf8 0x0a / 0xf8 0x09 0x05 0x01 0x01). Those switch the wheel
       into a native mode, after which its own PS4/PS5/PC mode switch
       stops responding, it stops recalibrating, the shift lights go
       out and it stops appearing to the browser. Recovering needs a
       full power cycle — a USB replug is not enough, because the G29
       has its own power brick.
     · It calls device.read() in a loop.

   This driver does neither. It only ever WRITES effect commands, and
   never anything that changes how the wheel presents itself.

   WHICH INTERFACE — READ THIS BEFORE CHANGING IT
   ----------------------------------------------
   There are two, and they do different things:

     usagePage 0x0001  "input"   the joystick interface. The BROWSER
                                 reads this for the Gamepad API.
     usagePage 0xff00  "vendor"  the force-feedback interface.

   Writing effect commands to the INPUT interface is what made force
   feedback actually work on a real G29 — but it also appears to stop
   the browser being able to read the wheel at all: FFB and the shift
   lights respond, and then the game sees no steering, no pedals and
   no buttons. Writing to the VENDOR interface leaves the browser's
   reads alone.

   So the default is VENDOR: the safe one. `--iface=input` opts into
   the one that works, and you should expect to power-cycle the wheel
   afterwards.

   It is not yet established whether the input interface is genuinely
   at fault or whether the wheel was already in a bad state from an
   earlier tool's mode-switch commands. Test it on a freshly
   power-cycled wheel, and if it kills the inputs again, that settles
   it.

   Command bytes come from the Linux hid-lg4ff driver and from the
   logitech-g29 source.
   ============================================================ */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const VENDOR = 0x046d;
const PRODUCTS = {
  0xc24f: 'Logitech G29',
  0xc262: 'Logitech G920',
  0xc26e: 'Logitech G923',
  0xc266: 'Logitech G923 (Xbox)',
  0xc299: 'Logitech G25',
  0xc29b: 'Logitech G27',
};

const INPUT_USAGE_PAGE = 0x0001;   // joystick interface
const FORCE_USAGE_PAGE = 0xff00;   // vendor interface

export function loadHid() {
  try { return require('node-hid'); } catch { return null; }
}

/** Every HID interface belonging to a Logitech wheel. */
export function findWheelInterfaces() {
  const HID = loadHid();
  if (!HID) return [];
  let devices = [];
  try { devices = HID.devices(); } catch { return []; }
  return devices.filter((d) => d.vendorId === VENDOR && PRODUCTS[d.productId]);
}

/** The 5 shift LEDs, as a 0-31 bitmask (1,2 = green · 4,8 = orange · 16 = red). */
export function ledMaskFor(fraction) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  if (pct > 92) return 31;
  if (pct > 84) return 15;
  if (pct > 70) return 7;
  if (pct > 55) return 3;
  if (pct > 38) return 1;
  return 0;
}

export class WheelForce {
  constructor({ verbose = false, iface = 'vendor', allowInit = false } = {}) {
    this.device = null;
    this.name = '';
    this.path = '';
    this.usagePage = null;
    this.verbose = verbose;
    this.iface = iface;
    this.allowInit = allowInit;
    this.writes = 0;
    this.writeErrors = 0;
    this.failStreak = 0;
    this.dead = false;
    this.lastError = '';
    this._lastConstant = null;
    this._lastFriction = null;
    this._lastLed = null;
  }

  get connected() { return !!this.device; }

  /**
   * Open the wheel for force output only.
   * @param {string} prefer 'vendor' (default, safe) or 'input' (works, but
   *   appears to block the browser's reads — power-cycle afterwards)
   */
  open(prefer = this.iface) {
    const HID = loadHid();
    if (!HID) { this.lastError = 'node-hid is not installed'; return false; }

    const all = findWheelInterfaces();
    if (!all.length) { this.lastError = 'no Logitech wheel found on USB'; return false; }

    const isInput = (d) => d.usagePage === INPUT_USAGE_PAGE || d.interface === 0;
    const isVendor = (d) => d.usagePage === FORCE_USAGE_PAGE;

    const order = prefer === 'vendor'
      ? [...all.filter(isVendor), ...all.filter(isInput)]
      : [...all.filter(isInput), ...all.filter(isVendor)];

    // dedupe by path
    const seen = new Set();
    for (const info of order) {
      if (seen.has(info.path)) continue;
      seen.add(info.path);
      try {
        const dev = new HID.HID(info.path);
        this.device = dev;
        this.path = info.path;
        this.usagePage = info.usagePage;
        this.name = PRODUCTS[info.productId] || info.product || 'Logitech wheel';
        if (this.verbose) {
          const kind = isInput(info) ? 'input' : isVendor(info) ? 'vendor' : 'other';
          console.log(`  opened ${this.name} on the ${kind} interface (usagePage 0x${(info.usagePage || 0).toString(16)})`);
        }
        return true;
      } catch (e) {
        this.lastError = e.message;
      }
    }
    return false;
  }

  /**
   * Enable native force-feedback mode.
   *
   * OFF BY DEFAULT. These two writes are the ones that put the wheel into
   * a state where its own mode switch stops working and only a power cycle
   * brings it back. Only reach for this if plain effect commands do
   * nothing, and expect to power-cycle afterwards.
   */
  sendInit() {
    if (!this.allowInit) return false;
    this._write([0xf8, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00]);
    this._write([0xf8, 0x09, 0x05, 0x01, 0x01, 0x00, 0x00]);
    return true;
  }

  _write(bytes) {
    if (!this.device) return false;
    try {
      this.device.write(bytes);
      this.writes++;
      this.failStreak = 0;
      return true;
    } catch (e) {
      this.writeErrors++;
      this.lastError = e.message;
      // The wheel was unplugged, powered off, or the handle went stale. Drop
      // it so the owner can notice and reconnect: otherwise we sit here
      // writing into a dead handle forever while still reporting the wheel
      // as present, and the driver feels nothing but the wheel's own spring.
      if (++this.failStreak >= 3) this.markDead();
      return false;
    }
  }

  /** The handle is no longer usable. Safe to call repeatedly. */
  markDead() {
    if (this.device) {
      try { this.device.close(); } catch { /* already gone */ }
    }
    this.device = null;
    this.dead = true;
  }

  /** @param {number} v 0..1 — 0 full left, 0.5 no force, 1 full right */
  forceConstant(v) {
    const n = Math.max(0, Math.min(1, v));
    if (this._lastConstant !== null && Math.abs(n - this._lastConstant) < 0.002) return true;
    this._lastConstant = n;
    if (Math.abs(n - 0.5) < 0.002) return this._write([0x10, 0, 0, 0, 0, 0, 0]);
    const mag = Math.round(Math.abs(n - 1) * 255);
    return this._write([0x11, 0x00, mag, 0x00, 0x00, 0x00, 0x00]);
  }

  /** @param {number} v 0..1 rim friction */
  forceFriction(v) {
    const n = Math.max(0, Math.min(1, v));
    if (this._lastFriction !== null && Math.abs(n - this._lastFriction) < 0.02) return true;
    this._lastFriction = n;
    if (n <= 0.001) return this._write([0x20, 0, 0, 0, 0, 0, 0]);
    const mag = Math.round(n * 7);
    return this._write([0x21, 0x02, mag, 0x00, mag, 0x00, 0x00]);
  }

  /** Turn off every effect except auto-centring. */
  forceOff() {
    this._lastConstant = null;
    this._lastFriction = null;
    return this._write([0xf3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }

  /** Hand the wheel back to its own auto-centring. */
  autoCenterOff() {
    return this._write([0xf5, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }

  /**
   * Lock-to-lock rotation. NOTE: the wheel remembers this, so it is never
   * sent automatically — only when the game explicitly asks for it.
   * @param {number} deg 40..900
   */
  setRange(deg) {
    const r = Math.max(40, Math.min(900, Math.round(deg)));
    return this._write([0xf8, 0x81, r & 0xff, (r >> 8) & 0xff, 0x00, 0x00, 0x00]);
  }

  /**
   * Shift indicator LEDs.
   * @param {number} mask 0..31 bitmask, or a 0..1 fraction
   */
  setLeds(mask) {
    const m = mask <= 1 ? ledMaskFor(mask) : Math.max(0, Math.min(31, Math.round(mask)));
    if (this._lastLed === m) return true;
    this._lastLed = m;
    return this._write([0xf8, 0x12, m, 0x00, 0x00, 0x00, 0x01]);
  }

  /** Put every setting this tool touches back to a neutral state. */
  restoreWheelDefaults() {
    this.forceOff();
    this.setLeds(0);
    // hand auto-centring back to the wheel
    this._write([0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    this.setRange(900);
  }

  release() {
    if (!this.device) return;
    try {
      this.restoreWheelDefaults();
    } catch { /* the wheel may already be gone */ }
    try { this.device.close(); } catch { /* already gone */ }
    this.device = null;
  }
}
