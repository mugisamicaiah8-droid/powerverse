/* ============================================================
   PowerVerse — WebRTC engine
   ------------------------------------------------------------
   Real peer-to-peer audio, video and screen sharing for sync
   rooms, on top of the signaling server in server/.

   Design notes
   ------------
   MESH, NOT SFU. Every participant holds one RTCPeerConnection
   per peer (for camera+mic) plus, while anyone shares a screen,
   one extra one-way connection per sharer. At the 6-person cap
   that is 5 outgoing + 5 incoming camera streams — past that a
   browser uplink gives up and you need an SFU (LiveKit,
   mediasoup, Daily). The cap is enforced by the server too.

   TWO CONNECTIONS PER PAIR, ON PURPOSE.
     kind 'cam'    -> mic + camera, bidirectional
     kind 'screen' -> screen video, one-way, sharer -> viewer

   Keeping them separate is what makes "stop sharing and share
   again" safe: tearing down the screen connection cannot disturb
   the audio path on the cam connection. Adding a screen track to
   the cam connection would force a renegotiation of the whole
   call every time someone clicked Share.

   GLARE. Both sides must agree who sends the offer. The rule is
   deterministic and identical on both ends: the peer with the
   LOWER socket id is the offerer. When we receive an offer we
   only ever answer. That removes the need for a perfect-
   negotiation dance without hand-rolling one badly.

   RECONNECT. socket.io reconnects on its own; on reconnect we
   re-join the room and rebuild every peer connection, because a
   new socket id invalidates the old mesh.

   RELATIVE PATHS. This file only handles transport and media.
   All rendering lives in call-ui.js; the player logic stays in
   sync-room.js and keeps running underneath, untouched.
   ============================================================ */
