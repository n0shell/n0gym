/* n0gym - config.js
 * Datos fijos de la aplicación: versión, comunidad y donaciones. Cámbialos aquí, en un solo sitio.
 */
(function (global) {
  'use strict';

  var Forge = (global.Forge = global.Forge || {});

  Forge.config = {
    version: '2.0',
    discord: 'https://discord.gg/rECDwZdgbp',
    donate: {
      network: 'Solana (SOL)',
      address: '2A22irszehvFwrV4CzMBK5L4tb4WtSi8Zh61t72jffuJ'
    }
  };
})(window);
