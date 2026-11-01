/* ============================================================
   PowerVerse — sync room engine  (media from the user's device)
   ------------------------------------------------------------
   Shared by music-sync.html and video-sync.html.

   There is no built-in sample library any more. A room starts
   empty and every byte it plays comes from a file someone picked
   off their own phone/computer. That creates an honest problem:

     A file on your phone cannot be streamed to someone else's
     browser. So there are two modes, and the UI says which one
     is active instead of pretending:

     • LOCAL FILES (default)
       Each participant picks the SAME file on their own device.
       Only the playhead is synced — index, playing, position,
       updatedAt — and every player re-aligns to
       position + (now - updatedAt)/1000 once a second. Picks are
       cached in IndexedDB (js/media-store.js) so re-joining does
       not mean re-picking.

     • UPLOAD & SHARE
       The host stores one copy through PV.store.putSharedMedia()
       and everybody streams that same copy. Progress is shown
       while the file is read, and large files are refused up
       front because browser storage is small.

   Everything else — host play/pause/seek/track change, member
   list + kick, like/comment/share, repost-to-home, end sync,
   floating video call and screen share — behaves as before.
   ============================================================ */
(function () {
  'use strict';

  var PV = window.PV;
  var S = PV.store, U = PV.ui, MS = PV.mediaStore;

  /* Shared uploads live in localStorage, which is ~5MB per origin and
     base64 inflates a file by ~33%. Refuse past 3MB, warn from 1.2MB. */
  var SHARED_MAX = 3 * 1024 * 1024;
  var SHARED_WARN = 1.2 * 1024 * 1024;
  var LOCAL_WARN = 60 * 1024 * 1024;

  var KIND = {
    music: { accept: 'audio/*', tag: 'audio', noun: 'song', nounPlural: 'songs', lib: 'music' },
    video: { accept: 'video/*', tag: 'video', noun: 'video', nounPlural: 'videos', lib: 'video' }
  };

  function init(opts) {
    var type = opts.type;                       // 'music' | 'video'
    var kind = KIND[type];
    var me = U.requireAuth();
    if (!me) return;

    var state = {
      syncId: null,
      isHost: false,
      media: null,
      itemId: null,
      srcUrl: null,
      local: {},            // norm -> { url, dur, name }
      driftTimer: null,
      lastIndex: -1,
      gate: false,
      callOpen: false,
      screenOpen: false,
      busy: false
    };

    var el = {
      lobby: document.getElementById('lobby'),
      room: document.getElementById('room'),
      createName: document.getElementById('createName'),
      createBtn: document.getElementById('createBtn'),
      joinCode: document.getElementById('joinCode'),
      joinBtn: document.getElementById('joinBtn'),
      lobbyErr: document.getElementById('lobbyErr'),
      title: document.getElementById('roomTitle'),
      code: document.getElementById('roomCode'),
      stage: document.getElementById('stage'),
      mediaHost: document.getElementById('mediaHost'),
      stageEmpty: document.getElementById('stageEmpty'),
      gate: document.getElementById('gate'),
      albumArt: document.getElementById('albumArt'),
      trackTitle: document.getElementById('trackTitle'),
      trackArtist: document.getElementById('trackArtist'),
      pickBtn: document.getElementById('pickBtn'),
      fileInput: document.getElementById('fileInput'),
      modeSeg: document.getElementById('modeSeg'),
      modeLocal: document.getElementById('modeLocal'),
      modeShared: document.getElementById('modeShared'),
      srcHint: document.getElementById('srcHint'),
      uploadWrap: document.getElementById('uploadWrap'),
      uploadText: document.getElementById('uploadText'),
      uploadPct: document.getElementById('uploadPct'),
      uploadBar: document.getElementById('uploadBar'),
      playlist: document.getElementById('playlist'),
      plEmpty: document.getElementById('plEmpty'),
      plCount: document.getElementById('plCount'),
      members: document.getElementById('members'),
      memberCount: document.getElementById('memberCount'),
      playBtn: document.getElementById('playBtn'),
      prevBtn: document.getElementById('prevBtn'),
      nextBtn: document.getElementById('nextBtn'),
      fill: document.getElementById('fill'),
      cur: document.getElementById('cur'),
      dur: document.getElementById('dur'),
      bar: document.getElementById('bar'),
      likeBtn: document.getElementById('likeBtn'),
      likeCount: document.getElementById('likeCount'),
      shareBtn: document.getElementById('shareBtn'),
      shareCount: document.getElementById('shareCount'),
      commentBtn: document.getElementById('commentBtn'),
      commentCount: document.getElementById('commentCount'),
      comments: document.getElementById('comments'),
      commentForm: document.getElementById('commentForm'),
      commentInput: document.getElementById('commentInput'),
      repostBtn: document.getElementById('repostBtn'),
      endBtn: document.getElementById('endBtn'),
      leaveBtn: document.getElementById('leaveBtn'),
      callBtn: document.getElementById('callBtn'),
      screenBtn: document.getElementById('screenBtn'),
      hostBadge: document.getElementById('hostBadge'),
      copyBtn: document.getElementById('copyBtn')
    };

    if (el.fileInput) el.fileInput.setAttribute('accept', kind.accept);

    /* ================= lobby ================= */

    function lobbyError(msg) {
      if (!el.lobbyErr) return;
      el.lobbyErr.innerHTML = U.icon('alert') + '<span>' + U.esc(msg) + '</span>';
      el.lobbyErr.classList.add('show');
    }
    function clearLobbyError() { if (el.lobbyErr) el.lobbyErr.classList.remove('show'); }

    if (el.createBtn) {
      el.createBtn.addEventListener('click', function () {
        clearLobbyError();
        var res = S.createSync(type, el.createName.value);
        if (!res.ok) { lobbyError(res.error); return; }
        U.toast('Sync created — share code ' + res.sync.code);
        enterRoom(res.sync.id);
      });
    }
    if (el.createName) {
      el.createName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') el.createBtn.click();
      });
    }

    if (el.joinBtn) {
      el.joinBtn.addEventListener('click', function () {
        clearLobbyError();
        var code = el.joinCode.value.trim().toUpperCase();
        if (!code) { lobbyError('Enter the code the host gave you.'); return; }
        var res = S.joinSync(code);
        if (!res.ok) { lobbyError(res.error); return; }
        if (res.sync.type !== type) {
          location.href = (res.sync.type === 'music' ? 'music-sync.html' : 'video-sync.html') +
            '?code=' + encodeURIComponent(code);
          return;
        }
        enterRoom(res.sync.id);
      });
    }
    if (el.joinCode) {
      el.joinCode.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') el.joinBtn.click();
      });
    }

    /* ================= enter / leave ================= */

    function enterRoom(syncId) {
      var s = S.getSync(syncId);
      if (!s) { U.toast('That sync no longer exists', 'err'); return; }
      if (s.ended) { U.toast('That sync has ended', 'err'); return; }
      if (s.members.indexOf(me.id) < 0) {
        var j = S.joinSync(s.code);
        if (!j.ok) { U.toast(j.error, 'err'); return; }
      }
      state.syncId = syncId;
      state.isHost = s.hostId === me.id;
      state.lastIndex = s.playback.index;
      if (el.lobby) el.lobby.classList.add('hidden');
      if (el.room) el.room.classList.remove('hidden');
      history.replaceState(null, '', '?code=' + s.code);

      ensureMediaEl();
      syncLocalSources().then(function () {
        applyCurrentSource(true);
        render();
      });
      render();
      startDriftLoop();
    }

    function leaveRoom(silent) {
      if (state.syncId) S.leaveSync(state.syncId);
      teardown();
      if (el.room) el.room.classList.add('hidden');
      if (el.lobby) el.lobby.classList.remove('hidden');
      if (!silent) U.toast('You left the sync');
    }

    function teardown() {
      stopDriftLoop();
      destroyMedia();
      closeCall();
      closeScreen();
      state.syncId = null;
      state.itemId = null;
      state.lastIndex = -1;
    }

    /* ================= media element ================= */

    function ensureMediaEl() {
      if (state.media) return state.media;
      var m = document.createElement(kind.tag);
      m.preload = 'metadata';
      m.playsInline = true;
      if (kind.tag === 'video') {
        m.setAttribute('playsinline', '');
        m.controls = false;
      }
      m.style.display = kind.tag === 'audio' ? 'none' : 'block';

      m.addEventListener('loadedmetadata', function () {
        applyPlayback(true);
        // preload="metadata" keeps a large movie from decoding on load, but it
        // also leaves the stage black. Nudge off frame 0 so the browser paints
        // a real frame. Runs AFTER applyPlayback (which would re-seek to 0),
        // and only while paused, so it never disturbs live playback.
        if (kind.tag === 'video' && m.paused && m.currentTime === 0) {
          try { m.currentTime = 0.05; } catch (e) {}
        }
      });
      m.addEventListener('ended', function () {
        if (state.isHost) nextTrack(true);
      });
      m.addEventListener('error', function () {
        if (!state.srcUrl) return;
        U.toast('That file could not be played in this browser. Try an MP4 / MP3 copy.', 'err');
      });
      m.addEventListener('play', function () { updateGate(); });
      m.addEventListener('pause', function () { updateGate(); });

      if (el.mediaHost) el.mediaHost.appendChild(m);
      state.media = m;
      return m;
    }

    function destroyMedia() {
      if (state.media) {
        try { state.media.pause(); } catch (e) {}
        state.media.removeAttribute('src');
        try { state.media.load(); } catch (e) {}
        if (state.media.parentNode) state.media.parentNode.removeChild(state.media);
        state.media = null;
      }
      releaseLocal();          // revoke every object URL we handed out
      state.srcUrl = null;
      state.itemId = null;
      state.gate = false;
    }

    function releaseLocal() {
      Object.keys(state.local).forEach(function (k) {
        try { URL.revokeObjectURL(state.local[k].url); } catch (e) {}
      });
      state.local = {};
    }

    /* ================= the room's files ================= */

    function roomMedia() { return S.getRoomMedia(state.syncId); }
    function items() { return roomMedia().items || []; }
    function mode() { return roomMedia().mode === 'shared' ? 'shared' : 'local'; }
    function currentItem() {
      var list = items();
      var s = S.getSync(state.syncId);
      if (!s || !list.length) return null;
      return list[s.playback.index] || list[0] || null;
    }
    function hasLocal(item) { return !!(item && state.local[item.norm]); }

    /* Where should the current item's audio actually come from?
       local mode  → this device's own copy (or nothing)
       shared mode → the uploaded copy, falling back to a local one */
    function sourceFor(item) {
      if (!item) return null;
      var local = state.local[item.norm];
      if (mode() === 'shared') {
        if (item.upid) {
          var shared = S.getSharedMedia(item.upid);
          if (shared && shared.dataUrl) return { url: shared.dataUrl, kind: 'shared' };
        }
        if (local) return { url: local.url, kind: 'local' };
        return null;
      }
      return local ? { url: local.url, kind: 'local' } : null;
    }

    /* Read this browser's stored picks for the room and match them to the
       room's playlist by normalised filename (same track, different name
       spellings, still matches). Also restores an empty room's playlist
       from what this device kept. */
    function syncLocalSources() {
      if (!state.syncId) return Promise.resolve();
      var s = S.getSync(state.syncId);
      if (!s) return Promise.resolve();

      return MS.listLocal(s.code).then(function (rows) {
        releaseLocal();
        rows.forEach(function (r) {
          var norm = MS.normName(r.name);
          if (!norm || !r.blob) return;
          state.local[norm] = {
            url: URL.createObjectURL(r.blob),
            dur: r.dur || 0,
            name: r.name
          };
        });

        // Nothing in the room but this device remembers files from last time?
        // Put them back so a rejoin does not start from an empty room.
        if (s.media && s.media.items && s.media.items.length === 0 && rows.length) {
          rows.forEach(function (r) {
            S.addRoomMedia(state.syncId, {
              name: r.name, size: r.size, mime: r.mime, dur: r.dur
            });
          });
          if (rows.length) U.toast('Restored ' + rows.length + ' ' + kind.nounPlural + ' from this device');
        }
        return null;
      }).catch(function () { return null; });
    }

    function setSource(src, item) {
      var m = ensureMediaEl();
      if (state.srcUrl === src.url && state.itemId === item.id) {
        applyPlayback(true);
        return;
      }
      state.srcUrl = src.url;
      state.itemId = item.id;
      m.src = src.url;
      try { m.load(); } catch (e) {}
      updateGate();
    }

    function applyCurrentSource(force) {
      var item = currentItem();
      if (!item) {
        if (state.media) {
          try { state.media.pause(); } catch (e) {}
          state.media.removeAttribute('src');
          try { state.media.load(); } catch (e) {}
        }
        state.srcUrl = null;
        state.itemId = null;
        render();
        return;
      }
      var src = sourceFor(item);
      if (!src) {
        if (state.media) {
          try { state.media.pause(); } catch (e) {}
          state.media.removeAttribute('src');
          try { state.media.load(); } catch (e) {}
        }
        state.srcUrl = null;
        state.itemId = item.id;
        updateGate();
        render();
        return;
      }
      setSource(src, item);
      applyPlayback(force !== false);
      render();
    }

    /* ================= synchronized playback ================= */

    function mediaDur() {
      var item = currentItem();
      if (state.media && isFinite(state.media.duration) && state.media.duration > 0) return state.media.duration;
      return (item && item.dur) || 0;
    }

    function applyPlayback(force) {
      var s = S.getSync(state.syncId);
      if (!s || !state.media || !state.srcUrl) return;
      var m = state.media;
      var target = S.syncPosition(s);
      var dur = mediaDur();

      if (dur && target > dur - 0.2) target = Math.max(0, dur - 0.1);

      if (force || Math.abs((m.currentTime || 0) - target) > 0.9) {
        try { m.currentTime = Math.max(0, target); } catch (e) {}
      }

      if (s.playback.playing) {
        if (m.paused) {
          var pr = m.play();
          if (pr && pr.catch) {
            pr.catch(function (err) {
              // Browsers block un-muted autoplay until a real gesture.
              if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
                state.gate = true;
                updateGate();
              }
            });
          }
        }
      } else if (!m.paused) {
        m.pause();
      }
      updateGate();
    }

    function updateGate() {
      if (!el.gate) return;
      var s = state.syncId ? S.getSync(state.syncId) : null;
      var blocked = !!state.gate && !!s && s.playback.playing && !!state.srcUrl &&
        !!state.media && state.media.paused;
      el.gate.classList.toggle('hidden', !blocked);
      if (blocked && kind.tag === 'video') {
        el.gate.innerHTML = U.icon('play') + '<span>Tap to join playback</span>';
      } else if (blocked) {
        el.gate.innerHTML = U.icon('play') + '<span>Tap to listen</span>';
      } else {
        state.gate = state.gate && blocked;
      }
    }

    if (el.gate) {
      el.gate.addEventListener('click', function () {
        state.gate = false;
        updateGate();
        if (state.media && state.srcUrl) {
          applyPlayback(true);
          var pr = state.media.play();
          if (pr && pr.catch) pr.catch(function () {});
        }
      });
    }

    function startDriftLoop() {
      stopDriftLoop();
      state.driftTimer = setInterval(function () {
        var s = state.syncId ? S.getSync(state.syncId) : null;
        if (!s) return;
        if (s.ended) { onEnded(); return; }
        if (s.members.indexOf(me.id) < 0) {
          U.toast('The host removed you from this sync', 'err');
          leaveRoom(true);
          return;
        }
        applyPlayback(false);
        updateProgress();
      }, 1000);
    }
    function stopDriftLoop() {
      if (state.driftTimer) { clearInterval(state.driftTimer); state.driftTimer = null; }
    }

    function updateProgress() {
      var s = state.syncId ? S.getSync(state.syncId) : null;
      if (!s) return;
      var pos = (state.media && state.srcUrl) ? (state.media.currentTime || 0) : 0;
      var dur = mediaDur();
      if (el.cur) el.cur.textContent = U.clock(pos);
      if (el.dur) el.dur.textContent = U.clock(dur);
      if (el.fill) el.fill.style.width = (dur ? Math.min(100, (pos / dur) * 100) : 0) + '%';
      if (el.playBtn) el.playBtn.innerHTML = U.icon(s.playback.playing ? 'pause' : 'play');
    }

    /* ================= host controls ================= */

    function hostSet(patch) {
      if (!state.isHost) {
        U.toast('Only the host controls playback', 'err');
        return false;
      }
      S.setPlayback(state.syncId, patch);
      applyPlayback(true);
      render();
      return true;
    }

    if (el.playBtn) {
      el.playBtn.addEventListener('click', function () {
        var s = S.getSync(state.syncId);
        if (!s) return;
        if (!state.isHost) { U.toast('Only the host controls playback', 'err'); return; }
        if (!state.srcUrl) {
          U.toast(items().length
            ? 'Pick this ' + kind.noun + ' on your device first'
            : 'Add a ' + kind.noun + ' to the playlist first', 'err');
          return;
        }
        var pos = state.media ? state.media.currentTime : 0;
        hostSet({ playing: !s.playback.playing, position: pos });
      });
    }

    if (el.prevBtn) {
      el.prevBtn.addEventListener('click', function () {
        var s = S.getSync(state.syncId);
        if (!s || !state.isHost) { U.toast('Only the host can change the track', 'err'); return; }
        var list = items();
        if (!list.length) return;
        var idx = (s.playback.index - 1 + list.length) % list.length;
        hostSet({ index: idx, position: 0 });
        applyCurrentSource(true);
      });
    }

    if (el.nextBtn) {
      el.nextBtn.addEventListener('click', function () {
        if (!state.isHost) { U.toast('Only the host can change the track', 'err'); return; }
        nextTrack(false);
      });
    }

    function nextTrack(auto) {
      var s = S.getSync(state.syncId);
      if (!s) return;
      var list = items();
      if (!list.length) return;
      var idx = s.playback.index + 1;
      if (idx >= list.length) {
        // End of the playlist — stop instead of looping forever.
        S.setPlayback(state.syncId, { index: list.length - 1, position: 0, playing: false });
        applyPlayback(true);
        render();
        return;
      }
      S.setPlayback(state.syncId, { index: idx, position: 0, playing: auto ? true : s.playback.playing });
      applyCurrentSource(true);
      render();
    }

    if (el.bar) {
      el.bar.addEventListener('click', function (e) {
        if (!state.isHost) { U.toast('Only the host can seek', 'err'); return; }
        if (!state.srcUrl) return;
        var rect = el.bar.getBoundingClientRect();
        var pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        hostSet({ position: pct * mediaDur() });
      });
    }

    /* ================= picking files ================= */

    if (el.pickBtn) {
      el.pickBtn.addEventListener('click', function () {
        if (mode() === 'shared' && !state.isHost) {
          U.toast('Only the host uploads in this mode — you are streaming their copy', 'err');
          return;
        }
        el.fileInput.value = '';
        el.fileInput.click();
      });
    }

    if (el.fileInput) {
      el.fileInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(el.fileInput.files || []);
        if (!files.length) return;
        ingest(files);
      });
    }

    function ingest(files) {
      if (state.busy) { U.toast('Still working on the last file…'); return; }
      var wanted = kind.tag === 'video' ? 'video/' : 'audio/';
      var accepted = files.filter(function (f) {
        return (f.type && f.type.indexOf(wanted) === 0) || f.name.match(kind.tag === 'video' ? /\.(mp4|webm|mov|m4v|ogv)$/i : /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i);
      });
      if (!accepted.length) {
        U.toast('Those files are not ' + kind.nounPlural + '. Pick ' + kind.accept + ' files.', 'err');
        return;
      }
      if (accepted.length < files.length) {
        U.toast((files.length - accepted.length) + ' file(s) skipped — wrong type', 'err');
      }

      state.busy = true;
      if (el.pickBtn) el.pickBtn.disabled = true;

      var shared = mode() === 'shared';
      var added = 0, matched = 0, failed = 0;
      var chain = Promise.resolve();

      accepted.forEach(function (file) {
        chain = chain.then(function () {
          if (shared && file.size > SHARED_MAX) {
            failed++;
            U.toast('"' + file.name + '" is ' + MS.humanSize(file.size) +
              ' — too big to share in this prototype (max ' + MS.humanSize(SHARED_MAX) + ')', 'err');
            return null;
          }
          if (shared && file.size > SHARED_WARN) {
            U.toast('Large file: ' + MS.humanSize(file.size) + '. Browser storage is small — keep it short.', 'err');
          }
          if (!shared && file.size > LOCAL_WARN) {
            U.toast('"' + file.name + '" is very large (' + MS.humanSize(file.size) + '). Playback may stutter.', 'err');
          }

          return probeDuration(file).then(function (dur) {
            if (!shared) {
              return MS.saveLocal({
                room: S.getSync(state.syncId).code,
                name: file.name, size: file.size, mime: file.type || '',
                dur: dur, blob: file
              }).then(function () {
                var r = S.addRoomMedia(state.syncId, {
                  name: file.name, size: file.size, mime: file.type || '', dur: dur
                });
                if (r.ok) { if (r.matched) matched++; else added++; }
                else { failed++; U.toast(r.error, 'err'); }
                return null;
              });
            }

            // Upload & share: read with a real progress bar, then store.
            return readWithProgress(file).then(function (dataUrl) {
              var r = S.putSharedMedia({
                name: file.name, size: file.size, mime: file.type || '', dur: dur
              }, dataUrl);
              if (!r.ok) { failed++; U.toast(r.error, 'err'); return null; }
              var added2 = S.addRoomMedia(state.syncId, {
                name: file.name, size: file.size, mime: file.type || '', dur: dur, upid: r.id
              });
              if (added2.ok) { if (added2.matched) matched++; else added++; }
              else { failed++; U.toast(added2.error, 'err'); }
              if (r.evicted) U.toast('Cleared ' + r.evicted + ' older upload(s) to make room');
              return null;
            });
          });
        });
      });

      chain.then(function () {
        state.busy = false;
        if (el.pickBtn) el.pickBtn.disabled = false;
        hideUpload();

        return syncLocalSources().then(function () {
          var s = S.getSync(state.syncId);
          // First file in an empty room becomes the current track, paused at 0.
          if (s && items().length && !state.srcUrl) {
            S.setPlayback(state.syncId, { index: s.playback.index, position: 0, playing: false });
          }
          applyCurrentSource(true);
          render();

          var msg = [];
          if (added) msg.push(added + ' ' + (added === 1 ? kind.noun : kind.nounPlural) + ' added');
          if (matched) msg.push(matched + ' matched to this room');
          if (failed) msg.push(failed + ' failed');
          U.toast(msg.length ? msg.join(' · ') : 'Nothing added');
        });
      }).catch(function (err) {
        state.busy = false;
        if (el.pickBtn) el.pickBtn.disabled = false;
        hideUpload();
        U.toast((err && err.message) || 'Could not read that file', 'err');
      });
    }

    /* Read a File into a data URL, reporting progress as it goes. */
    function readWithProgress(file) {
      return new Promise(function (resolve, reject) {
        showUpload(0, 'Preparing ' + file.name);
        var fr = new FileReader();
        fr.onprogress = function (e) {
          if (e.lengthComputable) {
            showUpload((e.loaded / e.total) * 100, 'Reading ' + file.name);
          }
        };
        fr.onload = function () {
          showUpload(100, 'Storing ' + file.name);
          resolve(fr.result);
        };
        fr.onerror = function () { reject(new Error('Could not read "' + file.name + '"')); };
        fr.readAsDataURL(file);
      });
    }

    function showUpload(pct, label) {
      if (!el.uploadWrap) return;
      el.uploadWrap.classList.remove('hidden');
      el.uploadBar.style.width = Math.max(2, Math.min(100, pct)) + '%';
      el.uploadPct.textContent = Math.round(pct) + '%';
      el.uploadText.textContent = label;
    }
    function hideUpload() {
      if (!el.uploadWrap) return;
      el.uploadBar.style.width = '0%';
      el.uploadPct.textContent = '0%';
      el.uploadWrap.classList.add('hidden');
    }

    function probeDuration(file) {
      return new Promise(function (resolve) {
        var url;
        try { url = URL.createObjectURL(file); } catch (e) { resolve(0); return; }
        var m = document.createElement(kind.tag);
        var done = false;
        function fin(v) {
          if (done) return;
          done = true;
          try { URL.revokeObjectURL(url); } catch (e) {}
          resolve(isFinite(v) && v > 0 ? v : 0);
        }
        m.preload = 'metadata';
        m.addEventListener('loadedmetadata', function () { fin(m.duration); });
        m.addEventListener('loadeddata', function () { fin(m.duration); });
        m.addEventListener('error', function () { fin(0); });
        setTimeout(function () { fin(0); }, 7000);
        m.src = url;
      });
    }

    /* ================= mode switch ================= */

    function bindModeBtn(btn, value) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (!state.isHost) {
          U.toast('Only the host can switch the media source', 'err');
          return;
        }
        if (mode() === value) return;
        var r = S.setMediaMode(state.syncId, value);
        if (!r.ok) { U.toast(r.error, 'err'); return; }
        U.toast(value === 'shared'
          ? 'Upload & share — one copy for everyone'
          : 'Local files — everyone picks the same file');
        applyCurrentSource(true);
        render();
      });
    }
    bindModeBtn(el.modeLocal, 'local');
    bindModeBtn(el.modeShared, 'shared');

    /* ================= render ================= */

    function hintText() {
      var item = currentItem();
      var lines = [];
      if (mode() === 'shared') {
        if (state.isHost) {
          lines.push('You upload once — everyone streams the same copy. Uploads are stored in this browser for now, so keep files small (max ' + MS.humanSize(SHARED_MAX) + ').');
        } else {
          lines.push('The host uploads once; everyone in the room streams that same copy.');
        }
        if (item && !state.srcUrl) {
          lines.push('Waiting for the upload of "' + item.title + '" to arrive…');
        }
      } else {
        lines.push('Everyone should pick the same ' + kind.noun + ' on their device — playback stays in sync.');
        if (item && !hasLocal(item)) {
          lines.push('This device does not have "' + item.name + '" yet. Pick it from your device to join in.');
        } else if (!items().length) {
          lines.push('Nothing here yet — tap “Pick from my device” to add your own ' + kind.nounPlural + '.');
        }
      }
      return lines;
    }

    function render() {
      if (!state.syncId) return;
      var s = S.getSync(state.syncId);
      if (!s) return;
      var host = S.getUser(s.hostId);
      var item = currentItem();
      var list = items();
      var m = mode();

      if (el.title) el.title.textContent = s.name;
      if (el.code) el.code.textContent = s.code;
      if (el.hostBadge) {
        el.hostBadge.textContent = state.isHost ? 'You are host' : 'Host: ' + (host ? host.name.split(' ')[0] : '?');
        el.hostBadge.className = 'chip ' + (state.isHost ? 'chip-brand' : '');
      }

      // track labels
      if (el.trackTitle) el.trackTitle.textContent = item ? item.title : 'No ' + kind.noun + ' yet';
      if (el.trackArtist) {
        if (!item) {
          el.trackArtist.textContent = 'Pick a ' + kind.noun + ' from your device to start the room';
        } else {
          var bits = [];
          if (item.dur) bits.push(U.clock(item.dur));
          if (item.size) bits.push(MS.humanSize(item.size));
          bits.push(m === 'shared' && item.upid ? 'Shared copy' : (hasLocal(item) ? 'On this device' : 'Not on your device'));
          el.trackArtist.textContent = bits.join(' · ');
        }
      }

      if (el.albumArt) el.albumArt.classList.toggle('spinning', !!s.playback.playing && !!state.srcUrl);

      // empty / missing state in the stage
      if (el.stageEmpty) {
        if (!list.length) {
          el.stageEmpty.classList.remove('hidden');
          el.stageEmpty.innerHTML =
            '<div class="se-ic">' + U.icon(kind.lib) + '</div>' +
            '<h4>Your ' + (kind.tag === 'video' ? 'screen' : 'speakers') + ' are empty</h4>' +
            '<p>Every ' + kind.noun + ' here comes from someone’s own device. Add the file you want the room to play.</p>' +
            '<button class="btn btn-primary btn-sm" data-pick>' + U.icon('plus') + 'Pick from my device</button>';
        } else if (!state.srcUrl && m === 'local') {
          el.stageEmpty.classList.remove('hidden');
          el.stageEmpty.innerHTML =
            '<div class="se-ic">' + U.icon('alert') + '</div>' +
            '<h4>Not on this device</h4>' +
            '<p>The room is on <b>' + U.esc(item ? item.name : '') + '</b>. Pick the same file here and you will join exactly where everyone else is.</p>' +
            '<button class="btn btn-primary btn-sm" data-pick>' + U.icon('plus') + 'Pick this file</button>';
        } else if (!state.srcUrl && m === 'shared') {
          el.stageEmpty.classList.remove('hidden');
          el.stageEmpty.innerHTML =
            '<div class="se-ic">' + U.icon('clock') + '</div>' +
            '<h4>Upload not available here</h4>' +
            '<p>“' + U.esc(item ? item.title : '') + '” was uploaded on the host’s device. In this prototype that copy only exists in the uploader’s browser.</p>';
        } else {
          el.stageEmpty.classList.add('hidden');
          el.stageEmpty.innerHTML = '';
        }
      }

      // mode segmented control
      if (el.modeLocal) el.modeLocal.className = 'seg-btn' + (m === 'local' ? ' active' : '');
      if (el.modeShared) el.modeShared.className = 'seg-btn' + (m === 'shared' ? ' active' : '');
      if (el.modeSeg) el.modeSeg.classList.toggle('locked', !state.isHost);

      // pick button availability
      if (el.pickBtn) {
        var blocked = m === 'shared' && !state.isHost;
        el.pickBtn.disabled = blocked;
        el.pickBtn.title = blocked ? 'Only the host uploads in shared mode' : '';
        el.pickBtn.innerHTML = U.icon('plus') + '<span>Pick from my device</span>';
      }

      // hint
      if (el.srcHint) {
        el.srcHint.innerHTML = hintText().map(function (t) {
          return '<p>' + U.icon('sparkle') + '<span>' + U.esc(t) + '</span></p>';
        }).join('');
      }

      // playlist
      if (el.plCount) el.plCount.textContent = list.length;
      if (el.playlist) {
        el.playlist.innerHTML = list.map(function (it, i) {
          var active = i === s.playback.index;
          var mine = hasLocal(it);
          var badge = (m === 'shared' && it.upid)
            ? '<span class="pl-badge shared">' + U.icon('link') + 'Shared</span>'
            : (mine
                ? '<span class="pl-badge ok">' + U.icon('check') + 'On device</span>'
                : '<span class="pl-badge warn">' + U.icon('alert') + 'Not here</span>');
          var canRemove = state.isHost || it.addedBy === me.id;
          return '<div class="pl-item' + (active ? ' active' : '') + '" data-track="' + i + '">' +
            '<span class="idx">' + (active ? U.icon('play') : (i + 1)) + '</span>' +
            '<div class="grow">' +
              '<div class="t truncate">' + U.esc(it.title) + '</div>' +
              '<div class="a truncate">' + U.clock(it.dur || 0) + ' · ' + MS.humanSize(it.size) + ' · ' + U.esc(it.name) + '</div>' +
            '</div>' +
            badge +
            (canRemove ? '<button class="kick-btn" data-remove="' + it.id + '" title="Remove from playlist">' + U.icon('trash') + '</button>' : '') +
          '</div>';
        }).join('');
      }
      if (el.plEmpty) el.plEmpty.classList.toggle('hidden', list.length > 0);

      // members
      if (el.memberCount) el.memberCount.textContent = s.members.length;
      if (el.members) {
        el.members.innerHTML = s.members.map(function (id) {
          var u = S.getUser(id);
          if (!u) return '';
          var isHostUser = id === s.hostId;
          return '<div class="member-item">' + U.avatar(u, 32, S.isOnline(u)) +
            '<div class="grow"><div class="nm truncate">' + U.esc(u.name) + (id === me.id ? ' (you)' : '') + '</div>' +
            (isHostUser ? '<div class="tag">Host</div>' : '') + '</div>' +
            (state.isHost && !isHostUser
              ? '<button class="kick-btn" data-kick="' + id + '" title="Remove from room">' + U.icon('x') + '</button>'
              : '') +
          '</div>';
        }).join('');
      }

      // reactions
      var liked = s.likes.indexOf(me.id) >= 0;
      if (el.likeBtn) el.likeBtn.classList.toggle('liked', liked);
      if (el.likeCount) el.likeCount.textContent = s.likes.length;
      if (el.shareCount) el.shareCount.textContent = s.shares.length;
      if (el.commentCount) el.commentCount.textContent = s.comments.length;

      if (el.comments) {
        el.comments.innerHTML = s.comments.length
          ? s.comments.map(function (c) {
              var ca = S.getUser(c.authorId);
              return '<div class="comment">' + U.avatar(ca, 26) +
                '<div class="bubble"><b>' + U.esc(ca ? ca.name : '?') + '</b>' + U.esc(c.text) + '</div></div>';
            }).join('')
          : '<p class="tiny muted" style="margin:0 0 10px">No comments yet — say something.</p>';
      }

      if (el.endBtn) el.endBtn.classList.toggle('hidden', !state.isHost);
      if (el.repostBtn) {
        el.repostBtn.classList.toggle('hidden', !state.isHost);
        el.repostBtn.disabled = !!s.reposted;
        el.repostBtn.textContent = s.reposted ? 'Reposted to Home' : 'Repost to Home';
      }
      if (el.playBtn) el.playBtn.disabled = !list.length;

      updateProgress();
    }

    /* pick button injected into the empty stage */
    if (el.stage) {
      el.stage.addEventListener('click', function (e) {
        if (e.target.closest('[data-pick]')) {
          if (mode() === 'shared' && !state.isHost) {
            U.toast('Only the host uploads in this mode', 'err');
            return;
          }
          el.fileInput.value = '';
          el.fileInput.click();
        }
      });
    }

    /* playlist clicks: play + remove */
    if (el.playlist) {
      el.playlist.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-remove]');
        if (rm) {
          var item = items().filter(function (x) { return x.id === rm.dataset.remove; })[0];
          U.modal({
            title: 'Remove this ' + kind.noun + '?',
            sub: item ? item.name : '',
            okText: 'Remove',
            danger: true,
            onOk: function () {
              var r = S.removeRoomMedia(state.syncId, rm.dataset.remove);
              if (!r.ok) { U.toast(r.error, 'err'); return; }
              U.toast('Removed from the playlist');
              applyCurrentSource(true);
              render();
            }
          });
          return;
        }

        var row = e.target.closest('[data-track]');
        if (!row) return;
        if (!state.isHost) { U.toast('Only the host can change the track', 'err'); return; }
        var s = S.getSync(state.syncId);
        S.setPlayback(state.syncId, { index: Number(row.dataset.track), position: 0 });
        applyCurrentSource(true);
        render();
      });
    }

    /* ================= members / reactions ================= */

    if (el.members) {
      el.members.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-kick]');
        if (!btn) return;
        var u = S.getUser(btn.dataset.kick);
        U.modal({
          title: 'Remove ' + (u ? u.name : 'this member') + '?',
          sub: 'They will be removed from the room and cannot rejoin with this code.',
          okText: 'Remove',
          danger: true,
          onOk: function () {
            var r = S.kickMember(state.syncId, btn.dataset.kick);
            if (!r.ok) U.toast(r.error, 'err');
            else { U.toast('Member removed'); render(); }
          }
        });
      });
    }

    if (el.likeBtn) {
      el.likeBtn.addEventListener('click', function () {
        var r = S.toggleSyncLike(state.syncId);
        if (!r.ok) { U.toast('Sign in first', 'err'); return; }
        render();
      });
    }

    if (el.commentBtn) {
      el.commentBtn.addEventListener('click', function () {
        el.comments.classList.toggle('hidden');
        if (!el.comments.classList.contains('hidden')) el.commentInput.focus();
      });
    }

    if (el.commentForm) {
      el.commentForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var r = S.commentSync(state.syncId, el.commentInput.value);
        if (!r.ok) { U.toast(r.error, 'err'); return; }
        el.commentInput.value = '';
        render();
      });
    }

    if (el.shareBtn) {
      el.shareBtn.addEventListener('click', function () {
        var s = S.getSync(state.syncId);
        if (!s) return;
        var link = location.origin + location.pathname + '?code=' + s.code;
        U.copyText(link).then(function (ok) {
          U.toast(ok ? 'Invite link copied' : 'Code: ' + s.code);
        });
      });
    }

    if (el.copyBtn) {
      el.copyBtn.addEventListener('click', function () {
        var s = S.getSync(state.syncId);
        if (!s) return;
        U.copyText(s.code).then(function (ok) {
          U.toast(ok ? 'Code ' + s.code + ' copied' : 'Code: ' + s.code);
        });
      });
    }

    if (el.repostBtn) {
      el.repostBtn.addEventListener('click', function () {
        var r = S.repostSync(state.syncId);
        if (!r.ok) { U.toast(r.error, 'err'); return; }
        U.toast('Posted to Home — code ' + r.code);
        render();
      });
    }

    if (el.endBtn) {
      el.endBtn.addEventListener('click', function () {
        U.modal({
          title: 'End this sync?',
          sub: 'Everyone in the room will be disconnected and the code stops working.',
          okText: 'End sync',
          danger: true,
          onOk: function () {
            var r = S.endSync(state.syncId);
            if (!r.ok) { U.toast(r.error, 'err'); return; }
            U.toast('Sync ended');
            onEnded();
          }
        });
      });
    }

    if (el.leaveBtn) el.leaveBtn.addEventListener('click', function () { leaveRoom(); });

    function onEnded() {
      teardown();
      if (el.room) el.room.classList.add('hidden');
      if (el.lobby) el.lobby.classList.remove('hidden');
      U.toast('This sync has ended');
    }

    /* ---------------- video call + screen share ----------------
       Transport lives in js/webrtc.js, presentation in js/call-ui.js.
       The player above keeps running: neither the call nor the screen
       window touches state.media, so the synchronised track never stops.
       The call is keyed on the room CODE, so it works across devices
       (and across members) without any local sync record.
       ---------------------------------------------------------- */

    function callCode() {
      var s = S.getSync(state.syncId);
      if (s && s.code) return s.code;
      return (U.qs('code') || '').toUpperCase();
    }

    function ensureCall() {
      var code = callCode();
      if (!code) return null;
      if (PV.call && PV.call.engine && PV.call.engine.code === code) return PV.call;
      // Switching rooms: tear the old mesh down instead of leaking it.
      if (PV.call && PV.call.destroy) { PV.call.destroy(); PV.call = null; }
      if (!PV.callUI) return null;
      var s = S.getSync(state.syncId);
      PV.call = PV.callUI.mount({
        code: code,
        label: (s && s.name ? s.name : 'Room') + ' call',
        onCallEnded: function () {
          state.callOpen = false;
          if (el.callBtn) {
            el.callBtn.classList.remove('btn-accent');
            el.callBtn.innerHTML = U.icon('phone') + '<span>Video Call</span>';
          }
        }
      });
      return PV.call;
    }

    function hangUp() {
      if (PV.call && PV.call.destroy) {
        PV.call.destroy();
        PV.call = null;
      }
      state.callOpen = false;
      state.screenOpen = false;
      if (el.callBtn) {
        el.callBtn.innerHTML = U.icon('phone') + '<span>Video Call</span>';
        el.callBtn.classList.remove('btn-accent');
      }
      if (el.screenBtn) {
        el.screenBtn.innerHTML = U.icon('screen') + '<span>Share Screen</span>';
        el.screenBtn.classList.remove('btn-accent');
      }
    }

    // Back-compat aliases used by teardown().
    function closeCall() { hangUp(); }
    function closeScreen() { hangUp(); }

    if (el.callBtn) {
      el.callBtn.addEventListener('click', function () {
        var call = ensureCall();
        if (!call) { U.toast('Join the sync first, then start a call', 'err'); return; }
        call.startCall();
        state.callOpen = call.isInCall();
      });
    }

    if (el.screenBtn) {
      el.screenBtn.addEventListener('click', function () {
        var call = ensureCall();
        if (!call) { U.toast('Join the sync first, then share your screen', 'err'); return; }
        if (!call.isInCall()) {
          U.toast('Start the video call first \u2014 screen sharing runs alongside it', 'err');
          return;
        }
        call.toggleScreen();
      });
    }

    // Keep the page buttons in sync with the module's real state.
    setInterval(function () {
      if (!PV.call || !state.syncId) return;
      var inCall = PV.call.isInCall();
      var n = PV.call.participantCount();
      if (el.callBtn && el.callBtn.classList.contains('btn-accent') !== inCall) {
        el.callBtn.classList.toggle('btn-accent', inCall);
        el.callBtn.innerHTML = U.icon('phone') + '<span>' +
          (inCall ? (n > 1 ? 'Leave Call \u00b7 ' + n : 'Leave Call') : 'Video Call') + '</span>';
      }
      var sharing = PV.call.engine && PV.call.engine.sharing;
      if (el.screenBtn && el.screenBtn.classList.contains('btn-accent') !== !!sharing) {
        el.screenBtn.classList.toggle('btn-accent', !!sharing);
        el.screenBtn.innerHTML = U.icon('screen') + '<span>' + (sharing ? 'Stop Sharing' : 'Share Screen') + '</span>';
      }
    }, 1200);

    /* ================= live updates ================= */

    S.subscribe(function (reason) {
      if (reason === 'session') { if (!S.currentUser()) location.replace('index.html'); return; }
      if (!state.syncId) return;
      var s = S.getSync(state.syncId);
      if (!s) { onEnded(); return; }
      if (s.ended) { onEnded(); return; }
      if (s.members.indexOf(me.id) < 0) {
        U.toast('The host removed you from this sync', 'err');
        leaveRoom(true);
        return;
      }

      var list = items();
      var idx = Math.min(s.playback.index, Math.max(0, list.length - 1));
      var changedTrack = idx !== state.lastIndex;
      state.lastIndex = idx;

      if (changedTrack || (state.itemId && !list.some(function (x) { return x.id === state.itemId; }))) {
        applyCurrentSource(true);
      } else {
        applyPlayback(false);
      }
      render();
    });

    /* ================= boot ================= */

    var code = U.qs('code');
    if (code) {
      var res = S.joinSync(code);
      if (res.ok) {
        if (res.sync.type !== type) {
          location.href = (res.sync.type === 'music' ? 'music-sync.html' : 'video-sync.html') +
            '?code=' + encodeURIComponent(code);
          return;
        }
        enterRoom(res.sync.id);
      } else {
        lobbyError(res.error);
        if (el.joinCode) el.joinCode.value = code;
      }
    }

    if (el.createName && !el.createName.value) {
      el.createName.value = type === 'music' ? 'Uganda Music' : 'Friday Film Club';
    }
  }

  PV.syncRoom = { init: init };
})();