(function () {
  'use strict';

  var PV = window.PV = window.PV || {};
  var CFG = PV.config || {};

  var ICE = (CFG.ICE_SERVERS || [{ urls: 'stun:stun.l.google.com:19302' }]);
  var MAX_PEERS = CFG.MAX_PEERS || 6;

  /* ============================================================
     Small utilities
     ============================================================ */

  function stopTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (t) {
      try { t.stop(); } catch (e) {}
    });
  }

  // Turn a getUserMedia / getDisplayMedia rejection into something a human
  // can act on. The raw DOMException names are useless to users.
  function mediaError(err, kind) {
    var n = (err && err.name) || '';
    var cam = kind === 'screen' ? 'Screen sharing' : 'Camera or microphone';
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      return kind === 'screen'
        ? 'Screen sharing was blocked or cancelled. Pick a window to share when the browser asks.'
        : 'Camera and microphone permission was blocked. Allow it in your browser settings, then try again.';
    }
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') {
      return kind === 'screen'
        ? 'This device has nothing to share.'
        : 'No camera or microphone was found on this device.';
    }
    if (n === 'NotReadableError' || n === 'TrackStartError') {
      return cam + ' is already in use by another app. Close it and try again.';
    }
    if (n === 'OverconstrainedError') {
      return 'Your camera does not support the requested settings.';
    }
    if (n === 'NotSupportedError' || n === 'AbortError') {
      return kind === 'screen'
        ? 'Screen sharing needs a desktop browser (Chrome, Edge or Firefox on a computer).'
        : 'This browser does not support camera access.';
    }
    return (err && err.message) || (cam + ' is unavailable.');
  }

  /* ============================================================
     Engine
     ============================================================ */

  function createEngine() {
    var E = {
      // identity + transport
      code: null,
      me: null,              // {id, name, avatar}
      socket: null,
      socketId: null,
      status: 'idle',        // idle | connecting | online | offline | unsupported
      lastError: null,
      serverUrl: null,

      // media
      localStream: null,     // camera + mic
      screenStream: null,
      micOn: true,
      camOn: true,
      sharing: false,

      // peers
      peers: {},             // socketId -> peer record
      inCall: false,
      callStartedAt: null,

      // listeners
      listeners: {},
      destroyed: false
    };

    /* ---------------- events ---------------- */
    E.on = function (name, fn) {
      (E.listeners[name] = E.listeners[name] || []).push(fn);
      return function off() {
        E.listeners[name] = (E.listeners[name] || []).filter(function (f) { return f !== fn; });
      };
    };

    function emit(name, payload) {
      var fns = (E.listeners[name] || []).slice();
      fns.forEach(function (fn) {
        try { fn(payload); } catch (err) { console.error('[webrtc] listener "' + name + '" threw', err); }
      });
    }
    E._emit = emit;

    function setStatus(s, err) {
      E.status = s;
      E.lastError = err || null;
      emit('status', { status: s, error: E.lastError, url: E.serverUrl });
    }

    /* ============================================================
       Transport
       ============================================================ */

    E.connect = function (code, user) {
      E.code = String(code || '').toUpperCase();
      E.me = { id: user.id, name: user.name, avatar: user.avatar || '' };

      if (typeof window.io !== 'function') {
        setStatus('unsupported', 'The signaling client failed to load. Check your connection and reload.');
        return Promise.resolve({ ok: false, error: E.lastError });
      }

      if (E.socket && E.socket.connected) return Promise.resolve({ ok: true });

      var url = CFG.getSignalingUrl();
      var problem = CFG.urlProblem ? CFG.urlProblem(url) : null;
      if (problem) {
        setStatus('offline', problem);
        return Promise.resolve({ ok: false, error: problem });
      }

      E.serverUrl = url;
      setStatus('connecting');

      return new Promise(function (resolve) {
        var settled = false;
        function settle(res) {
          if (settled) return;
          settled = true;
          resolve(res);
        }

        // If the server is not there, socket.io retries forever by default.
        // We want a fast, honest failure so the UI can fall back.
        var timer = setTimeout(function () {
          if (!E.socket || !E.socket.connected) {
            var msg = 'Could not reach the signaling server at ' + E.serverUrl +
              '. Calls need it running — everything else still works.';
            setStatus('offline', msg);
            if (E.socket) { try { E.socket.close(); } catch (e) {} E.socket = null; }
            settle({ ok: false, error: msg });
          }
        }, 7000);

        try {
          E.socket = window.io(url, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 6,
            reconnectionDelay: 800,
            reconnectionDelayMax: 5000,
            timeout: 7000,
            withCredentials: false
          });
        } catch (err) {
          clearTimeout(timer);
          setStatus('offline', 'That signaling URL is not valid: ' + (err && err.message));
          return settle({ ok: false, error: E.lastError });
        }

        var s = E.socket;

        s.on('connect', function () {
          clearTimeout(timer);
          E.socketId = s.id;
          s.emit('room:join',
            { code: E.code, user: E.me, mode: 'sync' },
            function (res) {
              if (!res || !res.ok) {
                var msg = (res && res.message) || 'The signaling server refused that room.';
                setStatus('offline', msg);
                return settle({ ok: false, error: msg });
              }
              E.socketId = res.self || s.id;
              setStatus('online');
              if (E.callActive) {
                // We were on a call before the reconnect: re-enter it.
                joinCallOnServer();
              }
              settle({ ok: true });
            });
        });

        s.on('connect_error', function (err) {
          if (!settled) {
            // Let socket.io retry; only report if this was the final attempt.
            if (err && /xhr|websocket|transport|failed/i.test(err.message || '')) {
              debug('connect_error', err.message);
            }
          }
        });

        s.on('disconnect', function (reason) {
          E.socketId = null;
          if (E.destroyed) return;
          setStatus('offline', 'Lost the signaling server (' + reason + '). Reconnecting…');
          teardownAllPeers();
        });

        s.on('reconnect', function () {
          // Handled by the 'connect' handler above firing again.
        });

        s.on('server:restart', function () {
          setStatus('connecting', 'The signaling server is restarting — reconnecting…');
        });

        /* ---------- call lifecycle ---------- */
        s.on('call:started', function (p) {
          if (!p || p.by === E.socketId) return;
          if (E.inCall) return; // already in
          emit('call:incoming', { from: p.user, by: p.by, participants: p.participants || [] });
        });

        s.on('call:participants', function (p) {
          if (!p) return;
          E.maxPeers = p.maxPeers || MAX_PEERS;
          var ids = (p.participants || []).map(function (x) { return x.socketId; });
          // Anyone on the roster we do not have a connection to yet: offer.
          ids.forEach(function (id) {
            if (id === E.socketId) return;
            var peer = E.peers[id];
            if (peer && peer.pc) {
              // Refresh their media flags without renegotiating.
              var info = (p.participants || []).filter(function (x) { return x.socketId === id; })[0];
              if (info) {
                peer.mic = info.mic !== false;
                peer.cam = info.cam !== false;
                peer.sharing = !!info.sharing;
                emit('peer:update', peer);
              }
              return;
            }
            // The lower socket id offers; everyone else waits for the offer.
            if (E.inCall && shouldOffer(id)) ensurePeer(id, 'cam');
          });
          emit('roster', { participants: p.participants || [], maxPeers: E.maxPeers });
        });

        s.on('call:peer-left', function (p) {
          if (!p) return;
          removePeer(p.socketId, 'left the call');
        });

        s.on('call:ended', function (p) {
          // Includes our own call:end — everyone runs the same teardown.
          tearDownCallLocal({ by: p && p.user, remote: true });
        });

        s.on('peer:join', function (p) {
          if (!p || p.socketId === E.socketId) return;
          emit('roommate:join', p);
        });

        s.on('peer:leave', function (p) {
          if (!p) return;
          removePeer(p.socketId, 'left the room');
          emit('roommate:leave', p);
        });

        s.on('peer:media', function (p) {
          var peer = E.peers[p && p.socketId];
          if (!peer) return;
          peer.mic = p.mic !== false;
          peer.cam = p.cam !== false;
          peer.sharing = !!p.sharing;
          emit('peer:update', peer);
          if (peer.sharing) ensurePeer(p.socketId, 'screen');
          else dropPeerKind(p.socketId, 'screen');
        });

        s.on('signal', function (p) {
          if (!p) return;
          handleSignal(p.from, p.kind || 'cam', p.data);
        });

        s.on('signal:error', function (p) {
          debug('signal error', p && p.message);
        });

        /* ---------- screen share notices ---------- */
        s.on('screen:started', function (p) {
          if (!p || p.by === E.socketId) return;
          ensurePeer(p.by, 'screen');
          emit('screen:remote-start', { socketId: p.by, user: p.user });
        });
        s.on('screen:stopped', function (p) {
          if (!p || p.by === E.socketId) return;
          dropPeerKind(p.by, 'screen');
          emit('screen:remote-stop', { socketId: p.by, user: p.user });
        });
      });
    };

    function debug() {
      if (PV.config && PV.config.DEBUG) console.log.apply(console, ['[webrtc]'].concat([].slice.call(arguments)));
    }

    /* ============================================================
       Offerer election
       ------------------------------------------------------------
       Identical rule on both sides, no negotiation needed: the
       lexicographically lower socket id initiates.
       ============================================================ */
    function shouldOffer(peerId) {
      if (!E.socketId || !peerId) return false;
      return E.socketId < peerId;
    }

    /* ============================================================
       Peer records
       ------------------------------------------------------------
       peers[socketId] = {
         socketId, user, mic, cam, sharing,
         pc,        // cam connection
         screenPc,  // screen connection (only while sharing)
         remoteStream,
         remoteScreenStream,
         pendingIce: { cam: [], screen: [] }
       }
       ============================================================ */

    function ensurePeer(peerId, kind) {
      if (!peerId || peerId === E.socketId) return null;
      var peer = E.peers[peerId];
      if (!peer) {
        peer = E.peers[peerId] = {
          socketId: peerId, user: null,
          mic: true, cam: true, sharing: false,
          pc: null, screenPc: null,
          remoteStream: null, remoteScreenStream: null,
          pendingIce: { cam: [], screen: [] },
          connState: 'new'
        };
        emit('peer:add', peer);
      }
      if (kind === 'screen') {
        if (!peer.screenPc) createScreenConnection(peer);
      } else {
        if (!peer.pc) createCamConnection(peer);
      }
      return peer;
    }

    function peerUser(peerId) {
      var p = E.peers[peerId];
      return (p && p.user) || { id: peerId, name: 'Guest', avatar: '' };
    }

    /* ---------------- cam connection (mic + video, bidirectional) ---------------- */
    function createCamConnection(peer) {
      var pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: 'max-bundle' });
      peer.pc = pc;

      if (E.localStream) {
        E.localStream.getTracks().forEach(function (track) {
          try { pc.addTrack(track, E.localStream); } catch (e) {}
        });
      } else {
        // No local media yet (permission denied, or audio-only). Still add a
        // transceiver so the SDP has a media section to negotiate into —
        // otherwise a later renegotiation to enable the camera fails.
        try {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
          pc.addTransceiver('video', { direction: 'sendrecv' });
        } catch (e) {}
      }

      pc.onicecandidate = function (e) {
        if (e.candidate) {
          signal(peer.socketId, 'cam', { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
        }
      };

      pc.ontrack = function (e) {
        var stream = e.streams && e.streams[0];
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(e.track);
        }
        peer.remoteStream = stream;
        emit('peer:stream', { peer: peer, stream: stream, kind: 'cam' });
      };

      pc.onconnectionstatechange = function () {
        peer.connState = pc.connectionState;
        emit('peer:update', peer);
        if (pc.connectionState === 'failed') {
          // One free recovery attempt, then surface it honestly.
          try { pc.restartIce(); } catch (e) {}
          setTimeout(function () {
            if (peer.pc && peer.pc.connectionState === 'failed' && shouldOffer(peer.socketId)) {
              makeOffer(peer, 'cam', true);
            }
          }, 1500);
        }
      };

      // If we are the designated offerer, kick off negotiation now.
      if (shouldOffer(peer.socketId)) makeOffer(peer, 'cam');
      return pc;
    }

    /* ---------------- screen connection (one-way, sharer -> viewer) ---------------- */
    function createScreenConnection(peer) {
      // Only the sharer needs to create the sending side; the viewer waits
      // for the offer. Creating the pc early on both ends is harmless and
      // means a late screen:started notice still lands on a live object.
      if (peer.screenPc) return peer.screenPc;

      var pc = new RTCPeerConnection({ iceServers: ICE });
      peer.screenPc = pc;

      if (E.screenStream) {
        E.screenStream.getVideoTracks().forEach(function (track) {
          try { pc.addTrack(track, E.screenStream); } catch (e) {}
        });
      }

      pc.onicecandidate = function (e) {
        if (e.candidate) {
          signal(peer.socketId, 'screen', { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
        }
      };

      pc.ontrack = function (e) {
        var stream = e.streams && e.streams[0];
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(e.track);
        }
        peer.remoteScreenStream = stream;
        // Viewers must be able to stop watching independently of the sharer.
        e.track.addEventListener('ended', function () {
          peer.remoteScreenStream = null;
          emit('screen:remote-stop', { socketId: peer.socketId, user: peerUser(peer.socketId) });
        });
        emit('peer:stream', { peer: peer, stream: stream, kind: 'screen' });
      };

      pc.onconnectionstatechange = function () {
        emit('peer:update', peer);
      };

      // The sharer is the only one with something to send, so only the
      // sharer negotiates. Viewers just answer.
      if (E.sharing && shouldOffer(peer.socketId)) makeOffer(peer, 'screen');
      return pc;
    }

    /* ---------------- SDP plumbing ---------------- */
    function pcFor(peer, kind) {
      return kind === 'screen' ? peer.screenPc : peer.pc;
    }

    function signal(to, kind, data) {
      if (!E.socket || !E.socket.connected) return;
      E.socket.emit('signal', { code: E.code, to: to, kind: kind, data: data });
    }

    function makeOffer(peer, kind, isRestart) {
      var pc = pcFor(peer, kind);
      if (!pc) return;
      if (pc.__making) return;
      pc.__making = true;

      pc.createOffer({ iceRestart: !!isRestart })
        .then(function (offer) {
          return pc.setLocalDescription(offer);
        })
        .then(function () {
          signal(peer.socketId, kind, {
            type: pc.localDescription.type,
            sdp: pc.localDescription.sdp
          });
        })
        .catch(function (err) {
          console.warn('[webrtc] offer failed', kind, err && err.message);
        })
        .then(function () { pc.__making = false; });
    }

    function handleSignal(from, kind, data) {
      if (!from || !data) return;
      var peer = E.peers[from] || ensurePeer(from, kind);
      if (!peer) return;
      var pc = pcFor(peer, kind);
      if (!pc) {
        peer = ensurePeer(from, kind);
        pc = pcFor(peer, kind);
        if (!pc) return;
      }

      if (data.type === 'offer') {
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: data.sdp }))
          .then(function () { return flushIce(peer, kind); })
          .then(function () { return pc.createAnswer(); })
          .then(function (answer) { return pc.setLocalDescription(answer); })
          .then(function () {
            signal(from, kind, {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp
            });
          })
          .catch(function (err) {
            console.warn('[webrtc] answer failed', kind, err && err.message);
          });
        return;
      }

      if (data.type === 'answer') {
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }))
          .then(function () { return flushIce(peer, kind); })
          .catch(function (err) {
            console.warn('[webrtc] setRemote(answer) failed', err && err.message);
          });
        return;
      }

      if (data.candidate) {
        var cand = new RTCIceCandidate(data.candidate);
        // Candidates can arrive before the remote description exists.
        if (!pc.remoteDescription || !pc.remoteDescription.type) {
          peer.pendingIce[kind].push(cand);
          return;
        }
        pc.addIceCandidate(cand).catch(function (err) {
          debug('addIceCandidate failed', err && err.message);
        });
      }
    }

    function flushIce(peer, kind) {
      var pc = pcFor(peer, kind);
      var queued = peer.pendingIce[kind] || [];
      peer.pendingIce[kind] = [];
      return queued.reduce(function (chain, cand) {
        return chain.then(function () {
          return pc.addIceCandidate(cand).catch(function () {});
        });
      }, Promise.resolve());
    }

    /* ---------------- peer teardown ---------------- */
    function dropPeerKind(peerId, kind) {
      var peer = E.peers[peerId];
      if (!peer) return;
      if (kind === 'screen') {
        if (peer.screenPc) {
          try { peer.screenPc.close(); } catch (e) {}
          peer.screenPc = null;
        }
        peer.remoteScreenStream = null;
        peer.pendingIce.screen = [];
      } else {
        if (peer.pc) {
          try { peer.pc.close(); } catch (e) {}
          peer.pc = null;
        }
        peer.remoteStream = null;
        peer.pendingIce.cam = [];
      }
      emit('peer:update', peer);
    }

    function removePeer(peerId, reason) {
      var peer = E.peers[peerId];
      if (!peer) return;
      dropPeerKind(peerId, 'cam');
      dropPeerKind(peerId, 'screen');
      delete E.peers[peerId];
      emit('peer:remove', { socketId: peerId, reason: reason, user: peer.user });
    }

    function teardownAllPeers() {
      Object.keys(E.peers).forEach(function (id) { removePeer(id, 'disconnected'); });
      E.peers = {};
    }

    /* ============================================================
       Public call API
       ============================================================ */

    E.callActive = false;

    function getLocalMedia() {
      if (E.localStream) return Promise.resolve(E.localStream);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser cannot access the camera. Use a modern browser on an https page.'));
      }
      // Request both, but degrade to audio-only rather than failing outright
      // on a device with no usable camera.
      return navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }
        })
        .catch(function (err) {
          if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError' || err.name === 'NotReadableError')) {
            return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (s) {
              E.camOn = false;
              return s;
            });
          }
          throw err;
        })
        .then(function (stream) {
          E.localStream = stream;
          E.hasVideo = stream.getVideoTracks().length > 0;
          emit('local:stream', stream);
          return stream;
        })
        .catch(function (err) {
          throw new Error(mediaError(err, 'cam'));
        });
    }

    // Attach (or re-attach) our local tracks to every existing cam connection.
    function pushLocalTracks() {
      Object.keys(E.peers).forEach(function (id) {
        var peer = E.peers[id];
        if (!peer.pc || !E.localStream) return;
        var senders = peer.pc.getSenders();
        E.localStream.getTracks().forEach(function (track) {
          var existing = senders.filter(function (s) { return s.track && s.track.kind === track.kind; })[0];
          if (existing) {
            existing.replaceTrack(track).catch(function () {});
          } else {
            var tr = peer.pc.getTransceivers().filter(function (t) {
              return t.receiver && t.receiver.track && t.receiver.track.kind === track.kind &&
                t.direction !== 'recvonly' && !t.sender.track;
            })[0];
            if (tr && tr.sender) tr.sender.replaceTrack(track).catch(function () {});
            else {
              try { peer.pc.addTrack(track, E.localStream); } catch (e) {}
            }
          }
        });
        // A new kind of track needs a new offer.
        if (shouldOffer(peer.socketId)) makeOffer(peer, 'cam');
      });
    }

    function joinCallOnServer() {
      if (!E.socket || !E.socket.connected) {
        return { ok: false, error: 'Not connected to the signaling server.' };
      }
      E.socket.emit('call:start', { code: E.code });
      E.socket.emit('call:join', { code: E.code }, function (res) {
        if (!res || !res.ok) {
          var msg = (res && res.message) || 'Could not join the call.';
          emit('call:error', { error: msg });
          return;
        }
        E.inCall = true;
        // Everyone already on the call: the lower id offers.
        (res.peers || []).forEach(function (p) {
          var peer = ensurePeer(p.socketId);
          if (peer) {
            peer.user = p.user;
            peer.mic = p.mic !== false;
            peer.cam = p.cam !== false;
            peer.sharing = !!p.sharing;
            if (p.sharing) ensurePeer(p.socketId, 'screen');
            emit('peer:update', peer);
          }
        });
        emit('call:joined', { peers: res.peers || [], call: res.call });
      });
      return { ok: true };
    }

    /**
     * Start (or join) the room call.
     * Resolves once the local camera/mic is live and the server knows we
     * are on the call. Rejects with a helpful message if there is no
     * server or no camera.
     */
    E.startCall = function () {
      if (E.inCall) return Promise.resolve({ ok: true, already: true });

      if (E.status !== 'online') {
        return Promise.reject(new Error(
          E.lastError || 'Calls need the signaling server. Start it (see server/README.md) or set its URL in Settings.'
        ));
      }

      E.connectingCall = true;
      return getLocalMedia()
        .then(function (stream) {
          E.callActive = true;
          E.callStartedAt = Date.now();
          E.micOn = true;
          if (!E.hasVideo) E.camOn = false;
          joinCallOnServer();
          return sendMediaState();
        })
        .then(function () {
          E.connectingCall = false;
          return { ok: true, stream: E.localStream };
        })
        .catch(function (err) {
          E.connectingCall = false;
          E.callActive = false;
          stopTracks(E.localStream);
          E.localStream = null;
          throw err;
        });
    };

    /** Answer an incoming call. */
    E.answerCall = function () {
      return E.startCall();
    };

    /** Decline / ignore an incoming call (no server notification needed). */
    E.declineCall = function () {
      emit('call:declined', {});
    };

    function sendMediaState() {
      if (!E.socket || !E.socket.connected) return Promise.resolve();
      E.socket.emit('media:state', {
        code: E.code,
        state: { mic: E.micOn, cam: E.camOn, sharing: E.sharing }
      });
      return Promise.resolve();
    }

    /** Leave the call, close every peer connection, stop local tracks. */
    E.leaveCall = function (opts) {
      var notify = !opts || opts.notify !== false;
      tearDownCallLocal({ by: null, remote: false, notify: notify });
    };

    function tearDownCallLocal(info) {
      var wasActive = E.inCall || !!E.localStream || Object.keys(E.peers).length > 0;

      if ((!info || info.notify !== false) && E.socket && E.socket.connected && E.inCall) {
        E.socket.emit('call:leave', { code: E.code });
      }

      teardownAllPeers();
      stopTracks(E.screenStream);
      E.screenStream = null;
      E.sharing = false;
      stopTracks(E.localStream);
      E.localStream = null;
      E.hasVideo = false;
      E.inCall = false;
      E.callActive = false;
      E.callStartedAt = null;
      E.micOn = true;
      E.camOn = true;

      if (wasActive) emit('call:left', info || {});
    }

    /** End the call for the whole room (host action). */
    E.endCallForAll = function () {
      if (E.socket && E.socket.connected) {
        E.socket.emit('call:end', { code: E.code });
      }
      tearDownCallLocal({ notify: false });
    };

    /* ---------------- mute / camera ---------------- */
    E.toggleMic = function () {
      E.micOn = !E.micOn;
      if (E.localStream) {
        E.localStream.getAudioTracks().forEach(function (t) { t.enabled = E.micOn; });
      }
      sendMediaState();
      emit('local:media', { micOn: E.micOn, camOn: E.camOn, sharing: E.sharing });
      return E.micOn;
    };

    E.setMic = function (on) {
      if (E.micOn === !!on) return E.micOn;
      return E.toggleMic();
    };

    E.toggleCam = function () {
      if (!E.localStream || !E.localStream.getVideoTracks().length) {
        // No camera track yet: try to acquire one and swap it in live.
        return enableCameraAfterTheFact();
      }
      E.camOn = !E.camOn;
      E.localStream.getVideoTracks().forEach(function (t) { t.enabled = E.camOn; });
      sendMediaState();
      emit('local:media', { micOn: E.micOn, camOn: E.camOn, sharing: E.sharing });
      return E.camOn;
    };

    function enableCameraAfterTheFact() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser cannot access the camera.'));
      }
      return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } })
        .then(function (camStream) {
          var track = camStream.getVideoTracks()[0];
          if (!track) throw new Error('No camera track was returned.');
          if (!E.localStream) E.localStream = new MediaStream();
          E.localStream.addTrack(track);
          E.hasVideo = true;
          E.camOn = true;
          pushLocalTracks();
          emit('local:stream', E.localStream);
          sendMediaState();
          emit('local:media', { micOn: E.micOn, camOn: E.camOn, sharing: E.sharing });
          return true;
        })
        .catch(function (err) { throw new Error(mediaError(err, 'cam')); });
    }

    /* ---------------- screen share ---------------- */
    E.startScreenShare = function () {
      if (E.sharing && E.screenStream) return Promise.resolve(E.screenStream);

      if (!E.inCall) {
        return Promise.reject(new Error('Start the call first — screen sharing rides along with it.'));
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        return Promise.reject(new Error('Screen sharing is not supported in this browser. Try desktop Chrome, Edge or Firefox.'));
      }

      return navigator.mediaDevices
        .getDisplayMedia({ video: { frameRate: { ideal: 12, max: 20 } }, audio: false })
        .then(function (stream) {
          // Replacing a share: drop the old stream only after the new one
          // exists, so a cancelled picker leaves the previous share intact.
          if (E.screenStream) stopTracks(E.screenStream);
          E.screenStream = stream;
          E.sharing = true;

          var track = stream.getVideoTracks()[0];
          if (track) {
            // The browser's own "Stop sharing" bar ends the track; mirror that.
            track.addEventListener('ended', function () {
              if (E.sharing) E.stopScreenShare();
            });
          }

          // Every call peer gets a dedicated screen connection. The cam
          // connection is never touched, so audio keeps flowing.
          Object.keys(E.peers).forEach(function (id) {
            var peer = E.peers[id];
            if (peer.screenPc) {
              try { peer.screenPc.close(); } catch (e) {}
              peer.screenPc = null;
            }
            createScreenConnection(peer);
          });

          if (E.socket && E.socket.connected) {
            E.socket.emit('screen:start', { code: E.code });
          }
          sendMediaState();
          emit('local:screen', { stream: stream, sharing: true });
          return stream;
        })
        .catch(function (err) {
          throw new Error(mediaError(err, 'screen'));
        });
    };

    E.stopScreenShare = function () {
      if (!E.sharing && !E.screenStream) return;
      stopTracks(E.screenStream);
      E.screenStream = null;
      E.sharing = false;

      Object.keys(E.peers).forEach(function (id) {
        var peer = E.peers[id];
        if (peer.screenPc) {
          try { peer.screenPc.close(); } catch (e) {}
          peer.screenPc = null;
        }
        peer.pendingIce.screen = [];
      });

      if (E.socket && E.socket.connected) {
        E.socket.emit('screen:stop', { code: E.code });
      }
      sendMediaState();
      emit('local:screen', { stream: null, sharing: false });
    };

    E.toggleScreenShare = function () {
      return E.sharing ? Promise.resolve(E.stopScreenShare()) : E.startScreenShare();
    };

    /* ---------------- diagnostics ---------------- */
    E.getParticipants = function () {
      var list = Object.keys(E.peers).map(function (id) {
        var p = E.peers[id];
        return {
          socketId: id,
          user: p.user || { name: 'Guest', avatar: '' },
          mic: p.mic, cam: p.cam, sharing: p.sharing,
          connection: p.connState || (p.pc && p.pc.connectionState) || 'new'
        };
      });
      list.unshift({
        socketId: E.socketId,
        user: E.me,
        mic: E.micOn, cam: E.camOn, sharing: E.sharing,
        connection: 'self',
        self: true
      });
      return list;
    };

    E.participantCount = function () {
      return (E.inCall ? 1 : 0) + Object.keys(E.peers).length;
    };

    E.isConnected = function () { return E.status === 'online'; };

    /** Full teardown — call this when leaving the sync page. */
    E.destroy = function () {
      E.destroyed = true;
      if (E.socket) {
        try {
          if (E.inCall) E.socket.emit('call:leave', { code: E.code });
          E.socket.emit('room:leave', { code: E.code });
        } catch (e) {}
      }
      teardownAllPeers();
      stopTracks(E.screenStream);
      E.screenStream = null;
      stopTracks(E.localStream);
      E.localStream = null;
      E.inCall = false;
      E.callActive = false;
      E.sharing = false;
      if (E.socket) {
        try { E.socket.close(); } catch (e) {}
        E.socket = null;
      }
      E.listeners = {};
      setStatus('idle');
    };

    /* ---------------- global guards ---------------- */
    window.addEventListener('beforeunload', function () {
      if (E.socket && E.inCall) {
        try { E.socket.emit('call:leave', { code: E.code }); } catch (e) {}
      }
    });

    // Mobile browsers suspend the page; re-check the mesh when we come back.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (E.status === 'online' && E.inCall && E.socket && !E.socket.connected) {
        E.socket.connect();
      }
    });

    return E;
  }

  /* ---------------- module export ---------------- */
  PV.webrtc = {
    create: createEngine,
    mediaError: mediaError,
    isSupported: function () {
      return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },
    canShareScreen: function () {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    }
  };
})();
