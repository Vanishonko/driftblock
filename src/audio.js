/* ============================================================
   AUDIO — 100% synthesized. No sample files.
   Engine (gearbox-modelled), tyre squeal, wind, impacts,
   turbo whoosh, UI blips and combo arpeggios.
   ============================================================ */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export class GameAudio {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.muted = false;
    this.masterVol = 0.9;
    this.windVol = 1.0;
    this.engineVol = 1.15;    // separate trim: the engine dominates the mix
  }

  setMasterVolume(v) {
    this.masterVol = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.masterVol;
  }

  /** @param {number} v 0..2 trim; 1 is the tuned default */
  setWindVolume(v) {
    this.windVol = Math.max(0, Number(v) || 0);
  }

  setEngineVolume(v) {
    this.engineVol = clamp(v, 0, 1.6);
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // ---- master chain: bus -> compressor -> limiter-ish -> out
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.master.connect(this.comp).connect(ctx.destination);

    // ---- shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this._buildEngine();
    this._buildTyres();
    this._buildWind();

    this.ready = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.masterVol;
  }

  // ==========================================================
  // ENGINE
  // ==========================================================
  _buildEngine() {
    const ctx = this.ctx;

    // ------------------------------------------------------------------
    // A four-stroke four-cylinder fires twice per revolution, so the note
    // you actually hear is  rpm / 30  Hz — about 29 Hz at idle and 245 Hz
    // at the redline. Everything below is built on that fundamental.
    // ------------------------------------------------------------------
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    // tracking lowpass: the engine gets brighter as it revs, which is most
    // of what makes it sound like it is working rather than droning
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 700;
    this.engFilter.Q.value = 1.4;

    // gentle top-end cut so the saws are not harsh
    this.engShelf = ctx.createBiquadFilter();
    this.engShelf.type = 'highshelf';
    this.engShelf.frequency.value = 3400;
    this.engShelf.gain.value = -9;

    // Two resonant peaks in the chain, which is what makes this sound like
    // it is coming out of a pipe rather than out of an oscillator. A real
    // exhaust and intake have strong resonances that move with revs; without
    // them any amount of harmonic content still reads as a synth tone.
    this.resA = ctx.createBiquadFilter();
    this.resA.type = 'peaking';
    this.resA.Q.value = 2.6;
    this.resA.gain.value = 10;

    this.resB = ctx.createBiquadFilter();
    this.resB.type = 'peaking';
    this.resB.Q.value = 1.7;
    this.resB.gain.value = 7;

    this.engGain.connect(this.resA);
    this.resA.connect(this.resB);
    this.resB.connect(this.engFilter);
    this.engFilter.connect(this.engShelf);
    this.engShelf.connect(this.master);

    /**
     * The shape of one cylinder's exhaust pulse.
     *
     * A sawtooth is the obvious thing to reach for and it is the wrong
     * shape: all harmonics at exactly 1/n is bright and buzzy, which is the
     * "microwave" end of the problem. Lifting the low orders and rolling the
     * rest off gives a much fatter spectrum — 94% of the energy below the
     * fifth harmonic against 88% for a saw — which is what puts a motorblock
     * under the note instead of a whine.
     *
     * The phase scatter is cosmetic and worth being honest about: for a
     * steady periodic tone the ear is largely phase-deaf, so it does not
     * change the timbre. It only shapes the waveform. The fatness comes
     * entirely from the amplitudes.
     */
    const enginePulse = (count = 40, rolloff = 1.05) => {
      const real = new Float32Array(count);
      const imag = new Float32Array(count);
      const GOLDEN = 2.399963229728653;
      for (let n = 1; n < count; n++) {
        // slightly stronger low orders than a saw, so there is weight under it
        const amp = (1 / Math.pow(n, rolloff)) * (n < 5 ? 1.35 : 1);
        const phase = n * GOLDEN;
        real[n] = amp * Math.cos(phase);
        imag[n] = amp * Math.sin(phase);
      }
      return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    };
    this.pulseWave = enginePulse();

    const mkOsc = (type, detune, gainVal, mult, wave) => {
      const o = ctx.createOscillator();
      if (wave) o.setPeriodicWave(wave); else o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gainVal;
      o.connect(g).connect(this.engGain);
      o.start();
      o._mult = mult;
      return o;
    };

    // Three copies of the same pulse. The detune is deliberately wide enough
    // to beat at a few Hz rather than to sit in unison: real cylinders do not
    // fire identically, and that slow unevenness is a big part of the
    // character. Two of them an octave down carry the weight.
    this.oscSub = mkOsc('sine', 0, 0.30, 0.5, this.pulseWave);
    this.oscA = mkOsc('sawtooth', -14, 0.24, 1, this.pulseWave);
    this.oscB = mkOsc('sawtooth', +21, 0.21, 1, this.pulseWave);
    this.oscLump = mkOsc('square', 0, 0.05, 0.25);
    this.oscBright = mkOsc('sawtooth', +16, 0.05, 2);

    // ---- intake / induction roar, tracks revs and throttle
    this.engNoise = ctx.createBufferSource();
    this.engNoise.buffer = this.noiseBuf;
    this.engNoise.loop = true;
    this.engNoiseFilter = ctx.createBiquadFilter();
    this.engNoiseFilter.type = 'bandpass';
    this.engNoiseFilter.frequency.value = 420;
    this.engNoiseFilter.Q.value = 0.9;
    this.engNoiseGain = ctx.createGain();
    this.engNoiseGain.gain.value = 0;
    this.engNoise.connect(this.engNoiseFilter).connect(this.engNoiseGain).connect(this.engGain);
    this.engNoise.start();

    // ---- exhaust crackle on a closed throttle
    this.popGain = ctx.createGain();
    this.popGain.gain.value = 1;
    this.popGain.connect(this.master);

    // ---- dedicated tailpipe for pops and shift bangs
    this.exhaust = ctx.createBiquadFilter();
    this.exhaust.type = 'lowpass';
    this.exhaust.frequency.value = 1800;
    this.exhaust.Q.value = 0.8;
    this.exhaust.connect(this.master);

    this._limPhase = 0;
  }

  // ==========================================================
  // TYRES
  // ==========================================================
  _buildTyres() {
    const ctx = this.ctx;

    // squeal = narrow bandpassed noise, with a resonant whistle on top
    this.tyreSrc = ctx.createBufferSource();
    this.tyreSrc.buffer = this.noiseBuf;
    this.tyreSrc.loop = true;
    this.tyreSrc.playbackRate.value = 1;

    this.tyreBP = ctx.createBiquadFilter();
    this.tyreBP.type = 'bandpass';
    this.tyreBP.frequency.value = 1500;
    this.tyreBP.Q.value = 7;

    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;

    this.tyreSrc.connect(this.tyreBP).connect(this.tyreGain).connect(this.master);
    this.tyreSrc.start();

    // tonal whistle layer — the "eeee" of a proper slide
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'triangle';
    this.whistle.frequency.value = 1100;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.master);
    this.whistle.start();

    // gravel / grass rumble
    this.rumbleSrc = ctx.createBufferSource();
    this.rumbleSrc.buffer = this.noiseBuf;
    this.rumbleSrc.loop = true;
    this.rumbleLP = ctx.createBiquadFilter();
    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 340;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleSrc.connect(this.rumbleLP).connect(this.rumbleGain).connect(this.master);
    this.rumbleSrc.start();
  }

  // ==========================================================
  // WIND
  // ==========================================================
  _buildWind() {
    const ctx = this.ctx;
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = this.noiseBuf;
    this.windSrc.loop = true;
    this.windHP = ctx.createBiquadFilter();
    this.windHP.type = 'highpass';
    this.windHP.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windHP).connect(this.windGain).connect(this.master);
    this.windSrc.start();
  }

  // ==========================================================
  // PER-FRAME ENGINE UPDATE
  // ==========================================================
  /**
   * @param {object} p
   *  p.rpm01    0..1 normalized revs
   *  p.throttle 0..1
   *  p.speed01  0..1
   *  p.slip     0..~1.5 slip amount
   *  p.onGrass  bool
   *  p.engineOn bool
   *  p.boost    0..1
   */
  updateEngine(p) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const sm = 0.03;

    const rpm01 = clamp(p.rpm01, 0, 1);
    const throttle = clamp(p.throttle, 0, 1);
    const speed01 = clamp(p.speed01, 0, 1);

    // firing frequency of a 4-cylinder four-stroke
    const rpm = p.rpm !== undefined ? p.rpm : 880 + rpm01 * 6520;
    const f0 = Math.max(18, rpm / 30);

    const setF = (osc, mult) => {
      osc.frequency.setTargetAtTime(Math.max(16, f0 * mult), t, sm);
    };
    setF(this.oscSub, 0.5);
    setF(this.oscA, 1);
    setF(this.oscB, 1);
    setF(this.oscLump, 0.5);
    setF(this.oscBright, 2);

    // ---- level. This is a loud, all-noise sort of engine on purpose: it
    // should dominate the mix, not sit politely behind it.
    let vol = p.engineOn ? (0.085 + rpm01 * 0.215) * (0.34 + throttle * 0.66) : 0;

    vol *= this.engineVol;

    // rev limiter stutter
    if (p.limiter && p.engineOn) {
      this._limPhase += 0.16;
      vol *= (Math.sin(this._limPhase * Math.PI * 2) > 0 ? 1 : 0.18);
    }
    this.engGain.gain.setTargetAtTime(vol, t, 0.035);

    this.engFilter.frequency.setTargetAtTime(280 + Math.pow(rpm01, 1.15) * 4200 + throttle * 500, t, sm);

    // The pipe resonances move with revs. Low orders carry the note, higher
    // ones carry the rasp, and keeping them locked to f0 is what stops the
    // whole thing sounding like a fixed filter with a tone behind it.
    this.resA.frequency.setTargetAtTime(Math.max(40, f0 * 1.9), t, sm);
    this.resB.frequency.setTargetAtTime(Math.max(120, f0 * 5.6), t, sm);
    // under load the pipe rings harder; off throttle it goes flat and hollow
    this.resA.gain.setTargetAtTime(7 + throttle * 7, t, 0.09);
    this.resB.gain.setTargetAtTime(4 + throttle * 6, t, 0.09);

    this.engNoiseFilter.frequency.setTargetAtTime(220 + f0 * 3.2, t, sm);
    this.engNoiseGain.gain.setTargetAtTime(
      p.engineOn ? (0.012 + rpm01 * 0.085) * (0.2 + throttle * 0.8) : 0, t, 0.05);

    // ---- exhaust crackle on overrun
    if (p.overrun > 0 && p.engineOn && Math.random() < 0.42) {
      const hard = Math.random() < 0.3;
      this._noiseBurst({
        dur: hard ? 0.11 : 0.05,
        freq: 260 + Math.random() * 900,
        q: 0.7,
        type: 'lowpass',
        gain: (hard ? 0.22 : 0.13) * clamp(p.overrun * 3, 0, 1),
        attack: 0.002,
      });
      this._tone({ freq: 90 + Math.random() * 60, to: 48, dur: 0.07, type: 'sine', gain: 0.13 });
    }

    // ---- TYRES
    const slip = clamp(p.slip, 0, 1.6);
    const squeal = clamp((slip - 0.10) / 0.85, 0, 1);
    const spd = clamp(speed01 * 2.4, 0, 1);
    const sq = squeal * spd;

    this.tyreGain.gain.setTargetAtTime(sq * 0.18, t, 0.04);
    this.tyreBP.frequency.setTargetAtTime(1050 + squeal * 1500, t, 0.05);
    this.tyreSrc.playbackRate.setTargetAtTime(0.85 + squeal * 0.8, t, 0.08);

    this.whistle.frequency.setTargetAtTime(820 + squeal * 1050 + rpm01 * 160, t, 0.05);
    this.whistleGain.gain.setTargetAtTime(Math.pow(sq, 1.6) * 0.06, t, 0.05);

    // ---- RUMBLE (grass/gravel)
    const rumbleAmt = p.onGrass ? clamp(speed01 * 2.6, 0, 1) : 0;
    this.rumbleGain.gain.setTargetAtTime(rumbleAmt * 0.20, t, 0.06);
    this.rumbleLP.frequency.setTargetAtTime(220 + speed01 * 520, t, 0.08);

    // ---- WIND: the cue for how fast you are actually going. Kept well under
    // the engine — it is a background rush, not a second engine.
    const w = Math.pow(clamp(speed01, 0, 1), 1.6);
    this.windGain.gain.setTargetAtTime((w * 0.145 + p.boost * 0.05) * this.windVol, t, 0.1);
    this.windHP.frequency.setTargetAtTime(420 + w * 1700, t, 0.1);
  }

  // ==========================================================
  // ONE-SHOTS
  // ==========================================================
  _env(node, t0, attack, peak, decay) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _noiseBurst({ dur = 0.25, freq = 900, q = 1, type = 'bandpass', gain = 0.4, attack = 0.004, sweep = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;

    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) {
      f.frequency.setValueAtTime(freq, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t0 + dur);
    }

    const g = ctx.createGain();
    this._env(g, t0, attack, gain, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.12);
  }

  _tone({ freq = 440, dur = 0.15, type = 'square', gain = 0.2, to = null, attack = 0.005, delay = 0 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const g = ctx.createGain();
    this._env(g, t0, attack, gain, dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + attack + 0.08);
  }

  /** Big crunchy impact. strength 0..1 */
  impact(strength = 0.6) {
    const s = clamp(strength, 0, 1);
    this._noiseBurst({ dur: 0.16 + s * 0.3, freq: 260 + s * 400, q: 0.7, gain: 0.30 + s * 0.34, type: 'lowpass' });
    this._tone({ freq: 150 + s * 60, to: 42, dur: 0.24 + s * 0.2, type: 'sine', gain: 0.28 + s * 0.3 });
    this._noiseBurst({ dur: 0.08, freq: 3200, q: 2.5, gain: 0.12 + s * 0.16 });
  }

  /** Metal scrape along a wall. */
  scrape() {
    this._noiseBurst({ dur: 0.18, freq: 2400, q: 3.5, gain: 0.16, type: 'bandpass', sweep: -900 });
  }

  /** Mini-turbo fire. tier 0..2 */
  boostFire(tier = 0) {
    const base = [300, 380, 470][clamp(tier, 0, 2)];
    this._tone({ freq: base, to: base * 4.2, dur: 0.42, type: 'sawtooth', gain: 0.20 });
    this._noiseBurst({ dur: 0.55, freq: 700, q: 0.8, gain: 0.30, type: 'bandpass', sweep: 2600 });
    this._tone({ freq: base * 2, to: base * 6, dur: 0.30, type: 'square', gain: 0.09, delay: 0.02 });
  }

  /** Drift-score tick. pitch rises with multiplier. */
  tick(mult = 1) {
    const f = 620 * Math.pow(1.075, Math.min(mult, 16));
    this._tone({ freq: f, dur: 0.045, type: 'square', gain: 0.05, attack: 0.002 });
  }

  /** Combo tier up — little arpeggio. tier 0..n */
  tierUp(tier = 0) {
    const roots = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const r = roots[clamp(tier, 0, roots.length - 1)];
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      this._tone({ freq: r * m, dur: 0.13, type: 'square', gain: 0.10, delay: i * 0.045 });
    });
  }

  /** Bank the drift score. */
  bank(points = 0) {
    const scale = [523.25, 659.25, 783.99, 1046.5];
    scale.forEach((f, i) => this._tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.14, delay: i * 0.05 }));
    this._tone({ freq: 130.81, dur: 0.32, type: 'sine', gain: 0.16 });
  }

  /** Losing a chain. */
  chainLost() {
    this._tone({ freq: 300, to: 90, dur: 0.42, type: 'sawtooth', gain: 0.16 });
    this._noiseBurst({ dur: 0.3, freq: 500, q: 1.2, gain: 0.12, type: 'lowpass', sweep: -300 });
  }

  /** Near-miss whoosh. */
  nearMiss() {
    this._noiseBurst({ dur: 0.26, freq: 1800, q: 1.4, gain: 0.16, type: 'bandpass', sweep: -1300 });
    this._tone({ freq: 1400, to: 620, dur: 0.2, type: 'sine', gain: 0.07 });
  }

  /** Lap / checkpoint. */
  lap(good = true) {
    if (good) {
      [659.25, 987.77, 1318.5].forEach((f, i) => this._tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.13, delay: i * 0.07 }));
    } else {
      this._tone({ freq: 330, dur: 0.22, type: 'square', gain: 0.12 });
    }
  }

  /** UI */
  ui(kind = 'move') {
    if (kind === 'move') this._tone({ freq: 880, dur: 0.04, type: 'square', gain: 0.05, attack: 0.002 });
    else if (kind === 'ok') { this._tone({ freq: 660, dur: 0.09, type: 'square', gain: 0.11 }); this._tone({ freq: 990, dur: 0.11, type: 'square', gain: 0.09, delay: 0.05 }); }
    else if (kind === 'back') this._tone({ freq: 420, to: 260, dur: 0.12, type: 'square', gain: 0.09 });
    else if (kind === 'count') this._tone({ freq: 1100, dur: 0.12, type: 'square', gain: 0.14 });
    else if (kind === 'go') { this._tone({ freq: 1400, dur: 0.34, type: 'square', gain: 0.18 }); this._tone({ freq: 700, dur: 0.4, type: 'sawtooth', gain: 0.12 }); }
    else if (kind === 'record') [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone({ freq: f, dur: 0.24, type: 'triangle', gain: 0.14, delay: i * 0.08 }));
  }

  /** Gear change: a mechanical thunk plus a bang out of the exhaust. */
  shift(up = true) {
    this._noiseBurst({ dur: 0.045, freq: up ? 1900 : 2700, q: 1.8, gain: 0.11 });
    this._tone({ freq: up ? 150 : 110, to: 55, dur: 0.10, type: 'sine', gain: 0.17 });
    if (!up) this._noiseBurst({ dur: 0.10, freq: 620, q: 0.7, type: 'lowpass', gain: 0.15 });
  }

  /** Tyre chirp on handbrake pull. */
  chirp() {
    this._noiseBurst({ dur: 0.2, freq: 2100, q: 4, gain: 0.16, type: 'bandpass', sweep: 700 });
  }
}
