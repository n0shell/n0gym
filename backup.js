/* n0gym - backup.js
 * Copias de seguridad: exporta todos los datos a un JSON y los restaura con validación previa.
 * No toca la interfaz (salvo iniciar la descarga). La restauración usa db.replaceAll (una sola transacción).
 *
 * Formato (versión 1):
 *   { format: 'n0gym-backup', version: 1, exportedAt: ISO, counts: {...}, prefs: { 'n0gym.xxx': 'texto' },
 *     data: { exercises: [], routines: [], sessions: [], images: [{ id, exerciseId, createdAt,
 *             blobType, blob: base64, thumbType?, thumb?: base64 }] } }
 *
 * Preferencias: se guardan en localStorage con claves que empiezan por "n0gym." (las usarán
 * el temporizador y la calculadora). Se incluyen en la copia automáticamente.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var db = Forge.db;
  var t = Forge.i18n.t;

  var FORMAT = 'n0gym-backup';
  var VERSION = 1;
  var PREF_PREFIX = 'n0gym.';
  var MAX_FILE_BYTES = 500 * 1024 * 1024;
  var IMAGE_TYPE = /^image\/(jpeg|png|webp|gif)$/;

  /* ---------- utilidades ---------- */

  /* Mensaje de validación: «Ejercicio 3: falta el nombre.» (cada parte se traduce). */
  function problem(at, key) {
    return t('{kind} {n}: {problem}', { kind: t(at.kind), n: at.n, problem: t(key) });
  }

  function fail(message) {
    throw new Error(message);
  }

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string'; }
  function isNum(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }
  function numOrNull(v) { return v === null || v === undefined ? null : v; }
  function optStr(v) { return isStr(v) ? v : ''; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error(t('Could not read an image.'))); };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    var bin = atob(b64); // lanza si no es Base64 válido
    if (!bin.length) throw new Error('empty image');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  }

  function readText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  /* ---------- preferencias (localStorage, solo claves "n0gym.") ---------- */

  function readPrefs() {
    var prefs = {};
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var key = global.localStorage.key(i);
        if (key && key.indexOf(PREF_PREFIX) === 0) prefs[key] = global.localStorage.getItem(key);
      }
    } catch (e) { /* almacenamiento no disponible */ }
    return prefs;
  }

  function writePrefs(prefs) {
    try {
      var old = [];
      for (var i = 0; i < global.localStorage.length; i++) {
        var key = global.localStorage.key(i);
        if (key && key.indexOf(PREF_PREFIX) === 0) old.push(key);
      }
      old.forEach(function (k) { global.localStorage.removeItem(k); });
      Object.keys(prefs).forEach(function (k) { global.localStorage.setItem(k, prefs[k]); });
    } catch (e) { /* no es crítico */ }
  }

  /* ---------- exportar ---------- */

  /* Construye el archivo sin crear un único JSON gigante: las imágenes se
   * convierten una a una y cada trozo pasa a ser un Blob. */
  function build() {
    return db.readAllStores().then(async function (data) {
      var counts = {
        exercises: data.exercises.length,
        routines: data.routines.length,
        sessions: data.sessions.length,
        images: data.images.length
      };
      var parts = [];
      parts.push(
        '{"format":' + JSON.stringify(FORMAT) +
        ',"version":' + VERSION +
        ',"appVersion":' + JSON.stringify(Forge.config.version) +
        ',"exportedAt":' + JSON.stringify(new Date().toISOString()) +
        ',"counts":' + JSON.stringify(counts) +
        ',"prefs":' + JSON.stringify(readPrefs()) +
        ',"data":{"exercises":' + JSON.stringify(data.exercises) +
        ',"routines":' + JSON.stringify(data.routines) +
        ',"sessions":' + JSON.stringify(data.sessions) +
        ',"images":['
      );
      for (var i = 0; i < data.images.length; i++) {
        var img = data.images[i];
        if (!(img.blob instanceof Blob)) throw new Error(t('A saved photo is damaged and cannot be exported.'));
        var entry = {
          id: img.id,
          exerciseId: img.exerciseId,
          createdAt: img.createdAt,
          blobType: img.blob.type || 'image/jpeg',
          blob: await blobToBase64(img.blob)
        };
        if (img.thumb instanceof Blob) {
          entry.thumbType = img.thumb.type || 'image/jpeg';
          entry.thumb = await blobToBase64(img.thumb);
        }
        parts.push((i ? ',' : '') + JSON.stringify(entry));
        parts[parts.length - 1] = new Blob([parts[parts.length - 1]]); // libera la cadena grande
      }
      parts.push(']}}');
      return { blob: new Blob(parts, { type: 'application/json' }), counts: counts };
    });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function exportToFile() {
    return build().then(function (result) {
      var filename = 'n0gym-copia-' + stamp() + '.json';
      download(result.blob, filename);
      return { filename: filename, size: result.blob.size, counts: result.counts };
    });
  }

  /* ---------- validar (no modifica nada) ---------- */

  function cleanExercises(list) {
    var seen = {};
    return list.map(function (x, i) {
      var at = { kind: 'Exercise', n: i + 1 };
      if (!isObj(x)) fail(problem(at, 'invalid format.'));
      if (!isStr(x.id) || !x.id) fail(problem(at, 'missing ID.'));
      if (seen[x.id]) fail(problem(at, 'duplicate ID.'));
      seen[x.id] = true;
      if (!isStr(x.name) || !x.name.trim()) fail(problem(at, 'missing name.'));
      if (!isNum(x.createdAt)) fail(problem(at, 'invalid date.'));
      return {
        id: x.id,
        name: x.name,
        muscle: optStr(x.muscle),
        notes: optStr(x.notes),
        createdAt: x.createdAt,
        updatedAt: isNum(x.updatedAt) ? x.updatedAt : x.createdAt
      };
    });
  }

  function cleanRoutines(list, exerciseIds) {
    var seen = {};
    return list.map(function (r, i) {
      var at = { kind: 'Routine', n: i + 1 };
      if (!isObj(r)) fail(problem(at, 'invalid format.'));
      if (!isStr(r.id) || !r.id) fail(problem(at, 'missing ID.'));
      if (seen[r.id]) fail(problem(at, 'duplicate ID.'));
      seen[r.id] = true;
      if (!isStr(r.name)) fail(problem(at, 'missing name.'));
      if (!isNum(r.createdAt)) fail(problem(at, 'invalid date.'));
      if (!Array.isArray(r.items)) fail(problem(at, 'missing exercises.'));
      var items = r.items.map(function (it) {
        if (!isObj(it) || !isStr(it.exerciseId)) fail(problem(at, 'invalid values.'));
        if (!exerciseIds[it.exerciseId]) fail(problem(at, 'it uses an exercise that is not in the backup.'));
        if (!isNum(it.sets) || !isNum(it.reps)) fail(problem(at, 'invalid values.'));
        var weight = numOrNull(it.weight);
        if (weight !== null && !isNum(weight)) fail(problem(at, 'invalid values.'));
        return { exerciseId: it.exerciseId, sets: it.sets, reps: it.reps, weight: weight };
      });
      return {
        id: r.id,
        name: r.name,
        items: items,
        createdAt: r.createdAt,
        updatedAt: isNum(r.updatedAt) ? r.updatedAt : r.createdAt
      };
    });
  }

  function cleanSessions(list) {
    var seen = {};
    var active = 0;
    var cleaned = list.map(function (s, i) {
      var at = { kind: 'Workout', n: i + 1 };
      if (!isObj(s)) fail(problem(at, 'invalid format.'));
      if (!isStr(s.id) || !s.id) fail(problem(at, 'missing ID.'));
      if (seen[s.id]) fail(problem(at, 'duplicate ID.'));
      seen[s.id] = true;
      if (s.status !== 'active' && s.status !== 'done') fail(problem(at, 'invalid values.'));
      if (s.status === 'active') active++;
      if (!isStr(s.routineName)) fail(problem(at, 'missing name.'));
      if (!isNum(s.startedAt)) fail(problem(at, 'invalid date.'));
      var finishedAt = numOrNull(s.finishedAt);
      if (finishedAt !== null && !isNum(finishedAt)) fail(problem(at, 'invalid date.'));
      if (s.status === 'done' && finishedAt === null) fail(problem(at, 'invalid date.'));
      if (!Array.isArray(s.exercises)) fail(problem(at, 'missing exercises.'));
      var exercises = s.exercises.map(function (ex) {
        if (!isObj(ex) || !isStr(ex.exerciseId) || !isStr(ex.name)) fail(problem(at, 'invalid values.'));
        if (!Array.isArray(ex.sets)) fail(problem(at, 'missing exercises.'));
        var sets = ex.sets.map(function (set) {
          if (!isObj(set)) fail(problem(at, 'invalid values.'));
          var weight = numOrNull(set.weight);
          var reps = numOrNull(set.reps);
          if ((weight !== null && !isNum(weight)) || (reps !== null && !isNum(reps))) {
            fail(problem(at, 'invalid values.'));
          }
          return { weight: weight, reps: reps, done: set.done === true };
        });
        return { exerciseId: ex.exerciseId, name: ex.name, muscle: optStr(ex.muscle), notes: optStr(ex.notes), sets: sets };
      });
      return {
        id: s.id,
        routineId: isStr(s.routineId) ? s.routineId : null,
        routineName: s.routineName,
        status: s.status,
        startedAt: s.startedAt,
        finishedAt: finishedAt,
        note: optStr(s.note),
        exercises: exercises
      };
    });
    if (active > 1) fail(t('The backup contains more than one workout in progress.'));
    return cleaned;
  }

  function cleanImages(list, exerciseIds) {
    var seen = {};
    var cleaned = [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      var at = { kind: 'Photo', n: i + 1 };
      if (!isObj(x)) fail(problem(at, 'invalid format.'));
      if (!isStr(x.id) || !x.id) fail(problem(at, 'missing ID.'));
      if (seen[x.id]) fail(problem(at, 'duplicate ID.'));
      seen[x.id] = true;
      if (!isStr(x.exerciseId) || !exerciseIds[x.exerciseId]) fail(problem(at, 'it uses an exercise that is not in the backup.'));
      if (!isNum(x.createdAt)) fail(problem(at, 'invalid date.'));
      if (!isStr(x.blob) || !IMAGE_TYPE.test(x.blobType || '')) fail(problem(at, 'invalid values.'));
      var record = { id: x.id, exerciseId: x.exerciseId, createdAt: x.createdAt };
      try {
        record.blob = base64ToBlob(x.blob, x.blobType);
        if (x.thumb !== undefined) {
          if (!isStr(x.thumb) || !IMAGE_TYPE.test(x.thumbType || '')) throw new Error('invalid thumbnail');
          record.thumb = base64ToBlob(x.thumb, x.thumbType);
        }
      } catch (err) {
        fail(problem(at, 'the image is damaged.'));
      }
      cleaned.push(record);
      list[i] = null; // libera el Base64 original a medida que se decodifica
    }
    return cleaned;
  }

  function validate(json) {
    if (!isObj(json) || json.format !== FORMAT) fail(t('This file is not an n0gym backup.'));
    if (typeof json.version !== 'number' || Math.floor(json.version) !== json.version || json.version < 1) {
      fail(t('The backup has an invalid format version.'));
    }
    if (json.version > VERSION) {
      fail(t('This backup was created with a newer version of n0gym (format {version}). Update the app and try again.', { version: json.version }));
    }
    /* Aquí irían las migraciones de formatos anteriores. Hoy solo existe la versión 1. */

    var d = json.data;
    if (!isObj(d)) fail(t('The backup is incomplete: data is missing.'));
    ['exercises', 'routines', 'sessions', 'images'].forEach(function (key) {
      if (!Array.isArray(d[key])) fail(t('The backup is incomplete: section {name} is missing.', { name: key }));
    });

    var exercises = cleanExercises(d.exercises);
    var exerciseIds = {};
    exercises.forEach(function (e) { exerciseIds[e.id] = true; });
    var routines = cleanRoutines(d.routines, exerciseIds);
    var sessions = cleanSessions(d.sessions);
    var images = cleanImages(d.images, exerciseIds);

    var prefs = {};
    if (isObj(json.prefs)) {
      Object.keys(json.prefs).forEach(function (k) {
        if (k.indexOf(PREF_PREFIX) === 0 && isStr(json.prefs[k])) prefs[k] = json.prefs[k];
      });
    }

    var date = json.exportedAt ? new Date(json.exportedAt) : null;
    return {
      data: { exercises: exercises, routines: routines, sessions: sessions, images: images },
      prefs: prefs,
      summary: {
        date: date && !isNaN(date.getTime()) ? date.toLocaleDateString(Forge.i18n.locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '',
        exercises: exercises.length,
        routines: routines.length,
        sessions: sessions.filter(function (s) { return s.status === 'done'; }).length,
        images: images.length
      }
    };
  }

  /* Lee y valida el archivo. No modifica ningún dato. Devuelve lo necesario para restore(). */
  function read(file) {
    if (!file) return Promise.reject(new Error(t('No file was selected.')));
    if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error(t('The file is too large to restore (maximum 500 MB).')));
    return readText(file).then(
      function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error(t('The file is not valid JSON or is damaged.'));
        }
        return validate(json);
      },
      function () { throw new Error(t('Could not read the file.')); }
    );
  }

  /* ---------- restaurar ---------- */

  /* Sustituye todos los datos en UNA transacción: si algo falla, no cambia nada. */
  function restore(parsed) {
    return db.replaceAll(parsed.data).then(
      function () { writePrefs(parsed.prefs); },
      function (err) {
        throw new Error(t('Could not restore the backup: {error} Your current data has not been modified.', { error: db.errorMessage(err) }));
      }
    );
  }

  Forge.backup = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    PREF_PREFIX: PREF_PREFIX,
    build: build,
    exportToFile: exportToFile,
    read: read,
    restore: restore
  };
})(window);
