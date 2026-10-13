/* n0gym - timer.js
 * Temporizador de descanso flotante. Vive fuera de #main, así que los repintados de la
 * aplicación no lo tocan. El tiempo restante se calcula con marcas de tiempo (Date.now),
 * nunca restando 1 s por cada ejecución del intervalo.
 *
 * Estados: idle (parado) -> running -> paused / done -> idle.
 * Preferencia (entra en las copias): localStorage "n0gym.restSeconds".
 * Estado para recuperarlo al recargar (NO entra en las copias): localStorage "n0gym-timer".
 * Posición elegida al arrastrarlo (propia del dispositivo, no entra en las copias): "n0gym-timer-pos".
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var t = Forge.i18n.t;

  function esc(value) { return Forge.ui.esc(value); } // ui.js se carga después; se usa al construir

  var PREF_KEY = 'n0gym.restSeconds';
  var STATE_KEY = 'n0gym-timer';
  var POS_KEY = 'n0gym-timer-pos';
  var EDGE = 8;                  // margen mínimo con los bordes al arrastrar
  var KEY_STEP = 24;             // píxeles por pulsación de flecha en el asa
  var DEFAULT_SECONDS = 90;
  var MIN_SECONDS = 5;
  var MAX_SECONDS = 3600;
  var DONE_VISIBLE_MS = 12000;   // cuánto se muestra "¡Listo!" antes de recogerse
  var VIBRATE_WINDOW_MS = 5000;  // solo vibra si el aviso es reciente
  var PRESETS = [30, 60, 90, 120]; // segundos

  function presetLabel(seconds) {
    return seconds >= 120 ? t('{n} min', { n: seconds / 60 }) : t('{n} s', { n: seconds });
  }

  /* ---------- núcleo puro (sin DOM) ---------- */

  function clampSeconds(value) {
    var n = parseFloat(String(value).trim().replace(',', '.'));
    if (!isFinite(n)) return null;
    n = Math.round(n);
    return n < MIN_SECONDS || n > MAX_SECONDS ? null : n;
  }

  function fmt(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function idleState(duration) {
    return { status: 'idle', duration: duration, endAt: null, remainingMs: 0 };
  }

  function remainingMs(st, now) {
    if (st.status === 'running') return Math.max(0, st.endAt - now);
    if (st.status === 'paused') return st.remainingMs;
    if (st.status === 'done') return 0;
    return st.duration * 1000;
  }

  function running(st, now, ms) {
    return { status: 'running', duration: st.duration, endAt: now + ms, remainingMs: 0 };
  }

  /* Transiciones. Devuelve siempre un estado nuevo; `st` no se modifica. */
  function next(st, action, now, arg) {
    switch (action) {
      case 'start':   // también reinicia: siempre un único contador, desde la duración elegida
      case 'reset':
        return running(st, now, st.duration * 1000);
      case 'pause':
        if (st.status !== 'running') return st;
        return { status: 'paused', duration: st.duration, endAt: null, remainingMs: remainingMs(st, now) };
      case 'resume':
        if (st.status !== 'paused') return st;
        return running(st, now, st.remainingMs);
      case 'skip':
        return idleState(st.duration);
      case 'duration': { // arg = segundos ya validados
        var changed = { status: st.status, duration: arg, endAt: st.endAt, remainingMs: st.remainingMs };
        if (st.status === 'running' || st.status === 'paused') return running(changed, now, arg * 1000);
        if (st.status === 'done') return idleState(arg);
        return idleState(arg);
      }
      case 'tick':
        if (st.status === 'running' && st.endAt - now <= 0) {
          return { status: 'done', duration: st.duration, endAt: st.endAt, remainingMs: 0 };
        }
        if (st.status === 'done' && now - st.endAt > DONE_VISIBLE_MS) return idleState(st.duration);
        return st;
      default:
        return st;
    }
  }

  /* ---------- almacenamiento (todo en try/catch) ---------- */

  function lsGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { global.localStorage.setItem(key, value); } catch (e) { /* no es crítico */ }
  }
  function lsRemove(key) {
    try { global.localStorage.removeItem(key); } catch (e) { /* no es crítico */ }
  }

  function loadState(now) {
    var saved = lsGet(PREF_KEY);
    var duration = (saved !== null && clampSeconds(saved)) || DEFAULT_SECONDS;
    var st = idleState(duration);
    try {
      var raw = JSON.parse(lsGet(STATE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        if (raw.status === 'running' && isFinite(raw.endAt)) {
          st = { status: 'running', duration: duration, endAt: raw.endAt, remainingMs: 0 };
        } else if (raw.status === 'paused' && isFinite(raw.remainingMs) && raw.remainingMs >= 0) {
          st = { status: 'paused', duration: duration, endAt: null, remainingMs: Math.min(raw.remainingMs, MAX_SECONDS * 1000) };
        } else if (raw.status === 'done' && isFinite(raw.endAt)) {
          st = { status: 'done', duration: duration, endAt: raw.endAt, remainingMs: 0 };
        }
      }
    } catch (e) { /* estado ilegible: se ignora */ }
    return next(st, 'tick', now);
  }

  /* ---------- interfaz ---------- */

  var st = null;
  var inited = false;
  var context = false;     // true en la pantalla de entrenamiento activo
  var tickId = null;
  var panelOpen = false;
  var els = {};
  var lastText = '';
  var pos = null;          // { fx, fy } en 0..1 (fracción del espacio libre) o null = posición por defecto
  var drag = null;
  var layoutKey = '';

  function build() {
    var root = document.createElement('div');
    root.id = 'rest-timer';
    root.className = 'rt';
    root.hidden = true;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', t('Rest timer'));
    root.innerHTML =
      '<div class="rt-panel" hidden>' +
      '<div class="rt-presets">' +
      PRESETS.map(function (p) {
        return '<button type="button" data-rt="preset" data-s="' + p + '" aria-pressed="false">' + presetLabel(p) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="rt-custom">' +
      '<input type="number" inputmode="numeric" min="' + MIN_SECONDS + '" max="' + MAX_SECONDS + '" step="1" placeholder="' + esc(t('Other (seconds)')) + '" aria-label="' + esc(t('Custom duration in seconds')) + '">' +
      '<button type="button" class="btn btn-ghost" data-rt="custom">' + esc(t('Apply')) + '</button>' +
      '</div>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-rt="resetpos">' + esc(t('Back to the starting position')) + '</button>' +
      '</div>' +
      '<div class="rt-bar">' +
      '<button type="button" class="rt-grip" aria-label="' + esc(t('Move timer (drag or use the arrow keys)')) + '">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg></button>' +
      '<button type="button" class="rt-time" data-rt="panel" aria-expanded="false" aria-label="' + esc(t('Choose rest duration')) + '"><span class="rt-text">1:30</span></button>' +
      '<button type="button" class="icon-btn" data-rt="playpause">▶</button>' +
      '<button type="button" class="icon-btn" data-rt="reset" aria-label="' + esc(t('Restart rest')) + '">↺</button>' +
      '<button type="button" class="icon-btn" data-rt="skip" aria-label="' + esc(t('Skip rest')) + '">✕</button>' +
      '</div>' +
      '<span class="rt-live" role="status" aria-live="polite"></span>';
    document.body.appendChild(root);

    els.root = root;
    els.panel = root.querySelector('.rt-panel');
    els.text = root.querySelector('.rt-text');
    els.panelBtn = root.querySelector('[data-rt="panel"]');
    els.grip = root.querySelector('.rt-grip');
    els.play = root.querySelector('[data-rt="playpause"]');
    els.reset = root.querySelector('[data-rt="reset"]');
    els.skip = root.querySelector('[data-rt="skip"]');
    els.custom = root.querySelector('.rt-custom input');
    els.live = root.querySelector('.rt-live');
    els.presets = root.querySelectorAll('[data-rt="preset"]');
  }

  function render() {
    var now = Date.now();
    var text = st.status === 'done' ? t('Done!') : fmt(Math.ceil(remainingMs(st, now) / 1000));
    if (text !== lastText) {
      els.text.textContent = text;
      lastText = text;
    }
    if (els.root.getAttribute('data-state') !== st.status) {
      els.root.setAttribute('data-state', st.status);
      els.live.textContent = st.status === 'done' ? t('Rest finished') : '';
      if (st.status === 'idle' && panelOpen) setPanel(false, false);
    }

    var isRunning = st.status === 'running';
    var isPaused = st.status === 'paused';
    var isDone = st.status === 'done';
    els.play.hidden = isDone;
    els.play.textContent = isRunning ? '❚❚' : '▶';
    els.play.setAttribute('aria-label', isRunning ? t('Pause rest') : isPaused ? t('Resume rest') : t('Start rest'));
    els.reset.hidden = st.status === 'idle';
    els.reset.setAttribute('aria-label', isDone ? t('Repeat rest') : t('Restart rest'));
    els.skip.hidden = st.status === 'idle';
    els.skip.setAttribute('aria-label', isDone ? t('Close notice') : t('Skip rest'));

    for (var i = 0; i < els.presets.length; i++) {
      els.presets[i].setAttribute('aria-pressed', parseInt(els.presets[i].getAttribute('data-s'), 10) === st.duration ? 'true' : 'false');
    }

    var visible = context || st.status !== 'idle';
    els.root.hidden = !visible;
    document.body.classList.toggle('on-workout', context);

    var key = st.status + (context ? '1' : '0') + (visible ? '1' : '0');
    if (key !== layoutKey) {
      layoutKey = key;
      if (pos && visible) applyPos(); // la píldora cambia de ancho según el estado
    }
  }

  /* ---------- posición y arrastre ---------- */

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function viewport() {
    return { w: document.documentElement.clientWidth, h: global.innerHeight };
  }

  /* Coloca la píldora con su esquina superior izquierda en (x, y), dentro de la pantalla. */
  function place(x, y) {
    var v = viewport();
    var w = els.root.offsetWidth;
    var h = els.root.offsetHeight;
    x = clamp(x, EDGE, Math.max(EDGE, v.w - w - EDGE));
    y = clamp(y, EDGE, Math.max(EDGE, v.h - h - EDGE));
    els.root.style.left = x + 'px';
    /* max(...) respeta la muesca / barra de estado en modo standalone */
    els.root.style.top = 'max(' + y + 'px, env(safe-area-inset-top))';
    els.root.style.bottom = 'auto';
  }

  function applyPos() {
    if (!pos || els.root.hidden) return;
    var v = viewport();
    var w = els.root.offsetWidth;
    var h = els.root.offsetHeight;
    place(EDGE + pos.fx * Math.max(0, v.w - w - 2 * EDGE), EDGE + pos.fy * Math.max(0, v.h - h - 2 * EDGE));
  }

  function savePos() {
    var r = els.root.getBoundingClientRect();
    var v = viewport();
    pos = {
      fx: clamp((r.left - EDGE) / Math.max(1, v.w - r.width - 2 * EDGE), 0, 1),
      fy: clamp((r.top - EDGE) / Math.max(1, v.h - r.height - 2 * EDGE), 0, 1)
    };
    lsSet(POS_KEY, JSON.stringify(pos));
  }

  function resetPos() {
    pos = null;
    lsRemove(POS_KEY);
    els.root.style.left = '';
    els.root.style.top = '';
    els.root.style.bottom = '';
  }

  function loadPos() {
    try {
      var raw = JSON.parse(lsGet(POS_KEY) || 'null');
      if (raw && isFinite(raw.fx) && isFinite(raw.fy)) return { fx: clamp(raw.fx, 0, 1), fy: clamp(raw.fy, 0, 1) };
    } catch (e) { /* posición ilegible: se usa la de por defecto */ }
    return null;
  }

  function onGripDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var r = els.root.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { els.grip.setPointerCapture(e.pointerId); } catch (err) { /* no es crítico */ }
    els.root.classList.add('rt-dragging');
    setPanel(false, false);
    e.preventDefault();
  }

  function onGripMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    place(e.clientX - drag.dx, e.clientY - drag.dy);
  }

  function onGripUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    els.root.classList.remove('rt-dragging');
    savePos();
  }

  function onGripKey(e) {
    var dx = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
    var dy = e.key === 'ArrowUp' ? -KEY_STEP : e.key === 'ArrowDown' ? KEY_STEP : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    var r = els.root.getBoundingClientRect();
    place(r.left + dx, r.top + dy);
    savePos();
  }

  function setPanel(open, focus) {
    panelOpen = open;
    els.panel.hidden = !open;
    els.panelBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      /* se despliega hacia arriba y a la derecha; si no cabe, hacia abajo / a la izquierda */
      var r = els.root.getBoundingClientRect();
      els.root.classList.toggle('rt-below', r.top < 240);
      els.root.classList.toggle('rt-right', r.left + 320 > viewport().w - EDGE);
    }
    if (open && focus && els.presets[0]) els.presets[0].focus();
  }

  function persist() {
    if (st.status === 'idle') lsRemove(STATE_KEY);
    else lsSet(STATE_KEY, JSON.stringify({ status: st.status, endAt: st.endAt, remainingMs: st.remainingMs }));
  }

  function vibrate() {
    try {
      if (global.navigator && typeof global.navigator.vibrate === 'function') global.navigator.vibrate([200, 100, 200]);
    } catch (e) { /* no es crítico */ }
  }

  function stopTick() {
    if (tickId !== null) {
      clearInterval(tickId);
      tickId = null;
    }
  }

  /* Un único intervalo como máximo; solo corre mientras hay algo que actualizar. */
  function ensureTick() {
    if (st.status === 'running' || st.status === 'done') {
      if (tickId === null) tickId = setInterval(tick, 250);
    } else {
      stopTick();
    }
  }

  function tick() {
    if (!inited) return;
    var now = Date.now();
    var before = st;
    st = next(st, 'tick', now);
    if (st !== before) {
      persist();
      if (st.status === 'done' && now - st.endAt < VIBRATE_WINDOW_MS) vibrate();
    }
    render();
    ensureTick();
  }

  function apply(action, arg) {
    st = next(st, action, Date.now(), arg);
    persist();
    render();
    ensureTick();
  }

  function setDuration(seconds) {
    lsSet(PREF_KEY, String(seconds));
    apply('duration', seconds);
  }

  function onClick(e) {
    var button = e.target.closest('[data-rt]');
    if (!button) return;
    var action = button.getAttribute('data-rt');
    if (action === 'panel') {
      setPanel(!panelOpen, true);
    } else if (action === 'playpause') {
      apply(st.status === 'running' ? 'pause' : st.status === 'paused' ? 'resume' : 'start');
    } else if (action === 'reset') {
      apply('reset');
    } else if (action === 'skip') {
      apply('skip');
    } else if (action === 'preset') {
      setDuration(parseInt(button.getAttribute('data-s'), 10));
      setPanel(false, false);
      els.panelBtn.focus();
    } else if (action === 'custom') {
      submitCustom();
    } else if (action === 'resetpos') {
      resetPos();
      setPanel(false, false);
    }
  }

  function submitCustom() {
    var seconds = clampSeconds(els.custom.value);
    if (seconds === null) {
      if (Forge.ui && Forge.ui.toast) Forge.ui.toast(t('Enter between {min} and {max} seconds.', { min: MIN_SECONDS, max: MAX_SECONDS }), 'error');
      return;
    }
    els.custom.value = '';
    setDuration(seconds);
    setPanel(false, false);
    els.panelBtn.focus();
  }

  function init() {
    if (inited) return;
    st = loadState(Date.now());
    build();
    inited = true;

    els.root.addEventListener('click', onClick);
    els.grip.addEventListener('pointerdown', onGripDown);
    els.grip.addEventListener('pointermove', onGripMove);
    els.grip.addEventListener('pointerup', onGripUp);
    els.grip.addEventListener('pointercancel', onGripUp);
    els.grip.addEventListener('keydown', onGripKey);
    global.addEventListener('resize', applyPos);
    pos = loadPos();
    els.custom.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitCustom(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) { setPanel(false, false); els.panelBtn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (panelOpen && !els.root.contains(e.target)) setPanel(false, false);
    });
    /* Al volver a la app (pestaña suspendida, pantalla bloqueada) se recalcula con la hora real. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
    global.addEventListener('pageshow', tick);

    persist();
    render();
    ensureTick();
  }

  /* ---------- API pública ---------- */

  Forge.timer = {
    init: init,
    /* Llamar al marcar una serie: inicia (o reinicia) el único contador. */
    start: function () { if (inited) apply('start'); },
    /* Recoge el temporizador (fin o cancelación de la sesión). */
    dismiss: function () { if (inited) apply('skip'); },
    /* true solo en la pantalla del entrenamiento activo: muestra el control aunque esté parado. */
    setContext: function (on) {
      if (!inited) return;
      context = !!on;
      render();
    },
    /* expuesto para pruebas */
    core: { next: next, remainingMs: remainingMs, fmt: fmt, clampSeconds: clampSeconds, idleState: idleState }
  };
})(window);
