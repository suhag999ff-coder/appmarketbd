/* theme.js — Global theme toggle. Load on every page before other scripts */
const THEME_KEY = "av_theme_v1";
const html = document.documentElement;

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  html.setAttribute("data-theme", saved || sys);
})();

function syncToggleIcons() {
  const isDark = html.getAttribute("data-theme") === "dark";
  document.querySelectorAll("[data-theme-toggle] i").forEach(el => {
    el.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  });
}

function toggleTheme() {
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  syncToggleIcons();
}

document.addEventListener("click", e => {
  if (e.target.closest("[data-theme-toggle]")) {
    e.preventDefault();
    toggleTheme();
  }
});

document.addEventListener("DOMContentLoaded", syncToggleIcons);
