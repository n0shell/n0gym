/* n0gym - images.js
 * Fotos: compresión/redimensionado y gestión de URLs temporales para mostrarlas.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});
  var t = Forge.i18n.t;

  var MAX_SIDE = 1280;   // lado mayor de la foto guardada
  var THUMB_SIDE = 256;  // lado mayor de la miniatura
  var MAX_INPUT_BYTES = 40 * 1024 * 1024;

  function loadSource(file) {
    if (global.createImageBitmap) {
      return global.createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return global.createImageBitmap(file); })
        .catch(function () { return loadWithImageElement(file); });
    }
    return loadWithImageElement(file);
  }

  function loadWithImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(t('Could not read the image. Try a JPG or PNG photo.')));
      };
      img.src = url;
    });
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error(t('Could not compress the image.')));
      }, 'image/jpeg', quality);
    });
  }

  function scaled(source, maxSide, quality) {
    var ratio = Math.min(1, maxSide / Math.max(source.width, source.height)); // nunca se amplía
    var w = Math.max(1, Math.round(source.width * ratio));
    var h = Math.max(1, Math.round(source.height * ratio));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // fondo para PNG con transparencia
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    return toBlob(canvas, quality);
  }

  /* Devuelve { blob, thumb } en JPEG: foto de hasta 1280 px y miniatura de 256 px. */
  function compress(file) {
    if (!file || !/^image\//.test(file.type)) {
      return Promise.reject(new Error(t('“{name}” is not an image.', { name: file && file.name ? file.name : t('File') })));
    }
    if (file.size > MAX_INPUT_BYTES) {
      return Promise.reject(new Error(t('The image is too large (maximum 40 MB).')));
    }
    return loadSource(file).then(function (source) {
      return Promise.all([scaled(source, MAX_SIDE, 0.8), scaled(source, THUMB_SIDE, 0.7)]).then(
        function (results) {
          if (source.close) source.close();
          return { blob: results[0], thumb: results[1] };
        },
        function (err) {
          if (source.close) source.close();
          throw err;
        }
      );
    });
  }

  /* URLs temporales: se guardan en una "cesta" (array) para poder liberarlas luego. */
  function url(blob, bucket) {
    var u = URL.createObjectURL(blob);
    bucket.push(u);
    return u;
  }

  function revoke(bucket) {
    while (bucket.length) URL.revokeObjectURL(bucket.pop());
  }

  Forge.imgs = {
    MAX_PHOTOS: 8,
    compress: compress,
    url: url,
    revoke: revoke
  };
})(window);
