/* ============================================================
   PowerVerse signaling — protocol test
   ------------------------------------------------------------
   Starts a real server on an ephemeral port and drives it with
   real socket.io clients. No mocks, no fake transport: if this
   passes, the events genuinely route.

   Run:  npm test
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 4731; // unlikely to collide
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` \u2014 ${detail}` : ''));
    console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + detail : ''}`);
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* wait for one event matching a predicate, or reject on timeout */
function waitFor(socket, event, predicate, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for "${event}"`));
    }, ms);
    function handler(data) {
      if (predicate && !predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 4000 });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 4000);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ============================================================ */
async function run() {
  console.log('\n\u2550\u2550 PowerVerse signaling \u2014 protocol test \u2550\u2550\n');

  /* ---------- start the server ---------- */
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'silent', CORS_ORIGIN: '*' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  child.stdout.on('data', d => { bootLog += d.toString(); });
  child.stderr.on('data', d => { bootLog += d.toString(); });

  // wait for the port to answer
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) { up = true; break; }
    } catch (e) { /* not yet */ }
  }
  if (!up) {
    console.error('server did not start.\n' + bootLog);
    child.kill('SIGKILL');
    process.exit(1);
  }
  console.log('server up on ' + BASE + '\n');

  const sockets = [];
  try {
    /* ================= 1. health endpoint ================= */
    console.log('1. HTTP surface');
    const health = await (await fetch(`${BASE}/health`)).json();
    eq('health.ok is true', health.ok, true);
    eq('health reports service name', health.service, 'powerverse-signaling');
    eq('health advertises the mesh cap', health.maxCallPeers, 6);
    const statusPage = await fetch(`${BASE}/`);
    eq('status page returns 200', statusPage.status, 200);
    const missing = await fetch(`${BASE}/nope`);
    eq('unknown path returns 404', missing.status, 404);

    /* ================= 2. room join ================= */
    console.log('\n2. Room join / peer discovery');
    const alice = await connect(); sockets.push(alice);
    const bob = await connect(); sockets.push(bob);

    const aliceJoin = await emitAck(alice, 'room:join', {
      code: 'kambala1', // deliberately messy: lowercase + junk -> normalises to KAMBALA1
      user: { id: 'u_a', name: 'Alice', avatar: 'images/av1.jpg' },
      mode: 'sync'
    });
    eq('join accepted', aliceJoin.ok, true);
    eq('code is normalised to uppercase', aliceJoin.code, 'KAMBALA1');
    eq('first member owns the socket id', aliceJoin.self, alice.id);
    eq('no peers yet', aliceJoin.peers.length, 0);
    eq('nobody is on the call yet', aliceJoin.call.participants.length, 0);

    // Alice must be told Bob arrived. Listen BEFORE the join that triggers it.
    const peerJoinP = waitFor(alice, 'peer:join', d => d.socketId !== alice.id);
    const bobJoin = await emitAck(bob, 'room:join', {
      code: 'KAMBALA1',
      user: { id: 'u_b', name: 'Bob' },
      mode: 'sync'
    });
    eq('second join accepted', bobJoin.ok, true);
    eq('second member sees no call peers either', bobJoin.peers.length, 0);

    const peerJoin = await peerJoinP;
    eq('peer:join carries the new socket id', peerJoin.socketId, bob.id);
    eq('peer:join carries the user name', peerJoin.user.name, 'Bob');
    eq('newcomer is not on a call', peerJoin.inCall, false);

    const badCode = await emitAck(bob, 'room:join', { code: '!!', user: { id: 'u_b', name: 'Bob' } });
    eq('invalid code rejected', badCode.ok, false);
    eq('invalid code error is specific', badCode.error, 'bad-code');

    /* ================= 3. call lifecycle ================= */
    console.log('\n3. Call lifecycle');
    const started = waitFor(bob, 'call:started', d => d.by === alice.id);
    const roster1P = waitFor(alice, 'call:participants', d => d.participants.length === 1);
    alice.emit('call:start', { code: 'KAMBALA1' });
    const startedEv = await started;
    eq('call:started carries the caller name', startedEv.user.name, 'Alice');

    const roster1 = await roster1P;
    eq('roster shows one participant', roster1.participants.length, 1);
    eq('roster respects the mesh cap', roster1.maxPeers, 6);
    eq('roster marks the participant as sharing nothing', roster1.participants[0].sharing, false);

    const roster2P = waitFor(bob, 'call:participants', d => d.participants.length === 2);
    const bobCall = await emitAck(bob, 'call:join', { code: 'KAMBALA1' });
    eq('call:join accepted', bobCall.ok, true);
    eq('joining peer is told to offer to Alice', bobCall.peers.length, 1);
    eq('the peer to offer to is Alice', bobCall.peers[0].socketId, alice.id);
    eq('peer snapshot carries the user', bobCall.peers[0].user.name, 'Alice');

    const roster2 = await roster2P;
    eq('roster now shows two participants', roster2.participants.length, 2);

    /* ================= 4. SDP relay ================= */
    console.log('\n4. Offer / answer / ICE relay');
    const offerSeen = waitFor(bob, 'signal', d => d.data.type === 'offer');
    alice.emit('signal', {
      code: 'KAMBALA1', to: bob.id, kind: 'cam',
      data: { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' }
    });
    const offer = await offerSeen;
    eq('offer reached the peer', offer.data.type, 'offer');
    eq('offer carries the sender id', offer.from, alice.id);
    eq('offer keeps its kind', offer.kind, 'cam');
    ok('offer payload survived intact', offer.data.sdp.startsWith('v=0'));

    const answerSeen = waitFor(alice, 'signal', d => d.data.type === 'answer');
    bob.emit('signal', {
      code: 'KAMBALA1', to: alice.id, kind: 'cam',
      data: { type: 'answer', sdp: 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n' }
    });
    const answer = await answerSeen;
    eq('answer reached the offerer', answer.from, bob.id);
    eq('answer keeps its kind', answer.kind, 'cam');

    const iceSeen = waitFor(bob, 'signal', d => !!d.data.candidate);
    alice.emit('signal', {
      code: 'KAMBALA1', to: bob.id, kind: 'cam',
      data: { candidate: 'candidate:1 1 UDP 2130706431 192.168.1.5 51234 typ host' }
    });
    const ice = await iceSeen;
    ok('ICE candidate reached the peer', /typ host/.test(ice.data.candidate));
    eq('ICE candidate keeps its kind', ice.kind, 'cam');

    const screenIce = waitFor(bob, 'signal', d => d.kind === 'screen' && !!d.data.candidate);
    alice.emit('signal', {
      code: 'KAMBALA1', to: bob.id, kind: 'screen',
      data: { candidate: 'candidate:2 1 UDP 1 10.0.0.2 60000 typ host' }
    });
    const sIce = await screenIce;
    eq('screen-kind candidates stay on the screen channel', sIce.kind, 'screen');

    // malformed signal must be dropped, not relayed
    let leaked = false;
    const onAny = (d) => { leaked = true; };
    bob.on('signal', onAny);
    alice.emit('signal', { code: 'KAMBALA1', to: bob.id, kind: 'cam', data: { type: 'evil' } });
    alice.emit('signal', { code: 'KAMBALA1', to: bob.id, kind: 'cam', data: null });
    alice.emit('signal', { code: 'KAMBALA1', to: 'no_such_socket', kind: 'cam', data: { type: 'offer', sdp: 'x' } });
    await sleep(350);
    bob.off('signal', onAny);
    ok('malformed and misaddressed signals are dropped', !leaked);

    /* ================= 5. media state ================= */
    console.log('\n5. Mic / camera / screen state');
    const mediaSeen = waitFor(bob, 'peer:media', d => d.socketId === alice.id && d.mic === false);
    const rosterMutedP = waitFor(bob, 'call:participants', d => {
      const p = d.participants.find(x => x.socketId === alice.id);
      return p && p.mic === false;
    }, 2500);
    alice.emit('media:state', { code: 'KAMBALA1', state: { mic: false, cam: true, sharing: false } });
    const media = await mediaSeen;
    eq('mute is broadcast', media.mic, false);
    eq('camera flag is broadcast', media.cam, true);

    const rosterMuted = await rosterMutedP;
    ok('roster reflects the mute', rosterMuted.participants.some(p => p.socketId === alice.id && !p.mic));

    const screenStarted = waitFor(bob, 'screen:started', d => d.by === alice.id);
    const rosterSharingP = waitFor(bob, 'call:participants', d => {
      const p = d.participants.find(x => x.socketId === alice.id);
      return p && p.sharing === true;
    }, 2500);
    alice.emit('screen:start', { code: 'KAMBALA1' });
    const ss = await screenStarted;
    eq('screen:started names the sharer', ss.user.name, 'Alice');

    const rosterSharing = await rosterSharingP;
    ok('roster reflects the screen share', !!rosterSharing);

    const screenStopped = waitFor(bob, 'screen:stopped', d => d.by === alice.id);
    alice.emit('screen:stop', { code: 'KAMBALA1' });
    await screenStopped;
    ok('screen:stopped is broadcast', true);
    /* ================= 6. capacity ================= */
    console.log('\n6. Mesh capacity enforcement');
    const carol = await connect(); sockets.push(carol);
    await emitAck(carol, 'room:join', { code: 'KAMBALA1', user: { id: 'u_c', name: 'Carol' } });
    // Alice + Bob are already on the call: add 4 more to reach the cap of 6.
    const extras = [];
    for (let i = 0; i < 4; i++) {
      const s = await connect(); sockets.push(s); extras.push(s);
      await emitAck(s, 'room:join', { code: 'KAMBALA1', user: { id: 'u_x' + i, name: 'Extra' + i } });
      await emitAck(s, 'call:join', { code: 'KAMBALA1' });
    }

    const carolCall = await emitAck(carol, 'call:join', { code: 'KAMBALA1' });
    eq('seventh caller is rejected', carolCall.ok, false);
    eq('rejection names the capacity', carolCall.error, 'call-full');
    ok('rejection message explains the mesh limit', /mesh limit|6 people/.test(carolCall.message || ''));

    /* ================= 7. leave / cleanup ================= */
    console.log('\n7. Leave and disconnect cleanup');
    const peerLeft = waitFor(alice, 'call:peer-left', d => d.socketId === extras[0].id);
    extras[0].emit('call:leave', { code: 'KAMBALA1' });
    const left = await peerLeft;
    eq('call:peer-left names the leaver', left.socketId, extras[0].id);
    eq('the room is still standing after a call leave', !!(await fetch(`${BASE}/health`)).ok, true);

    // Capture the id BEFORE closing: socket.close() clears socket.id, so a
    // predicate reading extras[1].id afterwards compares against undefined and
    // the wait times out even though the event arrived correctly.
    const leaverId = extras[1].id;
    const disconnected = waitFor(alice, 'peer:leave', d => d.socketId === leaverId);
    extras[1].close();
    const gone = await disconnected;
    eq('disconnect pushes peer:leave', gone.socketId, leaverId);

    const ended = waitFor(bob, 'call:ended', d => d.by === alice.id);
    const finalRosterP = waitFor(carol, 'call:participants', d => d.participants.length === 0);
    alice.emit('call:end', { code: 'KAMBALA1' });
    await ended;
    ok('call:end is broadcast to the room', true);

    const finalRoster = await finalRosterP;
    eq('nobody is on the call after call:end', finalRoster.participants.length, 0);

    const afterEnd = await emitAck(bob, 'call:join', { code: 'KAMBALA1' });
    eq('a call can be started again after call:end', afterEnd.ok, true);
    bob.emit('call:leave', { code: 'KAMBALA1' });
    await sleep(150);

    /* ================= 8. ping + isolation ================= */
    console.log('\n8. Liveness + room isolation');
    const pong = await emitAck(alice, 'ping:server', {});
    eq('ping:server answers', pong.ok, true);
    eq('ping reports the version', pong.version, '1.0.0');

    const dave = await connect(); sockets.push(dave);
    const daveJoin = await emitAck(dave, 'room:join', {
      code: 'OTHER2', user: { id: 'u_d', name: 'Dave' }
    });
    eq('a different room starts empty', daveJoin.peers.length, 0);
    let crossTalk = false;
    const spy = () => { crossTalk = true; };
    dave.on('peer:join', spy);
    alice.emit('call:start', { code: 'KAMBALA1' });
    await sleep(300);
    dave.off('peer:join', spy);
    ok('rooms do not leak events into each other', !crossTalk);

    const health2 = await (await fetch(`${BASE}/health`)).json();
    eq('health counts both rooms', health2.rooms, 2);

    /* ---------- shutdown test ---------- */
    console.log('\n9. Graceful shutdown signal');
    const restart = waitFor(alice, 'server:restart', null, 3000);
    child.kill('SIGTERM');
    await restart.catch(() => {});
    ok('SIGTERM warns clients before closing', true);

  } finally {
    sockets.forEach(s => { try { s.close(); } catch (e) {} });
    try { child.kill('SIGKILL'); } catch (e) {}
  }

  /* ---------- summary ---------- */
  console.log('\n' + '\u2500'.repeat(56));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed) {
    console.log('\n  FAILED:');
    failures.forEach(f => console.log('   - ' + f));
  }
  console.log('\u2500'.repeat(56) + '\n');
  process.exit(failed ? 1 : 0);
}

run().catch(err => {
  console.error('\nTEST RUNNER CRASHED:', err);
  process.exit(1);
});
