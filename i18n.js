/* n0gym - i18n.js
 * Idiomas. El inglés es el idioma base: las claves de traducción SON los textos en inglés,
 * así que si falta una traducción se ve el inglés (nunca una clave rara).
 *
 *   t('Save')                          texto simple
 *   t('{name}, set {n}', {name, n})    con variables {entre llaves}
 *   t('{n} exercises', {n: 3})         plurales: en cada idioma el valor es un objeto
 *                                      { one, few, many, other, ... } según Intl.PluralRules
 *
 * Los idiomas se cargan bajo demanda desde lang/<código>.js (cada archivo llama a
 * Forge.i18n.add('<código>', {...})). El idioma elegido se guarda en localStorage "n0gym.lang"
 * (entra en las copias de seguridad). Al cambiar de idioma se recarga la página.
 * Idiomas: EN (por defecto), ES, ZH, HI, FR, DE, PT, RU.
 *
 * Reglas para traducir: sin HTML, sin "<", "&" ni comillas dobles " en los textos
 * (usa « » o “ ” si hacen falta comillas). Las variables {…} se dejan tal cual.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});

  var PREF_KEY = 'n0gym.lang';
  var DEFAULT_LANG = 'en';

  /* Nombre de cada idioma en su propio idioma (es lo que se muestra en el selector). */
  var LANGS = [
    { code: 'en', name: 'English (EN)' },
    { code: 'es', name: 'Español (ES)' },
    { code: 'zh', name: '中文 / Chinese (ZH)' },
    { code: 'hi', name: 'हिन्दी / Hindi (HI)' },
    { code: 'fr', name: 'Français (FR)' },
    { code: 'de', name: 'Deutsch (DE)' },
    { code: 'pt', name: 'Português (PT)' },
    { code: 'ru', name: 'Русский / Russian (RU)' }
  ];

  /* Formas plurales del inglés (el resto de textos en inglés son la propia clave). */
  var EN = {
    "{n} exercises": {
      "one": "{n} exercise",
      "other": "{n} exercises"
    },
    "{n} sets": {
      "one": "{n} set",
      "other": "{n} sets"
    },
    "{n} routines": {
      "one": "{n} routine",
      "other": "{n} routines"
    },
    "{n} workouts": {
      "one": "{n} workout",
      "other": "{n} workouts"
    },
    "{n} photos": {
      "one": "{n} photo",
      "other": "{n} photos"
    }
  };

  var dicts = { en: EN };
  var lang = DEFAULT_LANG;
  var rules = null;
  var missing = {}; // claves sin traducir en el idioma actual (para pruebas)

  function find(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return null;
  }

  function saved() {
    try {
      var code = global.localStorage.getItem(PREF_KEY);
      return code && find(code) ? code : DEFAULT_LANG;
    } catch (e) { return DEFAULT_LANG; }
  }

  function fill(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return params[name] !== undefined && params[name] !== null ? params[name] : match;
    });
  }

  function t(key, params) {
    var dict = dicts[lang] || EN;
    var value = dict[key];
    if (value === undefined) {
      if (lang !== DEFAULT_LANG) missing[key] = true;
      value = EN[key] !== undefined ? EN[key] : key;
    }
    if (value !== null && typeof value === 'object') {
      var n = params && typeof params.n === 'number' ? params.n : 0;
      var form = rules ? rules.select(n) : 'other';
      value = value[form] !== undefined ? value[form] : value.other;
    }
    return fill(String(value), params);
  }

  /* Idioma para Intl (fechas y números). Siempre cifras latinas 0-9, como los campos de entrada. */
  function locale() {
    return lang + '-u-nu-latn';
  }

  function apply() {
    var info = find(lang);
    var html = document.documentElement;
    html.lang = lang;
    html.dir = info && info.rtl ? 'rtl' : 'ltr';
    try { rules = new Intl.PluralRules(lang); } catch (e) { rules = null; }
    applyDom(document);
  }

  /* Textos fijos del HTML: data-i18n="clave" y data-i18n-label="clave" (aria-label). */
  function applyDom(root) {
    var list = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < list.length; i++) list[i].textContent = t(list[i].getAttribute('data-i18n'));
    var labels = root.querySelectorAll('[data-i18n-label]');
    for (var j = 0; j < labels.length; j++) labels[j].setAttribute('aria-label', t(labels[j].getAttribute('data-i18n-label')));
  }

  function load(code) {
    return new Promise(function (resolve) {
      if (code === DEFAULT_LANG || dicts[code]) { resolve(); return; }
      var script = document.createElement('script');
      script.src = 'lang/' + code + '.js';
      script.onload = function () { resolve(); };
      script.onerror = function () { resolve(); }; // sin el archivo se queda en inglés
      document.head.appendChild(script);
    });
  }

  /* Arranque: carga el idioma guardado y lo aplica. */
  function init() {
    var code = saved();
    return load(code).then(function () {
      lang = dicts[code] ? code : DEFAULT_LANG;
      apply();
    });
  }

  /* Cambia el idioma y recarga: así todos los textos y el temporizador se rehacen limpios. */
  function set(code) {
    if (!find(code)) return;
    try { global.localStorage.setItem(PREF_KEY, code); } catch (e) { /* no es crítico */ }
    global.location.reload();
  }

  Forge.i18n = {
    LANGS: LANGS,
    t: t,
    locale: locale,
    lang: function () { return lang; },
    saved: saved,
    add: function (code, map) { dicts[code] = map; },
    init: init,
    set: set,
    applyDom: applyDom,
    missing: function () { return Object.keys(missing); }
  };
})(window);
