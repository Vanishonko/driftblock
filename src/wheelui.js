/* ============================================================
   WHEEL SETUP UI

   A live monitor plus a guided learn pass. Because no preset can
   cover every wheel, the important part is that the driver can see
   raw axis values and bind whatever their hardware actually sends.
   ============================================================ */

import { WHEEL_PRESETS, presetFor, defaultCalibration, LEARN_STEPS, SHIFTER_STEPS, WheelLearner } from './wheel.js';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

export class WheelUI {
  /**
   * @param {import('./wheel.js').WheelInput} wheel
   * @param {import('./ffb.js').ForceFeedback} ffb
   * @param {object} save   the persisted save object (mutated on save)
   * @param {Function} persist  called after mutation
   */
  constructor(wheel, ffb, save, persist) {
    this.wheel = wheel;
    this.ffb = ffb;
    this.save = save;
    this.persist = persist;
    this.root = document.getElementById('wheelBody');
    this.learner = null;
    this.visible = false;
    this.axisBars = [];
    this.buttonDots = [];
    this._built = false;
  }

  /* ============================================================
     BUILD
     ============================================================ */
  build() {
    if (this._built) return;
    this._built = true;
    const r = this.root;
    r.innerHTML = '';
    r.className = 'wheel-wrap';

    // ---------- status ----------
    this.statusCard = el('div', 'wheel-card wheel-status');
    r.appendChild(this.statusCard);

    // ---------- live monitor ----------
    const mon = el('div', 'wheel-card');
    mon.appendChild(el('h3', null, 'LIVE MONITOR'));
    mon.appendChild(el('p', 'wheel-hint',
      'Move the wheel and press the pedals — the bars below show exactly what the browser receives.'));
    this.axisHost = el('div', 'axis-list');
    mon.appendChild(this.axisHost);
    this.axisEmpty = el('div', 'wheel-hint', 'No wheel detected yet. Plug it in, then press a button on it — browsers only reveal a device after it has been used.');
    this.axisHost.appendChild(this.axisEmpty);

    this.btnHost = el('div', 'button-grid');
    mon.appendChild(el('div', 'wheel-sub', 'BUTTONS'));
    mon.appendChild(this.btnHost);
    r.appendChild(mon);

    // ---------- wizard ----------
    const wiz = el('div', 'wheel-card');
    wiz.appendChild(el('h3', null, 'AUTO-DETECT'));
    wiz.appendChild(el('p', 'wheel-hint',
      'Don\'t know which axis is which? This walks you through it and works out the layout from your inputs.'));
    this.wizardBox = el('div', 'wizard-box');
    this.wizardBtn = el('button', 'btn btn-primary', 'START AUTO-DETECT');
    this.wizardBtn.onclick = () => this.startLearn();
    this.wizardBox.appendChild(this.wizardBtn);
    wiz.appendChild(this.wizardBox);
    r.appendChild(wiz);

    // ---------- manual mapping ----------
    const map = el('div', 'wheel-card');
    map.appendChild(el('h3', null, 'MAPPING'));
    this.mapHost = el('div', 'map-grid');
    map.appendChild(this.mapHost);
    r.appendChild(map);

    // ---------- steering feel ----------
    const feel = el('div', 'wheel-card');
    feel.appendChild(el('h3', null, 'STEERING FEEL'));
    this.feelHost = el('div', 'map-grid');
    feel.appendChild(this.feelHost);
    r.appendChild(feel);

    // ---------- gearbox ----------
    const gear = el('div', 'wheel-card');
    gear.appendChild(el('h3', null, 'GEARBOX'));
    gear.appendChild(el('p', 'wheel-hint',
      'The game shifts automatically by default. Turn on the manual gearbox to use paddles or an H-pattern shifter — and remember to use the clutch, or the shift bites.'));
    this.gearboxHost = el('div', 'map-grid');
    gear.appendChild(this.gearboxHost);
    r.appendChild(gear);

    // ---------- force feedback ----------
    const ffbCard = el('div', 'wheel-card');
    ffbCard.appendChild(el('h3', null, 'FORCE FEEDBACK'));
    this.ffbHost = el('div', 'map-grid');
    ffbCard.appendChild(this.ffbHost);
    this.bridgeBox = el('div', 'bridge-box');
    ffbCard.appendChild(this.bridgeBox);
    r.appendChild(ffbCard);

    // ---------- actions ----------
    const actions = el('div', 'wheel-actions');
    const saveBtn = el('button', 'btn btn-primary', 'SAVE');
    saveBtn.onclick = () => this.commit();
    const resetBtn = el('button', 'btn', 'RESET TO PRESET');
    resetBtn.onclick = () => {
      const c = defaultCalibration(this.wheel.cal.preset || 'generic');
      this.wheel.setCalibration(c);
      this.refreshControls();
    };
    actions.appendChild(saveBtn);
    actions.appendChild(resetBtn);
    r.appendChild(actions);

    this.refreshControls();
    this.refreshStatus();
  }

