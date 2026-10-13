/* n0gym - sw.js
 * Service worker: guarda los archivos de la aplicación para abrirla sin conexión.
 * No toca IndexedDB ni localStorage: los datos del usuario no dependen de esta caché.
 * Todas las rutas son relativas a la ubicación de este archivo (sirve en /n0gym/ o en la raíz).
 *
 * IMPORTANTE: al publicar una versión nueva, cambia CACHE_VERSION. Así el navegador
 * detecta un sw.js distinto, descarga todo de nuevo y elimina la caché antigua.
 */
'use strict';

var CACHE_VERSION = 'v2.0';
var CACHE_PREFIX = 'n0gym-';
var CACHE = CACHE_PREFIX + CACHE_VERSION;
var OFFLINE_PAGE = 'offline.html';

var ASSETS = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'styles.css',
  'db.js',
  'logic.js',
  'images.js',
  'backup.js',
  'timer.js',
  'plates.js',
  'config.js',
  'i18n.js',
  'lang/es.js',
  'lang/zh.js',
  'lang/hi.js',
  'lang/fr.js',
  'lang/de.js',
  'lang/pt.js',
  'lang/ru.js',
  'ui.js',
  'views.js',
  'app.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* cache: 'reload' evita guardar copias viejas de la caché HTTP del navegador */
      return cache.addAll(ASSETS.map(function (url) { return new Request(url, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // solo recursos propios

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url));
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      return cached || fetch(request);
    })
  );
});

function scopePath() {
  return new URL('./', self.location).pathname; // p. ej. /n0gym/
}

function navigate(request, url) {
  var root = scopePath();
  var isApp = url.pathname === root || url.pathname === root + 'index.html';
  if (isApp) {
    return caches.match('index.html').then(function (cached) {
      return cached || fetch(request).catch(offline);
    });
  }
  return fetch(request).catch(offline);
}

function offline() {
  return caches.match(OFFLINE_PAGE);
}
