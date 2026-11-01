/* ============================================================
   PowerVerse — FIREBASE ADAPTER (drop-in seam)
   ------------------------------------------------------------
   This file is intentionally NOT wired in. It documents and
   scaffolds exactly what to replace so the app can move from
   localStorage to Firestore + Storage + Auth without touching
   any page code.

   ── HOW THE APP TALKS TO DATA ──────────────────────────────
   Every page calls `PV.store.<method>()` only. No page ever
   touches localStorage directly. So the swap is:

     1. Add the Firebase SDK (v10 modular, CDN):
        <script type="module">
          import { initializeApp } from
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
          import { getFirestore } from
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
          import { getStorage } from
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
          import { getAuth } from
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
        </script>

     2. Fill in FIREBASE_CONFIG below from the Firebase console
        (Project settings → Your apps → Web app → SDK config).

     3. Implement the methods in `FirebaseAdapter` below with the
        same names/signatures as PV.store, then in store.js set:
            window.PV.store = FirebaseAdapter;
        (or keep both and switch on a flag:
            PV.store.engine === 'firebase' ? FirebaseAdapter : LocalAdapter)

   ── FIRESTORE COLLECTION SHAPE (mirrors the local schema) ──
     users/{userId}      { name, username, bio, avatar, online, lastSeen, createdAt }
     posts/{postId}      { authorId, text, image, createdAt, likes[], shares[],
                           comments[{id,authorId,text,createdAt}],
                           repostOf?, syncRef? }
     follows/{followerId_followingId}  { followerId, followingId }
     syncs/{syncId}      { code, type, name, hostId, members[], kicked[],
                           ended, createdAt, playback{index,playing,position,updatedAt},
                           game?, likes[], comments[], shares[], reposted }

   ── REAL-TIME (replaces the 1.2s localStorage poll) ────────
     onSnapshot(collection(db,'posts'), snap => { ... emit('remote') })
     onSnapshot(doc(db,'syncs',id),   snap => { ... emit('remote') })
     Firestore pushes changes to every device instantly — no polling.

   ── AUTH ───────────────────────────────────────────────────
     createUserWithEmailAndPassword(auth, `${username}@powerverse.local`, password)
     signInWithEmailAndPassword(auth, `${username}@powerverse.local`, password)
     onAuthStateChanged(auth, user => { ... })
     (Or use real emails + a `username` field with a uniqueness check.)

   ── IMAGES ─────────────────────────────────────────────────
     The composer currently stores a base64 data URL in the post.
     With Firebase, replace `readImageAsDataURL()` in ui.js with:
        const ref = ref(storage, `posts/${uid}/${Date.now()}.jpg`);
        await uploadBytes(ref, file);
        const url = await getDownloadURL(ref);
     and store `url` on the post instead of the data URL.

   ── SYNCED PLAYBACK (the important one) ───────────────────
     Today: host writes playback{position, playing, updatedAt} to
     localStorage; every client computes
        position + (now - updatedAt)/1000
     so all tabs agree. With Firestore this becomes a doc write +
     onSnapshot, which is the same math but across devices.
     For sub-100ms accuracy add a WebRTC data channel or a
     Firestore server timestamp and correct for clock skew.

   ── SYNC MEDIA FROM THE DEVICE ──────────────────────────
     The sync rooms no longer ship a sample library. Each
     room document holds ONLY metadata:

       syncs/{id}.media = {
         mode: 'local' | 'shared',
         items: [{ id, name, title, norm, size, mime, dur,
                   upid, addedBy, at }]
       }

     Two modes, two different problems:

     • 'local' (default, no storage needed)
       Every participant picks the SAME file on their own
       device. The file never leaves the phone; only the
       playhead is synced. Each device's copy is cached in
       IndexedDB by js/media-store.js (key = room + name +
       size) so a rejoin does not require re-picking.
       NOTHING TO CHANGE for Firebase — this already works
       offline and needs no bucket.

     • 'shared' (one upload, everyone streams it)
       Today PV.store.putSharedMedia(meta, dataUrl) writes a
       base64 data URL into localStorage under
       'powerverse.sharedmedia.v1' and returns { id }.
       With Firebase Storage, replace that ONE function:

         import { ref, uploadBytes, getDownloadURL,
                  deleteObject } from '.../firebase-storage.js';

         async function putSharedMedia(meta, file) {
           const r = ref(storage,
             `syncs/${meta.room}/${meta.id}/${meta.name}`);
           await uploadBytes(r, file, { contentType: meta.mime });
           return { id: meta.id, url: await getDownloadURL(r) };
         }

       Then store that download URL on the item as `src`
       and have the player use `item.src || blobURL`. Using
       the raw File (not a data URL) also removes the ~5MB
       localStorage ceiling and gives you real progress via
       uploadBytesResumable's `state` callback — the UI
       already renders a progress bar, so wire it to
       snapshot.bytesTransferred / snapshot.totalBytes.

       Security rules worth adding with the bucket:
         match /syncs/{syncId}/{file=**} {
           allow read: if request.auth != null;
           allow write: if request.auth != null
                        && request.resource.size < 60 * 1024 * 1024;
         }

   ── WEBRTC (video call + screen share) ──────────────────────
     getUserMedia / getDisplayMedia already work locally (see
     PV.media in ui.js). For multi-device calls you additionally
     need a SIGNALING SERVER to exchange SDP offers/answers and
     ICE candidates. Options:
       • Firebase Realtime Database (cheapest to start):
           rooms/{code}/signals/{peerId}  ← push offer/answer/ice
       • A tiny Node + socket.io server (20 lines)
       • Managed: LiveKit, Daily, Twilio Video, Agora
     Without it, the call window shows your own camera locally
     and the app tells the user signaling is not configured.
   ============================================================ */

