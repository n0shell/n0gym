/* n0gym - db.js
 * Capa de almacenamiento (IndexedDB). No toca la interfaz.
 *
 * Almacenes:
 *   exercises  { id, name, muscle, notes, createdAt, updatedAt }
 *   routines   { id, name, items: [{ exerciseId, sets, reps, weight }], createdAt, updatedAt }
 *   images     { id, exerciseId, blob, thumb, createdAt }   (fotos de cada ejercicio, ya comprimidas)
 *   sessions   { id, routineId, routineName, status: 'active' | 'done',
 *                startedAt, finishedAt, note,
 *                exercises: [{ exerciseId, name, muscle, notes, sets: [{ weight, reps, done }] }] }
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var t = Forge.i18n.t;

  var DB_NAME = 'forge';
  var DB_VERSION = 1;
  var STORES = ['exercises', 'routines', 'images', 'sessions'];
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error(t('This browser does not allow saving local data (IndexedDB not available).')));
        return;
      }
      var request;
      try {
        request = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('exercises')) {
          db.createObjectStore('exercises', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('routines')) {
          db.createObjectStore('routines', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('images')) {
          var images = db.createObjectStore('images', { keyPath: 'id' });
          images.createIndex('exerciseId', 'exerciseId', { unique: false });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          var sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('status', 'status', { unique: false });
          sessions.createIndex('finishedAt', 'finishedAt', { unique: false });
        }
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = function () {
        reject(request.error || new Error(t('Could not open the database.')));
      };
      request.onblocked = function () {
        reject(new Error(t('The database is blocked by another n0gym tab. Close it and reload.')));
      };
    });
    dbPromise.catch(function () {
      dbPromise = null; // permite reintentar tras un fallo
    });
    return dbPromise;
  }

  function req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* Ejecuta `work(transaction)` dentro de una transacción y resuelve cuando
   * la transacción se ha confirmado (datos realmente guardados).
   * Dentro de `work` solo se debe esperar a peticiones de IndexedDB. */
  function run(stores, mode, work) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(stores, mode);
        var result;
        tx.oncomplete = function () { resolve(result); };
        tx.onabort = function () { reject(tx.error || new Error(t('The operation was cancelled.'))); };
        tx.onerror = function () { /* el detalle llega por onabort */ };
        var p;
        try {
          p = Promise.resolve(work(tx));
        } catch (err) {
          p = Promise.reject(err);
        }
        p.then(
          function (value) { result = value; },
          function (err) {
            try { tx.abort(); } catch (e) { /* ya cerrada */ }
            reject(err);
          }
        );
      });
    });
  }

  function errorMessage(err) {
    if (!err) return t('Unknown error.');
    if (err.name === 'QuotaExceededError') return t('There is no storage space left on the device.');
    if (err.name === 'InvalidStateError' || err.name === 'SecurityError') {
      return t('The browser does not allow saving data (private browsing?).');
    }
    return err.message || String(err);
  }

  /* ---------- operaciones genéricas ---------- */

  function getAll(store) {
    return run([store], 'readonly', function (tx) { return req(tx.objectStore(store).getAll()); });
  }

  function get(store, id) {
    return run([store], 'readonly', function (tx) { return req(tx.objectStore(store).get(id)); });
  }

  function put(store, value) {
    return run([store], 'readwrite', function (tx) {
      return req(tx.objectStore(store).put(value)).then(function () { return value; });
    });
  }

  function remove(store, id) {
    return run([store], 'readwrite', function (tx) { return req(tx.objectStore(store).delete(id)); });
  }

  function clearAll() {
    return run(STORES, 'readwrite', function (tx) {
      return Promise.all(STORES.map(function (s) { return req(tx.objectStore(s).clear()); }));
    });
  }

  /* Copias de seguridad: lectura consistente de todos los almacenes
   * y sustitución completa en una sola transacción (todo o nada). */
  function readAllStores() {
    return run(STORES, 'readonly', function (tx) {
      return Promise.all(STORES.map(function (s) { return req(tx.objectStore(s).getAll()); })).then(function (lists) {
        var out = {};
        STORES.forEach(function (s, i) { out[s] = lists[i]; });
        return out;
      });
    });
  }

  function replaceAll(data) {
    return run(STORES, 'readwrite', function (tx) {
      var ops = [];
      STORES.forEach(function (name) {
        var store = tx.objectStore(name);
        ops.push(req(store.clear())); // las peticiones se ejecutan en orden: primero se vacía
        (data[name] || []).forEach(function (value) { ops.push(req(store.put(value))); });
      });
      return Promise.all(ops);
    });
  }

  /* ---------- ejercicios ---------- */

  /* Borra el ejercicio, lo quita de las rutinas y elimina sus imágenes.
   * El historial no se toca: cada sesión guarda su propia copia del nombre. */
  function deleteExercise(id) {
    return run(['exercises', 'routines', 'images'], 'readwrite', function (tx) {
      var exercises = tx.objectStore('exercises');
      var routines = tx.objectStore('routines');
      var images = tx.objectStore('images');
      return req(exercises.delete(id))
        .then(function () { return req(routines.getAll()); })
        .then(function (all) {
          var pending = [];
          all.forEach(function (routine) {
            var items = routine.items.filter(function (it) { return it.exerciseId !== id; });
            if (items.length !== routine.items.length) {
              var updated = Object.assign({}, routine, { items: items, updatedAt: Date.now() });
              pending.push(req(routines.put(updated)));
            }
          });
          return Promise.all(pending);
        })
        .then(function () { return req(images.index('exerciseId').getAllKeys(id)); })
        .then(function (keys) {
          return Promise.all(keys.map(function (k) { return req(images.delete(k)); }));
        });
    });
  }

  /* Fotos de un ejercicio, de la más antigua a la más reciente. */
  function getImagesFor(exerciseId) {
    return run(['images'], 'readonly', function (tx) {
      return req(tx.objectStore('images').index('exerciseId').getAll(exerciseId));
    }).then(function (list) {
      return list.sort(function (a, b) { return a.createdAt - b.createdAt; });
    });
  }

  /* Guarda el ejercicio y sus fotos en una sola transacción:
   * si algo falla (por ejemplo, falta de espacio) no se guarda nada. */
  function saveExercise(exercise, addImages, removeIds) {
    return run(['exercises', 'images'], 'readwrite', function (tx) {
      var exercises = tx.objectStore('exercises');
      var images = tx.objectStore('images');
      var ops = [req(exercises.put(exercise))];
      removeIds.forEach(function (id) { ops.push(req(images.delete(id))); });
      addImages.forEach(function (img) { ops.push(req(images.put(img))); });
      return Promise.all(ops).then(function () { return exercise; });
    });
  }

  /* ---------- sesiones ---------- */

  function getActiveSession() {
    return run(['sessions'], 'readonly', function (tx) {
      return req(tx.objectStore('sessions').index('status').get('active'));
    });
  }

  /* Crea la sesión solo si no hay otra activa (una sesión activa a la vez). */
  function startSession(session) {
    return run(['sessions'], 'readwrite', function (tx) {
      var store = tx.objectStore('sessions');
      return req(store.index('status').get('active')).then(function (existing) {
        if (existing) return { session: existing, created: false };
        return req(store.put(session)).then(function () { return { session: session, created: true }; });
      });
    });
  }

  /* Guarda el progreso, pero solo si la sesión sigue activa
   * (evita "resucitar" una sesión ya finalizada o cancelada). */
  function saveActiveSession(session) {
    return run(['sessions'], 'readwrite', function (tx) {
      var store = tx.objectStore('sessions');
      return req(store.get(session.id)).then(function (stored) {
        if (!stored || stored.status !== 'active') return false;
        return req(store.put(session)).then(function () { return true; });
      });
    });
  }

  /* Finaliza la sesión de forma idempotente: si ya estaba finalizada,
   * devuelve la existente sin crear duplicados. */
  function finishSession(session) {
    return run(['sessions'], 'readwrite', function (tx) {
      var store = tx.objectStore('sessions');
      return req(store.get(session.id)).then(function (stored) {
        if (!stored) throw new Error(t('This workout no longer exists (was it cancelled in another tab?).'));
        if (stored.status === 'done') return stored;
        var done = Object.assign({}, session, { status: 'done', finishedAt: Date.now() });
        return req(store.put(done)).then(function () { return done; });
      });
    });
  }

  Forge.db = {
    open: open,
    errorMessage: errorMessage,
    getAll: getAll,
    get: get,
    put: put,
    remove: remove,
    clearAll: clearAll,
    readAllStores: readAllStores,
    replaceAll: replaceAll,
    deleteExercise: deleteExercise,
    getImagesFor: getImagesFor,
    saveExercise: saveExercise,
    getActiveSession: getActiveSession,
    startSession: startSession,
    saveActiveSession: saveActiveSession,
    finishSession: finishSession
  };
})(window);
