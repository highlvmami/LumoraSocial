/*
 * Tema: 'light' (varsayılan) veya 'dark'. Seçim bu cihazda saklanır.
 * Bu betik her sayfanın <head>'inde modül olmadan yüklenir; sayfa çizilmeden temayı uygular.
 * Sayfada data-theme-toggle özniteliği olan düğmeler açık/koyu arasında geçiş yapar.
 */
(function () {
  function get() {
    try {
      return localStorage.getItem('lumora.theme') === 'dark' ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }
  function set(theme) {
    try {
      localStorage.setItem('lumora.theme', theme);
    } catch (e) {
      /* depolama kapalı olabilir; yine de bu sayfada uygula */
    }
    document.documentElement.setAttribute('data-theme', theme);
    paint();
    document.dispatchEvent(new CustomEvent('lumora:theme', { detail: theme }));
  }
  function paint() {
    var dark = get() === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.textContent = dark ? 'Açık tema' : 'Koyu tema';
    });
  }
  document.documentElement.setAttribute('data-theme', get());
  document.addEventListener('DOMContentLoaded', function () {
    paint();
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-theme-toggle]')) set(get() === 'dark' ? 'light' : 'dark');
    });
  });
  window.LumoraTheme = { get: get, set: set };
})();
