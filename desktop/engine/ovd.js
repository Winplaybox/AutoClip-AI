/* AutoClip Desktop shell: theme switch + status chip. */
(function () {
  var b = document.getElementById("themeBtn");
  if (b) b.addEventListener("click", function () {
    var n = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem("ac_theme", n); } catch (e) {}
  });
})();
