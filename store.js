/* ============================================================
   PowerVerse — data layer
   ------------------------------------------------------------
   Single source of truth for the whole app. Everything goes
   through PV.store so the storage engine can be swapped.

   Current engine: localStorage + polling/storage events
   (simulated real-time, works in one browser and across tabs).

   To move to Firebase: implement the same method surface in
   js/firebase-adapter.js and set PV.store.engine = 'firebase'.
   See that file for the exact swap notes.
   ============================================================ */
(function () {
  'use strict';

  var DB_KEY = 'powerverse.db.v1';
  var SESSION_KEY = 'powerverse.session.v1';
  // Uploaded (shared) media lives under its OWN key: the room document keeps
  // only a tiny pointer, so one 3MB upload can never balloon every database
  // read or blow the quota on an unrelated post.
  var SHARED_KEY = 'powerverse.sharedmedia.v1';
  var SALT = 'pv::v1::';

  /* ---------------- tiny utils ---------------- */
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function hash(str) {
    var h = 5381, i;
    for (i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(36);
  }
  function now() { return Date.now(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- seed ---------------- */
  function seed() {
    var t = now();
    var min = 60000;
    var users = [
      { id: 'u_aisha', name: 'Aisha Nakato', username: 'aisha', password: hash(SALT + 'demo1234'),
        bio: 'Kampala-based producer. Afrobeat, amapiano, and late-night studio sessions. 🎧',
        avatar: 'images/av1.jpg', online: true, lastSeen: t, createdAt: t - 90 * 24 * 60 * min },
      { id: 'u_brian', name: 'Brian Okello', username: 'brian', password: hash(SALT + 'demo1234'),
        bio: 'Frontend dev. I break things then fix them. Sync rooms are my happy place.',
        avatar: 'images/av2.jpg', online: true, lastSeen: t, createdAt: t - 70 * 24 * 60 * min },
      { id: 'u_zara', name: 'Zara Mensah', username: 'zara', password: hash(SALT + 'demo1234'),
        bio: 'Film student · Accra → Kampala. I watch everything twice.',
        avatar: 'images/av3.jpg', online: true, lastSeen: t, createdAt: t - 55 * 24 * 60 * min },
      { id: 'u_daniel', name: 'Daniel Kigozi', username: 'dkigozi', password: hash(SALT + 'demo1234'),
        bio: 'Quiz host. Trivia is a personality trait, apparently.',
        avatar: 'images/av4.jpg', online: false, lastSeen: t - 42 * min, createdAt: t - 40 * 24 * 60 * min },
      { id: 'u_nadia', name: 'Nadia Achieng', username: 'nadia', password: hash(SALT + 'demo1234'),
        bio: 'Playlist curator. If it slaps, I have already added it.',
        avatar: 'images/av5.jpg', online: true, lastSeen: t, createdAt: t - 30 * 24 * 60 * min },
      { id: 'u_sam', name: 'Samuel Otim', username: 'sam', password: hash(SALT + 'demo1234'),
        bio: 'Matatu champion (self-declared). Ask me about the rules.',
        avatar: 'images/av6.jpg', online: false, lastSeen: t - 3 * 60 * min, createdAt: t - 20 * 24 * 60 * min },
      { id: 'u_demo', name: 'Demo User', username: 'demo', password: hash(SALT + 'demo1234'),
        bio: 'Just here to test the sync rooms. Say hi 👋',
        avatar: 'images/av2.jpg', online: true, lastSeen: t, createdAt: t - 10 * 24 * 60 * min }
    ];

    var posts = [
      { id: 'p_1', authorId: 'u_aisha', text: 'New loop finished at 3am. This one is for the Kampala night bus crowd 🚌🎶',
        image: 'images/post1.jpg', createdAt: t - 14 * min, likes: ['u_brian', 'u_nadia', 'u_zara'],
        shares: ['u_brian'], comments: [
          { id: 'c_1', authorId: 'u_nadia', text: 'This is unreal. Send it to the sync room tonight?', createdAt: t - 11 * min },
          { id: 'c_2', authorId: 'u_aisha', text: 'Already queued 😌', createdAt: t - 9 * min }
        ] },
      { id: 'p_2', authorId: 'u_zara', text: 'Watched a 1974 film print last night. The grain alone was worth the ticket.',
        image: 'images/post2.jpg', createdAt: t - 52 * min, likes: ['u_aisha', 'u_daniel'],
        shares: [], comments: [
          { id: 'c_3', authorId: 'u_daniel', text: 'Which one? I need the title.', createdAt: t - 40 * min }
        ] },
      { id: 'p_3', authorId: 'u_brian', text: 'Shipped the sync engine today. Two tabs, one song, zero drift. Small win but I will take it.',
        image: '', createdAt: t - 2 * 60 * min, likes: ['u_aisha', 'u_zara', 'u_nadia', 'u_sam'],
        shares: [], comments: [] },
      { id: 'p_4', authorId: 'u_nadia', text: 'Sunday reset playlist is up. Slow start, big finish.',
        image: 'images/post3.jpg', createdAt: t - 4 * 60 * min, likes: ['u_brian'],
        shares: ['u_zara'], comments: [] },
      { id: 'p_5', authorId: 'u_sam', text: 'Matatu rules reminder: you can only play a card if it matches colour OR number. Yes I have strong feelings about this.',
        image: '', createdAt: t - 7 * 60 * min, likes: ['u_daniel', 'u_brian'],
        shares: [], comments: [
          { id: 'c_4', authorId: 'u_daniel', text: 'The house rules are the real rules.', createdAt: t - 6 * 60 * min }
        ] },
      { id: 'p_6', authorId: 'u_aisha', text: 'Studio view. Nothing else to report.',
        image: 'images/post4.jpg', createdAt: t - 11 * 60 * min, likes: ['u_nadia', 'u_zara', 'u_brian', 'u_daniel', 'u_sam'],
        shares: [], comments: [] }
    ];

    var follows = [
      { followerId: 'u_demo', followingId: 'u_aisha' },
      { followerId: 'u_demo', followingId: 'u_brian' },
      { followerId: 'u_aisha', followingId: 'u_demo' },
      { followerId: 'u_brian', followingId: 'u_aisha' },
      { followerId: 'u_zara', followingId: 'u_aisha' },
      { followerId: 'u_nadia', followingId: 'u_aisha' },
      { followerId: 'u_daniel', followingId: 'u_aisha' },
      { followerId: 'u_aisha', followingId: 'u_nadia' },
      { followerId: 'u_brian', followingId: 'u_zara' },
      { followerId: 'u_sam', followingId: 'u_brian' }
    ];

    var syncs = [
      { id: 's_seed1', code: 'KAMPALA', type: 'music', name: 'Uganda Music', hostId: 'u_aisha',
        members: ['u_aisha', 'u_nadia', 'u_brian'], kicked: [], createdAt: t - 22 * min, ended: false,
        // No built-in sample library: a room stays empty until someone picks a
        // file from their own device. See js/media-store.js.
        media: { mode: 'local', items: [] },
        playback: { index: 0, playing: false, position: 0, updatedAt: t },
        likes: ['u_brian'], comments: [], shares: [], reposted: false },
      { id: 's_seed2', code: 'CINEMA', type: 'video', name: 'Friday Film Club', hostId: 'u_zara',
        members: ['u_zara', 'u_daniel'], kicked: [], createdAt: t - 8 * min, ended: false,
        media: { mode: 'local', items: [] },
        playback: { index: 0, playing: false, position: 0, updatedAt: t },
        likes: [], comments: [], shares: [], reposted: false }
    ];

    return {
      _rev: 1,
      users: users,
      posts: posts,
      follows: follows,
      syncs: syncs,
      meta: { seededAt: t }
    };
  }

  /* ---------------- persistence ---------------- */
  var db = null;
  var listeners = [];
  var lastRaw = '';

  function readRaw() {
    try { return localStorage.getItem(DB_KEY) || ''; } catch (e) { return ''; }
  }

  function load() {
    var raw = readRaw();
    if (!raw) {
      db = seed();
      write();
      return db;
    }
    try {
      db = JSON.parse(raw);
      if (!db || !db.users) throw new Error('bad shape');
    } catch (e) {
      db = seed();
      write();
    }
    lastRaw = readRaw();
    return db;
  }

  function write() {
    db._rev = (db._rev || 0) + 1;
    var raw = JSON.stringify(db);
    try {
      localStorage.setItem(DB_KEY, raw);
      lastRaw = raw;
    } catch (e) {
      // Quota exceeded — most likely a large image data URL.
      console.warn('[PowerVerse] storage write failed', e);
      throw new Error('Storage is full. Try a smaller image.');
    }
  }

  function emit(reason) {
    listeners.forEach(function (fn) {
      try { fn(reason || 'change'); } catch (e) { console.error(e); }
    });
  }

  function commit(reason) {
    write();
    emit(reason);
  }

  /* ---------------- cross-tab realtime ---------------- */
  function poll() {
    var raw = readRaw();
    if (raw && raw !== lastRaw) {
      try {
        db = JSON.parse(raw);
        lastRaw = raw;
        emit('remote');
      } catch (e) { /* ignore transient */ }
    }
  }

  window.addEventListener('storage', function (e) {
    if (e.key === DB_KEY) poll();
    if (e.key === SESSION_KEY) emit('session');
  });

  setInterval(poll, 1200);

  /* ---------------- session ---------------- */
  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
    emit('session');
  }

  /* ---------------- auth ---------------- */
  function signup(name, username, password) {
    name = (name || '').trim();
    username = (username || '').trim().toLowerCase().replace(/^@/, '');
    password = password || '';

    if (name.length < 2) return { ok: false, error: 'Please enter your name (at least 2 characters).' };
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      return { ok: false, error: 'Username must be 3–20 characters: letters, numbers, dots or underscores only.' };
    }
    if (password.length < 6) return { ok: false, error: 'Password needs at least 6 characters.' };
    if (db.users.some(function (u) { return u.username === username; })) {
      return { ok: false, error: 'That username is already taken. Try another one.' };
    }

    var user = {
      id: uid('u'), name: name, username: username,
      password: hash(SALT + password),
      bio: '', avatar: '', online: true, lastSeen: now(), createdAt: now()
    };
    db.users.push(user);
    commit('signup');
    setSession({ userId: user.id, at: now() });
    return { ok: true, user: user };
  }

  function login(username, password) {
    username = (username || '').trim().toLowerCase().replace(/^@/, '');
    if (!username || !password) {
      return { ok: false, error: 'Enter both your username and password.' };
    }
    var user = db.users.filter(function (u) { return u.username === username; })[0];
    if (!user) {
      return { ok: false, error: 'We could not find that username. Check the spelling or sign up.' };
    }
    if (user.password !== hash(SALT + password)) {
      return { ok: false, error: 'That password is not right. Try again.' };
    }
    user.online = true;
    user.lastSeen = now();
    commit('login');
    setSession({ userId: user.id, at: now() });
    return { ok: true, user: user };
  }

  function logout() {
    var u = currentUser();
    if (u) { u.online = false; u.lastSeen = now(); commit('logout'); }
    setSession(null);
  }

  function currentUser() {
    var s = getSession();
    if (!s) return null;
    return db.users.filter(function (u) { return u.id === s.userId; })[0] || null;
  }

  function changePassword(oldPw, newPw) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'You are not signed in.' };
    if (me.password !== hash(SALT + oldPw)) return { ok: false, error: 'Your current password is incorrect.' };
    if (!newPw || newPw.length < 6) return { ok: false, error: 'New password needs at least 6 characters.' };
    me.password = hash(SALT + newPw);
    commit('password');
    return { ok: true };
  }

  /* ---------------- users ---------------- */
  function getUser(id) {
    return db.users.filter(function (u) { return u.id === id; })[0] || null;
  }
  function getUserByUsername(username) {
    username = (username || '').toLowerCase();
    return db.users.filter(function (u) { return u.username === username; })[0] || null;
  }
  function allUsers() { return db.users.slice(); }

  function isOnline(u) {
    if (!u) return false;
    if (u.id === (getSession() || {}).userId) return true;
    return !!u.online && (now() - (u.lastSeen || 0) < 10 * 60 * 1000);
  }
  function onlineUsers() {
    return db.users.filter(isOnline);
  }

  function updateProfile(patch) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Not signed in.' };
    if (patch.name !== undefined) {
      if (!patch.name.trim() || patch.name.trim().length < 2) return { ok: false, error: 'Name is too short.' };
      me.name = patch.name.trim();
    }
    if (patch.bio !== undefined) me.bio = patch.bio.slice(0, 200);
    if (patch.avatar !== undefined) me.avatar = patch.avatar;
    commit('profile');
    return { ok: true };
  }

  /* ---------------- follows ---------------- */
  function isFollowing(followerId, followingId) {
    return db.follows.some(function (f) {
      return f.followerId === followerId && f.followingId === followingId;
    });
  }
  function toggleFollow(targetId) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    if (me.id === targetId) return { ok: false, error: 'You cannot follow yourself.' };
    var idx = -1;
    db.follows.forEach(function (f, i) {
      if (f.followerId === me.id && f.followingId === targetId) idx = i;
    });
    var following;
    if (idx >= 0) { db.follows.splice(idx, 1); following = false; }
    else { db.follows.push({ followerId: me.id, followingId: targetId }); following = true; }
    commit('follow');
    return { ok: true, following: following };
  }
  function followerCount(userId) {
    return db.follows.filter(function (f) { return f.followingId === userId; }).length;
  }
  function followingCount(userId) {
    return db.follows.filter(function (f) { return f.followerId === userId; }).length;
  }
  function followersOf(userId) {
    return db.follows.filter(function (f) { return f.followingId === userId; })
      .map(function (f) { return getUser(f.followerId); }).filter(Boolean);
  }
  function followingOf(userId) {
    return db.follows.filter(function (f) { return f.followerId === userId; })
      .map(function (f) { return getUser(f.followingId); }).filter(Boolean);
  }

  /* ---------------- posts ---------------- */
  function createPost(opts) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    var text = (opts.text || '').trim();
    var image = opts.image || '';
    if (!text && !image) return { ok: false, error: 'Write something or add a photo first.' };
    var post = {
      id: uid('p'), authorId: me.id, text: text, image: image,
      createdAt: now(), likes: [], shares: [], comments: []
    };
    db.posts.push(post);
    commit('post');
    return { ok: true, post: post };
  }

  function getPost(id) {
    return db.posts.filter(function (p) { return p.id === id; })[0] || null;
  }

  function feed() {
    return db.posts.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function postsBy(userId) {
    return db.posts.filter(function (p) { return p.authorId === userId; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function toggleLike(postId) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    var p = getPost(postId);
    if (!p) return { ok: false, error: 'Post not found.' };
    var i = p.likes.indexOf(me.id);
    var liked;
    if (i >= 0) { p.likes.splice(i, 1); liked = false; }
    else { p.likes.push(me.id); liked = true; }
    commit('like');
    return { ok: true, liked: liked, count: p.likes.length };
  }

  function addComment(postId, text) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    text = (text || '').trim();
    if (!text) return { ok: false, error: 'Comment cannot be empty.' };
    var p = getPost(postId);
    if (!p) return { ok: false, error: 'Post not found.' };
    p.comments.push({ id: uid('c'), authorId: me.id, text: text.slice(0, 500), createdAt: now() });
    commit('comment');
    return { ok: true };
  }

  function sharePost(postId) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    var p = getPost(postId);
    if (!p) return { ok: false, error: 'Post not found.' };
    if (p.shares.indexOf(me.id) < 0) p.shares.push(me.id);
    var repost = {
      id: uid('p'), authorId: me.id, text: '', image: '',
      repostOf: p.id, createdAt: now(), likes: [], shares: [], comments: []
    };
    db.posts.push(repost);
    commit('share');
    return { ok: true, count: p.shares.length };
  }

  function deletePost(postId) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    var p = getPost(postId);
    if (!p) return { ok: false, error: 'Post not found.' };
    if (p.authorId !== me.id) return { ok: false, error: 'You can only delete your own posts.' };
    db.posts = db.posts.filter(function (x) { return x.id !== postId && x.repostOf !== postId; });
    commit('delete');
    return { ok: true };
  }

  function likesReceived(userId) {
    return db.posts.filter(function (p) { return p.authorId === userId; })
      .reduce(function (sum, p) { return sum + p.likes.length; }, 0);
  }

  /* ---------------- syncs ---------------- */
  function makeCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code;
    do {
      code = '';
      for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (db.syncs.some(function (s) { return s.code === code && !s.ended; }));
    return code;
  }

  function createSync(type, name, gameType) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    name = (name || '').trim();
    if (!name) return { ok: false, error: 'Give your sync a name.' };
    var s = {
      id: uid('s'), code: makeCode(), type: type, name: name.slice(0, 60),
      gameType: gameType || null,
      hostId: me.id, members: [me.id], kicked: [],
      createdAt: now(), ended: false,
      playback: { index: 0, playing: false, position: 0, updatedAt: now() },
      game: gameType ? { qIndex: 0, scores: {}, answers: {}, startedAt: now() } : null,
      likes: [], comments: [], shares: [], reposted: false
    };
    db.syncs.push(s);
    commit('sync-create');
    return { ok: true, sync: s };
  }

  function getSync(id) {
    return db.syncs.filter(function (s) { return s.id === id; })[0] || null;
  }
  function getSyncByCode(code) {
    code = (code || '').trim().toUpperCase();
    return db.syncs.filter(function (s) { return s.code === code && !s.ended; })[0] || null;
  }
  function activeSyncs(type) {
    return db.syncs.filter(function (s) {
      return !s.ended && (!type || s.type === type);
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function joinSync(code) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    var s = getSyncByCode(code);
    if (!s) return { ok: false, error: 'No live sync found with that code. Check it and try again.' };
    if (s.kicked.indexOf(me.id) >= 0) {
      return { ok: false, error: 'The host removed you from this sync.' };
    }
    if (s.members.indexOf(me.id) < 0) {
      s.members.push(me.id);
      commit('sync-join');
    }
    return { ok: true, sync: s };
  }

  function leaveSync(syncId) {
    var me = currentUser();
    if (!me) return { ok: false };
    var s = getSync(syncId);
    if (!s) return { ok: false };
    s.members = s.members.filter(function (id) { return id !== me.id; });
    if (s.hostId === me.id) { s.ended = true; }
    commit('sync-leave');
    return { ok: true };
  }

  function endSync(syncId) {
    var me = currentUser();
    var s = getSync(syncId);
    if (!s) return { ok: false, error: 'Sync not found.' };
    if (!me || s.hostId !== me.id) return { ok: false, error: 'Only the host can end this sync.' };
    s.ended = true;
    s.playback.playing = false;
    commit('sync-end');
    return { ok: true };
  }

  function kickMember(syncId, userId) {
    var me = currentUser();
    var s = getSync(syncId);
    if (!s) return { ok: false, error: 'Sync not found.' };
    if (!me || s.hostId !== me.id) return { ok: false, error: 'Only the host can remove members.' };
    if (userId === s.hostId) return { ok: false, error: 'The host cannot be removed.' };
    s.members = s.members.filter(function (id) { return id !== userId; });
    if (s.kicked.indexOf(userId) < 0) s.kicked.push(userId);
    commit('sync-kick');
    return { ok: true };
  }

  function setPlayback(syncId, patch) {
    var s = getSync(syncId);
    if (!s) return { ok: false };
    var p = s.playback;
    if (patch.index !== undefined) p.index = patch.index;
    if (patch.playing !== undefined) p.playing = patch.playing;
    if (patch.position !== undefined) p.position = patch.position;
    p.updatedAt = now();
    commit('sync-playback');
    return { ok: true };
  }

  function syncPosition(s) {
    var p = s.playback || { position: 0, playing: false, updatedAt: now() };
    if (!p.playing) return p.position || 0;
    return (p.position || 0) + (now() - (p.updatedAt || now())) / 1000;
  }

  function toggleSyncLike(syncId) {
    var me = currentUser();
    if (!me) return { ok: false };
    var s = getSync(syncId);
    if (!s) return { ok: false };
    var i = s.likes.indexOf(me.id);
    if (i >= 0) s.likes.splice(i, 1); else s.likes.push(me.id);
    commit('sync-like');
    return { ok: true, liked: i < 0 };
  }

  function commentSync(syncId, text) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    text = (text || '').trim();
    if (!text) return { ok: false, error: 'Comment cannot be empty.' };
    var s = getSync(syncId);
    if (!s) return { ok: false };
    s.comments.push({ id: uid('c'), authorId: me.id, text: text.slice(0, 300), createdAt: now() });
    commit('sync-comment');
    return { ok: true };
  }

  function repostSync(syncId) {
    var me = currentUser();
    if (!me) return { ok: false, error: 'Sign in first.' };
    var s = getSync(syncId);
    if (!s) return { ok: false, error: 'Sync not found.' };
    if (s.hostId !== me.id) return { ok: false, error: 'Only the host can repost this sync.' };
    if (s.reposted) return { ok: false, error: 'This sync is already on your feed.' };
    s.reposted = true;
    if (s.shares.indexOf(me.id) < 0) s.shares.push(me.id);
    db.posts.push({
      id: uid('p'), authorId: me.id, text: '', image: '',
      syncRef: { id: s.id, code: s.code, type: s.type, name: s.name },
      createdAt: now(), likes: [], shares: [], comments: []
    });
    commit('sync-repost');
    return { ok: true, code: s.code };
  }

  function updateGame(syncId, patch) {
    var s = getSync(syncId);
    if (!s) return { ok: false };
    s.game = Object.assign({}, s.game || { qIndex: 0, scores: {}, answers: {} }, patch);
    commit('game');
    return { ok: true };
  }

  /* ---------------- sync media (files from the user's device) ----------------
     The room document only ever holds METADATA for each file — name, size,
     duration and (for shared uploads) a pointer. The bytes never enter it:
       • local mode  → each device keeps its own copy in IndexedDB
       • shared mode → one data URL under SHARED_KEY, looked up by `upid`
     Moving this to Firebase Storage means changing putSharedMedia() only.
  ---------------------------------------------------------------------- */

  function getRoomMedia(syncId) {
    var s = getSync(syncId);
    if (!s) return { mode: 'local', items: [] };
    return ensureMedia(s);
  }

  function ensureMedia(s) {
    if (!s.media || typeof s.media !== 'object') s.media = { mode: 'local', items: [] };
    if (!Array.isArray(s.media.items)) s.media.items = [];
    if (s.media.mode !== 'shared') s.media.mode = 'local';
    return s.media;
  }

  function setMediaMode(syncId, mode) {
    var me = currentUser();
    var s = getSync(syncId);
    if (!s) return { ok: false, error: 'Sync not found.' };
    if (!me || s.hostId !== me.id) {
      return { ok: false, error: 'Only the host can switch the media source.' };
    }
    if (mode !== 'local' && mode !== 'shared') return { ok: false, error: 'Unknown media mode.' };
    ensureMedia(s).mode = mode;
    commit('sync-media-mode');
    return { ok: true, mode: mode };
  }

  /* Add a file to the room playlist. Any member may add — that is how a
     participant contributes their own copy. If a file with the same
     normalised name is already listed we MATCH it instead of adding a
     duplicate row; the client then binds that member's local copy to the
     existing item, and duration is filled in for everyone. */
  function addRoomMedia(syncId, item) {
    var me = currentUser();
    var s = getSync(syncId);
    if (!s) return { ok: false, error: 'Sync not found.' };
    if (!me) return { ok: false, error: 'Sign in first.' };
    if (s.members.indexOf(me.id) < 0) return { ok: false, error: 'You are not in this room.' };
    if (s.ended) return { ok: false, error: 'This sync has ended.' };

    var m = ensureMedia(s);
    var norm = mediaNorm(item.name);
    var existing = norm ? (m.items.filter(function (x) { return x.norm === norm; })[0] || null) : null;

    if (existing) {
      if (!existing.dur && item.dur) existing.dur = item.dur;
      if (!existing.size && item.size) existing.size = item.size;
      if (item.upid && !existing.upid) existing.upid = item.upid;
      commit('sync-media-match');
      return { ok: true, item: existing, matched: true };
    }

    var entry = {
      id: item.id || uid('mi'),
      name: item.name || 'Untitled',
      title: item.title || mediaTitle(item.name),
      norm: norm,
      size: item.size || 0,
      mime: item.mime || '',
      dur: item.dur || 0,
      upid: item.upid || null,
      addedBy: me.id,
      at: now()
    };
    m.items.push(entry);
    commit('sync-media-add');
    return { ok: true, item: entry, matched: false };
  }

  function removeRoomMedia(syncId, itemId) {
    var me = currentUser();
    var s = getSync(syncId);
    if (!s) return { ok: false, error: 'Sync not found.' };
    if (!me) return { ok: false, error: 'Sign in first.' };
    var m = ensureMedia(s);
    var item = m.items.filter(function (x) { return x.id === itemId; })[0];
    if (!item) return { ok: false, error: 'That file is not in the playlist.' };
    if (s.hostId !== me.id && item.addedBy !== me.id) {
      return { ok: false, error: 'Only the host or whoever added it can remove this file.' };
    }

    var idx = m.items.indexOf(item);
    m.items.splice(idx, 1);
    if (item.upid) dropSharedMedia(item.upid);

    // Keep the playhead valid: removing the playing item stops and rewinds.
    if (s.playback.index >= m.items.length) {
      s.playback.index = Math.max(0, m.items.length - 1);
      s.playback.position = 0;
      s.playback.playing = false;
      s.playback.updatedAt = now();
    } else if (idx < s.playback.index) {
      s.playback.index -= 1;
    }
    commit('sync-media-remove');
    return { ok: true };
  }

  function mediaNorm(name) {
    return String(name || '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .replace(/^[0-9]+/, '');
  }

  function mediaTitle(name) {
    var t = String(name || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled';
  }

  /* ---------------- shared (uploaded) media ---------------- */

  function sharedMap() {
    try {
      var raw = localStorage.getItem(SHARED_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }

  function sharedSave(map) {
    try {
      localStorage.setItem(SHARED_KEY, JSON.stringify(map));
      return true;
    } catch (e) { return false; }
  }

  /* Store an uploaded file as a data URL and return a pointer id.
     NOTE: this is the ONE function to swap for Firebase Storage — see
     js/firebase-adapter.js, section "SYNC MEDIA FROM THE DEVICE". */
  function putSharedMedia(meta, dataUrl) {
    var id = uid('sm');
    var entry = {
      id: id,
      name: meta.name || 'file',
      title: meta.title || mediaTitle(meta.name),
      size: meta.size || 0,
      mime: meta.mime || '',
      dur: meta.dur || 0,
      upid: id,
      dataUrl: dataUrl,
      at: now()
    };
    var map = sharedMap();
    map[id] = entry;
    if (sharedSave(map)) return { ok: true, id: id };

    // Quota hit — evict the oldest shared files (never this one) and retry.
    var older = Object.keys(map)
      .filter(function (k) { return k !== id; })
      .sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
    for (var i = 0; i < older.length; i++) {
      delete map[older[i]];
      if (sharedSave(map)) return { ok: true, id: id, evicted: i + 1 };
    }
    return {
      ok: false,
      error: 'Browser storage is full. Remove an uploaded file from another room, or pick a smaller file.'
    };
  }

  function getSharedMedia(id) {
    if (!id) return null;
    return sharedMap()[id] || null;
  }

  function dropSharedMedia(id) {
    if (!id) return;
    var map = sharedMap();
    if (map[id]) { delete map[id]; sharedSave(map); }
  }

  /* ---------------- public API ---------------- */
  window.PV = window.PV || {};
  window.PV.store = {
    engine: 'local',
    init: load,
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    raw: function () { return db; },
    reset: function () { db = seed(); write(); emit('reset'); },

    // auth
    signup: signup, login: login, logout: logout, currentUser: currentUser,
    changePassword: changePassword, getSession: getSession,

    // users
    getUser: getUser, getUserByUsername: getUserByUsername, allUsers: allUsers,
    onlineUsers: onlineUsers, isOnline: isOnline, updateProfile: updateProfile,

    // follows
    isFollowing: isFollowing, toggleFollow: toggleFollow,
    followerCount: followerCount, followingCount: followingCount,
    followersOf: followersOf, followingOf: followingOf,

    // posts
    createPost: createPost, getPost: getPost, feed: feed, postsBy: postsBy,
    toggleLike: toggleLike, addComment: addComment, sharePost: sharePost,
    deletePost: deletePost, likesReceived: likesReceived,

    // syncs
    createSync: createSync, getSync: getSync, getSyncByCode: getSyncByCode,
    activeSyncs: activeSyncs, joinSync: joinSync, leaveSync: leaveSync,
    endSync: endSync, kickMember: kickMember, setPlayback: setPlayback,
    syncPosition: syncPosition, toggleSyncLike: toggleSyncLike,
    commentSync: commentSync, repostSync: repostSync, updateGame: updateGame,

    // sync media (files picked from the user's device)
    getRoomMedia: getRoomMedia, setMediaMode: setMediaMode,
    addRoomMedia: addRoomMedia, removeRoomMedia: removeRoomMedia,
    putSharedMedia: putSharedMedia, getSharedMedia: getSharedMedia,
    dropSharedMedia: dropSharedMedia, mediaNorm: mediaNorm, mediaTitle: mediaTitle,

    // utils
    uid: uid
  };

  load();
})();
