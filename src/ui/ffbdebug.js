/* ============================================================
   FFB DEBUG — the whole force-feedback chain, on one screen.

   Not a fix for anything. A way to see what is actually happening,
   because every value needed to diagnose a dead wheel already exists
   and is scattered across four modules and an HTTP endpoint.

   The chain is: browser sees a gamepad -> the game reads it -> the
   bridge holds the wheel -> the bridge receives force -> the wheel
   moves. It can break at any of those, and the symptoms are identical
   from the driver's seat: the rim does nothing.

   Toggle with Ctrl+D, or the button in OPTIONS.
   ============================================================ */

let root = null;
let deps = null;
let timer = null;
let visible = false;

/** One line per link in the chain, each independently checkable. */
function collect() {
  const { wheel, ffb, input } = deps;
  const pads = typeof navigator.getGamepads === 'function'
    ? Array.from(navigator.getGamepads()).filter((p) => p && p.connected)
    : [];
  const br = ffb.bridge;

  let pressed = 0;
  if (pads[0]) for (const b of pads[0].buttons) if (b.pressed) pressed++;

  return {
    browser: {
      gamepads: pads.length,
      ids: pads.map((p) => p.id).slice(0, 2),
      buttonsDown: pressed,
      // Chrome hides a gamepad until the driver physically touches it
      note: pads.length === 0
        ? 'turn the wheel or press a pedal — browsers hide a pad until you touch it'
        : '',
    },
    game: {
      wheelSeen: !!(wheel && wheel.connected),
      everSeen: !!(wheel && wheel.everSeen),
      usingBridgeInput: !!(input && input.usingBridgeInput),
      axes: wheel && wheel.connected && wheel.rawAxes
        ? wheel.rawAxes.slice(0, 6).map((v) => Number(v).toFixed(2)).join(' ')
        : '—',
    },
    bridge: {
      status: br.status,
      url: br.url || (br.ws ? br.ws.url : '—'),
      wheel: br.wheelName || '—',
      lastError: br.lastError || '',
    },
    force: {
      sent: ffb._forceAcc !== undefined ? Math.round(ffb._forceAcc) : '—',
      torque: Number(ffb.lastTorque || 0).toFixed(3),
      friction: Number(ffb.lastFriction || 0).toFixed(3),
      enabled: ffb.enabled !== false,
    },
  };
}

function row(label, value, cls = '') {
  return `<div class="ffbd-row ${cls}"><span>${label}</span><b>${value}</b></div>`;
}

function render() {
  if (!root) return;
  const c = collect();

  const browserOk = c.browser.gamepads > 0;
  const bridgeOk = c.bridge.status === 'on';

  root.innerHTML = `
    <div class="ffbd-head">FORCE FEEDBACK CHAIN <em>Ctrl+D to close</em></div>

    <div class="ffbd-sec ${browserOk ? 'ok' : 'bad'}">
      <h4>1 · DOES THE BROWSER SEE A WHEEL?</h4>
      ${row('gamepads', c.browser.gamepads, browserOk ? 'ok' : 'bad')}
      ${c.browser.ids.map((id, i) => row('  id ' + i, id)).join('')}
      ${row('buttons down', c.browser.buttonsDown)}
      ${c.browser.note ? `<p class="ffbd-note">${c.browser.note}</p>` : ''}
    </div>

    <div class="ffbd-sec ${c.game.wheelSeen ? 'ok' : 'bad'}">
      <h4>2 · IS THE GAME READING IT?</h4>
      ${row('wheel connected', c.game.wheelSeen ? 'yes' : 'no', c.game.wheelSeen ? 'ok' : 'bad')}
      ${row('seen this session', c.game.everSeen ? 'yes' : 'never')}
      ${row('using bridge input', c.game.usingBridgeInput ? 'yes' : 'no')}
      ${row('live axes', c.game.axes)}
    </div>

    <div class="ffbd-sec ${bridgeOk ? 'ok' : 'bad'}">
      <h4>3 · IS THE BRIDGE CONNECTED?</h4>
      ${row('websocket', c.bridge.status, bridgeOk ? 'ok' : 'bad')}
      ${row('url', c.bridge.url)}
      ${row('wheel at bridge', c.bridge.wheel)}
      ${c.bridge.lastError ? row('error', c.bridge.lastError, 'bad') : ''}
      ${bridgeOk ? '' : '<p class="ffbd-note">Start it with <code>node tools/ffb/bridge.mjs --iface=input</code>, then open the address it prints.</p>'}
    </div>

    <div class="ffbd-sec ${c.force.enabled ? '' : 'bad'}">
      <h4>4 · IS FORCE BEING SENT?</h4>
      ${row('enabled', c.force.enabled ? 'yes' : 'no')}
      ${row('torque', c.force.torque)}
      ${row('friction', c.force.friction)}
    </div>
  `;
}

/**
 * @param {{wheel:object, ffb:object, input:object}} d
 */
export function init(d) {
  deps = d;
  // On window, not document: an event dispatched on window does not bubble
  // down to document, and Ctrl+D is also the browser's bookmark shortcut, so
  // this needs to win before anything else looks at it.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyD' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  }, true);
}

/**
 * Show, hide, or flip the overlay.
 * @param {boolean} [on] omit to toggle
 * @returns {boolean} whether it is now visible
 */
export function toggle(on) {
  visible = on === undefined ? !visible : !!on;
  if (visible && !root) {
    root = document.createElement('div');
    root.id = 'ffbDebug';
    document.body.appendChild(root);
    root.addEventListener('click', () => toggle(false));
  }
  if (!root) return visible;
  root.classList.toggle('show', visible);
  if (visible && !timer) {
    render();
    timer = setInterval(render, 250);
  } else if (!visible && timer) {
    clearInterval(timer);
    timer = null;
  }
  return visible;
}

export function isOpen() { return visible; }
