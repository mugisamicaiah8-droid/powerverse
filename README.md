# PowerVerse — full source

Social feed + synchronized music/video rooms + games, as a **static multi-page app**
with a tiny **WebRTC signaling server** in `server/`.

- 37 files · 10,135 lines of code
- No build step, no bundler, no framework — plain HTML, CSS and ES5-safe JS
- Exported 2026-11-01

---

## 1. Run the app

It is a static site. Any static server works:

```bash
cd powerverse
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` straight off the filesystem also works, except the
browser may refuse a couple of storage APIs on `file://` — a local server is
the honest way to test it.

Log in with **demo / demo1234**, or create an account. Seeded users
`aisha`, `brian`, `zara`, `nadia`, `sam` use the same password.

## 2. Run the signaling server (only needed for cross-device calls)

```bash
cd powerverse/server
npm install
npm start          # http://localhost:3001
npm test           # end-to-end protocol test, real sockets, no mocks
```

Then point the app at it in `js/config.js`:

```js
var DEFAULT_SIGNALING_URL = 'http://localhost:3001';
```

Everything else — feed, posts, rooms, sync playheads, games — works with no
backend at all. Only **peer-to-peer audio/video/screen** needs this process,
and only because two browsers must discover each other first. Media never
touches the server.

## 3. What runs without keys, and what does not

| Feature | Works today | Needs real credentials |
|---|---|---|
| Auth, posts, likes, comments, follows | `localStorage`, per browser | Firebase Auth for real multi-device accounts |
| Sync rooms + playhead | `localStorage` + storage events + 1.2s poll | Firestore for cross-device rooms |
| Local-files playback | ✅ fully — each phone plays its own file | — |
| Upload & share playback | ✅ one browser | Firebase Storage so the file reaches other devices |
| Video call / screen share | ✅ same browser/tabs, and across devices **once** `DEFAULT_SIGNALING_URL` is set | a deployed signaling server + TURN for strict NATs |

`js/firebase-adapter.js` is the single seam: it stubs every `PV.store` method
with the exact Firestore/Storage call that replaces it, plus the collection
shape and the `onSnapshot` calls that retire the polling loop.

---

## 4. Pages

| File | Lines | Size | What it does |
|---|---:|---:|---|
| `game-sync.html` | 678 | 28.7 KB | Game Sync page — True or False, Matatu and Quiz. Solo-vs-AI or a 2+ player room created/joined by code, with a shared scoreboard and the video-call button. Game logic is inline and untouched by this export. |
| `home.html` | 394 | 16.2 KB | Home tab — composer (text, photo upload with preview, or both), newest-first feed, like/comment/share on each post, the “Online now” follow panel, live-syncs panel and trending. |
| `index.html` | 188 | 7.7 KB | First screen / auth — Log In and Sign Up tabs with inline validation, password visibility toggles, and a one-click demo login. Redirects an already-signed-in user straight through. |
| `music-sync.html` | 234 | 10.9 KB | Music Sync — create or join by code, “Pick from my device” playlist, shared <audio> player with the synchronized playhead, member list with host kick, like/comment/share, repost-to-home, floating call and screen share, end sync. |
| `my-profile.html` | 319 | 13.6 KB | My tab — avatar, display name, username, bio and edit-profile with avatar upload; stats for posts/followers/following/likes received; tabs for my posts grid, my syncs & reposts, followers and following; change password and log out. |
| `rooms.html` | 164 | 6.4 KB | Rooms tab — the three mode cards, a live list of every ongoing sync (name, type, host, member count, join button) and join-by-code with automatic routing to the right sync page. |
| `video-sync.html` | 232 | 10.9 KB | Video Sync — the same create/join flow as Music Sync with “Pick from my device” videos, a shared <video> stage whose playhead stays in lockstep, plus member list, host kick, reactions, repost-to-home, floating call and screen share. |

## 5. Everything else