  /* ============================================================
     CONTROLS
     ============================================================ */
  _num(label, get, set, { min = 0, max = 1, step = 0.01, fmt = (v) => v.toFixed(2) } = {}) {
    const row = el('div', 'map-row');
    row.appendChild(el('span', 'map-label', label));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    const out = el('span', 'map-value', fmt(get()));
    input.oninput = () => { set(parseFloat(input.value)); out.textContent = fmt(parseFloat(input.value)); };
    row.appendChild(input);
    row.appendChild(out);
    return row;
  }

  _check(label, get, set) {
    const row = el('div', 'map-row');
    row.appendChild(el('span', 'map-label', label));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!get();
    input.onchange = () => set(input.checked);
    row.appendChild(input);
    return row;
  }

  _axisSelect(label, get, set) {
    const row = el('div', 'map-row');
    row.appendChild(el('span', 'map-label', label));
    const sel = document.createElement('select');
    const off = el('option', null, '—'); off.value = '-1';
    sel.appendChild(off);
    for (let i = 0; i < 8; i++) {
      const o = el('option', null, 'Axis ' + i);
      o.value = String(i);
      sel.appendChild(o);
    }
    sel.value = String(get());
    sel.onchange = () => set(parseInt(sel.value, 10));
    row.appendChild(sel);
    this.axisSelects = this.axisSelects || [];
    this.axisSelects.push({ sel, get });
    return row;
  }

  _buttonSelect(label, get, set) {
    const row = el('div', 'map-row');
    row.appendChild(el('span', 'map-label', label));
    const sel = document.createElement('select');
    const off = el('option', null, '—'); off.value = '-1';
    sel.appendChild(off);
    for (let i = 0; i < 32; i++) {
      const o = el('option', null, 'Button ' + i);
      o.value = String(i);
      sel.appendChild(o);
    }
    sel.value = String(get());
    sel.onchange = () => set(parseInt(sel.value, 10));
    row.appendChild(sel);
    this.buttonSelects = this.buttonSelects || [];
    this.buttonSelects.push({ sel, get });
    return row;
  }

