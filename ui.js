/* n0gym - ui.js
 * Utilidades de interfaz: escapado de HTML, avisos y diálogos.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var t = Forge.i18n.t;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var toastTimer = null;

  function toast(message, kind) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, kind === 'error' ? 5000 : 2500);
  }

  /* Abre un <dialog> modal con el HTML dado y devuelve una promesa con el valor
   * pasado a close(valor). Si se cierra con Esc o tocando fuera, resuelve null. */
  function openDialog(html, onMount) {
    return new Promise(function (resolve) {
      var dlg = document.createElement('dialog');
      dlg.className = 'dlg';
      dlg.innerHTML = html;
      document.body.appendChild(dlg);

      var result = null;
      function close(value) {
        result = value === undefined ? null : value;
        if (dlg.open) dlg.close();
      }

      dlg.addEventListener('close', function () {
        dlg.remove();
        resolve(result);
      });
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg) close(null); // clic en el fondo
      });

      dlg.showModal();
      if (onMount) onMount(dlg, close);
    });
  }

  /* Diálogo de confirmación. Devuelve true solo si se pulsa el botón de confirmar. */
  function confirmDialog(options) {
    var html =
      '<div class="dlg-body">' +
      '<h2>' + esc(options.title) + '</h2>' +
      '<p>' + esc(options.message) + '</p>' +
      '<div class="dlg-actions">' +
      '<button type="button" class="btn btn-ghost" data-close="no">' + esc(t('Cancel')) + '</button>' +
      '<button type="button" class="btn' + (options.danger ? ' btn-danger' : '') + '" data-close="yes">' +
      esc(options.confirmText || t('OK')) + '</button>' +
      '</div></div>';
    return openDialog(html, function (dlg, close) {
      dlg.addEventListener('click', function (e) {
        var button = e.target.closest('[data-close]');
        if (button) close(button.getAttribute('data-close') === 'yes');
      });
    }).then(function (result) { return result === true; });
  }

  Forge.ui = {
    esc: esc,
    toast: toast,
    openDialog: openDialog,
    confirm: confirmDialog
  };
})(window);
