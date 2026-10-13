/* n0gym - plates.js
 * Calculadora de discos: algoritmo (puro) y configuración guardada en localStorage.
 *
 * Configuración (entra en las copias de seguridad): localStorage "n0gym.plates"
 *   { target, bar, plates: [{ w: kg, count: máx. por lado, on: activo }] }
 *
 * Algoritmo: se trabaja en centésimas de kg (enteros, sin errores de coma flotante).
 * El peso por lado es (objetivo - barra) / 2, redondeado hacia abajo, y se resuelve con
 * programación dinámica (suma máxima alcanzable sin pasarse, usando cada disco como mucho
 * `count` veces). Entre las soluciones con la misma suma se prefiere la de menos discos.
 * Los dos lados son siempre iguales, así que el resultado es simétrico y nunca supera el objetivo.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});

  var KEY = 'n0gym.plates';
  var MAX_TARGET = 1000;
  var MAX_BAR = 100;
  var MAX_PLATES = 12;
  var MAX_COUNT = 50;
  var MAX_WEIGHT = 200;
  var DEFAULT_WEIGHTS = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function defaults() {
    return {
      target: 100,
      bar: 20,
      plates: DEFAULT_WEIGHTS.map(function (w) { return { w: w, count: 10, on: true }; })
    };
  }

  /* ---------- algoritmo ---------- */

  /* Devuelve siempre un objeto con `status`:
   *  'invalid'  -> datos no válidos (reason: 'target' | 'bar' | 'max')
   *  'below-bar'-> el objetivo es menor que la barra
   *  'exact'    -> el objetivo se alcanza exactamente
   *  'closest'  -> no se alcanza; se da el peso más cercano sin pasarse (diff > 0)
   * Los pesos se devuelven en kg. */
  function solve(target, bar, plates) {
    target = num(target);
    bar = num(bar);
    if (target === null || target < 0) return { status: 'invalid', reason: 'target' };
    if (bar === null || bar < 0 || bar > MAX_BAR) return { status: 'invalid', reason: 'bar' };
    if (target > MAX_TARGET) return { status: 'invalid', reason: 'max' };

    var targetC = Math.round(target * 100);
    var barC = Math.round(bar * 100);
    if (targetC < barC) return { status: 'below-bar', target: target, bar: bar };

    /* discos utilizables, uniendo los de igual peso */
    var byWeight = {};
    (plates || []).forEach(function (p) {
      if (!p || p.on === false) return;
      var w = num(p.w);
      var count = num(p.count);
      if (w === null || w <= 0 || count === null || count < 1) return;
      var wc = Math.round(w * 100);
      if (wc < 1) return;
      byWeight[wc] = Math.min(MAX_COUNT * 4, (byWeight[wc] || 0) + Math.floor(count));
    });
    var types = Object.keys(byWeight).map(Number).sort(function (a, b) { return b - a; }); // de mayor a menor

    var sideC = Math.floor((targetC - barC) / 2);
    var capacity = types.reduce(function (sum, wc) { return sum + wc * byWeight[wc]; }, 0);
    var limit = Math.min(sideC, capacity);
    var counts = {}; // peso(centésimas) -> nº de discos por lado
    var best = 0;

    if (types.length && limit > 0) {
      /* artículos de la mochila: cada tipo se trocea en 1, 2, 4... para respetar la cantidad máxima */
      var items = [];
      types.forEach(function (wc) {
        var left = byWeight[wc];
        var k = 1;
        while (left > 0) {
          var take = Math.min(k, left);
          items.push({ wc: wc, k: take });
          left -= take;
          k *= 2;
        }
      });
      var INF = 1e9;
      var dp = new Int32Array(limit + 1).fill(INF);
      dp[0] = 0;
      var took = items.map(function () { return new Uint8Array(limit + 1); });
      items.forEach(function (item, i) {
        var weight = item.wc * item.k;
        for (var s = limit; s >= weight; s--) {
          var prev = dp[s - weight];
          if (prev !== INF && prev + item.k < dp[s]) {
            dp[s] = prev + item.k;
            took[i][s] = 1;
          }
        }
      });
      for (var s = limit; s >= 0; s--) {
        if (dp[s] !== INF) { best = s; break; }
      }
      var rest = best;
      for (var i = items.length - 1; i >= 0; i--) {
        if (took[i][rest]) {
          rest -= items[i].wc * items[i].k;
          counts[items[i].wc] = (counts[items[i].wc] || 0) + items[i].k;
        }
      }
    }

    var perSide = types
      .filter(function (wc) { return counts[wc]; })
      .map(function (wc) { return { w: wc / 100, n: counts[wc] }; });
    var totalC = barC + 2 * best;
    var diffC = targetC - totalC;

    return {
      status: diffC === 0 ? 'exact' : 'closest',
      target: target,
      bar: bar,
      perSide: perSide,
      side: best / 100,
      plates: (2 * best) / 100,
      total: totalC / 100,
      diff: diffC / 100,
      noPlates: types.length === 0
    };
  }

  /* ---------- colores IPF ---------- */

  /* Estándar de powerlifting (IPF). Los discos sin color oficial (1,25, 0,5 o pesos propios) son plateados. */
  var COLORS = [
    { w: 25, bg: '#ef4444', fg: '#ffffff', edge: '#fca5a5' },   // rojo
    { w: 20, bg: '#3b82f6', fg: '#ffffff', edge: '#93c5fd' },   // azul
    { w: 15, bg: '#eab308', fg: '#1c1500', edge: '#fde047' },   // amarillo
    { w: 10, bg: '#22c55e', fg: '#052e16', edge: '#86efac' },   // verde
    { w: 5, bg: '#f8fafc', fg: '#0f172a', edge: '#cbd5e1' },    // blanco
    { w: 2.5, bg: '#27272a', fg: '#f4f4f5', edge: '#a1a1aa' }   // negro
  ];
  var NEUTRAL = { bg: '#94a3b8', fg: '#0f172a', edge: '#e2e8f0' };

  function color(weight) {
    var w = num(weight);
    if (w === null) return NEUTRAL;
    for (var i = 0; i < COLORS.length; i++) {
      if (Math.abs(COLORS[i].w - w) < 0.001) return COLORS[i];
    }
    return NEUTRAL;
  }

  /* Tamaño en el dibujo: los discos de competición (>= 2,5 kg) tienen el mismo diámetro y
   * cambia su grosor; los pequeños son más bajos. */
  function dims(weight) {
    var w = num(weight) || 0;
    var width = w >= 25 ? 38 : w >= 20 ? 34 : w >= 15 ? 30 : w >= 10 ? 26 : w >= 5 ? 22 : w >= 2.5 ? 18 : 14;
    return { w: width, h: w >= 2.5 ? 88 : 56 };
  }

  /* ---------- configuración ---------- */

  function cleanPlate(p) {
    var w = num(p && p.w);
    if (w === null || w <= 0 || w > MAX_WEIGHT || Math.round(w * 100) < 1) return null;
    var count = num(p.count);
    return {
      w: round2(w),
      count: Math.max(0, Math.min(MAX_COUNT, Math.round(count === null ? 0 : count))),
      on: p.on !== false
    };
  }

  function load() {
    var cfg = defaults();
    try {
      var raw = JSON.parse(global.localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        var target = num(raw.target);
        var bar = num(raw.bar);
        if (target !== null && target >= 0 && target <= MAX_TARGET) cfg.target = target;
        if (bar !== null && bar >= 0 && bar <= MAX_BAR) cfg.bar = bar;
        if (Array.isArray(raw.plates)) {
          cfg.plates = raw.plates.map(cleanPlate).filter(Boolean).slice(0, MAX_PLATES);
        }
      }
    } catch (e) { /* configuración ilegible: valores por defecto */ }
    return cfg;
  }

  function save(cfg) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify({ target: cfg.target, bar: cfg.bar, plates: cfg.plates }));
    } catch (e) { /* no es crítico */ }
  }

  Forge.plates = {
    MAX_TARGET: MAX_TARGET,
    MAX_PLATES: MAX_PLATES,
    MAX_COUNT: MAX_COUNT,
    defaults: defaults,
    solve: solve,
    load: load,
    save: save,
    round2: round2,
    COLORS: COLORS,
    color: color,
    dims: dims
  };
})(window);
