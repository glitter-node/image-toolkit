(() => {
  const tablist = document.querySelector(".workspace-nav");
  const tabs = Array.from(document.querySelectorAll("[data-workspace-tab]"));
  const names = ["images", "editor", "output", "history"];
  const panels = names.map(name => document.getElementById(`workspace-${name}`));
  if (!tablist || tabs.length !== names.length) return;

  tablist.setAttribute("role", "tablist");
  tabs.forEach((tab, index) => {
    const name = names[index];
    const panel = panels[index];
    tab.id = `tab-${name}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.tabIndex = index === 0 ? 0 : -1;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
  });

  function activate(name, moveFocus = false) {
    if (!names.includes(name)) return;
    const selectedIndex = names.indexOf(name);
    tabs.forEach((tab, index) => {
      const selected = index === selectedIndex;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((view, index) => {
      if (view) view.hidden = index !== selectedIndex;
    });
    if (moveFocus) tabs[selectedIndex].focus();
    if (name === "editor") requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  function moveTab(index) {
    const nextIndex = (index + tabs.length) % tabs.length;
    activate(names[nextIndex], true);
  }

  tabs.forEach(tab => tab.addEventListener("click", () => activate(tab.dataset.workspaceTab)));
  tabs.forEach((tab, index) => tab.addEventListener("keydown", event => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTab(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      activate(names[0], true);
    } else if (event.key === "End") {
      event.preventDefault();
      activate(names[names.length - 1], true);
    }
  }));

  activate(names.find(name => document.querySelector(`[data-workspace-tab="${name}"][aria-selected="true"]`)) || names[0]);
  document.addEventListener("keydown", event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !["1", "2", "3", "4"].includes(event.key)) return;
    event.preventDefault();
    activate(names[Number(event.key) - 1]);
  });
  window.ImageToolkitWorkspace = { activate };
})();
