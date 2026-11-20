/* Applies the saved theme before first paint (no flash). Same light/dark switch as OVD. */
(function () {
  var t = "light";
  try {
    t = localStorage.getItem("ac_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (e) { /* storage blocked */ }
  document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
})();
