/* n0gym - app.js
 * Controlador: rutas, carga de datos, acciones del usuario y guardado automático.
 */
(function () {
  'use strict';

  var Forge = window.Forge;
  var db = Forge.db;
  var L = Forge.logic;
  var ui = Forge.ui;
  var views = Forge.views;
  var imgs = Forge.imgs;
  var backup = Forge.backup;
  var timer = Forge.timer;
  var I18N = Forge.i18n;
  var t = I18N.t;
  var PL = Forge.plates;

  var main = document.getElementById('main');

  var state = {
    draft: null,   // rutina que se está editando (en memoria hasta pulsar Guardar)
    plates: null,  // configuración de la calculadora de discos
    session: null, // sesión activa
    prev: {}       // último resultado de cada ejercicio
  };

  var renderToken = 0;
  var pageUrls = []; // URLs temporales de las miniaturas de la pantalla actual
  var busy = false;
  var saveTimer = null;
  var dirty = false;

  /* ---------- utilidades ---------- */

  function byName(a, b) { return a.name.localeCompare(b.name, Forge.i18n.locale()); }
  function byCreated(a, b) { return a.createdAt - b.createdAt; }
  function indexById(list) {
    var map = {};
    list.forEach(function (item) { map[item.id] = item; });
    return map;
  }
  function onlyDone(sessions) {
    return sessions.filter(function (s) { return s.status === 'done'; });
  }
  function norm(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function fail(err) {
    console.error(err);
    ui.toast(db.errorMessage(err), 'error');
  }
  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  /* ---------- guardado automático de la sesión activa ---------- */

  function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSession, 300);
  }

  function flushSession() {
    clearTimeout(saveTimer);
    if (!dirty || !state.session) return Promise.resolve();
    dirty = false;
    return db.saveActiveSession(state.session).then(
      function (ok) {
        if (!ok) {
          state.session = null;
          ui.toast(t('This workout is no longer active.'), 'error');
        }
      },
      function (err) {
        dirty = true;
        fail(err);
      }
    );
  }

  function dropSessionState() {
    timer.dismiss(); // la sesión termina o cambia: el descanso ya no tiene sentido
    clearTimeout(saveTimer);
    dirty = false;
    state.session = null;
  }

  /* ---------- carga de datos y vistas ---------- */

  /* Miniaturas: { byEx: { exerciseId: [imageId...] }, thumbs: { imageId: Blob } } */
  async function loadImages() {
    var all = (await db.getAll('images')).sort(function (a, b) { return a.createdAt - b.createdAt; });
    var result = { byEx: {}, thumbs: {} };
    all.forEach(function (img) {
      (result.byEx[img.exerciseId] = result.byEx[img.exerciseId] || []).push(img.id);
      result.thumbs[img.id] = img.thumb || img.blob;
    });
    return result;
  }

  function hydrateThumbs(root, thumbs) {
    var list = root.querySelectorAll('img[data-thumb]');
    for (var i = 0; i < list.length; i++) {
      var blob = thumbs[list[i].getAttribute('data-thumb')];
      if (blob) list[i].src = imgs.url(blob, pageUrls);
    }
  }

  function renderTab(tab) {
    var links = document.querySelectorAll('.nav a');
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute('data-tab') === tab) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
  }

  async function render(options) {
    var keepScroll = options && options.keepScroll;
    var scrollY = window.scrollY;
    var token = ++renderToken;

    await flushSession();

    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    var route = parts[0] || '';
    var arg = parts[1];
    if (route !== 'routine') state.draft = null;

    var html;
    var tab = 'home';
    var thumbs = {};
    var onWorkout = false;

    try {
      if (route === '') {
        var h = await Promise.all([db.getAll('routines'), db.getAll('exercises'), db.getAll('sessions'), db.getActiveSession()]);
        html = views.home({
          routines: h[0].sort(byCreated),
          exById: indexById(h[1]),
          recent: onlyDone(h[2]).sort(L.byFinishedDesc).slice(0, 3),
          active: h[3]
        });
      } else if (route === 'routines') {
        tab = 'routines';
        var r = await Promise.all([db.getAll('routines'), db.getAll('exercises')]);
        html = views.routines({ routines: r[0].sort(byCreated), exById: indexById(r[1]) });
      } else if (route === 'routine') {
        tab = 'routines';
        if (!arg) { navigate('#/routines'); return; }
        var stored = await db.get('routines', arg);
        if (!state.draft || state.draft.id !== arg) {
          if (!stored) { navigate('#/routines'); return; }
          state.draft = L.clone(stored);
        }
        var re = await Promise.all([db.getAll('exercises'), loadImages()]);
        thumbs = re[1].thumbs;
        html = views.routineEditor({ draft: state.draft, exById: indexById(re[0]), imgs: re[1].byEx, isNew: !stored });
      } else if (route === 'exercises') {
        tab = 'routines';
        var ex = await Promise.all([db.getAll('exercises'), loadImages()]);
        thumbs = ex[1].thumbs;
        html = views.exercises({ exercises: ex[0].sort(byName), imgs: ex[1].byEx });
      } else if (route === 'exercise') {
        tab = 'routines';
        if (!arg) { navigate('#/exercises'); return; }
        var e = await Promise.all([db.get('exercises', arg), db.getAll('sessions')]);
        var entries = L.exerciseHistory(onlyDone(e[1]), arg);
        if (!e[0] && !entries.length) { navigate('#/exercises'); return; }
        html = views.exerciseHistory({ exercise: e[0] || null, entries: entries });
      } else if (route === 'history') {
        tab = 'history';
        if (arg) {
          var session = await db.get('sessions', arg);
          if (!session || session.status !== 'done') { navigate('#/history'); return; }
          html = views.sessionDetail(session);
        } else {
          html = views.history({ sessions: onlyDone(await db.getAll('sessions')).sort(L.byFinishedDesc) });
        }
      } else if (route === 'workout') {
        var w = await Promise.all([db.getActiveSession(), db.getAll('sessions'), loadImages()]);
        state.session = w[0] || null;
        if (!state.session) {
          html = views.noWorkout();
        } else {
          state.prev = L.lastSetsByExercise(onlyDone(w[1]));
          thumbs = w[2].thumbs;
          html = views.workout({ session: state.session, prev: state.prev, imgs: w[2].byEx });
          onWorkout = true;
        }
      } else if (route === 'plates') {
        tab = 'plates';
        state.plates = PL.load();
        var cfg = state.plates;
        html = views.plates({ cfg: cfg, result: PL.solve(cfg.target, cfg.bar, cfg.plates), active: await db.getActiveSession() });
      } else if (route === 'settings') {
        tab = 'settings';
        var c = await Promise.all([db.getAll('routines'), db.getAll('exercises'), db.getAll('sessions')]);
        html = views.settings({ routines: c[0].length, exercises: c[1].length, sessions: onlyDone(c[2]).length });
      } else {
        navigate('#/');
        return;
      }
    } catch (err) {
      console.error(err);
      html = views.fatal(db.errorMessage(err));
    }

    if (token !== renderToken) return; // llegó una navegación más reciente
    imgs.revoke(pageUrls);
    main.innerHTML = html;
    hydrateThumbs(main, thumbs);
    renderTab(tab);
    timer.setContext(onWorkout);
    window.scrollTo(0, keepScroll ? scrollY : 0);
  }

  /* ---------- diálogos que usan datos ---------- */

  function exerciseDialog(existing) {
    var bucket = [];   // URLs temporales de las miniaturas del formulario
    var photos = [];   // { id, thumb, blob, isNew }
    var removed = [];  // ids de fotos guardadas que se quitarán al pulsar Guardar
    var processing = false;

    return ui.openDialog(views.exerciseForm(existing), function (dlg, close) {
      var form = dlg.querySelector('#ex-form');
      var errorBox = dlg.querySelector('#ex-error');
      var grid = dlg.querySelector('#ex-photos');
      var fileInput = dlg.querySelector('#ex-file');
      var addButton = dlg.querySelector('#ex-add-photo');
      var help = dlg.querySelector('#ex-photo-help');

      function showError(message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
      }

      function renderPhotos() {
        imgs.revoke(bucket);
        grid.innerHTML = views.photoGrid(photos.map(function (p) { return { id: p.id }; }));
        var list = grid.querySelectorAll('img[data-photo]');
        for (var i = 0; i < list.length; i++) {
          var id = list[i].getAttribute('data-photo');
          var p = photos.filter(function (x) { return x.id === id; })[0];
          if (p) list[i].src = imgs.url(p.thumb, bucket);
        }
        addButton.disabled = processing || photos.length >= imgs.MAX_PHOTOS;
        addButton.textContent = photos.length ? t('Add another photo') : t('Add photo');
        if (processing) help.textContent = t('Processing photos…');
        else if (photos.length >= imgs.MAX_PHOTOS) help.textContent = t('You have reached the maximum of {n} photos.', { n: imgs.MAX_PHOTOS });
      }

      if (existing) {
        db.getImagesFor(existing.id).then(function (list) {
          photos = list.map(function (img) { return { id: img.id, thumb: img.thumb || img.blob, isNew: false }; });
          renderPhotos();
        }, function (err) { showError(t('Could not load the photos: {error}', { error: db.errorMessage(err) })); });
      }

      dlg.querySelector('[data-close]').addEventListener('click', function () { close(null); });

      addButton.addEventListener('click', function () { fileInput.click(); });

      fileInput.addEventListener('change', async function () {
        var files = Array.prototype.slice.call(fileInput.files);
        fileInput.value = '';
        if (!files.length) return;
        errorBox.hidden = true;
        processing = true;
        renderPhotos();
        for (var i = 0; i < files.length; i++) {
          if (photos.length >= imgs.MAX_PHOTOS) {
            showError(t('Maximum {n} photos per exercise.', { n: imgs.MAX_PHOTOS }));
            break;
          }
          try {
            var result = await imgs.compress(files[i]);
            photos.push({ id: L.uid(), thumb: result.thumb, blob: result.blob, isNew: true });
          } catch (err) {
            showError(err.message || t('Could not process the image.'));
          }
        }
        processing = false;
        help.textContent = t('Upload a photo to remember how the exercise is done. You can use the camera or the gallery.');
        renderPhotos();
      });

      grid.addEventListener('click', function (e) {
        var button = e.target.closest('[data-rm]');
        if (!button) return;
        var id = button.getAttribute('data-rm');
        var p = photos.filter(function (x) { return x.id === id; })[0];
        if (p && !p.isNew) removed.push(id);
        photos = photos.filter(function (x) { return x.id !== id; });
        renderPhotos();
      });

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (processing) { showError(t('Wait for the photos to finish processing.')); return; }
        var name = dlg.querySelector('#ex-name').value.trim();
        if (!name) { showError(t('Enter a name for the exercise.')); return; }
        try {
          var all = await db.getAll('exercises');
          var duplicated = all.some(function (x) {
            return norm(x.name) === norm(name) && (!existing || x.id !== existing.id);
          });
          if (duplicated) { showError(t('An exercise with that name already exists.')); return; }
          var now = Date.now();
          var exercise = {
            id: existing ? existing.id : L.uid(),
            name: name,
            muscle: dlg.querySelector('#ex-muscle').value.trim(),
            notes: dlg.querySelector('#ex-notes').value.trim(),
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now
          };
          var added = photos.filter(function (p) { return p.isNew; }).map(function (p, i) {
            return { id: p.id, exerciseId: exercise.id, blob: p.blob, thumb: p.thumb, createdAt: now + i };
          });
          await db.saveExercise(exercise, added, removed);
          close(exercise);
        } catch (err) {
          console.error(err);
          showError(t('Could not save: {error}', { error: db.errorMessage(err) }));
        }
      });
    }).then(function (result) {
      imgs.revoke(bucket);
      return result;
    });
  }

  /* Elige un ejercicio existente o crea uno nuevo. Devuelve el ejercicio o null. */
  async function pickExercise() {
    var list = (await db.getAll('exercises')).sort(byName);
    var picked = await ui.openDialog(views.exercisePicker(list), function (dlg, close) {
      var search = dlg.querySelector('#pick-search');
      if (search) {
        search.addEventListener('input', function () {
          var q = norm(search.value.trim());
          var shown = 0;
          dlg.querySelectorAll('[data-pick]').forEach(function (b) {
            var match = norm(b.getAttribute('data-name')).indexOf(q) !== -1;
            b.hidden = !match;
            if (match) shown++;
          });
          dlg.querySelector('#pick-none').hidden = shown !== 0;
        });
      }
      dlg.addEventListener('click', function (e) {
        var pick = e.target.closest('[data-pick]');
        if (pick) { close({ id: pick.getAttribute('data-pick') }); return; }
        if (e.target.closest('[data-new]')) { close({ create: true }); return; }
        if (e.target.closest('[data-close]')) close(null);
      });
    });
    if (!picked) return null;
    if (picked.create) return exerciseDialog(null);
    return list.find(function (x) { return x.id === picked.id; }) || null;
  }

  /* ---------- sesiones ---------- */

  async function beginSession(routine) {
    await flushSession();
    var data = await Promise.all([db.getAll('exercises'), db.getAll('sessions')]);
    var prev = L.lastSetsByExercise(onlyDone(data[1]));
    var session = L.buildSession(routine, indexById(data[0]), prev);
    var result = await db.startSession(session);
    if (!result.created) ui.toast(t('You already had a workout in progress. Continue with that one.'));
    dropSessionState();
    navigate('#/workout');
  }

  async function discardSession(session) {
    dropSessionState();
    await db.remove('sessions', session.id);
    ui.toast(t('Workout discarded'));
    navigate('#/');
  }

  function updateProgress() {
    var el = document.getElementById('w-progress');
    if (!el || !state.session) return;
    var c = L.countSets(state.session);
    el.textContent = t('{done}/{total} sets', { done: c.done, total: c.total });
  }

  /* ---------- copia de seguridad ---------- */

  async function importBackup(file) {
    ui.toast(t('Reading backup…'));
    var parsed = await backup.read(file); // valida todo antes de tocar nada
    var s = parsed.summary;
    var ok = await ui.confirm({
      title: t('Restore backup?'),
      message: (s.date ? t('Backup from {date}:', { date: s.date }) : t('Backup:')) + ' ' +
        t('{routines}, {exercises}, {workouts} and {photos}.', {
          routines: t('{n} routines', { n: s.routines }),
          exercises: t('{n} exercises', { n: s.exercises }),
          workouts: t('{n} workouts', { n: s.sessions }),
          photos: t('{n} photos', { n: s.images })
        }) + ' ' +
        t('ALL current data on this device will be REPLACED by the backup: anything you saved after that backup will be lost. This cannot be undone.'),
      confirmText: t('Restore backup'),
      danger: true
    });
    if (!ok) return;
    dropSessionState();
    state.draft = null;
    var langBefore = I18N.lang();
    await backup.restore(parsed);
    if (I18N.saved() !== langBefore) {
      location.reload(); // la copia traía otro idioma: se recarga para aplicarlo
      return;
    }
    ui.toast(t('Backup restored successfully'));
    await render();
  }

  /* ---------- calculadora de discos ---------- */

  function refreshPlates() {
    var c = state.plates;
    if (!c) return;
    PL.save(c);
    var box = document.getElementById('plates-result');
    if (box) box.innerHTML = views.platesResult(PL.solve(c.target, c.bar, c.plates));
  }

  function refreshPlatesList() {
    var list = document.getElementById('plates-list');
    if (list && state.plates) list.innerHTML = views.platesList(state.plates.plates);
    refreshPlates();
  }

  function setPlatesField(id, key, value) {
    state.plates[key] = value;
    var input = document.getElementById(id);
    if (input) input.value = value === null ? '' : String(value);
    refreshPlates();
  }

  /* Feedback del botón Copiar: «¡Copiado!» en verde durante 2 segundos. */
  var copyTimer = null;
  function showCopyResult(button, ok) {
    clearTimeout(copyTimer);
    button.textContent = ok ? t('Copied!') : t('Could not copy');
    button.classList.toggle('copied', ok);
    button.classList.toggle('copy-failed', !ok);
    copyTimer = setTimeout(function () {
      button.textContent = t('Copy');
      button.classList.remove('copied', 'copy-failed');
    }, 2000);
  }

  /* ---------- acciones (botones con data-action) ---------- */

  var actions = {
    reload: function () { location.reload(); },

    /* rutinas */
    'new-routine': function () {
      state.draft = L.newRoutine();
      navigate('#/routine/' + state.draft.id);
    },

    'start-routine': async function (el) {
      var routine = await db.get('routines', el.getAttribute('data-id'));
      if (!routine) {
        ui.toast(t('That routine no longer exists.'), 'error');
        return render();
      }
      await beginSession(routine);
    },

    'start-free': function () { return beginSession(null); },

    'duplicate-routine': async function (el) {
      var routine = await db.get('routines', el.getAttribute('data-id'));
      if (!routine) return render();
      await db.put('routines', L.duplicateRoutine(routine));
      ui.toast(t('Routine duplicated'));
      await render({ keepScroll: true });
    },

    'delete-routine': async function (el) {
      var routine = await db.get('routines', el.getAttribute('data-id'));
      if (!routine) return render();
      var ok = await ui.confirm({
        title: t('Delete routine?'),
        message: t('Routine “{name}” will be deleted. Your saved workouts are not deleted.', { name: routine.name }),
        confirmText: t('Delete'),
        danger: true
      });
      if (!ok) return;
      await db.remove('routines', routine.id);
      ui.toast(t('Routine deleted'));
      await render({ keepScroll: true });
    },

    'save-routine': async function () {
      var d = state.draft;
      if (!d) return;
      var name = (d.name || '').trim();
      if (!name) {
        ui.toast(t('Give the routine a name.'), 'error');
        var field = document.getElementById('r-name');
        if (field) field.focus();
        return;
      }
      if (!d.items.length) {
        ui.toast(t('Add at least one exercise.'), 'error');
        return;
      }
      var now = Date.now();
      await db.put('routines', {
        id: d.id,
        name: name,
        createdAt: d.createdAt || now,
        updatedAt: now,
        items: d.items.map(L.cleanRoutineItem)
      });
      state.draft = null;
      ui.toast(t('Routine saved'));
      navigate('#/routines');
    },

    'add-routine-exercise': async function () {
      var exercise = await pickExercise();
      if (!exercise || !state.draft) return;
      state.draft.items.push(L.newRoutineItem(exercise.id));
      await render({ keepScroll: true });
    },

    'move-item-up': function (el) {
      L.moveItem(state.draft.items, parseInt(el.getAttribute('data-index'), 10), -1);
      return render({ keepScroll: true });
    },

    'move-item-down': function (el) {
      L.moveItem(state.draft.items, parseInt(el.getAttribute('data-index'), 10), 1);
      return render({ keepScroll: true });
    },

    'remove-item': function (el) {
      state.draft.items.splice(parseInt(el.getAttribute('data-index'), 10), 1);
      return render({ keepScroll: true });
    },

    /* ejercicios */
    'new-exercise': async function () {
      var exercise = await exerciseDialog(null);
      if (!exercise) return;
      ui.toast(t('Exercise saved'));
      await render({ keepScroll: true });
    },

    'edit-exercise': async function (el) {
      var existing = await db.get('exercises', el.getAttribute('data-id'));
      if (!existing) return render();
      var exercise = await exerciseDialog(existing);
      if (!exercise) return;
      ui.toast(t('Exercise saved'));
      await render({ keepScroll: true });
    },

    'delete-exercise': async function (el) {
      var id = el.getAttribute('data-id');
      var data = await Promise.all([db.get('exercises', id), db.getAll('routines')]);
      var exercise = data[0];
      if (!exercise) return render();
      var used = data[1].filter(function (r) {
        return r.items.some(function (it) { return it.exerciseId === id; });
      }).length;
      var extra = used ? ' ' + t('It will be removed from {routines}.', { routines: t('{n} routines', { n: used }) }) : '';
      var ok = await ui.confirm({
        title: t('Delete exercise?'),
        message: t('Exercise “{name}” will be deleted.', { name: exercise.name }) + extra + ' ' + t('Your workout history is kept.'),
        confirmText: t('Delete'),
        danger: true
      });
      if (!ok) return;
      await db.deleteExercise(id);
      ui.toast(t('Exercise deleted'));
      await render({ keepScroll: true });
    },

    'view-photos': async function (el) {
      var list = await db.getImagesFor(el.getAttribute('data-id'));
      if (!list.length) return;
      var index = parseInt(el.getAttribute('data-index') || '0', 10);
      var bucket = [];
      await ui.openDialog(views.photoViewer(el.getAttribute('data-name'), list.map(function (i) { return i.id; })), function (dlg, close) {
        var images = dlg.querySelectorAll('img[data-full]');
        for (var i = 0; i < images.length; i++) images[i].src = imgs.url(list[i].blob, bucket);
        dlg.addEventListener('click', function (e) {
          if (e.target.closest('[data-close]')) close(null);
        });
        if (images[index]) images[index].scrollIntoView({ block: 'nearest', inline: 'center' });
      });
      imgs.revoke(bucket);
    },

    /* entrenamiento activo */
    'toggle-set': function (el) {
      var s = state.session;
      if (!s) return;
      var set = s.exercises[parseInt(el.getAttribute('data-ei'), 10)].sets[parseInt(el.getAttribute('data-si'), 10)];
      set.done = !set.done;
      if (set.done) timer.start(); // un único contador: marcar otra serie lo reinicia
      el.setAttribute('aria-pressed', set.done ? 'true' : 'false');
      el.closest('.set').classList.toggle('done', set.done);
      updateProgress();
      scheduleSave();
    },

    'add-set': function (el) {
      if (!state.session) return;
      var ex = state.session.exercises[parseInt(el.getAttribute('data-ei'), 10)];
      var last = ex.sets[ex.sets.length - 1];
      ex.sets.push({
        weight: last ? last.weight : null,
        reps: last ? last.reps : null,
        done: false
      });
      scheduleSave();
      return render({ keepScroll: true });
    },

    'remove-set': function (el) {
      if (!state.session) return;
      var ex = state.session.exercises[parseInt(el.getAttribute('data-ei'), 10)];
      ex.sets.splice(parseInt(el.getAttribute('data-si'), 10), 1);
      scheduleSave();
      return render({ keepScroll: true });
    },

    'remove-ex': async function (el) {
      if (!state.session) return;
      var index = parseInt(el.getAttribute('data-ei'), 10);
      var ex = state.session.exercises[index];
      var ok = await ui.confirm({
        title: t('Remove exercise?'),
        message: t('“{name}” will be removed from this session along with its sets.', { name: ex.name }),
        confirmText: t('Remove'),
        danger: true
      });
      if (!ok || !state.session) return;
      state.session.exercises.splice(index, 1);
      scheduleSave();
      await render({ keepScroll: true });
    },

    'add-session-exercise': async function () {
      var exercise = await pickExercise();
      if (!exercise || !state.session) return;
      state.session.exercises.push(L.buildSessionExercise(exercise, state.prev[exercise.id], null));
      scheduleSave();
      await render({ keepScroll: true });
    },

    'finish-session': async function () {
      await flushSession();
      var session = state.session;
      if (!session) return;
      var c = L.countSets(session);

      if (c.done === 0) {
        var discard = await ui.confirm({
          title: t('You have not completed any set'),
          message: t('If you finish now nothing will be saved. Do you want to discard this workout?'),
          confirmText: t('Discard workout'),
          danger: true
        });
        if (discard) await discardSession(session);
        return;
      }

      if (c.done < c.total) {
        var ok = await ui.confirm({
          title: t('Finish workout?'),
          message: t('Unmarked sets: {unmarked}. Completed sets that will be saved: {done}.', { unmarked: c.total - c.done, done: c.done }),
          confirmText: t('Finish and save')
        });
        if (!ok) return;
      }

      var cleaned = L.finalizeSession(session);
      dropSessionState();
      var saved;
      try {
        saved = await db.finishSession(cleaned);
      } catch (err) {
        await render({ keepScroll: true });
        throw err;
      }
      ui.toast(t('Workout saved'));
      navigate('#/history/' + saved.id);
    },

    'cancel-session': async function () {
      var session = state.session;
      if (!session) return;
      var ok = await ui.confirm({
        title: t('Cancel workout?'),
        message: t('Everything recorded in this session will be lost.'),
        confirmText: t('Cancel workout'),
        danger: true
      });
      if (ok) await discardSession(session);
    },

    /* historial */
    'delete-session': async function (el) {
      var id = el.getAttribute('data-id');
      var ok = await ui.confirm({
        title: t('Delete session?'),
        message: t('This workout will be deleted from the history. This cannot be undone.'),
        confirmText: t('Delete'),
        danger: true
      });
      if (!ok) return;
      await db.remove('sessions', id);
      ui.toast(t('Session deleted'));
      navigate('#/history');
    },

    /* calculadora de discos */
    'plates-adjust': function (el) {
      var base = state.plates.target === null ? 0 : state.plates.target;
      var next = PL.round2(base + parseFloat(el.getAttribute('data-delta')));
      setPlatesField('p-target', 'target', Math.max(0, Math.min(PL.MAX_TARGET, next)));
    },
    'plates-use': function (el) { setPlatesField('p-target', 'target', parseFloat(el.getAttribute('data-v'))); },
    'plates-bar-set': function (el) { setPlatesField('p-bar', 'bar', parseFloat(el.getAttribute('data-v'))); },
    'plates-toggle': function (el) {
      var p = state.plates.plates[parseInt(el.getAttribute('data-i'), 10)];
      if (!p) return;
      p.on = !p.on;
      refreshPlatesList();
    },
    'plates-add': function () {
      if (state.plates.plates.length >= PL.MAX_PLATES) {
        ui.toast(t('Maximum {n} plate types.', { n: PL.MAX_PLATES }), 'error');
        return;
      }
      state.plates.plates.push({ w: null, count: 10, on: true });
      refreshPlatesList();
      var inputs = document.querySelectorAll('#plates-list [data-field="plates-w"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    'plates-remove': function (el) {
      state.plates.plates.splice(parseInt(el.getAttribute('data-i'), 10), 1);
      refreshPlatesList();
    },
    'plates-reset': async function () {
      var ok = await ui.confirm({
        title: t('Reset plates?'),
        message: t('The default plates and quantities are restored. The target weight and the bar do not change.'),
        confirmText: t('Reset')
      });
      if (!ok) return;
      state.plates.plates = PL.defaults().plates;
      refreshPlatesList();
    },

    /* ajustes */
    'copy-wallet': async function (el) {
      var address = Forge.config.donate.address;
      var ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(address);
          ok = true;
        }
      } catch (err) { /* se prueba el método alternativo */ }
      if (!ok) {
        var field = document.getElementById('wallet-address');
        if (field) {
          field.focus();
          field.select();
          field.setSelectionRange(0, address.length);
          try { ok = document.execCommand('copy'); } catch (err2) { ok = false; }
        }
      }
      showCopyResult(el, ok);
    },
    'export-backup': async function () {
      ui.toast(t('Preparing backup…'));
      var result = await backup.exportToFile();
      ui.toast(t('Backup exported ({size} MB): {file}', { size: (result.size / 1048576).toLocaleString(I18N.locale(), { maximumFractionDigits: 1 }), file: result.filename }));
    },

    /* debe abrir el selector dentro del propio toque (sin await antes) */
    'import-backup': function () {
      var input = document.getElementById('backup-file');
      if (input) input.click();
    },

    'delete-all': async function () {
      var first = await ui.confirm({
        title: t('Delete all data?'),
        message: t('Routines, exercises, photos and history will be deleted from this device. This cannot be undone.'),
        confirmText: t('Continue'),
        danger: true
      });
      if (!first) return;
      var second = await ui.confirm({
        title: t('Last confirmation'),
        message: t('You are about to delete all of n0gym from this device. Are you sure?'),
        confirmText: t('Delete everything'),
        danger: true
      });
      if (!second) return;
      dropSessionState();
      state.draft = null;
      await db.clearAll();
      ui.toast(t('Data deleted'));
      await render();
    }
  };

  /* Acciones que no deben ejecutarse dos veces seguidas por un doble toque. */
  var GUARDED = {
    'start-routine': true,
    'start-free': true,
    'save-routine': true,
    'finish-session': true,
    'cancel-session': true,
    'delete-session': true,
    'delete-all': true,
    'export-backup': true
  };

  /* ---------- eventos ---------- */

  document.addEventListener('click', async function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var name = el.getAttribute('data-action');
    var handler = actions[name];
    if (!handler) return;
    e.preventDefault();

    var guarded = GUARDED[name] === true;
    if (guarded) {
      if (busy) return;
      busy = true;
    }
    try {
      await handler(el);
    } catch (err) {
      fail(err);
    } finally {
      if (guarded) busy = false;
    }
  });

  /* Los campos actualizan el estado en memoria sin repintar (no se pierde el foco). */
  document.addEventListener('input', function (e) {
    var target = e.target;
    var field = target.getAttribute && target.getAttribute('data-field');
    if (!field) return;
    var value = target.value;

    if (field === 'routine-name') {
      if (state.draft) state.draft.name = value;
    } else if (field === 'item-sets' || field === 'item-reps' || field === 'item-weight') {
      var item = state.draft && state.draft.items[parseInt(target.getAttribute('data-index'), 10)];
      if (item) item[field.slice(5)] = L.toNumber(value);
    } else if (field === 'set-weight' || field === 'set-reps') {
      var ex = state.session && state.session.exercises[parseInt(target.getAttribute('data-ei'), 10)];
      var set = ex && ex.sets[parseInt(target.getAttribute('data-si'), 10)];
      if (!set) return;
      if (field === 'set-weight') set.weight = L.toNumber(value);
      else set.reps = L.toInt(value);
      scheduleSave();
    } else if (field === 'plates-target' || field === 'plates-bar') {
      if (!state.plates) return;
      state.plates[field === 'plates-target' ? 'target' : 'bar'] = L.toNumber(value);
      refreshPlates();
    } else if (field === 'plates-w' || field === 'plates-n') {
      var plate = state.plates && state.plates.plates[parseInt(target.getAttribute('data-i'), 10)];
      if (!plate) return;
      if (field === 'plates-w') plate.w = L.toNumber(value);
      else plate.count = L.toInt(value);
      refreshPlates();
    } else if (field === 'session-note') {
      if (state.session) {
        state.session.note = value;
        scheduleSave();
      }
    }
  });

  document.addEventListener('change', async function (e) {
    var input = e.target;
    if (input && input.id === 'lang-select') {
      await flushSession();   // el idioma se aplica recargando: antes se guarda el entrenamiento en curso
      I18N.set(input.value);
      return;
    }
    if (!input || input.id !== 'backup-file') return;
    var file = input.files && input.files[0];
    input.value = '';
    if (!file || busy) return;
    busy = true;
    try {
      await importBackup(file);
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  });

  /* Al tocar la dirección de la wallet se selecciona entera, para copiarla a mano si hiciera falta. */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'wallet-address') e.target.select();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSession();
  });
  window.addEventListener('pagehide', function () { flushSession(); });
  window.addEventListener('hashchange', function () { render(); });
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });

  /* ---------- arranque ---------- */

  /* Service worker: solo en contexto seguro (HTTPS o localhost). Ruta relativa: vale bajo /n0gym/. */
  function registerWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Could not register the service worker:', err);
      });
    });
  }

  async function init() {
    await I18N.init();
    registerWorker();
    try {
      await db.open();
    } catch (err) {
      console.error(err);
      main.innerHTML = views.fatal(db.errorMessage(err));
      return;
    }
    timer.init();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () { /* no es crítico */ });
    }
    render();
  }

  init();
})();
