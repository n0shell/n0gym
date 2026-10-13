/* n0gym - logic.js
 * Lógica de la aplicación: funciones puras, sin DOM ni almacenamiento.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var t = Forge.i18n.t;

  /* ---------- utilidades ---------- */

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* Convierte texto de un input en número >= 0, o null si está vacío o es inválido. */
  function toNumber(value) {
    if (value === null || value === undefined) return null;
    var n = parseFloat(String(value).trim().replace(',', '.'));
    return isFinite(n) && n >= 0 ? n : null;
  }

  function toInt(value) {
    var n = toNumber(value);
    return n === null ? null : Math.round(n);
  }

  function clampInt(value, min, max, fallback) {
    var n = toInt(value);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* Nombre de una sesión para mostrar: los entrenamientos libres se muestran en el idioma actual. */
  function sessionName(session) {
    return session.routineId ? session.routineName : t('Free workout');
  }

  function byFinishedDesc(a, b) {
    return b.finishedAt - a.finishedAt;
  }

  function moveItem(list, index, direction) {
    var target = index + direction;
    if (index < 0 || index >= list.length || target < 0 || target >= list.length) return;
    var tmp = list[index];
    list[index] = list[target];
    list[target] = tmp;
  }

  /* ---------- formato ---------- */

  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function fmtDay(ts) {
    return capitalize(new Date(ts).toLocaleDateString(Forge.i18n.locale(), { weekday: 'long', day: 'numeric', month: 'long' }));
  }

  function fmtShortDate(ts) {
    return new Date(ts).toLocaleDateString(Forge.i18n.locale(), { day: 'numeric', month: 'short' });
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString(Forge.i18n.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function fmtDuration(ms) {
    var minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return t('{n} min', { n: minutes });
    return t('{h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 });
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return '–';
    try {
      return new Intl.NumberFormat(Forge.i18n.locale(), { maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100);
    } catch (e) {
      return String(Math.round(n * 100) / 100);
    }
  }

  function fmtSet(set) {
    var hasWeight = set.weight !== null && set.weight !== undefined;
    var hasReps = set.reps !== null && set.reps !== undefined;
    if (hasWeight && hasReps) return fmtNum(set.weight) + ' kg × ' + set.reps;
    if (hasWeight) return fmtNum(set.weight) + ' kg';
    if (hasReps) return t('{n} reps', { n: set.reps });
    return t('No data');
  }

  /* ---------- rutinas ---------- */

  function newRoutine() {
    var now = Date.now();
    return { id: uid(), name: '', items: [], createdAt: now, updatedAt: now };
  }

  function newRoutineItem(exerciseId) {
    return { exerciseId: exerciseId, sets: 3, reps: 10, weight: null };
  }

  /* Normaliza lo que el usuario ha escrito antes de guardar. */
  function cleanRoutineItem(item) {
    return {
      exerciseId: item.exerciseId,
      sets: clampInt(item.sets, 1, 20, 3),
      reps: clampInt(item.reps, 1, 999, 10),
      weight: toNumber(item.weight)
    };
  }

  function duplicateRoutine(routine) {
    var now = Date.now();
    var copy = clone(routine);
    copy.id = uid();
    copy.name = t('{name} (copy)', { name: routine.name });
    copy.createdAt = now;
    copy.updatedAt = now;
    return copy;
  }

  /* ---------- sesiones ---------- */

  /* Último resultado de cada ejercicio: { [exerciseId]: { sets, date } } */
  function lastSetsByExercise(doneSessions) {
    var sorted = doneSessions.slice().sort(function (a, b) { return a.finishedAt - b.finishedAt; });
    var map = {};
    sorted.forEach(function (session) {
      session.exercises.forEach(function (ex) {
        if (ex.sets.length) map[ex.exerciseId] = { sets: ex.sets, date: session.finishedAt };
      });
    });
    return map;
  }

  /* Ejercicio dentro de una sesión. `target` es el objetivo de la rutina (o null si se añade en la sesión).
   * Cada serie se rellena con el resultado anterior si existe; si no, con el objetivo. */
  function buildSessionExercise(exercise, prev, target) {
    var count = target ? target.sets : prev ? prev.sets.length : 3;
    var sets = [];
    for (var i = 0; i < count; i++) {
      var p = prev && prev.sets[i];
      sets.push({
        weight: p ? p.weight : target ? target.weight : null,
        reps: p ? p.reps : target ? target.reps : null,
        done: false
      });
    }
    return {
      exerciseId: exercise.id,
      name: exercise.name,
      muscle: exercise.muscle || '',
      notes: exercise.notes || '',
      sets: sets
    };
  }

  function buildSession(routine, exercisesById, prevMap) {
    var exercises = [];
    if (routine) {
      routine.items.forEach(function (item) {
        var exercise = exercisesById[item.exerciseId];
        if (exercise) exercises.push(buildSessionExercise(exercise, prevMap[exercise.id], item));
      });
    }
    return {
      id: uid(),
      routineId: routine ? routine.id : null,
      routineName: routine ? routine.name : t('Free workout'),
      status: 'active',
      startedAt: Date.now(),
      finishedAt: null,
      note: '',
      exercises: exercises
    };
  }

  function countSets(session) {
    var total = 0;
    var done = 0;
    session.exercises.forEach(function (ex) {
      ex.sets.forEach(function (set) {
        total++;
        if (set.done) done++;
      });
    });
    return { total: total, done: done };
  }

  /* Al finalizar solo se guardan las series completadas. */
  function finalizeSession(session) {
    var exercises = session.exercises
      .map(function (ex) {
        return Object.assign({}, ex, {
          sets: ex.sets
            .filter(function (s) { return s.done; })
            .map(function (s) { return { weight: s.weight, reps: s.reps, done: true }; })
        });
      })
      .filter(function (ex) { return ex.sets.length > 0; });
    return Object.assign({}, session, { exercises: exercises, note: (session.note || '').trim() });
  }

  function sessionStats(session) {
    var sets = 0;
    var volume = 0;
    session.exercises.forEach(function (ex) {
      ex.sets.forEach(function (s) {
        sets++;
        if (s.weight && s.reps) volume += s.weight * s.reps;
      });
    });
    var end = session.finishedAt || Date.now();
    return {
      exercises: session.exercises.length,
      sets: sets,
      volume: Math.round(volume),
      durationMs: end - session.startedAt
    };
  }

  /* Historial de un ejercicio: sesiones (más recientes primero) donde aparece. */
  function exerciseHistory(doneSessions, exerciseId) {
    return doneSessions
      .slice()
      .sort(byFinishedDesc)
      .map(function (session) {
        var matches = session.exercises.filter(function (ex) { return ex.exerciseId === exerciseId; });
        var sets = [];
        matches.forEach(function (ex) { sets = sets.concat(ex.sets); });
        return { session: session, name: matches.length ? matches[0].name : '', sets: sets };
      })
      .filter(function (entry) { return entry.sets.length > 0; });
  }

  Forge.logic = {
    uid: uid,
    clone: clone,
    toNumber: toNumber,
    toInt: toInt,
    plural: plural,
    sessionName: sessionName,
    byFinishedDesc: byFinishedDesc,
    moveItem: moveItem,
    fmtDay: fmtDay,
    fmtShortDate: fmtShortDate,
    fmtTime: fmtTime,
    dayKey: dayKey,
    fmtDuration: fmtDuration,
    fmtNum: fmtNum,
    fmtSet: fmtSet,
    newRoutine: newRoutine,
    newRoutineItem: newRoutineItem,
    cleanRoutineItem: cleanRoutineItem,
    duplicateRoutine: duplicateRoutine,
    lastSetsByExercise: lastSetsByExercise,
    buildSessionExercise: buildSessionExercise,
    buildSession: buildSession,
    countSets: countSets,
    finalizeSession: finalizeSession,
    sessionStats: sessionStats,
    exerciseHistory: exerciseHistory
  };
})(window);