  refreshControls() {
    const c = this.wheel.cal;
    const set = (k, v) => { c[k] = v; };

    // ---- mapping
    this.mapHost.innerHTML = '';
    this.mapHost.appendChild(this._axisSelect('Steering axis', () => c.steerAxis, (v) => set('steerAxis', v)));
    this.mapHost.appendChild(this._axisSelect('Throttle axis', () => c.throttleAxis, (v) => set('throttleAxis', v)));
    this.mapHost.appendChild(this._axisSelect('Brake axis', () => c.brakeAxis, (v) => set('brakeAxis', v)));
    this.mapHost.appendChild(this._axisSelect('Clutch axis', () => c.clutchAxis, (v) => set('clutchAxis', v)));
    this.mapHost.appendChild(this._check('Invert steering', () => c.steerInvert, (v) => set('steerInvert', v)));
    this.mapHost.appendChild(this._check('Invert throttle', () => c.throttleInvert, (v) => set('throttleInvert', v)));
    this.mapHost.appendChild(this._check('Invert brake', () => c.brakeInvert, (v) => set('brakeInvert', v)));
    this.mapHost.appendChild(this._buttonSelect('Handbrake button', () => c.handbrakeButton, (v) => set('handbrakeButton', v)));
    this.mapHost.appendChild(this._buttonSelect('Mini-turbo button', () => c.boostButton, (v) => set('boostButton', v)));
    this.mapHost.appendChild(this._buttonSelect('Camera button', () => c.cameraButton, (v) => set('cameraButton', v)));
    this.mapHost.appendChild(this._buttonSelect('Reset button', () => c.resetButton, (v) => set('resetButton', v)));

    // ---- feel
    this.feelHost.innerHTML = '';
    this.feelHost.appendChild(this._num('Deadzone', () => c.steerDeadzone, (v) => set('steerDeadzone', v),
      { min: 0, max: 0.2, step: 0.005, fmt: (v) => (v * 100).toFixed(1) + '%' }));
    this.feelHost.appendChild(this._num('Linearity', () => c.steerGamma, (v) => set('steerGamma', v),
      { min: 0.4, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + (v < 1 ? ' (sharper)' : v > 1 ? ' (softer)' : ' (linear)') }));
    this.feelHost.appendChild(this._num('Saturation', () => c.steerSaturation, (v) => set('steerSaturation', v),
      { min: 0.4, max: 1, step: 0.02, fmt: (v) => (v * 100).toFixed(0) + '% of travel' }));
    this.feelHost.appendChild(this._num('Wheel range', () => c.rangeDeg, (v) => set('rangeDeg', v),
      { min: 180, max: 900, step: 10, fmt: (v) => v + '° lock-to-lock' }));

    // ---- ffb
    this.ffbHost.innerHTML = '';
    this.ffbHost.appendChild(this._check('Enable force feedback', () => c.ffbEnabled, (v) => set('ffbEnabled', v)));
    this.ffbHost.appendChild(this._num('Strength', () => c.ffbStrength, (v) => set('ffbStrength', v),
      { min: 0, max: 1, step: 0.05, fmt: (v) => (v * 100).toFixed(0) + '%' }));
    this.ffbHost.appendChild(this._num('Rim friction', () => c.ffbFriction, (v) => set('ffbFriction', v),
      { min: 0, max: 1, step: 0.05, fmt: (v) => (v * 100).toFixed(0) + '%' }));
    this.ffbHost.appendChild(this._check('Invert force direction', () => c.ffbInvert, (v) => set('ffbInvert', v)));

    // ---- gearbox
    if (this.gearboxHost) {
      this.gearboxHost.innerHTML = '';
      const mk = (label, type, get, set, opts = {}) => {
        const row = el('div', 'map-row');
        row.appendChild(el('span', 'map-label', label));
        const input = document.createElement(type);
        if (type === 'checkbox') {
          input.checked = !!get();
          input.onchange = () => { set(input.checked); this.commit(); };
        } else {
          input.type = 'range';
          input.min = opts.min; input.max = opts.max; input.step = opts.step;
          input.value = get();
          const out = el('span', 'map-value', opts.fmt(get()));
          input.oninput = () => { set(parseFloat(input.value)); out.textContent = opts.fmt(parseFloat(input.value)); };
          row.appendChild(input);
          row.appendChild(out);
          this.gearboxHost.appendChild(row);
          return;
        }
        row.appendChild(input);
        this.gearboxHost.appendChild(row);
      };

      mk('MANUAL GEARBOX', 'checkbox', () => !!this.save.gearbox, (v) => { this.save.gearbox = v; });
      this.gearboxHost.appendChild(this._buttonSelect('Shift up button',
        () => this.wheel.cal.shiftUpButton, (v) => { this.wheel.cal.shiftUpButton = v; }));
      this.gearboxHost.appendChild(this._buttonSelect('Shift down button',
        () => this.wheel.cal.shiftDownButton, (v) => { this.wheel.cal.shiftDownButton = v; }));

      const pat = this.wheel.cal.gearPattern;
      const hasPat = Array.isArray(pat) && pat.slice(1, 8).every((c) => c && c.length);
      this.gearboxHost.appendChild(el('p', 'wheel-hint',
        hasPat
          ? 'H-pattern learned: ' + pat.slice(1, 8).map((c, i) => `<code>${i + 1 === 7 ? 'R' : i + 1}</code> B${c.join('+')}`).join(' &nbsp; ')
          : 'No H-pattern learned. If you have a gear shifter, teach it which buttons each gate uses.'));

      const hb = el('button', 'btn', hasPat ? 'RE-LEARN H-PATTERN' : 'LEARN H-PATTERN');
      hb.onclick = () => this.startLearn(true);
      this.gearboxHost.appendChild(hb);
    }

    this.buildBridgeBox();
  }

