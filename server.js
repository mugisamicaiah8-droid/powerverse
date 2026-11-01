/* ============================================================
   PowerVerse — WebRTC signaling server
   ------------------------------------------------------------
   A deliberately small, stateless-ish relay. It does ONE job:
   get two (or up to six) browsers pointed at each other so they
   can build peer-to-peer connections for camera, mic and screen.

   It never touches media. Audio/video flows browser <-> browser
   directly; this process only forwards a few hundred bytes of
   SDP and ICE candidates.

   Requires: socket.io (the only dependency).

   Rooms are keyed by the SAME 6-character sync code the app
   already uses (KAMPALA, CINEMA, ...), so joining a call is just
   "be on the same code".

   Run:  node server.js        (or: npm start)
   Env:  PORT, CORS_ORIGIN, MAX_CALL_PEERS, MAX_ROOM_MEMBERS, LOG_LEVEL
   ============================================================ */
'use strict';

const http = require('http');
const { Server } = require('socket.io');

/* ---------------- config ---------------- */
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_CALL_PEERS = Number(process.env.MAX_CALL_PEERS || 6);
const MAX_ROOM_MEMBERS = Number(process.env.MAX_ROOM_MEMBERS || 16);
const IDLE_ROOM_MS = Number(process.env.IDLE_ROOM_MS || 30 * 60 * 1000);
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase(); // silent | info | debug
const VERSION = '1.0.0';

function log(...args) {
  if (LOG_LEVEL !== 'silent') console.log('[signal]', ...args);
}
function debug(...args) {
  if (LOG_LEVEL === 'debug') console.log('[signal:debug]', ...args);
}

/* ============================================================
   Room state
   ------------------------------------------------------------
   rooms: Map<code, {
     code, createdAt, lastActivity,
     members: Map<socketId, member>
   }>

   member = {
     socketId, user: {id, name, avatar},
     mode: 'sync' | 'call',
     inCall: bool, mic: bool, cam: bool, sharing: bool,
     joinedAt, msgBudget
   }

   "In a room"  = opened the sync page (can receive call:started).
   "In the call"= actually on the call (gets peer connections).
   Both live in the same Map; only inCall members are peers.
   ============================================================ */
const rooms = new Map();

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}
function validCode(code) {
  return /^[A-Z0-9]{3,12}$/.test(code);
}
function sanitizeUser(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const name = String(raw.name || '').slice(0, 60).trim() || 'Guest';
  const id = String(raw.id || '').slice(0, 60).trim() || 'anon';
  let avatar = String(raw.avatar || '').slice(0, 400);
  // Only allow same-origin relative paths or https/data image URLs — never javascript: etc.
  if (avatar && !/^(https?:\/\/|data:image\/|images\/|[a-zA-Z0-9_.\-]+\/)/.test(avatar)) avatar = '';
  return { id, name, avatar };
}

function getRoom(code, create) {
  let room = rooms.get(code);
  if (!room && create) {
    room = { code, createdAt: Date.now(), lastActivity: Date.now(), members: new Map() };
    rooms.set(code, room);
    log('room created', code);
  }
  return room || null;
}

function touch(room) {
  if (room) room.lastActivity = Date.now();
}

function callMembers(room) {
  const out = [];
  if (!room) return out;
  for (const m of room.members.values()) if (m.inCall) out.push(m);
  return out;
}

function publicPeer(m) {
  return {
    socketId: m.socketId,
    user: m.user,
    mic: m.mic,
    cam: m.cam,
    sharing: m.sharing,
    joinedAt: m.joinedAt
  };
}

function callSnapshot(room) {
  return {
    code: room.code,
    maxPeers: MAX_CALL_PEERS,
    participants: callMembers(room).map(publicPeer)
  };
}

/* ---------------- tiny per-socket rate limit ---------------- */
// Relay messages are tiny but a hostile client could spam them.
// Token bucket: 200 messages per 10s, refilled continuously.
function allowed(member, cost = 1) {
  const now = Date.now();
  const windowMs = 10000;
  if (!member.bucketAt) {
    member.bucketAt = now;
    member.bucket = 200;
  }
  member.bucket = Math.min(200, member.bucket + ((now - member.bucketAt) / windowMs) * 200);
  member.bucketAt = now;
  if (member.bucket < cost) return false;
  member.bucket -= cost;
  return true;
}

