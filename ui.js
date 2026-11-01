/* ============================================================
   PowerVerse — shared UI helpers
   Icons, nav, toasts, modals, avatars, time, media (WebRTC-ish)
   ============================================================ */
(function () {
  'use strict';

  var PV = window.PV = window.PV || {};

  /* ---------------- icons ---------------- */
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    rooms: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    music: '<circle cx="7" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M10 18V6l11-2v12"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="m16 11 6-3.5v9L16 13z"/>',
    game: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3M16 11.5h.01M18.5 14h.01"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>',
    comment: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 0 1 11 4h2a8 8 0 0 1 8 8z"/>',
    share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M12 16V3M8 7l4-4 4 4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    skipBack: '<path d="M19 20 9 12l10-8z"/><path d="M5 4v16"/>',
    skipFwd: '<path d="M5 4l10 8-10 8z"/><path d="M19 4v16"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5"/><path d="M17 5.2a3.5 3.5 0 0 1 0 6.6M18 14.5c2.4.6 4 2.3 4 5.5"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    verified: '<path d="m9 12 2 2 4-4"/><path d="M12 2 15 5h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4z"/>',
    fire: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4-6-4-10.5-3 1.5-4 4-4 6-1-.5-2-1.5-2-3-2 2-4 4.5-4 7.5C5 19.3 8 22 12 22z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/><path d="M2 2l20 20"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
    micOff: '<path d="M2 2l20 20"/><path d="M9 9v3a3 3 0 0 0 5 2M15 9V5a3 3 0 0 0-5.9-.7"/><path d="M5 11a7 7 0 0 0 10.5 6M19 11a7 7 0 0 1-.6 2.8M12 18v4"/>',
    camOff: '<path d="M2 2l20 20"/><path d="M16 16v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2M16 8l6-3.5v9l-3-1.7"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'
  };

  function icon(name, cls) {
    var d = P[name] || P.sparkle;
    return '<svg class="' + (cls || '') + '" width="1em" height="1em" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + d + '</svg>';
  }

  /* ---------------- escape ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------- time ---------------- */
  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 90) return '1m';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 7200) return '1h';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 172800) return 'yesterday';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- avatar ---------------- */
  function initials(name) {
    return (name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function avatar(user, size, online) {
    size = size || 40;
    if (!user) {
      return '<div class="avatar" style="width:' + size + 'px;height:' + size + 'px;display:grid;place-items:center;font-size:' +
        Math.round(size / 2.6) + 'px;font-weight:800;color:#8b95a8">?</div>';
    }
    var inner = user.avatar
      ? '<img class="avatar" src="' + esc(user.avatar) + '" alt="' + esc(user.name) + '" ' +
        'style="width:' + size + 'px;height:' + size + 'px" onerror="this.style.display=\'none\'">'
      : '<div class="avatar" style="width:' + size + 'px;height:' + size + 'px;display:grid;place-items:center;' +
        'font-size:' + Math.round(size / 2.6) + 'px;font-weight:800;color:#fff;background:linear-gradient(140deg,#ff5c38,#ff2d55)">' +
        esc(initials(user.name)) + '</div>';
    if (online) {
      return '<span class="avatar-wrap">' + inner + '<span class="dot-online"></span></span>';
    }
    return inner;
  }

  /* ---------------- toast ---------------- */
  function toast(msg, kind) {
    var host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.innerHTML = icon(kind === 'err' ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, 2400);
  }

  /* ---------------- modal ---------------- */
  function modal(opts) {
    var back = document.createElement('div');
    back.className = 'modal-back open';
    back.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<h3>' + esc(opts.title || '') + '</h3>' +
        (opts.sub ? '<p class="sub">' + esc(opts.sub) + '</p>' : '') +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        '<div class="modal-actions">' +
          (opts.cancel === false ? '' : '<button class="btn btn-ghost" data-mc>' + esc(opts.cancelText || 'Cancel') + '</button>') +
          '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-mok>' + esc(opts.okText || 'Confirm') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(back);

    function close() { back.remove(); }
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    var cancelBtn = back.querySelector('[data-mc]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { close(); if (opts.onCancel) opts.onCancel(); });
    back.querySelector('[data-mok]').addEventListener('click', function () {
      var ok = opts.onOk ? opts.onOk(back) : true;
      if (ok !== false) close();
    });
    if (opts.onMount) opts.onMount(back, close);
    var first = back.querySelector('input, textarea');
    if (first) setTimeout(function () { first.focus(); }, 60);
    return { el: back, close: close };
  }

  /* ---------------- nav ---------------- */
  var NAV = [
    { key: 'home', label: 'Home', href: 'home.html', icon: 'home' },
    { key: 'rooms', label: 'Rooms', href: 'rooms.html', icon: 'rooms' },
    { key: 'my', label: 'My', href: 'my-profile.html', icon: 'user' }
  ];

  function renderNav(active) {
    var side = document.getElementById('sidebar');
    if (side) {
      var me = PV.store.currentUser();
      side.innerHTML =
        '<a class="brand" href="home.html">' +
          '<div class="brand-mark">P</div>' +
          '<div class="brand-name">Power<span>Verse</span></div>' +
        '</a>' +
        NAV.map(function (n) {
          return '<a class="nav-item' + (n.key === active ? ' active' : '') + '" href="' + n.href + '">' +
            icon(n.icon) + '<span>' + n.label + '</span></a>';
        }).join('') +
        '<div class="sidebar-foot">' +
          (me ? '<a class="nav-item" href="my-profile.html">' + avatar(me, 30, true) +
            '<span class="truncate">' + esc(me.name) + '</span></a>' : '') +
        '</div>';
    }

    var top = document.getElementById('topbar');
    if (top) {
      top.innerHTML =
        '<a class="brand" href="home.html">' +
          '<div class="brand-mark">P</div>' +
          '<div class="brand-name">Power<span>Verse</span></div>' +
        '</a>' +
        '<div class="row" style="gap:6px">' +
          '<a class="icon-btn" href="my-profile.html" aria-label="My profile">' + icon('user') + '</a>' +
        '</div>';
    }

    var bn = document.getElementById('bottomnav');
    if (bn) {
      bn.innerHTML = NAV.map(function (n) {
        return '<a class="bn-item' + (n.key === active ? ' active' : '') + '" href="' + n.href + '">' +
          icon(n.icon) + '<span>' + n.label + '</span></a>';
      }).join('');
    }
  }

  /* ---------------- auth guard ---------------- */
  function requireAuth() {
    var me = PV.store.currentUser();
    if (!me) {
      window.location.replace('index.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
      return null;
    }
    return me;
  }

  /* ---------------- image reading ---------------- */
  function readImage(file, maxW) {
    maxW = maxW || 1100;
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file'));
      if (!/^image\//.test(file.type)) return reject(new Error('That file is not an image.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('Image is too large (max 8MB).'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read that file.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That image could not be opened.')); };
        img.onload = function () {
          var scale = Math.min(1, maxW / img.width);
          var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', 0.82)); }
          catch (e) { resolve(fr.result); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- media: camera + screen ---------------- */
  var media = {
    callStream: null,
    screenStream: null,

    startCall: function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser does not support camera access. Try Chrome, Edge or Safari on a secure (https) page.'));
      }
      return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
        .then(function (stream) { media.callStream = stream; return stream; })
        .catch(function (err) {
          var msg = 'Camera unavailable.';
          if (err && err.name === 'NotAllowedError') msg = 'Camera permission was blocked. Allow it in your browser settings and try again.';
          else if (err && err.name === 'NotFoundError') msg = 'No camera found on this device.';
          else if (err && err.name === 'NotReadableError') msg = 'Your camera is being used by another app.';
          throw new Error(msg);
        });
    },

    stopCall: function () {
      if (media.callStream) {
        media.callStream.getTracks().forEach(function (t) { t.stop(); });
        media.callStream = null;
      }
    },

    startScreen: function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        return Promise.reject(new Error('Screen sharing is not supported in this browser. Try desktop Chrome or Edge.'));
      }
      return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 12 }, audio: false })
        .then(function (stream) { media.screenStream = stream; return stream; })
        .catch(function (err) {
          var msg = 'Screen share cancelled.';
          if (err && err.name === 'NotAllowedError') msg = 'Screen sharing was blocked or cancelled.';
          else if (err && err.name === 'NotSupportedError') msg = 'Screen sharing needs a desktop browser.';
          throw new Error(msg);
        });
    },

    stopScreen: function () {
      if (media.screenStream) {
        media.screenStream.getTracks().forEach(function (t) { t.stop(); });
        media.screenStream = null;
      }
    }
  };

  /* ---------------- floating windows ---------------- */
  function floatWindow(kind, title, onClose) {
    var id = 'float-' + kind;
    var old = document.getElementById(id);
    if (old) old.remove();

    var el = document.createElement('div');
    el.className = 'float-win ' + kind;
    el.id = id;
    el.innerHTML =
      '<div class="bar">' +
        '<span class="lbl">' + icon(kind === 'call' ? 'phone' : 'screen') + esc(title) + '</span>' +
        '<button data-close aria-label="Close">' + icon('x') + '</button>' +
      '</div>' +
      '<div class="fw-body"></div>';
    document.body.appendChild(el);
    el.querySelector('[data-close]').addEventListener('click', function () {
      el.remove();
      if (onClose) onClose();
    });
    return el.querySelector('.fw-body');
  }

  /* ---------------- misc ---------------- */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return fallback(); });
    }
    return Promise.resolve(fallback());
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch (e) { return false; }
    }
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  PV.ui = {
    icon: icon, esc: esc, timeAgo: timeAgo, clock: clock,
    avatar: avatar, initials: initials, toast: toast, modal: modal,
    renderNav: renderNav, requireAuth: requireAuth, readImage: readImage,
    media: media, floatWindow: floatWindow, copyText: copyText, qs: qs
  };
})();