  buildBridgeBox() {
    const b = this.bridgeBox;
    b.innerHTML = '';
    const br = this.ffb.bridge;
    b.appendChild(el('div', 'wheel-sub', 'NATIVE FORCE FEEDBACK BRIDGE'));
    const state = br.status;
    const cls = state === 'on' ? 'good' : state === 'connecting' ? 'warn' : 'none';
    b.appendChild(el('div', 'bridge-state ' + cls,
      state === 'on'
        ? `CONNECTED${br.wheelName ? ' — ' + br.wheelName : ''}`
        : state === 'connecting' ? 'CONNECTING…'
          : `NOT RUNNING — tried ws://127.0.0.1:${location.port || 8177}/ffb`));
    b.appendChild(el('p', 'wheel-hint',
      'A browser cannot turn a wheel. Real force feedback needs the optional native bridge: ' +
      'quit this, run <code>node tools/ffb/bridge.mjs --iface=input</code>, then open the ' +
      'address it prints — <b>not</b> the plain dev server, which has no bridge in it.'));

    // Say WHY it failed. "Could not reach the bridge" is useless when the
    // usual cause is that you are on the plain dev server, which serves the
    // game but has no force-feedback endpoint at all.
    if (state === 'failed' || (state === 'off' && br.lastError)) {
      b.appendChild(el('p', 'wheel-hint bad',
        'No force feedback available on this address. Either the bridge is not running, ' +
        'or you are on the plain dev server (<code>tools/serve.mjs</code>) — that one has ' +
        'no bridge in it. Check the terminal: the bridge prints the address to use, and ' +
        'it may not be 8177 if that port was already taken.'));
    }

    const btn = el('button', 'btn', state === 'on' ? 'DISCONNECT' : 'TRY TO CONNECT');
    btn.onclick = () => {
      if (br.status === 'on') br.disconnect();
      else br.connect();
      setTimeout(() => this.buildBridgeBox(), 400);
    };
    b.appendChild(btn);
  }

  /* ============================================================
     WIZARD
     ============================================================ */
  startLearn(shifter = false) {
    this.learningShifter = !!shifter;
    if (!this.wheel.connected) {
      this.wizardBox.innerHTML = '<p class="wheel-hint bad">No wheel detected. Plug one in and press a button on it first.</p>';
      const back = el('button', 'btn', 'BACK');
      back.onclick = () => this.build();
      this.wizardBox.appendChild(back);
      return;
    }
    this.learner = new WheelLearner(this.wheel, { shifter: !!shifter });
    // a shifter learn needs the gearbox switched on to mean anything
    if (shifter) { this.save.gearbox = true; }
    this.renderWizard();
  }

  cancelLearn() {
    this.learner = null;
    this.build();
  }

