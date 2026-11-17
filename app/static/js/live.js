(() => {
  const switcher = document.querySelector("#editor-switcher");
  const thumbs = document.querySelector("#editor-thumbnails");
  const original = document.querySelector("#live-original");
  const edited = document.querySelector("#live-edited");
  const compareOriginal = document.querySelector("#live-compare-original");
  const compareEdited = document.querySelector("#live-compare-edited");
  const compareRange = document.querySelector("#live-compare-range");
  const stateLabel = document.querySelector("#live-change-state");
  let pending = false;
  let lastUrl = "";
  let lastSignature = "";
  let lastOriginal = "";
  let sourceImage = new Image();
  let sourceReady = false;
  const boundary = document.querySelector("#live-compare-boundary");
  const stack = document.querySelector(".live-compare-stack");
  const compareLabel = document.querySelector("#live-compare-value");
  const baseline = () => imageStates[activeIndex]?.history?.[0] || {};
  const changed = index => {
    const state = imageStates[index];
    if (!state) return false;
    const current = index === activeIndex ? captureEdits() : state.history[state.index];
    return JSON.stringify(current) !== JSON.stringify(state.history[0]);
  };
  const updateStatus = () => {
    stateLabel.textContent = t(changed(activeIndex) ? "live.changed" : "live.unchanged");
    for (const [index, button] of Array.from(thumbs.children).entries()) {
      button.classList.toggle("modified", changed(index));
      button.title = button.querySelector("span")?.textContent || "";
      button.setAttribute("aria-label", `${button.title} — ${t(changed(index) ? "live.changed" : "live.unchanged")}`);
      button.setAttribute("aria-pressed", String(index === activeIndex));
    }
  };
  const refresh = () => {
    thumbs.replaceChildren();
    switcher.hidden = selected.length === 0;
    selected.forEach((file, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "editor-thumb";
      const image = document.createElement("img");
      image.src = urls[index] || "";
      image.alt = file.name;
      const name = document.createElement("span");
      name.textContent = file.name;
      button.append(image, name);
      button.addEventListener("click", () => selectImage(index));
      thumbs.append(button);
    });
    updateStatus();
  };
  const renderComparison = () => {
    if (!sourceReady || !editorImage || !selected.length) return;
    const angle = Number(document.querySelector("#rotate").value) * Math.PI / 180;
    const flipH = document.querySelector("#flip_horizontal").checked ? -1 : 1;
    const flipV = document.querySelector("#flip_vertical").checked ? -1 : 1;
    const swap = Math.abs(Math.round(angle / (Math.PI / 2))) % 2 === 1;
    const scale = Math.min(1, 760 / sourceImage.naturalWidth, 500 / sourceImage.naturalHeight);
    const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
    const originalCanvas = document.createElement("canvas");
    originalCanvas.width = swap ? height : width;
    originalCanvas.height = swap ? width : height;
    const context = originalCanvas.getContext("2d");
    context.translate(originalCanvas.width / 2, originalCanvas.height / 2);
    context.rotate(angle);
    context.scale(flipH, flipV);
    context.drawImage(sourceImage, -width / 2, -height / 2, width, height);
    const baseline = originalCanvas.toDataURL("image/png");
    const result = canvas.toDataURL("image/png");
    if (baseline !== lastOriginal) {
      original.src = baseline;
      compareOriginal.src = baseline;
      lastOriginal = baseline;
    }
    edited.src = result;
    compareEdited.src = result;
    stack.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    updateStatus();
  };
  const preview = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!editorImage || !selected.length) return;
      const url = urls[activeIndex];
      const signature = `${url}:${document.querySelector("#rotate").value}:${document.querySelector("#flip_horizontal").checked}:${document.querySelector("#flip_vertical").checked}`;
      if (url !== lastUrl) {
        lastUrl = url;
        lastOriginal = "";
        sourceReady = false;
        sourceImage = new Image();
        sourceImage.onload = () => {
          if (url !== lastUrl) return;
          sourceReady = true;
          renderComparison();
        };
        sourceImage.src = url;
      } else if (signature !== lastSignature) {
        lastOriginal = "";
      }
      lastSignature = signature;
      renderComparison();
    });
  };
  const position = () => {
    const value = Number(compareRange.value);
    compareEdited.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    boundary.style.left = `${value}%`;
    compareLabel.textContent = `${value}%`;
    compareRange.setAttribute("aria-valuetext", `${value}%`);
  };
  compareRange.addEventListener("input", position);
  position();
  document.querySelectorAll("#workspace-editor input, #workspace-editor select, #workspace-output input, #workspace-output select").forEach(input => input.addEventListener("input", () => {updateStatus(); preview();}));
  ImageI18n.onChange(() => {updateStatus();});
  window.ImageToolkitLive = {refresh, preview};
  refresh();
})();