/* ============================================================
   HTTP surface (health checks + a human-readable page)
   ============================================================ */
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health' || url === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      service: 'powerverse-signaling',
      version: VERSION,
      uptime: Math.round(process.uptime()),
      rooms: rooms.size,
      calls: [...rooms.values()].reduce((n, r) => n + callMembers(r).length, 0),
      maxCallPeers: MAX_CALL_PEERS
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    });
    res.end(body);
    return;
  }

  if (url === '/' || url === '/status') {
    const rows = [...rooms.values()].map(r => {
      const inCall = callMembers(r).length;
      return `<tr><td><code>${r.code}</code></td><td>${r.members.size}</td>` +
        `<td>${inCall}</td><td>${new Date(r.createdAt).toISOString().slice(11, 19)}Z</td></tr>`;
    }).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>PowerVerse signaling</title>
<style>body{background:#0b0e14;color:#e8ecf4;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;padding:40px;max-width:760px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}code{background:#161b25;padding:2px 6px;border-radius:5px;color:#7dd3fc}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14px}td,th{text-align:left;padding:7px 10px;border-bottom:1px solid #222a36}
.muted{color:#8b96a9;font-size:13.5px}.ok{color:#4ade80}
</style></head><body>
<h1>PowerVerse signaling server <span class="ok">● online</span></h1>
<p class="muted">WebRTC signaling only — no media passes through this process.</p>
<table><tr><th>Room</th><th>Members</th><th>On call</th><th>Since</th></tr>
${rows || '<tr><td colspan="4" class="muted">No active rooms right now.</td></tr>'}
</table>
<p class="muted" style="margin-top:22px">Health: <code>/health</code> · Socket.IO path: <code>/socket.io</code> · v${VERSION}</p>
</body></html>`);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found. Try /health');
});

/* ============================================================
   Socket.IO
   ============================================================ */
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
    methods: ['GET', 'POST'],
    credentials: false
  },
  pingTimeout: 25000,
  pingInterval: 20000,
  maxHttpBufferSize: 1e6 // SDP can be large-ish; 1MB is plenty, not a media channel
});

io.on('connection', (socket) => {
  debug('connect', socket.id);
  socket.data.rooms = new Set();

  /* ---------- helpers bound to this socket ---------- */

  function memberOf(code) {
    const room = rooms.get(code);
    return room ? room.members.get(socket.id) || null : null;
  }

  function toOthers(room, event, payload) {
    socket.to('room:' + room.code).emit(event, payload);
  }

  function broadcastCall(room) {
    io.to('room:' + room.code).emit('call:participants', callSnapshot(room));
  }

  function detach(code, reason) {
    const room = rooms.get(code);
    if (!room) return;
    const member = room.members.get(socket.id);
    if (!member) return;

    const wasInCall = member.inCall;

    // Emit BEFORE leaving the Socket.IO room and before deleting the member:
    // once socket.leave() has run, socket.to(...) no longer reaches anyone, so
    // the announcement would be silently lost.
    socket.to('room:' + code).emit('peer:leave', { socketId: socket.id, code, reason: reason || 'left' });
    if (wasInCall) {
      socket.to('room:' + code).emit('call:peer-left', {
        socketId: socket.id, code, user: member.user, reason: reason || 'left'
      });
    }

    room.members.delete(socket.id);
    socket.leave('room:' + code);
    socket.data.rooms.delete(code);

    if (wasInCall) {
      broadcastCall(room);
      log('call leave', code, socket.id, `(${callMembers(room).length} left)`);
    }

    if (room.members.size === 0) {
      rooms.delete(code);
      log('room closed', code);
    } else {
      touch(room);
    }
  }

  /* ============================================================
     1. ROOM JOIN / LEAVE
     ============================================================ */
  socket.on('room:join', (payload, ack) => {
    const done = typeof ack === 'function' ? ack : () => {};
    try {
      const code = normalizeCode(payload && payload.code);
      if (!validCode(code)) return done({ ok: false, error: 'bad-code', message: 'That is not a valid room code.' });

      const user = sanitizeUser(payload && payload.user);
      const mode = payload && payload.mode === 'call' ? 'call' : 'sync';

      if (socket.data.rooms.has(code)) {
        // Idempotent re-join (e.g. after a reconnect retry).
        const existing = memberOf(code);
        if (existing) {
          return done({
            ok: true,
            self: socket.id,
            code,
            peers: callMembers(rooms.get(code))
              .filter(m => m.socketId !== socket.id)
              .map(publicPeer),
            call: callSnapshot(rooms.get(code))
          });
        }
      }

      const room = getRoom(code, true);

      if (room.members.size >= MAX_ROOM_MEMBERS) {
        return done({
          ok: false,
          error: 'room-full',
          message: `This room already has ${MAX_ROOM_MEMBERS} people. Try again later.`
        });
      }

      const member = {
        socketId: socket.id,
        user,
        mode,
        inCall: false,
        mic: true,
        cam: true,
        sharing: false,
        joinedAt: Date.now()
      };
      room.members.set(socket.id, member);
      socket.join('room:' + code);
      socket.data.rooms.add(code);
      touch(room);

      // Tell the newcomer who is already here (only call participants are
      // interesting as peers — being on the page is not being on the call).
      const peers = callMembers(room)
        .filter(m => m.socketId !== socket.id)
        .map(publicPeer);

      // Tell everyone else someone arrived (for the room roster / call list).
      toOthers(room, 'peer:join', {
        socketId: socket.id,
        code,
        user,
        inCall: false
      });

      log('room join', code, user.name, `(${room.members.size} in room)`);
      done({ ok: true, self: socket.id, code, peers, call: callSnapshot(room) });
    } catch (err) {
      console.error('[signal] room:join failed', err);
      done({ ok: false, error: 'server-error', message: 'The signaling server could not join that room.' });
    }
  });

  socket.on('room:leave', (payload) => {
    const code = normalizeCode(payload && payload.code);
    if (code) detach(code, 'left');
  });

  /* ============================================================
     2. CALL LIFECYCLE
     ============================================================ */

  // Someone pressed "start call" — everyone else gets a prompt.
  socket.on('call:start', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) return;
    if (!allowed(member, 2)) return;

    member.inCall = true;
    touch(room);

    toOthers(room, 'call:started', {
      code,
      by: socket.id,
      user: member.user,
      participants: callSnapshot(room).participants
    });
    broadcastCall(room);
    log('call started', code, member.user.name);
  });

  // Joining an in-progress call: returns the peers to initiate toward.
  socket.on('call:join', (payload, ack) => {
    const done = typeof ack === 'function' ? ack : () => {};
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) {
      return done({ ok: false, error: 'not-in-room', message: 'Join the room first.' });
    }

    const others = callMembers(room).filter(m => m.socketId !== socket.id);
    if (!member.inCall && others.length + 1 > MAX_CALL_PEERS) {
      return done({
        ok: false,
        error: 'call-full',
        message: `This call already has ${MAX_CALL_PEERS} people (the mesh limit). Ask someone to leave, or build a SFU for bigger calls.`
      });
    }

    member.inCall = true;
    touch(room);
    broadcastCall(room);

    done({
      ok: true,
      self: socket.id,
      peers: others.map(publicPeer),
      call: callSnapshot(room)
    });
    log('call join', code, member.user.name, `(${callMembers(room).length}/${MAX_CALL_PEERS})`);
  });

  // Leaving the call but staying on the page.
  socket.on('call:leave', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member || !member.inCall) return;

    member.inCall = false;
    member.sharing = false;
    member.mic = true;
    member.cam = true;
    touch(room);

    toOthers(room, 'call:peer-left', { socketId: socket.id, code, user: member.user, reason: 'left-call' });
    broadcastCall(room);
    log('call leave', code, member.user.name);
  });

  // Host ends the call for everyone.
  socket.on('call:end', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) return;

    member.inCall = false;
    for (const m of room.members.values()) {
      m.inCall = false;
      m.sharing = false;
    }
    touch(room);

    // Includes the sender so every client runs the same teardown path.
    io.to('room:' + code).emit('call:ended', {
      code,
      by: socket.id,
      user: member.user
    });
    broadcastCall(room);
    log('call ended', code, 'by', member.user.name);
  });

  /* ============================================================
     3. MEDIA STATE (mic / cam / screen) — no renegotiation needed
     ============================================================ */
  socket.on('media:state', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) return;
    if (!allowed(member)) return;

    const st = (payload && payload.state) || {};
    if (typeof st.mic === 'boolean') member.mic = st.mic;
    if (typeof st.cam === 'boolean') member.cam = st.cam;
    if (typeof st.sharing === 'boolean') member.sharing = st.sharing;
    touch(room);

    toOthers(room, 'peer:media', {
      socketId: socket.id,
      code,
      mic: member.mic,
      cam: member.cam,
      sharing: member.sharing
    });
    if (member.inCall) broadcastCall(room);
  });

  /* ============================================================
     4. SCREEN SHARE SIGNALS
     ============================================================ */
  socket.on('screen:start', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) return;
    member.sharing = true;
    touch(room);
    toOthers(room, 'screen:started', { code, by: socket.id, user: member.user });
    if (member.inCall) broadcastCall(room);
  });

  socket.on('screen:stop', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) return;
    member.sharing = false;
    touch(room);
    toOthers(room, 'screen:stopped', { code, by: socket.id, user: member.user });
    if (member.inCall) broadcastCall(room);
  });

  /* ============================================================
     5. SIGNAL RELAY (offer / answer / ICE)
     ------------------------------------------------------------
     kind: 'cam'    -> the camera+mic peer connection for this pair
     kind: 'screen' -> the one-way screen connection sharer -> viewer
     ============================================================ */
  socket.on('signal', (payload) => {
    const code = normalizeCode(payload && payload.code);
    const room = rooms.get(code);
    const member = memberOf(code);
    if (!room || !member) return;
    if (!allowed(member)) {
      debug('rate limited', socket.id);
      return;
    }

    const to = payload && payload.to;
    const kind = payload && payload.kind === 'screen' ? 'screen' : 'cam';
    const data = payload && payload.data;
    if (!to || !data || typeof data !== 'object') return;
    if (!room.members.has(to)) {
      socket.emit('signal:error', { to, message: 'That peer already left.' });
      return;
    }
    // Only relay the two SDP/candidate shapes we expect.
    const type = data.type || (data.candidate ? 'candidate' : '');
    if (type !== 'offer' && type !== 'answer' && type !== 'candidate') return;

    io.to(to).emit('signal', { from: socket.id, code, kind, data });
    debug('relay', type, kind, socket.id, '->', to);
  });

  /* ============================================================
     6. MISC
     ============================================================ */
  socket.on('ping:server', (payload, ack) => {
    if (typeof ack === 'function') ack({ ok: true, at: Date.now(), service: 'powerverse-signaling', version: VERSION });
  });

  socket.on('disconnecting', () => {
    for (const code of [...socket.data.rooms]) detach(code, 'disconnected');
  });

  socket.on('disconnect', (reason) => {
    debug('disconnect', socket.id, reason);
    // `disconnecting` already cleaned the rooms; this is a belt-and-braces pass.
    for (const code of [...socket.data.rooms]) detach(code, reason);
  });

  socket.on('error', (err) => console.error('[signal] socket error', socket.id, err && err.message));
});

/* ---------------- idle room sweeper ---------------- */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.members.size === 0 && now - room.lastActivity > 60000) {
      rooms.delete(code);
      debug('swept empty room', code);
      continue;
    }
    if (now - room.lastActivity > IDLE_ROOM_MS && room.members.size === 0) {
      rooms.delete(code);
    }
  }
}, 60000).unref();

/* ---------------- graceful shutdown ---------------- */
function shutdown(signal) {
  log(`${signal} received, shutting down`);
  io.emit('server:restart', { message: 'Signaling server restarting — reconnecting.' });
  io.close(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}`);
  log(`CORS origin: ${CORS_ORIGIN}`);
  log(`mesh limit: ${MAX_CALL_PEERS} call participants per room`);
  log(`health: http://localhost:${PORT}/health`);
});

module.exports = { server, io, rooms };