  renderWizard() {
    const L = this.learner;
    const box = this.wizardBox;
    box.innerHTML = '';
    if (!L) return;

    if (L.done) {
      box.appendChild(el('div', 'wizard-done' + (L.unreliable ? ' warn' : ''),
        L.unreliable ? '! BARELY DETECTED ANY MOVEMENT' : '✓ LAYOUT LEARNED'));
      const r = L.result;
      box.appendChild(el('p', 'wheel-hint', L.shifter
        ? 'Gears recorded: ' + (r.gearPattern || []).slice(1, 8)
          .map((c, i) => `${i + 1 === 7 ? 'R' : i + 1}=B${(c || []).join('+')}`).join(' · ')
        : `Steering axis ${r.steerAxis} · throttle ${r.throttleAxis} · brake ${r.brakeAxis} · ` +
          `handbrake button ${r.handbrakeButton} · turbo button ${r.boostButton}`));
      if (L.unreliable) {
        box.appendChild(el('p', 'wheel-hint bad', L.shifter
          ? 'Some gear positions could not be told apart — a gate was empty or duplicates another. ' +
            'Every gate needs its own combination of buttons.'
          : 'The two steering holds read almost the same value, so the direction could be wrong. ' +
            'Try again and hold the wheel hard against each stop, or set it by hand below.'));
      }
      const apply = el('button', 'btn btn-primary', 'APPLY');
      apply.onclick = () => {
        if (this.learningShifter) {
          this.wheel.cal.gearPattern = r.gearPattern;
          this.commit();
        } else {
          this.wheel.setCalibration(r);
        }
        this.learner = null;
        this.refreshControls();
        this.build();
      };
      const skip = el('button', 'btn', 'CANCEL');
      skip.onclick = () => this.cancelLearn();
      const row = el('div', 'wizard-actions');
      row.appendChild(apply); row.appendChild(skip);
      box.appendChild(row);
      return;
    }

    const s = L.step;
    box.appendChild(el('div', 'wizard-step', `STEP ${L.stepIndex + 1} / ${L.steps.length}`));
    box.appendChild(el('div', 'wizard-title', s.title));
    box.appendChild(el('p', 'wheel-hint', s.detail));

    const bar = el('div', 'wizard-progress');
    const fill = el('i');
    fill.style.width = (L.progress * 100).toFixed(0) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);

