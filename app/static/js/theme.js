(() => {
  const storageKey = "image-toolkit.theme";
  const supported = new Set(["light", "dark", "natural"]);
  const read = () => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  };
  const apply = (value) => {
    const theme = supported.has(value) ? value : "light";
    document.documentElement.dataset.theme = theme;
    const select = document.getElementById("theme");
    if (select) select.value = theme;
    try { localStorage.setItem(storageKey, theme); } catch {}
  };
  apply(read());
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("theme");
    if (!select) return;
    select.value = document.documentElement.dataset.theme;
    select.addEventListener("change", () => apply(select.value));
  });
})();
