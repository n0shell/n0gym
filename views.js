/* n0gym - views.js
 * Interfaz: cada vista recibe datos y devuelve HTML. No lee ni escribe datos.
 * Los botones llevan data-action y los campos data-field; app.js los gestiona.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var L = Forge.logic;
  var esc = Forge.ui.esc;
  var t = Forge.i18n.t;

  /* Grupos musculares sugeridos en el formulario (se traducen al construirlo). */
  function muscles() {
    return [
      t('Chest'), t('Back'), t('Shoulders'), t('Biceps'), t('Triceps'), t('Forearm'), t('Quadriceps'),
      t('Hamstrings'), t('Glutes'), t('Calves'), t('Abs'), t('Full body'), t('Cardio')
    ];
  }

  /* ---------- piezas comunes ---------- */

  function val(v) {
    return v === null || v === undefined ? '' : esc(v);
  }

  function top(title, backHref, extra) {
    return (
      '<header class="top">' +
      (backHref ? '<a class="icon-btn" href="' + backHref + '" aria-label="' + esc(t('Go back')) + '">←</a>' : '') +
      '<h1>' + esc(title) + '</h1>' +
      (extra || '') +
      '</header>'
    );
  }

  function empty(title, text, actions) {
    return '<div class="empty"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + (actions || '') + '</div>';
  }

  function sectionTabs(active) {
    function link(href, key, label) {
      return '<a href="' + href + '"' + (active === key ? ' aria-current="page"' : '') + '>' + label + '</a>';
    }
    return '<nav class="seg" aria-label="' + esc(t('Section')) + '">' +
      link('#/routines', 'routines', t('Routines')) +
      link('#/exercises', 'exercises', t('Exercises')) +
      '</nav>';
  }

  function routineSummary(routine, exById) {
    var names = routine.items
      .map(function (it) { return exById[it.exerciseId]; })
      .filter(Boolean)
      .map(function (ex) { return ex.name; });
    var line = t('{n} exercises', { n: names.length });
    if (names.length) line += ': ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    return line;
  }

  function sessionCard(session, mode) {
    var st = L.sessionStats(session);
    var when = mode === 'time' ? L.fmtTime(session.finishedAt) : L.fmtShortDate(session.finishedAt);
    return (
      '<a class="card card-link" href="#/history/' + esc(session.id) + '">' +
      '<div class="row-between"><h3>' + esc(L.sessionName(session)) + '</h3>' +
      '<span class="muted small">' + esc(when) + '</span></div>' +
      '<p class="muted">' + t('{n} exercises', { n: st.exercises }) + ', ' +
      t('{n} sets', { n: st.sets }) + ', ' + L.fmtDuration(st.durationMs) + '</p>' +
      '</a>'
    );
  }

  /* Miniatura de una foto; al tocarla se abre la galería del ejercicio.
   * El src lo pone app.js después de pintar (data-thumb = id de la foto). */
  function thumbBtn(exerciseId, name, imageId, index, total) {
    return (
      '<button type="button" class="thumb" data-action="view-photos" data-id="' + esc(exerciseId) +
      '" data-name="' + esc(name) + '" data-index="' + index + '" aria-label="' + esc(t('View photos of {name}', { name: name })) + '">' +
      '<img data-thumb="' + esc(imageId) + '" alt="">' +
      (total > 1 && index === 0 ? '<span class="thumb-count">' + total + '</span>' : '') +
      '</button>'
    );
  }

  function photoStrip(exerciseId, name, ids) {
    if (!ids || !ids.length) return '';
    return '<div class="photo-strip">' + ids.map(function (id, i) {
      return thumbBtn(exerciseId, name, id, i, ids.length);
    }).join('') + '</div>';
  }

  function setsList(sets) {
    return '<ol class="sets">' + sets.map(function (s) { return '<li>' + esc(L.fmtSet(s)) + '</li>'; }).join('') + '</ol>';
  }

  /* ---------- inicio ---------- */

  function home(d) {
    var html = '<header class="top"><h1 class="brand">n0gym</h1></header>';

    if (d.active) {
      var c = L.countSets(d.active);
      html +=
        '<a class="banner" href="#/workout">' +
        '<span><strong>' + esc(t('Workout in progress')) + '</strong><br>' +
        '<span class="muted">' + esc(L.sessionName(d.active)) + ', ' + esc(t('{done} of {total} sets', { done: c.done, total: c.total })) + '</span></span>' +
        '<span class="btn btn-sm">' + esc(t('Continue')) + '</span></a>';
    }

    html += '<section><div class="section-head"><h2>' + esc(t('Your routines')) + '</h2><a class="link" href="#/routines">' + esc(t('Manage')) + '</a></div>';
    if (d.routines.length) {
      html += d.routines.map(function (r) {
        return (
          '<article class="card"><h3>' + esc(r.name) + '</h3>' +
          '<p class="muted">' + esc(routineSummary(r, d.exById)) + '</p>' +
          '<button type="button" class="btn block" data-action="start-routine" data-id="' + esc(r.id) + '">' + esc(t('Train')) + '</button>' +
          '</article>'
        );
      }).join('');
    } else {
      html += empty(
        t('You have no routines yet'),
        t('Create your first routine with the exercises you usually do.'),
        '<button type="button" class="btn" data-action="new-routine">' + esc(t('Create routine')) + '</button>'
      );
    }
    html += '<button type="button" class="btn btn-ghost block" data-action="start-free">' + esc(t('Free workout')) + '</button></section>';

    html += '<section><div class="section-head"><h2>' + esc(t('Latest sessions')) + '</h2><a class="link" href="#/history">' + esc(t('View history')) + '</a></div>';
    html += d.recent.length
      ? d.recent.map(function (s) { return sessionCard(s, 'date'); }).join('')
      : empty(t('No sessions yet'), t('Your finished workouts will appear here.'));
    html += '</section>';
    return html;
  }

  /* ---------- rutinas ---------- */

  function routines(d) {
    var html = top(t('Routines'), null, '<button type="button" class="btn btn-sm" data-action="new-routine">' + esc(t('New routine')) + '</button>');
    html += sectionTabs('routines');
    if (!d.routines.length) {
      return html + empty(
        t('There are no routines'),
        t('A routine groups the exercises you do together, with sets, reps and a target weight.'),
        '<button type="button" class="btn" data-action="new-routine">' + esc(t('Create routine')) + '</button>'
      );
    }
    return html + d.routines.map(function (r) {
      var id = esc(r.id);
      return (
        '<article class="card"><h3>' + esc(r.name) + '</h3>' +
        '<p class="muted">' + esc(routineSummary(r, d.exById)) + '</p>' +
        '<div class="row"><button type="button" class="btn grow" data-action="start-routine" data-id="' + id + '">' + esc(t('Train')) + '</button>' +
        '<a class="btn btn-ghost" href="#/routine/' + id + '">' + esc(t('Edit')) + '</a></div>' +
        '<div class="row mt"><button type="button" class="btn btn-ghost grow" data-action="duplicate-routine" data-id="' + id + '">' + esc(t('Duplicate')) + '</button>' +
        '<button type="button" class="btn btn-ghost grow danger-text" data-action="delete-routine" data-id="' + id + '">' + esc(t('Delete')) + '</button></div>' +
        '</article>'
      );
    }).join('');
  }

  function routineEditor(d) {
    var r = d.draft;
    var last = r.items.length - 1;
    var html = top(d.isNew ? t('New routine') : t('Edit routine'), '#/routines');

    html +=
      '<label class="field" for="r-name"><span>' + esc(t('Routine name')) + '</span>' +
      '<input id="r-name" type="text" maxlength="60" autocomplete="off" placeholder="' + esc(t('For example, Push')) + '" ' +
      'data-field="routine-name" value="' + val(r.name) + '"></label>';

    html += '<div class="section-head"><h2>' + esc(t('Exercises')) + '</h2></div>';

    if (!r.items.length) {
      html += empty(t('No exercises'), t('Add the exercises for this routine. You can change the order later.'));
    }

    html += r.items.map(function (it, i) {
      var ex = d.exById[it.exerciseId];
      var idx = ' data-index="' + i + '"';
      return (
        '<article class="card">' +
        '<div class="row-between"><div class="ex-row">' +
        (ex && d.imgs[ex.id] && d.imgs[ex.id].length ? thumbBtn(ex.id, ex.name, d.imgs[ex.id][0], 0, d.imgs[ex.id].length) : '') +
        '<div><h3>' + esc(ex ? ex.name : t('Exercise deleted')) + '</h3>' +
        (ex && ex.muscle ? '<p class="muted small">' + esc(ex.muscle) + '</p>' : '') + '</div></div>' +
        '<div class="row-tight">' +
        '<button type="button" class="icon-btn" data-action="move-item-up"' + idx + ' aria-label="' + esc(t('Move exercise up')) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="icon-btn" data-action="move-item-down"' + idx + ' aria-label="' + esc(t('Move exercise down')) + '"' + (i === last ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="icon-btn" data-action="remove-item"' + idx + ' aria-label="' + esc(t('Remove exercise')) + '">✕</button>' +
        '</div></div>' +
        '<div class="grid3">' +
        '<label class="field"><span>' + esc(t('Sets')) + '</span><input type="number" inputmode="numeric" min="1" max="20" step="1" data-field="item-sets"' + idx + ' value="' + val(it.sets) + '"></label>' +
        '<label class="field"><span>' + esc(t('Reps')) + '</span><input type="number" inputmode="numeric" min="1" max="999" step="1" data-field="item-reps"' + idx + ' value="' + val(it.reps) + '"></label>' +
        '<label class="field"><span>' + esc(t('Weight (kg)')) + '</span><input type="number" inputmode="decimal" min="0" step="any" data-field="item-weight"' + idx + ' value="' + val(it.weight) + '" placeholder="' + esc(t('Optional')) + '"></label>' +
        '</div></article>'
      );
    }).join('');

    html += '<button type="button" class="btn btn-ghost block" data-action="add-routine-exercise">' + esc(t('Add exercise')) + '</button>';
    html +=
      '<div class="sticky-actions">' +
      '<a class="btn btn-ghost" href="#/routines">' + esc(t('Cancel')) + '</a>' +
      '<button type="button" class="btn grow" data-action="save-routine">' + esc(t('Save routine')) + '</button></div>';
    return html;
  }

  /* ---------- ejercicios ---------- */

  function exercises(d) {
    var html = top(t('Exercises'), null, '<button type="button" class="btn btn-sm" data-action="new-exercise">' + esc(t('New exercise')) + '</button>');
    html += sectionTabs('exercises');
    if (!d.exercises.length) {
      return html + empty(
        t('There are no exercises'),
        t('Create exercises here or directly while building a routine.'),
        '<button type="button" class="btn" data-action="new-exercise">' + esc(t('Create exercise')) + '</button>'
      );
    }
    return html + d.exercises.map(function (ex) {
      var id = esc(ex.id);
      return (
        '<article class="card"><div class="ex-row">' +
        (d.imgs[ex.id] && d.imgs[ex.id].length ? thumbBtn(ex.id, ex.name, d.imgs[ex.id][0], 0, d.imgs[ex.id].length) : '') +
        '<div class="grow"><h3>' + esc(ex.name) + '</h3>' +
        (ex.muscle ? '<p class="muted">' + esc(ex.muscle) + '</p>' : '') +
        (ex.notes ? '<p class="note">' + esc(ex.notes) + '</p>' : '') + '</div></div>' +
        '<div class="row mt">' +
        '<a class="btn btn-ghost grow" href="#/exercise/' + id + '">' + esc(t('History')) + '</a>' +
        '<button type="button" class="btn btn-ghost grow" data-action="edit-exercise" data-id="' + id + '">' + esc(t('Edit')) + '</button>' +
        '<button type="button" class="btn btn-ghost grow danger-text" data-action="delete-exercise" data-id="' + id + '">' + esc(t('Delete')) + '</button>' +
        '</div></article>'
      );
    }).join('');
  }

  function exerciseForm(ex) {
    var options = muscles().map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('');
    return (
      '<form class="dlg-body" id="ex-form" novalidate>' +
      '<h2>' + (ex ? t('Edit exercise') : t('New exercise')) + '</h2>' +
      '<label class="field" for="ex-name"><span>' + esc(t('Name')) + '</span>' +
      '<input id="ex-name" type="text" maxlength="80" autocomplete="off" autofocus value="' + val(ex && ex.name) + '"></label>' +
      '<label class="field" for="ex-muscle"><span>' + esc(t('Muscle group (optional)')) + '</span>' +
      '<input id="ex-muscle" type="text" list="muscle-list" maxlength="40" autocomplete="off" value="' + val(ex && ex.muscle) + '"></label>' +
      '<datalist id="muscle-list">' + options + '</datalist>' +
      '<label class="field" for="ex-notes"><span>' + esc(t('Personal notes')) + '</span>' +
      '<textarea id="ex-notes" rows="3" maxlength="500">' + val(ex && ex.notes) + '</textarea></label>' +
      '<div class="field"><span>' + esc(t('Photos (optional)')) + '</span>' +
      '<div id="ex-photos" class="photo-grid"></div>' +
      '<input id="ex-file" type="file" accept="image/*" multiple hidden>' +
      '<button type="button" class="btn btn-ghost block" id="ex-add-photo">' + esc(t('Add photo')) + '</button>' +
      '<p class="muted small" id="ex-photo-help">' + esc(t('Upload a photo to remember how the exercise is done. You can use the camera or the gallery.')) + '</p></div>' +
      '<p class="form-error" id="ex-error" role="alert" hidden></p>' +
      '<div class="dlg-actions">' +
      '<button type="button" class="btn btn-ghost" data-close="no">' + esc(t('Cancel')) + '</button>' +
      '<button type="submit" class="btn">' + esc(t('Save')) + '</button></div>' +
      '</form>'
    );
  }

  function exercisePicker(list) {
    var html = '<div class="dlg-body"><h2>' + esc(t('Choose exercise')) + '</h2>';
    if (list.length) {
      html +=
        '<label class="field" for="pick-search"><span>' + esc(t('Search')) + '</span>' +
        '<input id="pick-search" type="search" autocomplete="off"></label>' +
        '<div class="pick-list">' +
        list.map(function (ex) {
          return (
            '<button type="button" class="pick" data-pick="' + esc(ex.id) + '" data-name="' + esc(ex.name + ' ' + (ex.muscle || '')) + '">' +
            '<span>' + esc(ex.name) + '</span>' + (ex.muscle ? '<small>' + esc(ex.muscle) + '</small>' : '') + '</button>'
          );
        }).join('') +
        '</div><p class="muted" id="pick-none" hidden>' + esc(t('No exercise matches.')) + '</p>';
    } else {
      html += '<p class="muted">' + esc(t('You have no saved exercises yet.')) + '</p>';
    }
    html +=
      '<button type="button" class="btn btn-ghost block" data-new="1">' + esc(t('Create new exercise')) + '</button>' +
      '<button type="button" class="btn btn-quiet block" data-close="no">' + esc(t('Cancel')) + '</button></div>';
    return html;
  }

  function photoGrid(list) {
    return list.map(function (p, i) {
      return (
        '<div class="photo"><img data-photo="' + esc(p.id) + '" alt="' + esc(t('Photo {n}', { n: i + 1 })) + '">' +
        '<button type="button" class="photo-rm" data-rm="' + esc(p.id) + '" aria-label="' + esc(t('Remove photo {n}', { n: i + 1 })) + '">✕</button></div>'
      );
    }).join('');
  }

  function photoViewer(name, ids) {
    return (
      '<div class="dlg-body"><h2>' + esc(name) + '</h2>' +
      '<div class="gallery">' + ids.map(function (id, i) {
        return '<img data-full="' + esc(id) + '" alt="' + esc(t('Photo {n} of {name}', { n: i + 1, name: name })) + '">';
      }).join('') + '</div>' +
      (ids.length > 1 ? '<p class="muted small">' + esc(t('Swipe to see the {n} photos.', { n: ids.length })) + '</p>' : '') +
      '<button type="button" class="btn btn-ghost block" data-close="no">' + esc(t('Close')) + '</button></div>'
    );
  }

  function exerciseHistory(d) {
    var name = d.exercise ? d.exercise.name : d.entries.length ? d.entries[0].name : t('Exercise');
    var html = top(name, '#/exercises');
    if (d.exercise && d.exercise.muscle) html += '<p class="muted">' + esc(d.exercise.muscle) + '</p>';
    if (d.exercise && d.exercise.notes) html += '<p class="note">' + esc(d.exercise.notes) + '</p>';
    if (!d.entries.length) {
      return html + empty(t('No records'), t('When you complete sets of this exercise, you will see your progress here.'));
    }
    return html + d.entries.map(function (entry) {
      return (
        '<a class="card card-link" href="#/history/' + esc(entry.session.id) + '">' +
        '<div class="row-between"><h3>' + esc(L.fmtDay(entry.session.finishedAt)) + '</h3>' +
        '<span class="muted small">' + esc(L.sessionName(entry.session)) + '</span></div>' +
        setsList(entry.sets) + '</a>'
      );
    }).join('');
  }

  /* ---------- entrenamiento activo ---------- */

  function setRow(ex, ei, set, si) {
    var where = ' data-ei="' + ei + '" data-si="' + si + '"';
    var rawLabel = t('{name}, set {n}', { name: ex.name, n: si + 1 });
    var label = esc(rawLabel);
    return (
      '<div class="set' + (set.done ? ' done' : '') + '">' +
      '<span class="set-n">' + (si + 1) + '</span>' +
      '<input type="number" inputmode="decimal" min="0" step="any" placeholder="kg" data-field="set-weight"' + where +
      ' value="' + val(set.weight) + '" aria-label="' + esc(t('Weight in kg, {label}', { label: rawLabel })) + '">' +
      '<input type="number" inputmode="numeric" min="0" step="1" placeholder="' + esc(t('reps')) + '" data-field="set-reps"' + where +
      ' value="' + val(set.reps) + '" aria-label="' + esc(t('Repetitions, {label}', { label: rawLabel })) + '">' +
      '<button type="button" class="check" data-action="toggle-set"' + where + ' aria-pressed="' + (set.done ? 'true' : 'false') +
      '" aria-label="' + esc(t('Complete {label}', { label: rawLabel })) + '">✓</button>' +
      '<button type="button" class="icon-btn small" data-action="remove-set"' + where + ' aria-label="' + esc(t('Remove set {n}', { n: si + 1 })) + '">−</button>' +
      '</div>'
    );
  }

  function workout(d) {
    var s = d.session;
    var c = L.countSets(s);
    var html =
      '<header class="top"><h1>' + esc(L.sessionName(s)) + '</h1>' +
      '<a class="link" href="#/plates">' + esc(t('Plates')) + '</a>' +
      '<span class="chip" id="w-progress">' + esc(t('{done}/{total} sets', { done: c.done, total: c.total })) + '</span></header>' +
      '<p class="muted">' + esc(t('Started at {time}', { time: L.fmtTime(s.startedAt) })) + '</p>';

    if (!s.exercises.length) {
      html += empty(t('No exercises'), t('Add the first exercise of this session.'));
    }

    html += s.exercises.map(function (ex, ei) {
      var prev = d.prev[ex.exerciseId];
      var prevText = prev
        ? t('Previous ({date}): {sets}', { date: L.fmtShortDate(prev.date), sets: prev.sets.map(L.fmtSet).join(', ') })
        : t('No previous records');
      return (
        '<section class="card ex">' +
        '<div class="row-between"><h2>' + esc(ex.name) + '</h2>' +
        '<button type="button" class="icon-btn" data-action="remove-ex" data-ei="' + ei + '" aria-label="' + esc(t('Remove {name} from the session', { name: ex.name })) + '">✕</button></div>' +
        (ex.notes ? '<p class="note">' + esc(ex.notes) + '</p>' : '') +
        photoStrip(ex.exerciseId, ex.name, d.imgs[ex.exerciseId]) +
        '<p class="prev">' + esc(prevText) + '</p>' +
        '<div class="set set-head" aria-hidden="true"><span>' + esc(t('Set')) + '</span><span>' + esc(t('Kg')) + '</span><span>' + esc(t('Reps')) + '</span><span></span><span></span></div>' +
        ex.sets.map(function (set, si) { return setRow(ex, ei, set, si); }).join('') +
        '<button type="button" class="btn btn-ghost block" data-action="add-set" data-ei="' + ei + '">' + esc(t('Add set')) + '</button>' +
        '</section>'
      );
    }).join('');

    html +=
      '<button type="button" class="btn btn-ghost block" data-action="add-session-exercise">' + esc(t('Add exercise')) + '</button>' +
      '<label class="field" for="s-note"><span>' + esc(t('Session notes')) + '</span>' +
      '<textarea id="s-note" rows="3" maxlength="1000" data-field="session-note">' + val(s.note) + '</textarea></label>' +
      '<div class="sticky-actions">' +
      '<button type="button" class="btn btn-ghost danger-text" data-action="cancel-session">' + esc(t('Cancel')) + '</button>' +
      '<button type="button" class="btn grow" data-action="finish-session">' + esc(t('Finish')) + '</button></div>';
    return html;
  }

  function noWorkout() {
    return top(t('Workout')) + empty(
      t('There is no workout in progress'),
      t('Start one from a routine or with a free workout.'),
      '<a class="btn" href="#/">' + esc(t('Go to home')) + '</a>'
    );
  }

  /* ---------- historial ---------- */

  function history(d) {
    var html = top(t('History'));
    if (!d.sessions.length) {
      return html + empty(t('There are no workouts yet'), t('Finish a session and it will be saved here.'));
    }
    var groups = [];
    var current = null;
    d.sessions.forEach(function (s) {
      var key = L.dayKey(s.finishedAt);
      if (!current || current.key !== key) {
        current = { key: key, ts: s.finishedAt, items: [] };
        groups.push(current);
      }
      current.items.push(s);
    });
    return html + groups.map(function (g) {
      return '<h2 class="day">' + esc(L.fmtDay(g.ts)) + '</h2>' +
        g.items.map(function (s) { return sessionCard(s, 'time'); }).join('');
    }).join('');
  }

  function sessionDetail(s) {
    var st = L.sessionStats(s);
    var html = top(L.sessionName(s), '#/history');
    html += '<p class="muted">' + esc(t('{date}, from {start} to {end}', { date: L.fmtDay(s.finishedAt), start: L.fmtTime(s.startedAt), end: L.fmtTime(s.finishedAt) })) + '</p>';
    html +=
      '<div class="stats">' +
      '<div><strong>' + st.sets + '</strong><span>' + esc(t('sets')) + '</span></div>' +
      '<div><strong>' + esc(st.volume.toLocaleString(Forge.i18n.locale())) + '</strong><span>' + esc(t('kg of volume')) + '</span></div>' +
      '<div><strong>' + esc(L.fmtDuration(st.durationMs)) + '</strong><span>' + esc(t('duration')) + '</span></div></div>';
    html += s.exercises.map(function (ex) {
      return (
        '<section class="card"><h3><a href="#/exercise/' + esc(ex.exerciseId) + '">' + esc(ex.name) + '</a></h3>' +
        (ex.notes ? '<p class="note">' + esc(ex.notes) + '</p>' : '') +
        setsList(ex.sets) + '</section>'
      );
    }).join('');
    if (s.note) {
      html += '<section class="card"><h3>' + esc(t('Session notes')) + '</h3><p class="note">' + esc(s.note) + '</p></section>';
    }
    html += '<button type="button" class="btn btn-ghost block danger-text" data-action="delete-session" data-id="' + esc(s.id) + '">' + esc(t('Delete session')) + '</button>';
    return html;
  }

  /* ---------- ajustes ---------- */

  function settings(d) {
    return (
      top(t('Settings')) +
      '<section class="card"><h3>' + esc(t('Language')) + '</h3>' +
      '<label class="field" for="lang-select"><span>' + esc(t('Choose the language of the app.')) + '</span>' +
      '<select id="lang-select">' + Forge.i18n.LANGS.map(function (l) {
        return '<option value="' + esc(l.code) + '"' + (l.code === Forge.i18n.lang() ? ' selected' : '') + '>' + esc(l.name) + '</option>';
      }).join('') + '</select></label></section>' +
      '<section class="card"><h3>' + esc(t('Your data')) + '</h3><dl class="kv">' +
      '<div><dt>' + esc(t('Routines')) + '</dt><dd>' + d.routines + '</dd></div>' +
      '<div><dt>' + esc(t('Exercises')) + '</dt><dd>' + d.exercises + '</dd></div>' +
      '<div><dt>' + esc(t('Workouts')) + '</dt><dd>' + d.sessions + '</dd></div></dl></section>' +
      '<section class="card"><h3>' + esc(t('Storage')) + '</h3>' +
      '<p class="muted">' + esc(t('Everything is saved on this device, inside the browser. There are no accounts or servers. If you clear the browser data, n0gym data is also deleted.')) + '</p></section>' +
      '<section class="card"><h3>' + esc(t('Backup')) + '</h3>' +
      '<p class="muted">' + esc(t('Save a file with your routines, exercises, photos and history. Restoring replaces the current data on this device. If you have many photos, the file can be large.')) + '</p>' +
      '<button type="button" class="btn block" data-action="export-backup">' + esc(t('Export data (.json)')) + '</button>' +
      '<button type="button" class="btn btn-ghost block" data-action="import-backup">' + esc(t('Restore backup')) + '</button>' +
      '<input type="file" id="backup-file" accept="application/json,.json" hidden></section>' +
      '<section class="card"><h3>' + esc(t('Delete data')) + '</h3>' +
      '<p class="muted">' + esc(t('Removes routines, exercises, photos and history from this device.')) + '</p>' +
      '<button type="button" class="btn btn-danger block" data-action="delete-all">' + esc(t('Delete all data')) + '</button></section>' +
      '<section class="card"><h3>' + esc(t('Support and community')) + '</h3>' +
      '<p class="muted">' + esc(t('Questions, suggestions or bug reports? Join the community.')) + '</p>' +
      '<a class="btn block" href="' + esc(Forge.config.discord) + '" target="_blank" rel="noopener noreferrer">' + esc(t('Join Discord')) + '</a></section>' +
      '<section class="card"><h3>' + esc(t('Donations')) + ' · Solana / USDC</h3>' +
      '<p class="muted">' + esc(t('You can support the development of n0gym v{version}.', { version: Forge.config.version })) + '</p>' +
      '<dl class="kv"><div><dt>' + esc(t('Network')) + '</dt><dd>' + esc(Forge.config.donate.network) + '</dd></div></dl>' +
      '<div class="field mt"><span id="wallet-label">' + esc(t('Wallet address')) + '</span>' +
      '<div class="row"><input id="wallet-address" class="wallet" type="text" readonly spellcheck="false" autocomplete="off" aria-labelledby="wallet-label" value="' + esc(Forge.config.donate.address) + '">' +
      '<button type="button" class="btn btn-ghost copy-btn" data-action="copy-wallet" aria-label="' + esc(t('Copy the address')) + '">' + esc(t('Copy')) + '</button></div></div>' +
      '<p class="muted small">' + esc(t('Send only through the Solana network (SOL or USDC).')) + '</p></section>' +
      '<p class="muted small center">' + esc(t('n0gym v{version}, created by n0shell', { version: Forge.config.version })) + '</p>'
    );
  }

  /* ---------- calculadora de discos ---------- */

  /* Variables CSS con los colores IPF de un disco (valores fijos, no vienen del usuario). */
  function plateVars(weight) {
    var c = Forge.plates.color(weight);
    return '--pc:' + c.bg + ';--pf:' + c.fg + ';--pe:' + c.edge;
  }

  /* Barra con los discos de un lado: del más pesado (junto al centro) al más ligero. */
  function platesVisual(perSide) {
    var P = Forge.plates;
    var weights = [];
    perSide.forEach(function (p) { for (var i = 0; i < p.n; i++) weights.push(p.w); });
    return '<div class="plate-vis" role="img" aria-label="' + esc(t('Plates of one side, from heaviest (next to the center) to lightest')) + '">' +
      '<span class="bar-shaft"></span><span class="bar-collar"></span>' +
      weights.map(function (w) {
        var d = P.dims(w);
        var c = P.color(w);
        return '<span class="plate" style="height:' + d.h + 'px;width:' + d.w + 'px;background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.edge + '">' +
          '<span>' + esc(L.fmtNum(w)) + '</span></span>';
      }).join('') +
      '<span class="bar-tip"></span></div>';
  }

  function platesResult(r) {
    var f = L.fmtNum;
    if (r.status === 'invalid') {
      var why = r.reason === 'bar' ? t('Enter the bar weight in kilograms (0 to 100).')
        : r.reason === 'max' ? t('The maximum weight of the calculator is 1000 kg.')
        : t('Enter the target weight in kilograms.');
      return '<section class="card"><p class="muted">' + why + '</p></section>';
    }
    if (r.status === 'below-bar') {
      return '<section class="card"><p><strong>' + esc(t('The target ({target} kg) is lower than the bar ({bar} kg).', { target: f(r.target), bar: f(r.bar) })) + '</strong></p>' +
        '<p class="muted">' + esc(t('Raise the target weight or change the bar weight.')) + '</p></section>';
    }

    var html = '<section class="card">';
    if (r.status === 'closest') {
      html += '<p><strong>' + esc(t('{target} kg cannot be reached exactly.', { target: f(r.target) })) + '</strong></p>' +
        (r.noPlates
          ? '<p class="muted">' + esc(t('There are no active plates with available quantity. Turn them on under Available plates.')) + '</p>'
          : '<p class="muted">' + esc(t('With the available plates, the closest you can get without going over is {total} kg (missing {diff} kg).', { total: f(r.total), diff: f(r.diff) })) + '</p>') +
        (r.total !== r.bar ? '<button type="button" class="btn btn-sm" data-action="plates-use" data-v="' + r.total + '">' + esc(t('Use {total} kg', { total: f(r.total) })) + '</button>' : '');
    }
    html += '<dl class="kv">' +
      '<div><dt>' + esc(t('Target weight')) + '</dt><dd>' + f(r.target) + ' kg</dd></div>' +
      '<div><dt>' + esc(t('Bar')) + '</dt><dd>' + f(r.bar) + ' kg</dd></div>' +
      '<div><dt>' + esc(t('Plates (both sides)')) + '</dt><dd>' + f(r.plates) + ' kg</dd></div>' +
      '<div><dt>' + esc(t('Final weight')) + '</dt><dd>' + f(r.total) + ' kg</dd></div></dl></section>';

    html += '<section class="card"><h3>' + esc(t('Each side of the bar')) + '</h3>';
    if (r.perSide.length) {
      html += '<ul class="plate-chips">' + r.perSide.map(function (p) {
        return '<li class="plate-chip" style="' + plateVars(p.w) + '">' + p.n + ' × ' + esc(f(p.w)) + ' kg</li>';
      }).join('') + '</ul>' +
        '<p class="muted small">' + esc(t('Total per side: {side} kg. Put the same setup on the other side.', { side: f(r.side) })) + '</p>' +
        platesVisual(r.perSide);
    } else {
      html += '<p class="muted">' + esc(t('Only the bar, no plates.')) + '</p>';
    }
    return html + '</section>';
  }

  function platesList(list) {
    var rows = list.map(function (p, i) {
      return (
        '<div class="plate-row' + (p.on ? ' on' : '') + '" style="' + plateVars(p.w) + '">' +
        '<button type="button" class="check" data-action="plates-toggle" data-i="' + i + '" aria-pressed="' + (p.on ? 'true' : 'false') +
        '" aria-label="' + esc(p.w === null ? t('Use the plate with no weight set') : t('Use the {weight} kg plate', { weight: L.fmtNum(p.w) })) + '">✓</button>' +
        '<input type="number" inputmode="decimal" min="0" step="any" data-field="plates-w" data-i="' + i + '" value="' + val(p.w) + '" aria-label="' + esc(t('Plate weight in kg')) + '">' +
        '<input type="number" inputmode="numeric" min="0" max="' + Forge.plates.MAX_COUNT + '" step="1" data-field="plates-n" data-i="' + i + '" value="' + val(p.count) + '" aria-label="' + esc(t('Maximum quantity per side')) + '">' +
        '<button type="button" class="icon-btn small" data-action="plates-remove" data-i="' + i + '" aria-label="' + esc(t('Remove this plate')) + '">−</button>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="plate-row head" aria-hidden="true"><span>' + esc(t('Use')) + '</span><span>' + esc(t('Kg')) + '</span><span>' + esc(t('Max. per side')) + '</span><span></span></div>' +
      (rows || '<p class="muted">' + esc(t('There are no plates. Add at least one.')) + '</p>')
    );
  }

  function plates(d) {
    var cfg = d.cfg;
    var deltas = [-10, -5, -2.5, 2.5, 5, 10];
    return (
      top(t('Plate calculator'), '', d.active ? '<a class="link" href="#/workout">' + esc(t('Back to workout')) + '</a>' : '') +
      '<section class="card">' +
      '<label class="field" for="p-target"><span>' + esc(t('Target weight (kg)')) + '</span>' +
      '<input id="p-target" type="number" inputmode="decimal" min="0" max="' + Forge.plates.MAX_TARGET + '" step="any" data-field="plates-target" value="' + val(cfg.target) + '"></label>' +
      '<div class="grid3">' + deltas.map(function (x) {
        return '<button type="button" class="btn btn-ghost btn-sm" data-action="plates-adjust" data-delta="' + x + '">' + (x > 0 ? '+' : '−') + L.fmtNum(Math.abs(x)) + '</button>';
      }).join('') + '</div>' +
      '<label class="field mt" for="p-bar"><span>' + esc(t('Bar (kg)')) + '</span>' +
      '<input id="p-bar" type="number" inputmode="decimal" min="0" max="100" step="any" data-field="plates-bar" value="' + val(cfg.bar) + '"></label>' +
      '<div class="row"><button type="button" class="btn btn-ghost btn-sm grow" data-action="plates-bar-set" data-v="10">10 kg</button>' +
      '<button type="button" class="btn btn-ghost btn-sm grow" data-action="plates-bar-set" data-v="15">15 kg</button>' +
      '<button type="button" class="btn btn-ghost btn-sm grow" data-action="plates-bar-set" data-v="20">20 kg</button></div>' +
      '</section>' +
      '<div id="plates-result">' + platesResult(d.result) + '</div>' +
      '<details class="card plates-cfg"><summary>' + esc(t('Available plates')) + '</summary>' +
      '<p class="muted small">' + esc(t('The plates are the same on both sides. Turn each one on or off, change its weight or limit how many you have per side.')) + '</p>' +
      '<p class="muted small">' + esc(t('IPF colors')) + '</p>' +
      '<ul class="plate-chips legend">' + Forge.plates.COLORS.map(function (c) {
        return '<li class="plate-chip" style="' + plateVars(c.w) + '">' + esc(L.fmtNum(c.w)) + '</li>';
      }).join('') + '</ul>' +
      '<div id="plates-list">' + platesList(cfg.plates) + '</div>' +
      '<div class="row mt"><button type="button" class="btn btn-ghost btn-sm grow" data-action="plates-add">' + esc(t('Add plate')) + '</button>' +
      '<button type="button" class="btn btn-quiet btn-sm grow" data-action="plates-reset">' + esc(t('Reset')) + '</button></div>' +
      '</details>'
    );
  }

  function fatal(message) {
    return empty(
      t('Could not open n0gym'),
      message,
      '<button type="button" class="btn" data-action="reload">' + esc(t('Retry')) + '</button>'
    );
  }

  Forge.views = {
    home: home,
    routines: routines,
    routineEditor: routineEditor,
    exercises: exercises,
    exerciseForm: exerciseForm,
    exercisePicker: exercisePicker,
    photoGrid: photoGrid,
    photoViewer: photoViewer,
    exerciseHistory: exerciseHistory,
    workout: workout,
    noWorkout: noWorkout,
    history: history,
    sessionDetail: sessionDetail,
    settings: settings,
    plates: plates,
    platesResult: platesResult,
    platesList: platesList,
    fatal: fatal
  };
})(window);
