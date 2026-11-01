/* ============================================================
   PowerVerse — call UI
   ------------------------------------------------------------
   Owns everything the user sees and touches for a call:
     · the floating call window (top-right)
     · the floating screen-share window (top-left)
     · the participant-count badge
     · the incoming-call banner
     · mute / camera / screen / leave controls
     · the "no server configured" fallback messaging

   All transport lives in js/webrtc.js. This file never speaks
   socket.io and never holds an RTCPeerConnection.

   The two windows are deliberately small and float ABOVE the
   player, so the synchronised music or video keeps running
   underneath while people talk over it.
   ============================================================ */
(function () {
  'use strict';

  var PV = window.PV = window.PV || {};

  function ready() {
    return PV.ui && PV.webrtc && PV.config;
  }

  /* ============================================================
     Mount a call session for one sync room
     ------------------------------------------------------------
     opts = { code, label, onEnded }
     ============================================================ */
  function mount(opts) {
    if (!ready()) {
      console.error('[call-ui] loaded before its dependencies');
      return null;
    }

    var S = PV.store, U = PV.ui, CFG = PV.config;

    var me = S.currentUser();
    if (!me) return null;

    var engine = PV.webrtc.create();
    var code = String(opts.code || '').toUpperCase();
    var label = opts.label || 'Room call';

    var dom = {
      callWin: null,
      callBody: null,
      screenWin: null,
      screenBody: null,
      tiles: {},
      screenVideos: {}
    };

    var state = {
      callOpen: false,
      screenOpen: false,
      incoming: null,
      badgeEl: null,
      unread: 0,
      renderSig: null,
      screenSig: null
    };

    /* ============================================================
       Icons (reuse PV.ui.icon so the set stays consistent)
       ============================================================ */
    function ic(name) { return U.icon(name); }

    /* ============================================================
       Small helpers
       ============================================================ */
    function el(id) { return document.getElementById(id); }

    function initials(name) {
      return U.initials(name || '?');
    }

    function connLabel(peer) {
      var c = peer.connection || (peer.pc && peer.pc.connectionState) || 'new';
      if (c === 'connected') return '';
      if (c === 'connecting' || c === 'new') return 'connecting…';
      if (c === 'disconnected') return 'reconnecting…';
      if (c === 'failed') return 'connection failed';
      if (c === 'closed') return 'closed';
      return c;
    }

    /* ============================================================
       Participant badge
       ============================================================ */
    function ensureBadge() {
      if (state.badgeEl) return state.badgeEl;
      var host = document.getElementById('callBadgeSlot');
      if (!host) return null;
      var b = document.createElement('span');
      b.className = 'call-badge hidden';
      b.id = 'callBadge';
      b.innerHTML = ic('users') + '<span class="n">0</span>';
      host.appendChild(b);
      state.badgeEl = b;
      return b;
    }

    function updateBadge() {
      var b = ensureBadge();
      if (!b) return;
      var n = engine.participantCount();
      b.querySelector('.n').textContent = n;
      var shown = engine.inCall || n > 1;
      b.classList.toggle('hidden', !shown);
      b.classList.toggle('live', !!engine.inCall);
      b.title = n + ' in the call';
      // A pulse when someone joins while the window is minimised.
      if (shown && state.unread > 0) {
        b.classList.add('pulse-badge');
        setTimeout(function () { b.classList.remove('pulse-badge'); }, 1600);
        state.unread = 0;
      }
    }

    /* ============================================================
       Fallback: no signaling server
       ------------------------------------------------------------
       The old behaviour — your own camera in a small window — is
       still genuinely useful for checking your framing before a
       real call, so we keep it, but we say clearly that it is a
       local preview and why nobody else can see it.
       ============================================================ */
    function showLocalPreview(reason) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        U.toast('This browser cannot access a camera, and no signaling server is configured.', 'err');
        return;
      }

      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(function (stream) {
          openCallWindow();
          state.callOpen = true;

          dom.callBody.innerHTML =
            '<div class="call-tiles single">' +
              '<div class="call-tile" data-self>' +
                '<video autoplay muted playsinline id="selfPreview"></video>' +
                '<span class="nm">You</span>' +
              '</div>' +
            '</div>' +
            '<div class="call-notice warn">' +
              ic('alert') +
              '<span><b>Local preview only.</b> ' + U.esc(reason || 'The signaling server is not configured.') +
                ' Nobody else can see or hear this yet.</span>' +
            '</div>' +
            '<div class="call-bar">' +
              '<button class="cbtn" data-preview-stop title="Stop preview">' + ic('x') + '</button>' +
              '<span class="call-bar-note">Start the server in <code>server/</code> to call for real</span>' +
            '</div>';

          var v = dom.callBody.querySelector('#selfPreview');
          if (v) { v.srcObject = stream; v.play().catch(function () {}); }

          dom.callBody.querySelector('[data-preview-stop]').addEventListener('click', function () {
            stream.getTracks().forEach(function (t) { t.stop(); });
            closeCallWindow();
          });

          U.toast('Camera preview on — no server, so this is just you');
        })
        .catch(function (err) {
          U.toast(PV.webrtc.mediaError(err, 'cam'), 'err');
        });
    }

    /* ============================================================
       Call window (top-right)
       ============================================================ */
    function openCallWindow() {
      if (dom.callWin) return dom.callWin;
      var body = U.floatWindow('call', label, onCloseCall);
      dom.callBody = body;
      // U.floatWindow returns the body; reach the frame for styling hooks.
      dom.callWin = document.getElementById('float-call');
      if (dom.callWin) dom.callWin.classList.add('call-live');
      return dom.callWin;
    }

    function closeCallWindow() {
      var w = document.getElementById('float-call');
      if (w) w.remove();
      dom.callWin = null;
      dom.callBody = null;
      dom.tiles = {};
      state.callOpen = false;
    }

    function onCloseCall() {
      // Closing the window is "leave the call", not "hide it" — a hidden
      // window with an open mic is exactly the behaviour people complain about.
      if (engine.inCall) {
        engine.leaveCall();
        U.toast('You left the call');
      } else {
        closeCallWindow();
      }
    }

    /* ============================================================
       Render the call window
       ============================================================ */
    function renderCall() {
      if (!state.callOpen || !dom.callBody) return;

      var participants = engine.getParticipants();
      var total = participants.length;
      var sharingPeer = participants.filter(function (p) { return p.sharing && !p.self; })[0];

      // Rebuilding innerHTML replaces the <video> elements, which drops
      // their srcObject and causes a visible flicker. Only re-render when
      // something the user can actually see has changed.
      var sig = participants.map(function (p) {
        return [p.socketId, p.user && p.user.name, p.mic, p.cam, p.sharing,
          p.connection || '', p.self ? 1 : 0].join('|');
      }).join(';') + '~' + engine.status + '~' + engine.inCall +
        '~' + engine.micOn + '~' + engine.camOn + '~' + engine.sharing +
        '~' + (sharingPeer ? sharingPeer.socketId : '-') +
        '~' + (engine.lastError || '');
      if (sig === state.renderSig) { attachStreams(); return; }
      state.renderSig = sig;

      var tilesHTML = participants.map(function (p) {
        var isSelf = !!p.self;
        var conn = connLabel(p);
        var sub = conn ? '<span class="conn">' + U.esc(conn) + '</span>' : '';
        var badges = '';
        if (!p.mic) badges += '<span class="mtag" title="Muted">' + ic('micOff') + '</span>';
        if (!p.cam) badges += '<span class="mtag" title="Camera off">' + ic('camOff') + '</span>';
        if (p.sharing) badges += '<span class="mtag share" title="Sharing screen">' + ic('screen') + '</span>';

        return '<div class="call-tile' + (isSelf ? ' self' : '') + (total === 1 ? ' solo' : '') + '" data-tile="' + U.esc(p.socketId) + '">' +
          '<video autoplay playsinline ' + (isSelf ? 'muted ' : '') + 'data-video="' + U.esc(p.socketId) + '"></video>' +
          '<div class="tile-fallback" data-fb="' + U.esc(p.socketId) + '">' +
            '<div class="tf-av">' + U.esc(initials(p.user && p.user.name)) + '</div>' +
          '</div>' +
          '<div class="tile-tags">' + badges + '</div>' +
          '<span class="nm">' + U.esc((p.user && p.user.name) || 'Guest') + (isSelf ? ' (you)' : '') + '</span>' +
          sub +
        '</div>';
      }).join('');

      // Fill empty mesh slots so the window does not look broken at 2 people.
      var placeholders = '';
      for (var i = total; i < Math.min(4, engine.maxPeers || CFG.MAX_PEERS); i++) {
        placeholders += '<div class="call-tile empty"><div class="tile-fallback"><div class="tf-av dim">' + ic('users') + '</div></div>' +
          '<span class="nm">empty seat</span></div>';
      }

      dom.callBody.innerHTML =
        '<div class="call-tiles' +
          (total === 1 ? ' single' : '') +
          (total >= 3 ? ' many' : '') + '">' + tilesHTML + placeholders + '</div>' +

        (sharingPeer
          ? '<div class="call-notice info">' + ic('screen') +
            '<span><b>' + U.esc((sharingPeer.user && sharingPeersName(sharingPeer)) || 'Someone') +
            '</b> is sharing their screen — see the window on the left.</span></div>'
          : '') +

        (engine.status !== 'online'
          ? '<div class="call-notice warn">' + ic('alert') +
            '<span>' + U.esc(engine.lastError || 'Reconnecting to the signaling server…') + '</span></div>'
          : '') +

        '<div class="call-bar">' +
          '<button class="cbtn' + (engine.micOn ? '' : ' off') + '" data-act="mic" ' +
            'title="' + (engine.micOn ? 'Mute microphone' : 'Unmute microphone') + '">' +
            ic(engine.micOn ? 'mic' : 'micOff') + '</button>' +
          '<button class="cbtn' + (engine.camOn ? '' : ' off') + '" data-act="cam" ' +
            'title="' + (engine.camOn ? 'Turn camera off' : 'Turn camera on') + '">' +
            ic(engine.camOn ? 'video' : 'camOff') + '</button>' +
          '<button class="cbtn' + (engine.sharing ? ' on' : '') + '" data-act="screen" ' +
            'title="' + (engine.sharing ? 'Stop sharing your screen' : 'Share your screen') + '">' +
            ic('screen') + '</button>' +
          '<button class="cbtn danger" data-act="leave" title="Leave the call">' + ic('phone') + '</button>' +
        '</div>';

      // Attach streams to their tiles (re-attaching the same srcObject is a
      // no-op cost-wise, and survives the innerHTML rebuild).
      attachStreams();
      wireControls();
    }

    function sharingPeersName(p) {
      return (p.user && p.user.name) || 'Someone';
    }

    function attachStreams() {
      if (!dom.callBody) return;

      // Self preview
      var selfVid = dom.callBody.querySelector('video[data-video="' + (engine.socketId || '') + '"]');
      if (selfVid && engine.localStream) {
        if (selfVid.srcObject !== engine.localStream) selfVid.srcObject = engine.localStream;
        selfVid.play().catch(function () {});
        toggleFallback(selfVid, !!engine.camOn);
      } else if (selfVid && !engine.localStream) {
        toggleFallback(selfVid, false);
      }

      // Remote peers
      Object.keys(engine.peers).forEach(function (id) {
        var peer = engine.peers[id];
        var v = dom.callBody.querySelector('video[data-video="' + id + '"]');
        if (!v) return;
        if (peer.remoteStream) {
          if (v.srcObject !== peer.remoteStream) v.srcObject = peer.remoteStream;
          v.play().catch(function () {});
          toggleFallback(v, true);
        } else {
          toggleFallback(v, false);
        }
      });
    }

    // Show the avatar plate whenever there is no live video to show, instead
    // of leaving a black rectangle with no explanation.
    function toggleFallback(videoEl, hasVideo) {
      var tile = videoEl.closest('.call-tile');
      if (!tile) return;
      var track = videoEl.srcObject && videoEl.srcObject.getVideoTracks
        ? videoEl.srcObject.getVideoTracks()[0]
        : null;
      var live = hasVideo && track && track.readyState === 'live' && track.enabled !== false;
      tile.classList.toggle('no-video', !live);
    }

    function wireControls() {
      if (!dom.callBody) return;
      dom.callBody.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.dataset.act;

          if (act === 'mic') {
            var on = engine.toggleMic();
            U.toast(on ? 'Microphone on' : 'Microphone muted');
            renderCall();

          } else if (act === 'cam') {
            var camOn = engine.toggleCam();
            if (camOn && camOn.then) {
              camOn.then(function () { U.toast('Camera on'); renderCall(); })
                .catch(function (err) { U.toast(err.message, 'err'); renderCall(); });
            } else {
              U.toast(camOn ? 'Camera on' : 'Camera off');
              renderCall();
            }

          } else if (act === 'screen') {
            toggleScreen();

          } else if (act === 'leave') {
            engine.leaveCall();
            U.toast('You left the call');
            closeCallWindow();
            updateBadge();
          }
        });
      });
    }

    /* ============================================================
       Screen share
       ============================================================ */
    function toggleScreen() {
      if (engine.sharing) {
        engine.stopScreenShare();
        U.toast('Screen share stopped');
        closeScreenWindow();
        renderCall();
        return;
      }
      if (!PV.webrtc.canShareScreen()) {
        U.toast('Screen sharing needs a desktop browser (Chrome, Edge or Firefox on a computer).', 'err');
        return;
      }
      if (!engine.inCall) {
        U.toast('Start the call first — screen sharing rides along with it.', 'err');
        return;
      }

      engine.startScreenShare()
        .then(function () {
          U.toast('Sharing your screen');
          renderScreen();
          renderCall();
        })
        .catch(function (err) {
          U.toast(err.message, 'err');
          renderCall();
        });
    }

    /* ============================================================
       Screen-share window (top-left)
       ------------------------------------------------------------
       Shows exactly ONE screen at a time — the local share if you
       are sharing, otherwise the first remote sharer. The main
       player keeps running underneath either way.
       ============================================================ */
    function openScreenWindow(title) {
      if (dom.screenWin) return dom.screenBody;
      dom.screenBody = U.floatWindow('screen', title || 'Screen share', onCloseScreen);
      dom.screenWin = document.getElementById('float-screen');
      if (dom.screenWin) dom.screenWin.classList.add('screen-live');
      return dom.screenBody;
    }

    function closeScreenWindow() {
      var w = document.getElementById('float-screen');
      if (w) w.remove();
      dom.screenWin = null;
      dom.screenBody = null;
      state.screenOpen = false;
    }

    function onCloseScreen() {
      // Closing the window while YOU share means "stop sharing".
      // Closing it while watching someone else is just hiding it.
      if (engine.sharing) {
        engine.stopScreenShare();
        U.toast('Screen share stopped');
        renderCall();
      }
      closeScreenWindow();
    }

    function renderScreen() {
      var localShare = engine.sharing && engine.screenStream;
      var remotePeer = null;
      var remoteStream = null;

      if (!localShare) {
        Object.keys(engine.peers).forEach(function (id) {
          var p = engine.peers[id];
          if (p.remoteScreenStream && !remotePeer) {
            remotePeer = p;
            remoteStream = p.remoteScreenStream;
          }
        });
      }

      if (!localShare && !remoteStream) {
        closeScreenWindow();
        return;
      }

      var name = localShare
        ? (S.currentUser() && S.currentUser().name) || 'You'
        : ((remotePeer.user && remotePeer.user.name) || 'Someone');

      if (!dom.screenBody) openScreenWindow(localShare ? 'You are sharing' : name + ' is sharing');

      dom.screenBody.innerHTML =
        '<div class="screen-stage">' +
          '<video autoplay muted playsinline id="screenVideo"></video>' +
          '<div class="screen-empty">' + ic('screen') + '<span>Waiting for the first frame…</span></div>' +
        '</div>' +
        '<div class="screen-foot">' +
          '<span class="who">' + ic('screen') + U.esc(localShare ? 'You are sharing your screen' : name + ' is sharing') + '</span>' +
          (localShare
            ? '<button class="cbtn sm" data-screen-stop title="Stop sharing">' + ic('x') + '</button>'
            : '<span class="tiny">View only</span>') +
        '</div>';

      var v = dom.screenBody.querySelector('#screenVideo');
      v.srcObject = localShare ? engine.screenStream : remoteStream;
      v.play().catch(function () {});
      v.addEventListener('loadeddata', function () {
        var stage = v.closest('.screen-stage');
        if (stage) stage.classList.add('has-video');
      });
      // Some browsers fire loadeddata before the listener attaches.
      if (v.readyState >= 2) {
        var stage = v.closest('.screen-stage');
        if (stage) stage.classList.add('has-video');
      }

      var stopBtn = dom.screenBody.querySelector('[data-screen-stop]');
      if (stopBtn) {
        stopBtn.addEventListener('click', function () {
          engine.stopScreenShare();
          U.toast('Screen share stopped');
          closeScreenWindow();
          renderCall();
        });
      }

      state.screenOpen = true;
    }

    /* ============================================================
       Incoming-call banner
       ============================================================ */
    function showIncoming(info) {
      hideIncoming();
      state.incoming = info;

      var who = (info.from && info.from.name) || 'Someone';
      var others = Math.max(0, (info.participants || []).length - 1);

      var banner = document.createElement('div');
      banner.className = 'incoming-call';
      banner.id = 'incomingCall';
      banner.innerHTML =
        '<div class="ic">' + ic('phone') + '<span class="ring"></span></div>' +
        '<div class="grow">' +
          '<div class="who">' + U.esc(who) + ' started a call</div>' +
          '<div class="sub">' + (others > 0 ? others + ' already on the call · ' : '') + label + '</div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" data-decline>Not now</button>' +
        '<button class="btn btn-primary btn-sm" data-answer>' + ic('phone') + 'Join</button>';

      document.body.appendChild(banner);
      setTimeout(function () { banner.classList.add('show'); }, 20);

      banner.querySelector('[data-answer]').addEventListener('click', function () {
        hideIncoming();
        startCallUI();
      });
      banner.querySelector('[data-decline]').addEventListener('click', function () {
        hideIncoming();
        engine.declineCall();
        U.toast('Call dismissed');
      });

      // A ringing banner that never stops is a bug, not a feature.
      setTimeout(function () {
        if (state.incoming === info) hideIncoming();
      }, 45000);
    }

    function hideIncoming() {
      state.incoming = null;
      var b = document.getElementById('incomingCall');
      if (b) {
        b.classList.remove('show');
        setTimeout(function () { b.remove(); }, 220);
      }
    }

    /* ============================================================
       Start / join the call from the page button
       ============================================================ */
    function startCallUI() {
      if (engine.inCall) {
        // Toggle: pressing the button during a call leaves it.
        engine.leaveCall();
        closeCallWindow();
        closeScreenWindow();
        setCallButtons(false);
        updateBadge();
        U.toast('You left the call');
        return;
      }

      if (!PV.webrtc.isSupported()) {
        U.toast('This browser cannot do calls. Try Chrome, Edge, Firefox or Safari on an https page.', 'err');
        return;
      }

      // Not configured / unreachable → be explicit, then offer the preview.
      if (engine.status !== 'online') {
        var why = engine.lastError || (!CFG.getSignalingUrl()
          ? 'No signaling server is configured.'
          : 'The signaling server is unreachable.');

        U.modal({
          title: 'Calls need a signaling server',
          sub: why,
          okText: 'Show camera preview instead',
          cancelText: 'Close',
          body:
            '<p class="tiny muted" style="margin:0 0 12px;line-height:1.6">' +
              'Audio and video connect browser-to-browser; the server only introduces them. ' +
              'Everything else in PowerVerse works without it.' +
            '</p>' +
            '<div class="call-setup">' +
              '<div class="row" style="gap:8px;align-items:center;margin-bottom:8px">' +
                '<code class="kbd">cd server &amp;&amp; npm install &amp;&amp; npm start</code>' +
              '</div>' +
              '<p class="tiny muted" style="margin:0;line-height:1.6">' +
                'Then set the URL in <b>My → Settings → Video calls</b>. ' +
                'Full instructions are in <b>server/README.md</b>.' +
              '</p>' +
            '</div>',
          onOk: function () { showLocalPreview(why); }
        });
        return;
      }

      // Connecting state so a slow camera does not look like nothing happened.
      setCallButtons('connecting');
      U.toast('Starting the call…');

      engine.startCall()
        .then(function () {
          state.callOpen = true;
          openCallWindow();
          setCallButtons(true);
          renderCall();
          updateBadge();
          U.toast('You are in the call');
        })
        .catch(function (err) {
          setCallButtons(false);
          U.toast(err.message || 'Could not start the call', 'err');
        });
    }

    /* ============================================================
       Page buttons
       ============================================================ */
    function setCallButtons(mode) {
      var callBtn = document.getElementById('callBtn');
      if (!callBtn) return;

      var on = mode === true;
      var connecting = mode === 'connecting';

      callBtn.classList.toggle('btn-accent', on);
      callBtn.classList.toggle('is-loading', connecting);
      callBtn.disabled = connecting;

      var txt = on ? (engine.participantCount() > 1
        ? 'Leave Call · ' + engine.participantCount()
        : 'Leave Call')
        : (connecting ? 'Connecting…' : 'Video Call');

      callBtn.innerHTML = ic('phone') + '<span>' + U.esc(txt) + '</span>';

      var screenBtn = document.getElementById('screenBtn');
      if (screenBtn) {
        screenBtn.classList.toggle('btn-accent', !!engine.sharing);
        screenBtn.innerHTML = ic('screen') + '<span>' + (engine.sharing ? 'Stop Sharing' : 'Share Screen') + '</span>';
      }
    }

    /* ============================================================
       Engine event wiring
       ============================================================ */
    engine.on('status', function (s) {
      if (s.status === 'online') {
        var b = document.getElementById('connChip');
        if (b) { b.className = 'chip chip-ok'; b.innerHTML = '<span class="pulse"></span> Signaling online'; }
      } else if (s.status === 'offline' && (state.callOpen || engine.inCall)) {
        var b2 = document.getElementById('connChip');
        if (b2) { b2.className = 'chip chip-warn'; b2.innerHTML = 'Reconnecting…'; }
      }
      if (state.callOpen) renderCall();
    });

    engine.on('peer:add', function () {
      state.unread++;
      updateBadge();
      if (state.callOpen) renderCall();
    });

    engine.on('peer:update', function () {
      updateBadge();
      if (state.callOpen) renderCall();
    });

    engine.on('peer:stream', function (p) {
      if (p.kind === 'screen') {
        renderScreen();
      } else if (state.callOpen) {
        renderCall();
      }
    });

    engine.on('peer:remove', function () {
      updateBadge();
      if (state.callOpen) renderCall();
      renderScreen();
    });

    engine.on('roster', function () {
      updateBadge();
      if (state.callOpen) renderCall();
    });

    engine.on('call:incoming', function (info) {
      showIncoming(info);
    });

    engine.on('call:joined', function () {
      updateBadge();
      if (state.callOpen) renderCall();
    });

    engine.on('call:left', function (info) {
      hideIncoming();
      closeCallWindow();
      closeScreenWindow();
      setCallButtons(false);
      updateBadge();
      if (info && info.remote) {
        U.toast((info.by && info.by.name ? info.by.name : 'The host') + ' ended the call');
      }
      if (opts.onCallEnded) opts.onCallEnded(info);
    });

    engine.on('call:error', function (e) {
      U.toast(e.error || 'Call error', 'err');
      engine.leaveCall();
      closeCallWindow();
      setCallButtons(false);
      updateBadge();
    });

    engine.on('local:media', function () {
      if (state.callOpen) renderCall();
    });

    engine.on('local:screen', function (s) {
      if (s.sharing) renderScreen(); else closeScreenWindow();
    });

    engine.on('screen:remote-start', function () {
      renderScreen();
      if (engine.inCall) U.toast('Someone started sharing their screen');
    });

    engine.on('screen:remote-stop', function () {
      renderScreen();
    });

    /* ============================================================
       Connect on mount
       ============================================================ */
    engine.connect(code, me).then(function (res) {
      var chip = document.getElementById('connChip');
      if (!res.ok) {
        if (chip) {
          chip.className = 'chip chip-warn';
          chip.title = res.error || '';
          chip.innerHTML = ic('alert') + ' Local only';
        }
        return;
      }
      if (chip) {
        chip.className = 'chip chip-ok';
        chip.innerHTML = '<span class="pulse"></span> Signaling online';
      }
      updateBadge();
    });

    /* ============================================================
       Public handle used by the pages
       ============================================================ */
    var api = {
      engine: engine,
      startCall: startCallUI,
      toggleScreen: toggleScreen,
      isInCall: function () { return engine.inCall; },
      participantCount: function () { return engine.participantCount(); },
      refresh: function () { renderCall(); updateBadge(); },
      destroy: function () { engine.destroy(); closeCallWindow(); closeScreenWindow(); hideIncoming(); }
    };

    // The page scripts only rebind the buttons to this handle once.
    PV.call = api;
    return api;
  }

  PV.callUI = { mount: mount };
})();
