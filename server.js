'use strict';
// THE VEIL: zero-dependency static server + public WebSocket chat.
// Public demo channel: no login, no message persistence. Deploy behind HTTPS/WSS for internet use.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const MAX_MESSAGE = 240;
const clients = new Set();
const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.mp4':'video/mp4', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8'
};
function safeName(input) {
  const name = String(input || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 22);
  return name || `GUEST-${Math.floor(1000 + Math.random() * 9000)}`;
}
function sendFrame(socket, data, opcode = 1) {
  if (socket.destroyed || !socket.writable) return;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}
function sendJson(client, obj) { sendFrame(client.socket, JSON.stringify(obj)); }
function broadcast(obj) { for (const c of clients) sendJson(c, obj); }
function broadcastCount() { broadcast({type:'count', count:clients.size}); }
function system(text) { broadcast({type:'system', text}); }
function processMessage(client, value) {
  let data;
  try { data = JSON.parse(value.toString('utf8')); } catch { return; }
  if (!data || typeof data !== 'object') return;
  if (data.type === 'join') {
    client.name = safeName(data.name);
    client.joined = true;
    sendJson(client, {type:'system', text:`欢迎 ${client.name} 接入公共频道。请勿发送现实地址、个人信息或敏感内容。`});
    broadcastCount();
    return;
  }
  if (data.type !== 'chat' || !client.joined) return;
  const now = Date.now();
  // Basic rate limiting: at most one message every 700ms per connection.
  if (now - client.lastMessageAt < 700) return;
  client.lastMessageAt = now;
  const text = String(data.text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, MAX_MESSAGE);
  if (!text) return;
  broadcast({type:'chat', message:{name:client.name, role:'访客', avatar:client.name.slice(0,1).toUpperCase(), text, time:new Date().toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}});
}
function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0], b1 = client.buffer[1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f, offset = 2;
    if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) { if (client.buffer.length < 10) return; const big = client.buffer.readBigUInt64BE(2); if (big > 8192n) { client.socket.destroy(); return; } length = Number(big); offset = 10; }
    const maskBytes = masked ? 4 : 0;
    if (client.buffer.length < offset + maskBytes + length) return;
    let payload = client.buffer.subarray(offset + maskBytes, offset + maskBytes + length);
    if (masked) { const mask = client.buffer.subarray(offset, offset + 4); payload = Buffer.from(payload); for (let i=0;i<payload.length;i++) payload[i] ^= mask[i%4]; }
    client.buffer = client.buffer.subarray(offset + maskBytes + length);
    if (opcode === 8) { sendFrame(client.socket, Buffer.alloc(0), 8); client.socket.end(); return; }
    if (opcode === 9) { sendFrame(client.socket, payload, 10); continue; }
    if (opcode === 1) processMessage(client, payload);
  }
}
function removeClient(client) {
  if (!clients.has(client)) return;
  clients.delete(client);
  if (client.joined) system(`${client.name} 已离开公共频道。`);
  broadcastCount();
}
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const fullPath = path.resolve(ROOT, `.${pathname}`);
  if (!fullPath.startsWith(ROOT + path.sep) && fullPath !== path.join(ROOT,'index.html')) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Not Found'); return; }
    const type = mime[path.extname(fullPath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && type === 'video/mp4') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); res.end(); return; }
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) { const suffix = Number(match[2]); start = Math.max(0, stat.size - suffix); end = stat.size - 1; }
      if (start >= stat.size || end < start) { res.writeHead(416, {'Content-Range':`bytes */${stat.size}`}); res.end(); return; }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {'Content-Type':type,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600'});
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(fullPath,{start,end}).pipe(res); return;
    }
    res.writeHead(200, {'Content-Type':type,'Content-Length':stat.size,'Accept-Ranges':type==='video/mp4'?'bytes':'none','Cache-Control':fullPath.endsWith('index.html')?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(fullPath).pipe(res);
  });
});
server.on('upgrade', (req, socket) => {
  let pathname;
  try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; } catch { socket.destroy(); return; }
  if (pathname !== '/chat' || req.headers['sec-websocket-version'] !== '13' || !req.headers['sec-websocket-key']) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols','Upgrade: websocket','Connection: Upgrade',`Sec-WebSocket-Accept: ${accept}`,'\r\n'].join('\r\n'));
  const client = {socket, buffer:Buffer.alloc(0), name:`GUEST-${Math.floor(1000+Math.random()*9000)}`, joined:false, lastMessageAt:0};
  clients.add(client);
  socket.on('data', chunk => parseFrames(client, chunk));
  socket.on('error', () => removeClient(client));
  socket.on('close', () => removeClient(client));
  socket.on('end', () => removeClient(client));
  broadcastCount();
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`THE VEIL is running at http://localhost:${PORT}`);
  console.log('Public chat is enabled without login. Messages are not stored.');
  console.log('For internet deployment, use an HTTPS host that supports WebSocket/WSS.');
});
