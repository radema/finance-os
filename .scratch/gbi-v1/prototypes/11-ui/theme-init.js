/* PROTOTYPE: set data-theme before first paint.
   ?theme=dark|light wins, then the saved choice, else the OS theme. */
(function () {
  var qs = new URLSearchParams(location.search);
  var v = qs.get('theme'); if (!v) { try { v = localStorage.getItem('gbi-proto-theme'); } catch (e) { v = null; } }
  if (v === 'dark' || v === 'light') document.documentElement.setAttribute('data-theme', v);
})();
