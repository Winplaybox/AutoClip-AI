/* Applies the saved theme before first paint. Same light/dark switch as the AutoClip site and OVD. */
(function () {
  var t = "light";
  try { t = localStorage.getItem("ac_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch (e) {}
  document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
})();
