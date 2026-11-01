/* ============================================================
   PowerVerse — media store
   ------------------------------------------------------------
   Sync rooms play files that come from the user's own device.
   There are two places such a file can live:

   1. DEVICE PICKS  ("Local files" mode — the default)
      The exact file the user picked from their phone/computer,
      kept as a Blob in IndexedDB keyed by room code + filename +
      size, so a rejoin does not require picking again (where the
      browser allows it). The file never leaves the device, which
      is exactly why only the playhead is synced and why every
      participant must pick the same file themselves.

   2. SHARED UPLOADS  ("Upload & share" mode)
      The host stores the file through PV.store.putSharedMedia()
      (localStorage for this prototype) and every member streams
      that same data URL — nobody has to own the file. Browser
      storage is small (~5MB per origin), so the UI warns and
      hard-blocks big files instead of failing mid-upload.

   ── FIREBASE SEAM ──────────────────────────────────────────
   saveLocal() may stay as-is (an offline cache is still useful).
   PV.store.putSharedMedia() → replace the body with
        const r = ref(storage, `syncs/${code}/${name}`);
        await uploadBytes(r, file);
        return getDownloadURL(r);    // store that URL on the item
   and PV.store.getSharedMedia() → return the stored URL.
   See js/firebase-adapter.js ("SYNC MEDIA FROM THE DEVICE").
   ============================================================ */
(function () {
  'use strict';

  var PV = window.PV = window.PV || {};

  var IDB_NAME = 'powerverse.media.v1';
  var IDB_STORE = 'picks';
  var memFallback = {};        // used only when IndexedDB is unavailable
  var dbPromise = null;

  /* ---------------- tiny helpers ---------------- */

  function humanSize(bytes) {
    bytes = bytes || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* Same-name matching across devices: "01 - Sunflower.mp3" and
     "sunflower.MP3" resolve to the same key, so a member who has the
     file under a slightly different name still gets it matched. */
  function normName(name) {
    return String(name || '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .replace(/^[0-9]+/, '');
  }

  function titleFrom(name) {
    var t = String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return 'Untitled';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function keyFor(room, name, size) {
    return String(room) + '::' + String(name) + '::' + String(size || 0);
  }

  /* ---------------- IndexedDB ---------------- */

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no-indexeddb')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(IDB_STORE)) {
          var st = d.createObjectStore(IDB_STORE, { keyPath: 'key' });
          st.createIndex('room', 'room', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
      req.onblocked = function () { reject(new Error('idb-blocked')); };
    }).catch(function (err) {
      console.warn('[PowerVerse] IndexedDB unavailable — this browser will not remember picked files.', err);
      return null;
    });
    return dbPromise;
  }

  /* Save one picked file for a room. Resolves { ok, key, persisted }.
     `persisted:false` means it only lives in memory for this tab. */
  function saveLocal(rec) {
    var entry = {
      key: keyFor(rec.room, rec.name, rec.size),
      room: String(rec.room || ''),
      name: rec.name,
      title: titleFrom(rec.name),
      size: rec.size || 0,
      mime: rec.mime || '',
      dur: rec.dur || 0,
      addedAt: Date.now(),
      blob: rec.blob
    };

    function keepInMemory() {
      memFallback[entry.key] = entry;
      return { ok: true, key: entry.key, persisted: false };
    }

    return openDB().then(function (db) {
      if (!db) return keepInMemory();
      return new Promise(function (resolve) {
        var t;
        try { t = db.transaction(IDB_STORE, 'readwrite'); }
        catch (e) { resolve(keepInMemory()); return; }
        t.objectStore(IDB_STORE).put(entry);
        t.oncomplete = function () { resolve({ ok: true, key: entry.key, persisted: true }); };
        t.onerror = function () { resolve(keepInMemory()); };
        t.onabort = function () { resolve(keepInMemory()); };
      });
    });
  }

  /* Every file this browser has stored for a room, oldest first. */
  function listLocal(room) {
    room = String(room || '');
    return openDB().then(function (db) {
      if (!db) {
        return Object.keys(memFallback)
          .map(function (k) { return memFallback[k]; })
          .filter(function (e) { return e.room === room; })
          .sort(function (a, b) { return a.addedAt - b.addedAt; });
      }
      return new Promise(function (resolve) {
        var rows = [];
        var t;
        try { t = db.transaction(IDB_STORE, 'readonly'); }
        catch (e) { resolve([]); return; }
        var req = t.objectStore(IDB_STORE).index('room').openCursor(IDBKeyRange.only(room));
        req.onsuccess = function () {
          var c = req.result;
          if (c) { rows.push(c.value); c.continue(); }
        };
        t.oncomplete = function () {
          rows.sort(function (a, b) { return a.addedAt - b.addedAt; });
          resolve(rows);
        };
        t.onerror = function () { resolve(rows); };
      });
    });
  }

  function removeLocal(key) {
    return openDB().then(function (db) {
      if (!db) { delete memFallback[key]; return { ok: true }; }
      return new Promise(function (resolve) {
        var t;
        try { t = db.transaction(IDB_STORE, 'readwrite'); }
        catch (e) { delete memFallback[key]; resolve({ ok: true }); return; }
        t.objectStore(IDB_STORE).delete(key);
        t.oncomplete = function () { resolve({ ok: true }); };
        t.onerror = function () { resolve({ ok: false }); };
      });
    });
  }

  function clearRoom(room) {
    return listLocal(room).then(function (rows) {
      return Promise.all(rows.map(function (r) { return removeLocal(r.key); }));
    });
  }

  function bytesForRoom(room) {
    return listLocal(room).then(function (rows) {
      return rows.reduce(function (sum, r) { return sum + (r.size || 0); }, 0);
    });
  }

  PV.mediaStore = {
    saveLocal: saveLocal,
    listLocal: listLocal,
    removeLocal: removeLocal,
    clearRoom: clearRoom,
    bytesForRoom: bytesForRoom,
    keyFor: keyFor,
    normName: normName,
    titleFrom: titleFrom,
    humanSize: humanSize
  };
})();