    const skip = el('button', 'btn btn-ghost', 'CANCEL');
    skip.onclick = () => this.cancelLearn();
    box.appendChild(skip);
  }

  /* ============================================================
     SAVE / STATUS
     ============================================================ */
  commit() {
    this.wheel.cal.deviceId = this.wheel.wheel ? this.wheel.wheel.id : this.wheel.cal.deviceId;
    this.save.wheel = { ...this.wheel.cal };
    this.persist();
    this.refreshStatus();
    const b = this.root.querySelector('.wheel-actions');
    if (b) {
      const note = el('span', 'saved-note', 'SAVED');
      b.appendChild(note);
      setTimeout(() => note.remove(), 1400);
    }
    // push the range to the wheel if the bridge is up
    if (this.ffb.bridge.status === 'on') this.ffb.bridge.setRange(this.wheel.cal.rangeDeg);
  }

  refreshStatus() {
    const c = this.statusCard;
    if (!c) return;
    c.innerHTML = '';
    const w = this.wheel;
    const preset = presetFor(w.cal.preset);

    const line = (k, v, cls = '') => {
      const row = el('div', 'status-row ' + cls);
      row.appendChild(el('span', 'status-k', k));
      row.appendChild(el('span', 'status-v', v));
      return row;
    };

    c.appendChild(el('h3', null, 'STATUS'));
    c.appendChild(line('Device', w.connected ? (w.rawName || 'wheel').slice(0, 46) : 'none connected',
      w.connected ? 'good' : 'bad'));
    c.appendChild(line('Profile', preset.name));
    c.appendChild(line('Axes / buttons',
      w.connected ? `${w.rawAxes.length} / ${w.rawButtons.length}` : '—'));

    const desc = this.ffb.describe();
    c.appendChild(line('Force feedback', desc.label + (desc.detail ? ' — ' + desc.detail : ''),
      desc.level === 'good' ? 'good' : desc.level === 'warn' ? 'warn' : 'bad'));
  }

  /* ============================================================
     LIVE UPDATE
     ============================================================ */
  open() {
    this.build();
    this.visible = true;
    // The wheel may have been plugged in, or its preset adopted, since the
    // screen was last built — so always re-read the calibration rather than
    // showing stale dropdowns.
    if (this._built) this.refreshControls();
    this.refreshStatus();
  }

  close() {
    this.visible = false;
    this.learner = null;
  }

  update() {
    if (!this.visible) return;
    const w = this.wheel;

    // ---- axis bars
    const axes = w.rawAxes || [];
    if (axes.length !== this.axisBars.length) {
      this.axisHost.innerHTML = '';
      this.axisBars = [];
      if (!axes.length) {
        this.axisHost.appendChild(this.axisEmpty);
      } else {
        for (let i = 0; i < axes.length; i++) {
          const row = el('div', 'axis-row');
          const tagged = [];
          if (i === w.cal.steerAxis) tagged.push('steer');
          if (i === w.cal.throttleAxis) tagged.push('thr');
          if (i === w.cal.brakeAxis) tagged.push('brk');
          if (i === w.cal.clutchAxis) tagged.push('clu');
          row.appendChild(el('span', 'axis-name', `A${i}${tagged.length ? ' · ' + tagged.join('/') : ''}`));
          const track = el('div', 'axis-track');
          const centre = el('i', 'axis-centre');
          const bar = el('i', 'axis-bar');
          track.appendChild(centre);
          track.appendChild(bar);
          row.appendChild(track);
          const val = el('span', 'axis-val', '0.00');
          row.appendChild(val);
          this.axisHost.appendChild(row);
          this.axisBars.push({ bar, val });
        }
      }
    }
    for (let i = 0; i < axes.length; i++) {
      const b = this.axisBars[i];
      if (!b) continue;
      const v = axes[i];
      // draw from the centre outwards, which is how a wheel axis reads
      const half = Math.abs(v) * 50;
      b.bar.style.left = (v < 0 ? 50 - half : 50) + '%';
      b.bar.style.width = half + '%';
      b.bar.className = 'axis-bar' + (v < 0 ? ' neg' : ' pos');
      b.val.textContent = v.toFixed(2);
    }

    // ---- button dots
    const btns = w.rawButtons || [];
    if (btns.length !== this.buttonDots.length) {
      this.btnHost.innerHTML = '';
      this.buttonDots = [];
      for (let i = 0; i < Math.max(btns.length, 16); i++) {
        const d = el('div', 'btn-dot', String(i));
        this.btnHost.appendChild(d);
        this.buttonDots.push(d);
      }
    }
    for (let i = 0; i < this.buttonDots.length; i++) {
      const on = (btns[i] || 0) > 0.5;
      this.buttonDots[i].classList.toggle('on', on);
      if (on && w.cal.handbrakeButton === i) this.buttonDots[i].classList.add('bound');
    }

    // ---- wizard progress
    if (this.learner) {
      const before = this.learner.stepIndex;
      const wasDone = this.learner.done;
      this.learner.update(1 / 60);
      if (this.learner.stepIndex !== before || this.learner.done !== wasDone) this.renderWizard();
      else {
        const fill = this.wizardBox.querySelector('.wizard-progress i');
        if (fill) fill.style.width = (this.learner.progress * 100).toFixed(0) + '%';
      }
    }

    // ---- keep the detected-device line fresh
    this._statusTick = (this._statusTick || 0) + 1;
    if (this._statusTick % 30 === 0) this.refreshStatus();
    if (this._bridgeTick === undefined) this._bridgeTick = 0;
    this._bridgeTick++;
    if (this._bridgeTick % 60 === 0 && this.ffb.bridge.status === 'on') {
      const st = this.bridgeBox.querySelector('.bridge-state');
      if (st && !st.classList.contains('good')) this.buildBridgeBox();
    }
  }
}