window.PV = window.PV || {};

window.PV.FIREBASE_CONFIG = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME'
};

/* Scaffold only — every method throws until implemented.
   Keeping the signatures identical is what makes the swap safe. */
window.PV.FirebaseAdapter = (function () {
  function notImplemented(name) {
    return function () {
      var msg = '[PowerVerse] FirebaseAdapter.' + name + '() is not implemented yet. ' +
                'See js/firebase-adapter.js for the swap notes.';
      console.warn(msg);
      return { ok: false, error: 'Firebase is not configured yet.' };
    };
  }

  return {
    engine: 'firebase',
    init: function () { console.info('[PowerVerse] Firebase adapter loaded (scaffold).'); },
    subscribe: function () { return function () {}; },

    // auth
    signup: notImplemented('signup'),
    login: notImplemented('login'),
    logout: notImplemented('logout'),
    currentUser: function () { return null; },
    changePassword: notImplemented('changePassword'),

    // users
    getUser: notImplemented('getUser'),
    getUserByUsername: notImplemented('getUserByUsername'),
    allUsers: function () { return []; },
    onlineUsers: function () { return []; },
    isOnline: function () { return false; },
    updateProfile: notImplemented('updateProfile'),

    // follows
    isFollowing: function () { return false; },
    toggleFollow: notImplemented('toggleFollow'),
    followerCount: function () { return 0; },
    followingCount: function () { return 0; },
    followersOf: function () { return []; },
    followingOf: function () { return []; },

    // posts
    createPost: notImplemented('createPost'),
    getPost: notImplemented('getPost'),
    feed: function () { return []; },
    postsBy: function () { return []; },
    toggleLike: notImplemented('toggleLike'),
    addComment: notImplemented('addComment'),
    sharePost: notImplemented('sharePost'),
    deletePost: notImplemented('deletePost'),
    likesReceived: function () { return 0; },

    // syncs
    createSync: notImplemented('createSync'),
    getSync: notImplemented('getSync'),
    getSyncByCode: notImplemented('getSyncByCode'),
    activeSyncs: function () { return []; },
    joinSync: notImplemented('joinSync'),
    leaveSync: notImplemented('leaveSync'),
    endSync: notImplemented('endSync'),
    kickMember: notImplemented('kickMember'),
    setPlayback: notImplemented('setPlayback'),
    syncPosition: function () { return 0; },
    toggleSyncLike: notImplemented('toggleSyncLike'),
    commentSync: notImplemented('commentSync'),
    repostSync: notImplemented('repostSync'),
    updateGame: notImplemented('updateGame'),

    /* ── sync media (files from the user's device) ────────────
       getRoomMedia / addRoomMedia / removeRoomMedia /
       setMediaMode are plain reads and writes of
       syncs/{id}.media — same shape as the local schema, so
       they port with the rest of the syncs collection.

       putSharedMedia(arg, dataUrl) is the ONE method that must
       change for a real backend: it currently receives a base64
       data URL and returns { id }. With Firebase Storage it
       receives the original File instead, uploads it with
       uploadBytesResumable (which also gives real progress), and
       returns { id, url }. getSharedMedia(id) then resolves the
       download URL rather than reading localStorage. */
    getRoomMedia: function () { return { mode: 'local', items: [] }; },
    setMediaMode: notImplemented('setMediaMode'),
    addRoomMedia: notImplemented('addRoomMedia'),
    removeRoomMedia: notImplemented('removeRoomMedia'),
    putSharedMedia: notImplemented('putSharedMedia'),
    getSharedMedia: function () { return null; },
    dropSharedMedia: function () {},
    mediaNorm: function (n) { return String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); },
    mediaTitle: function (n) { return String(n || '').replace(/\.[^.]+$/, '') || 'Untitled'; }
  };
})();
