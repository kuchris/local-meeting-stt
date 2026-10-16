// Paint the saved theme and language before the first frame, so a dark window
// never flashes white. settings.json stays the source; this is only a hint.
try {
  const theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const locale = localStorage.getItem("locale");
  if (locale) document.documentElement.lang = locale;
} catch {}
