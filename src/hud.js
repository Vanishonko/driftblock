/* ============================================================
   HUD — blocky tachometer canvas plus the DOM readouts.
   ============================================================ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const TIER_NAMES = ['NICE', 'GOOD', 'GREAT', 'AWESOME', 'INSANE', 'LEGENDARY', 'UNREAL', 'GODLIKE', 'MAXIMUM'];

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      mode: document.getElementById('modeLabel'),
      timer: document.getElementById('timerValue'),
      lap: document.getElementById('lapValue'),
      lapLabel: document.getElementById('lapLabel'),
      panel: document.getElementById('driftPanel'),
      mult: document.getElementById('multValue'),
      driftScore: document.getElementById('driftScore'),
      chainFill: document.getElementById('chainFill'),
      chargeBar: document.getElementById('chargeBar'),
      chargeFill: document.getElementById('chargeFill'),
      total: document.getElementById('totalScore'),
      popups: document.getElementById('popups'),
      toast: document.getElementById('toast'),
      gauge: document.getElementById('gauge'),
      minimap: document.getElementById('minimap'),
      mapWrap: document.getElementById('mapWrap'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.mapPath = null;
    this.mapTransform = null;
    this.ctx = this.el.gauge.getContext('2d');
    this._needle = 0;
    this._shownTotal = 0;
    this._shownDrift = 0;
    this._lastMult = 0;
    this._toastTimer = 0;
  }

  show(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  /**
   * Precompute the circuit outline in canvas coordinates. Done once per
   * track rather than per frame — the shape never changes, only the dot.
   */
  setTrack(track) {
    if (!track || !track.samples) { this.mapPath = null; return; }
    const S = track.samples;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const pad = 34;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < S.length; i += 2) {
      if (S[i].x < minX) minX = S[i].x;
      if (S[i].x > maxX) maxX = S[i].x;
      if (S[i].z < minZ) minZ = S[i].z;
      if (S[i].z > maxZ) maxZ = S[i].z;
    }
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ);
    const ox = (W - spanX * scale) / 2 - minX * scale;
    const oz = (H - spanZ * scale) / 2 - minZ * scale;

    this.mapTransform = { scale, ox, oz, halfWidth: track.halfWidth * scale };
    this.mapIsArena = !!track.def.arena;

    const pts = [];
    for (let i = 0; i < S.length; i += 3) {
      pts.push([S[i].x * scale + ox, S[i].z * scale + oz]);
    }
    this.mapPath = pts;
    this.mapStart = [S[0].x * scale + ox, S[0].z * scale + oz];
  }

  /** @param {number} x @param {number} z @param {number} yaw */
  drawMinimap(x, z, yaw, drifting) {
    const c = this.mapCtx;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    c.clearRect(0, 0, W, H);
    if (!this.mapPath || !this.mapTransform) return;

    const t = this.mapTransform;
    const px = x * t.scale + t.ox;
    const pz = z * t.scale + t.oz;

    // circuit ribbon
    c.beginPath();
    const p = this.mapPath;
    c.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]);
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.lineWidth = Math.max(6, t.halfWidth * 2 + 4);
    c.stroke();
    c.strokeStyle = 'rgba(160,180,220,0.35)';
    c.lineWidth = Math.max(3, t.halfWidth * 2);
    c.stroke();

    // start line
    if (this.mapStart) {
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(this.mapStart[0] - 4, this.mapStart[1] - 4, 8, 8);
    }

    // the car: a triangle pointing where it is heading. Canvas +Y is screen
    // down, and world +Z maps to it, so the heading angle carries straight
    // over from (sin yaw, cos yaw).
    c.save();
    c.translate(px, pz);
    c.rotate(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
    c.beginPath();
    c.moveTo(0, -13);
    c.lineTo(9, 10);
    c.lineTo(0, 5);
    c.lineTo(-9, 10);
    c.closePath();
    c.fillStyle = drifting ? '#ffcc33' : '#2fe0ff';
    c.strokeStyle = 'rgba(0,0,0,0.65)';
    c.lineWidth = 2.5;
    c.stroke();
    c.fill();
    c.restore();
  }

  setMode(text) { this.el.mode.textContent = text; }

  setTimer(seconds) {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    this.el.timer.textContent = `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
  }

  setLap(text, label = 'LAP') {
    this.el.lap.textContent = text;
    this.el.lapLabel.textContent = label;
  }

  /**
   * @param {object} d
   *   speed      m/s
   *   rpm01      0..1
   *   gear       1..6
   *   drifting   bool
   *   multiplier number
   *   driftScore number
   *   chain01    0..1 progress to next multiplier tier
   *   charge01   0..1 mini-turbo charge
   *   chargeReady bool
   *   chargeMax  bool
   *   total      number
   *   boost      0..1
   *   boostTier  0..2
   */
  update(dt, d) {
    // ---- drift panel
    const active = d.drifting || d.driftScore > 1;
    this.el.panel.classList.toggle('active', active);

    if (active) {
      this._shownDrift += (d.driftScore - this._shownDrift) * (1 - Math.exp(-16 * dt));
      this.el.driftScore.textContent = Math.round(this._shownDrift).toLocaleString();
      const m = Math.max(1, Math.floor(d.multiplier));
      if (m !== this._lastMult) {
        this.el.mult.textContent = 'x' + m;
        this.el.mult.classList.remove('pop');
        void this.el.mult.offsetWidth;
        this.el.mult.classList.add('pop');
        this._lastMult = m;
      }
      this.el.chainFill.style.width = (clamp(d.chain01, 0, 1) * 100).toFixed(1) + '%';
    } else {
      this._shownDrift = 0;
      this._lastMult = 0;
    }

    // ---- boost charge
    this.el.chargeFill.style.width = (clamp(d.charge01, 0, 1) * 100).toFixed(1) + '%';
    this.el.chargeBar.classList.toggle('ready', !!d.chargeReady && !d.chargeMax);
    this.el.chargeBar.classList.toggle('max', !!d.chargeMax);

    // ---- total (animated count-up so banking feels good)
    if (d.total !== this._shownTotal) {
      const diff = d.total - this._shownTotal;
      if (Math.abs(diff) < 2) this._shownTotal = d.total;
      else this._shownTotal += diff * (1 - Math.exp(-11 * dt));
      this.el.total.textContent = Math.round(this._shownTotal).toLocaleString();
    }

    this.drawGauge(dt, d);

    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  /* ---------------- tachometer canvas ---------------- */
  drawGauge(dt, d) {
    const c = this.ctx;
    const W = 520, H = 520;
    const cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);

    const kmh = d.speed * 3.6;
    const rpm = clamp(d.rpm01, 0, 1);
    this._needle += (rpm - this._needle) * (1 - Math.exp(-18 * dt));

    const A0 = Math.PI * 0.75;
    const A1 = Math.PI * 2.25;
    const BLOCKS = 46;
    const R = 205;
    const boost = clamp(d.boost || 0, 0, 1);

    // ---- background ring blocks (tachometer)
    const litBlocks = this._needle * BLOCKS;
    for (let i = 0; i < BLOCKS; i++) {
      const t = i / (BLOCKS - 1);
      const a = A0 + (A1 - A0) * t;
      // The redline is the last 12%, not the last 20%: a long red zone means
      // the needle spends most of its life in the warning colours and stops
      // meaning anything.
      const redline = t > 0.88;
      const amber = t > 0.78 && t <= 0.88;
      const on = i < litBlocks;

      let col;
      if (on) {
        col = redline ? '#ff3b3b' : amber ? '#ffb020' : '#2fe0ff';
        if (d.limiter) col = '#ffffff';                     // limiter flash
        else if (boost > 0) col = boost > 0.7 ? '#ff2e7e' : '#ffcc33';
      } else {
        col = redline ? 'rgba(255,59,59,0.18)' : amber ? 'rgba(255,176,32,0.12)' : 'rgba(255,255,255,0.10)';
      }

      const bw = 13, bh = on ? 30 : 22;
      c.save();
      c.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.rotate(a + Math.PI / 2);
      c.fillStyle = col;
      c.fillRect(-bw / 2, -bh / 2, bw, bh);
      if (on) {
        c.shadowColor = col;
        c.shadowBlur = d.limiter && redline ? 26 : 14;
        c.fillRect(-bw / 2, -bh / 2, bw, bh);
        c.shadowBlur = 0;
      }
      c.restore();
    }

    // ---- redline wedge marker
    c.save();
    c.strokeStyle = d.limiter ? 'rgba(255,255,255,0.95)' : 'rgba(255,59,59,0.6)';
    c.lineWidth = d.limiter ? 5 : 3;
    c.beginPath();
    c.arc(cx, cy, R + 24, A0 + (A1 - A0) * 0.88, A1);
    c.stroke();
    c.restore();

    // ---- digital speed
    const shown = Math.round(kmh);
    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    c.fillStyle = boost > 0 ? '#ffcc33' : '#eef3ff';
    c.font = '900 128px ui-monospace, "SF Mono", Menlo, monospace';
    c.shadowColor = boost > 0 ? 'rgba(255,204,51,0.75)' : 'rgba(47,224,255,0.35)';
    c.shadowBlur = 26;
    c.fillText(String(shown), cx, cy - 24);
    c.shadowBlur = 0;

    c.fillStyle = 'rgba(160,170,200,0.9)';
    c.font = '700 22px ui-monospace, Menlo, monospace';
    c.fillText('KM/H', cx, cy + 40);

    // ---- gear
    c.fillStyle = d.reversing ? '#ffcc33' : '#2fe0ff';
    c.font = '900 56px ui-monospace, Menlo, monospace';
    c.fillText(d.reversing ? 'R' : String(d.gear || 1), cx, cy + 112);
    c.fillStyle = 'rgba(160,170,200,0.75)';
    c.font = '700 15px ui-monospace, Menlo, monospace';
    c.fillText('GEAR', cx, cy + 148);
    c.restore();

    // ---- boost ring
    if (boost > 0) {
      c.save();
      c.strokeStyle = boost > 0.7 ? '#ff2e7e' : boost > 0.35 ? '#ffcc33' : '#2fe0ff';
      c.lineWidth = 7;
      c.shadowColor = c.strokeStyle;
      c.shadowBlur = 22;
      c.beginPath();
      c.arc(cx, cy, R + 34, A0, A0 + (A1 - A0) * boost);
      c.stroke();
      c.restore();
    }
  }

  /* ---------------- popups ---------------- */
  pop(text, cls = 'pop-tier', sub = '') {
    const el = document.createElement('div');
    el.className = 'pop ' + cls;
    el.innerHTML = sub ? `${text}<span class="sub">${sub}</span>` : text;
    this.el.popups.appendChild(el);
    setTimeout(() => el.remove(), 1250);
    // keep the stack short
    while (this.el.popups.children.length > 6) this.el.popups.firstChild.remove();
  }

  tierName(level) {
    return TIER_NAMES[clamp(level - 1, 0, TIER_NAMES.length - 1)];
  }

  /** floating text anchored to a screen position */
  float(screenX, screenY, text, color = '#2fe0ff') {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.color = color;
    document.getElementById('app').appendChild(el);
    setTimeout(() => el.remove(), 1050);
  }

  bankFlash() {
    this.el.total.classList.remove('bank');
    void this.el.total.offsetWidth;
    this.el.total.classList.add('bank');
  }

  toast(msg, seconds = 1.8) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this._toastTimer = seconds;
  }
}
