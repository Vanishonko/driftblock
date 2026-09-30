/* ============================================================
   DRIFTBLOCK dev server.

     node tools/serve.mjs            # auto-picks a free port, opens the browser
     node tools/serve.mjs 9000       # use a specific port
     node tools/serve.mjs --no-open  # don't launch a browser

   The game is plain ES modules with no build step, but it MUST be
   served over http:// — opening index.html as a file:// URL will
   fail because browsers block module imports from the filesystem.

   For racing wheel force feedback, use tools/ffb/bridge.mjs instead:
   it serves exactly the same files plus a native HID channel.
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStaticHandler, listenWithFallback } from './static-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const NO_OPEN = argv.includes('--no-open');
const portArg = argv.find((a) => /^\d+$/.test(a));
const START_PORT = portArg ? Number(portArg) : 8177;

// ---- sanity check: the one file that must ship with the game --------
if (!fs.existsSync(path.join(ROOT, 'vendor', 'three.module.js'))) {
  console.error(
    '\n  vendor/three.module.js is missing.\n' +
    '  The game cannot run without it — re-extract the archive with\n' +
    '  the vendor/ folder included.\n'
  );
  process.exit(1);
}

const handler = createStaticHandler(ROOT);
const server = http.createServer((req, res) => handler(req, res));

listenWithFallback(server, START_PORT, 20, (port) => {
  const url = `http://127.0.0.1:${port}/`;
  console.log('\n  DRIFTBLOCK is running\n');
  console.log('    ' + url + '\n');
  console.log('  Controls:  W/S throttle & brake  ·  A/D steer');
  console.log('             SPACE handbrake  ·  SHIFT mini-turbo');
  console.log('             R reset  ·  C camera  ·  ESC pause\n');
  console.log('  Racing wheel: run tools/ffb/bridge.mjs instead for force feedback.\n');
  console.log('  Press Ctrl+C to stop.\n');
  if (!NO_OPEN) openBrowser(url);
});

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch { /* opening a browser is a nicety, never fatal */ }
}
