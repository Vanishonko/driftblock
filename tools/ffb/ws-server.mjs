/* ============================================================
   Minimal RFC 6455 WebSocket server.

   The bridge needs a low-latency duplex channel (60 Hz of force
   commands going out, input coming back) and the project has a
   strict "no dependencies for the core" rule, so this implements
   just the slice of the protocol that is actually needed:
   text frames, ping/pong, close, and fragmentation.

   Not implemented, deliberately: extensions, permessage-deflate,
   binary frames.
   ============================================================ */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export class WebSocketServer extends EventEmitter {
  constructor({ path: wsPath = '/ffb' } = {}) {
    super();
    this.path = wsPath;
    this.clients = new Set();
  }

  /** Hook this into an existing http.Server's 'upgrade' event. */
  handleUpgrade(req, socket) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== this.path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);

    const client = new WsClient(socket);
    this.clients.add(client);
    client.on('close', () => this.clients.delete(client));
    client.on('message', (data) => this.emit('message', client, data));
    client.on('close', () => this.emit('disconnect', client));
    this.emit('connection', client);
    return client;
  }

  broadcast(obj) {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const c of this.clients) c.sendText(text);
  }
}

class WsClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;
    this.closed = false;

    socket.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this._drain();
    });
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _drain() {
    // Parse as many whole frames as the buffer holds. A partial frame
    // simply stays in the buffer until the rest arrives.
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;

      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (b.length < offset + 2) return;
        len = b.readUInt16BE(offset); offset += 2;
      } else if (len === 127) {
        if (b.length < offset + 8) return;
        const big = b.readBigUInt64BE(offset); offset += 8;
        if (big > 1_000_000n) { this.close(1009, 'too big'); return; }
        len = Number(big);
      }

      // clients MUST mask
      if (!masked) { this.close(1002, 'unmasked'); return; }
      if (b.length < offset + 4) return;
      const mask = b.subarray(offset, offset + 4); offset += 4;

      if (b.length < offset + len) return;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[offset + i] ^ mask[i & 3];
      this.buf = b.subarray(offset + len);

      this._frame(fin, opcode, payload);
    }
  }

  _frame(fin, opcode, payload) {
    if (opcode === OP.CLOSE) { this.close(); return; }
    if (opcode === OP.PING) { this._send(OP.PONG, payload); return; }
    if (opcode === OP.PONG) return;

    if (opcode === OP.CONT) {
      this.fragments.push(payload);
    } else {
      this.fragments = [payload];
      this.fragmentOp = opcode;
    }
    if (!fin) return;

    const full = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragmentOp === OP.TEXT) this.emit('message', full.toString('utf8'));
    else this.emit('message', full);
  }

  _send(opcode, payload) {
    if (this.closed || !this.socket.writable) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;   // FIN + opcode; server frames are never masked
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch { this._closed(); }
  }

  sendText(text) { this._send(OP.TEXT, Buffer.from(text, 'utf8')); }
  send(obj) { this.sendText(JSON.stringify(obj)); }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this._send(OP.CLOSE, body);
    try { this.socket.end(); } catch { /* ignore */ }
    this._closed();
  }
}
