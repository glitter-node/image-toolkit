(() => {
  const button = document.getElementById("scroll-top");
  if (!button) return;
  const allowed = new Set(["images", "editor", "output", "history"]);
  const update = () => {
    const active = document.querySelector('[data-workspace-tab][aria-selected="true"]');
    button.hidden = !active || !allowed.has(active.dataset.workspaceTab);
  };
  document.querySelectorAll("[data-workspace-tab]").forEach(tab => {
    tab.addEventListener("click", update);
  });
  document.addEventListener("keydown", event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && ["1", "2", "3", "4"].includes(event.key)) requestAnimationFrame(update);
  });
  button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
  update();
})();
