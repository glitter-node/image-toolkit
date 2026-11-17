const ImageI18n = (() => {
  const supported = ["ko", "en", "ja", "zh-CN"];
  const fallback = "ko";
  const cache = new Map();
  let locale = fallback;
  let messages = {};
  const listeners = new Set();

  function lookup(source, key) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    return key.split(".").reduce((value, part) => {
      if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part)) return value[part];
      return undefined;
    }, source);
  }

  function translate(key, values = {}) {
    let value = lookup(messages, key);
    if (typeof value !== "string") value = key;
    for (const [name, replacement] of Object.entries(values)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  function apply() {
    document.documentElement.lang = locale;
    for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = translate(node.dataset.i18n);
    for (const node of document.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = translate(node.dataset.i18nPlaceholder);
    for (const node of document.querySelectorAll("[data-i18n-aria-label]")) node.setAttribute("aria-label", translate(node.dataset.i18nAriaLabel));
    for (const node of document.querySelectorAll("[data-i18n-content]")) node.setAttribute("content", translate(node.dataset.i18nContent));
    document.querySelector("#language").value = locale;
    for (const listener of listeners) listener();
  }

  async function fetchMessages(code) {
    if (cache.has(code)) return cache.get(code);
    const response = await fetch(`/lang/${code}.json`);
    if (!response.ok) throw new Error(`Language resource unavailable: ${code}`);
    const result = await response.json();
    cache.set(code, result);
    return result;
  }

  async function setLocale(code) {
    const target = supported.includes(code) ? code : fallback;
    try {
      const base = await fetchMessages(fallback);
      const selected = target === fallback ? base : await fetchMessages(target);
      messages = {...base, ...selected};
      locale = target;
    } catch (error) {
      if (!cache.has(fallback)) throw error;
      messages = cache.get(fallback);
      locale = fallback;
    }
    try { localStorage.setItem("image-toolkit.locale", locale); } catch (error) {}
    apply();
  }

  function onChange(listener) { listeners.add(listener); }

  async function init() {
    let stored = fallback;
    try { stored = localStorage.getItem("image-toolkit.locale") || fallback; } catch (error) {}
    await setLocale(stored);
    document.querySelector("#language").addEventListener("change", async (event) => {
      await setLocale(event.target.value);
    });
  }

  return {init, setLocale, onChange, t: translate};
})();
