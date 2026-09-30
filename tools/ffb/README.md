# Force feedback bridge

Optional. The game runs fine without it — this is what makes a steering
wheel actually push back.

```
cd tools/ffb
npm install
node bridge.mjs
```

Then open the address it prints (default <http://127.0.0.1:8177>) and play.
The bridge serves the game itself, so there is no second port to manage.

---

## Why this is a separate program

A browser cannot apply torque to a steering wheel. The Gamepad API gives you
*input*, and `Gamepad.vibrationActuator` can rumble a gamepad, but there is no
web API that turns a wheel's rim. That needs a native process talking to the
wheel over USB HID, which is what this is:

```
  physics  ->  FFB model  ->  WebSocket  ->  this bridge  ->  USB HID  ->  wheel
  (browser)    (browser)      localhost      (node)          (node-hid)
```

The game degrades gracefully at every step. No bridge, no wheel, or no
`node-hid` — it still plays, it just does not push back.

---

## Setup

**1. Check the wheel is visible to the OS.**

```bash
node bridge.mjs --probe
```

This lists HID devices and tells you if it can see a wheel. If it cannot:

- **Set the mode switch to PS3.** There is a small switch on the top of a G29,
  above the centre of the wheel. The library only understands the wheel in PS3
  mode.
- **Quit Logitech G HUB.** Only one process can claim the device; if G HUB has
  it, nothing else can open it.
- Make sure it is plugged in and powered.

**2. Connect the game.**

Open the game from the address the bridge prints, then go to
**WHEEL & FORCE FEEDBACK** on the title screen. The bridge line should read
`CONNECTED — Logitech G29`.

If you opened the game from `tools/serve.mjs` instead, the bridge will not be
found — it has to be the bridge serving the page.

---

## Tuning the feel

The torque model lives in `src/ffb.js`. It produces three things:

| Output | What it does | Where it comes from |
|---|---|---|
| **Aligning torque** | The main force. Pushes the rim toward the direction that corrects the slide. | Slip angle, shaped so it peaks around 32° and falls away after — that falloff is your warning that grip is going. |
| **Friction** | Weight in the rim. | Speed, dropping sharply once the car is sliding. This is the "the rear has let go" cue. |
| **Kick** | A short jolt on impact. | Wall collisions. |

All three are exposed on the wheel setup screen (strength, rim friction,
invert direction). If the wheel pulls the wrong way, that is what **Invert
force direction** is for — though the sign is verified by
`node tools/ffbcheck.mjs`, so if it feels backwards it is more likely the
wheel's own axis orientation.

The wheel's **rotation range** is set to 540° by default and can be changed on
the setup screen; the bridge applies it to the hardware.

---

## Safety

The bridge cuts force automatically if it stops hearing from the browser for
600 ms, and calls `forceOff()` on Ctrl+C. A game that crashes should never
leave a wheel pulling against your hands.

---

## What the bridge does and does not do

**It only writes force to the wheel.** Steering and pedals are read by the
browser's Gamepad API. The two never touch the same interface, so they cannot
compete:

```
  browser  --Gamepad API-->  joystick interface  (usagePage 0x0001)
  bridge   --node-hid----->  force interface     (usagePage 0xff00)
```

Verified on a real G29:

```
usagePage=0x0001  iface=0  -> joystick input
usagePage=0xff00  iface=1  -> force feedback
```

## Why this does not use the obvious library

`logitech-g29` is the package everyone finds first. It caused two real problems
on real hardware, which is why `g29.mjs` exists instead:

1. **It opens the joystick interface** and calls `device.read()` in a loop —
   the same interface the browser needs, competing for the same reports.
2. **It sends wheel mode/init commands on connect** (`0xf8 0x0a`,
   `0xf8 0x09 0x05 0x01 0x01`). Those switch the wheel into a native mode.
   The symptom is nasty: the wheel stops responding to its own PS4/PS5/PC mode
   switch, stops recalibrating, and stops appearing to the browser. A full
   power cycle is the only way back — a USB replug is not always enough,
   because the G29 has its own power brick.

`g29.mjs` sends only effect commands — constant force, friction, range,
auto-centre-off — and never anything that changes how the wheel presents
itself. The command bytes come from the Linux `hid-lg4ff` driver and the
`logitech-g29` source.

## If your wheel stops responding

1. Stop the bridge with `Ctrl+C`. It calls `forceOff()` and closes the device.
2. **Pull the wheel's power brick, not just USB.** Wait ten seconds.
3. Power first, then USB.
4. Check it in the browser before starting the bridge:
   <https://hardwaretester.com/gamepad> — it should appear as
   `G29 Driving Force Racing Wheel`.

## Real hardware reference

```
id      G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)
mapping none
axes    10   [0] steering (centred)  [1] clutch  [2] throttle  [5] brake
             pedals rest at +1 and travel to -1
buttons 25
vibrationActuator  null
```

Note the pedal axes are **not** 1 and 2 in the order you would guess, and the
layout can shift between PS4/PS5/PC modes. If the preset does not match your
unit, use auto-detect rather than editing the preset by hand.

The `vibrationActuator` line is why this bridge exists: the browser exposes no
haptics at all for this wheel, so there is no rumble fallback available.

## Setup

```bash
cd tools/ffb
npm install
node bridge.mjs --probe    # confirm the wheel is visible
node bridge.mjs            # serve the game with force feedback
```

Then open the address it prints. The bridge serves the game itself, so there is
no second port to manage.

## Safety

Force is cut automatically if the bridge stops hearing from the browser for
600 ms, and `Ctrl+C` releases the wheel cleanly. A crashed game must never
leave a wheel pulling against your hands.