| File | Lines | Size | What it does |
|---|---:|---:|---|
| `css/app.css` | 1494 | 53.4 KB | The whole design system: colour tokens, shell/sidebar/topbar layout, cards, buttons, forms, feed, sync-room stage, chat, games, and the mobile bottom nav. 1494 lines, no external framework. |
| `images/av1.jpg` | — | 12.7 KB |  |
| `images/av2.jpg` | — | 15.5 KB |  |
| `images/av3.jpg` | — | 9.4 KB |  |
| `images/av4.jpg` | — | 12.2 KB |  |
| `images/av5.jpg` | — | 16.5 KB |  |
| `images/av6.jpg` | — | 12.1 KB |  |
| `images/post1.jpg` | — | 65.5 KB |  |
| `images/post2.jpg` | — | 54.7 KB |  |
| `images/post3.jpg` | — | 79.8 KB |  |
| `images/post4.jpg` | — | 78.7 KB |  |
| `js/call-ui.js` | 777 | 28.2 KB | The visible half of calling: floating call window (top-right), floating screen-share window (top-left), participant badge, incoming-call banner, mute/camera/screen/leave controls, and the “no server configured” fallback. Speaks no socket.io and holds no RTCPeerConnection. |
| `js/config.js` | 120 | 4.3 KB | Runtime configuration — the one file you edit to set your deployed signaling-server URL and add STUN/TURN servers. Carries the “not configured” state explicitly rather than defaulting to a fake endpoint. |
| `js/firebase-adapter.js` | 238 | 10.9 KB | THE BACKEND SEAM. Not wired in on purpose: it documents the exact Firestore collection shape, the onSnapshot calls that replace the 1.2s poll, the Storage upload that replaces base64 shared media, and stubs every PV.store method so the swap is one assignment. |
| `js/media-store.js` | 199 | 7.1 KB | Device-file layer — keeps picked audio/video Blobs in IndexedDB keyed by room code + filename + size so a rejoin does not mean re-picking, and marks the Firebase Storage swap point for “Upload & share” mode. |
| `js/store.js` | 816 | 30.8 KB | THE DATA LAYER. Users, sessions, posts, reactions, comments, follows, syncs and shared media — all of it behind PV.store.*. localStorage persistence plus storage events and a 1.2s poll to simulate real-time across tabs. |
| `js/sync-room.js` | 1223 | 45.1 KB | The sync engine shared by both sync pages — playlist from the user's own device, the local-files vs upload-and-share modes, the {index, playing, position, updatedAt} playhead and its re-align loop, member list, kick, reactions, repost-to-home and end-sync. |
| `js/ui.js` | 350 | 16.8 KB | Shared UI helpers — the inline SVG icon set, topbar/sidebar/bottom-nav rendering, auth guard, toasts, modals, avatar and relative-time formatting, plus the floating media windows. |
| `js/vendor/socket.io.min.js` | 7 | 48.8 KB | Vendored socket.io browser client (v4, minified) so the app runs with no build step or CDN dependency. Generated library code — do not edit. |
| `js/webrtc.js` | 1017 | 35.4 KB | THE TRANSPORT. Real peer-to-peer audio/video/screen over a mesh — one RTCPeerConnection pair per peer for camera+mic and a separate one-way pair per screen sharer, with lower-socket-id offerer election to avoid glare. |
| `server/.dockerignore` | 7 | 75 B | Keeps node_modules, logs, .env files and test/ out of the signaling-server Docker image. |
| `server/.env.example` | 26 | 968 B | Every environment variable the signaling server reads (PORT, HOST, CORS_ORIGIN, MAX_CALL_PEERS, MAX_ROOM_MEMBERS, IDLE_ROOM_MS, LOG_LEVEL) with the defaults documented. |
| `server/.gitignore` | 5 | 60 B | Ignores node_modules, npm debug logs, .env and .DS_Store for the server folder. |
| `server/Dockerfile` | 26 | 763 B | Minimal node:20-alpine production image for the signaling process only — manifests copied first for layer caching, runs as the unprivileged node user, with a /health HEALTHCHECK. |
| `server/README.md` | 287 | 12.9 KB | The server's operating manual — run it locally, deploy it (Render blueprint / Docker / any PaaS), point the app at it, the full event protocol, the 6-peer mesh limit and why an SFU is the next step, and sticky-session requirements. |
| `server/package-lock.json` | 358 | 12.0 KB | Locked dependency tree for the signaling server, so npm ci reproduces the exact socket.io versions. |
| `server/package.json` | 27 | 698 B | Server manifest — one runtime dependency (socket.io), plus socket.io-client for the protocol test; scripts for start, dev and test; requires Node 18+. |
| `server/render.yaml` | 25 | 709 B | Render Blueprint that deploys only the server folder as a free web service with a /health check and the env vars pre-set. |
| `server/server.js` | 574 | 19.3 KB | The signaling server itself — an http server plus socket.io that joins sockets to rooms keyed by the 6-character sync code, relays SDP offers/answers and ICE candidates, enforces the peer/member caps, and sweeps idle rooms. Never touches media. |
| `server/test/protocol.test.js` | 350 | 14.6 KB | End-to-end protocol test — spawns a real server on an ephemeral port and drives it with real socket.io clients (no mocks) to assert join, relay, cap enforcement and cleanup actually route. |

---

## 6. Where to look first

| Question | File |
|---|---|
| How is data stored / how do I swap in Firestore? | `js/firebase-adapter.js` → then `js/store.js` |
| How does the playhead stay in sync? | `js/sync-room.js` |
| How do device files survive a rejoin? | `js/media-store.js` |
| How does a call actually connect? | `js/webrtc.js` (transport) + `js/call-ui.js` (UI) |
| What does the server relay? | `server/server.js`, documented in `server/README.md` |
| Where do the design tokens live? | `css/app.css` (`:root`) |

## 7. Known limits (by design, not by accident)

- **Storage is per browser.** `localStorage` is ~5 MB; uploaded shared media is
  capped well below that with a visible size warning, and large files are
  refused up front rather than failing mid-upload.
- **A file on one phone cannot stream to another** without an upload. That is
  why the two modes exist and why the UI states which one is active instead of
  silently pretending.
- **Mesh calling caps at 6 participants.** Past that you need an SFU (LiveKit,
  mediasoup, Daily); the server enforces the cap rather than degrading quietly.
- **Synchronization is poll-based**, so it is smooth within a tab and a second
  or so behind across tabs. Real-time listeners in the Firebase adapter fix it.
