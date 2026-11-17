const form = document.querySelector("#image-form");
const input = document.querySelector("#file");
const zone = document.querySelector("#dropzone");
const list = document.querySelector("#preview-list");
const previewSection = document.querySelector("#preview-section");
const previewCount = document.querySelector("#preview-count");
const statusNode = document.querySelector("#status");
const details = document.querySelector("#details");
const comparison = document.querySelector("#comparison");
const comparisonText = document.querySelector("#compare-text");
const resultPreview = document.querySelector("#result-preview");
const originalPreview = document.querySelector("#original-preview");
const inspectButton = document.querySelector("#inspect");
const convertButton = document.querySelector("#convert");
let selected = [];
let batchTargets = new Set();
let copiedEdits = null;
let activeIndex = 0;
let imageStates = [];
let urls = [];
let resultUrl = null;
let busy = false;
let currentController = null;
const progressPanel = document.querySelector("#job-progress");
let statusKey = "";
let statusArgs = {};
let inspection = null;
let comparisonData = null;
let editorImage = null;
let editorUrl = null;
let selection = null;
let dragStart = null;
const editorSection = document.querySelector("#editor-section");
const canvas = document.querySelector("#editor-canvas");
const ctx = canvas.getContext("2d");
const coordinateNode = document.querySelector("#editor-coordinates");
const editorFrame = document.querySelector("#editor-frame");
const editorZoomLabel = document.querySelector("#editor-zoom-label");
let editorZoomMode = "fit";
let editorZoomFactor = 1;
function editorFitFactor() {
  if (!canvas.width || !canvas.height) return 1;
  const availableWidth = Math.max(1, editorFrame.clientWidth - 4);
  const availableHeight = Math.max(1, editorFrame.clientHeight - 4);
  return Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
}
function updateEditorZoom() {
  if (!canvas.width || !canvas.height) return;
  const factor = editorZoomMode === "fit" ? editorFitFactor() : editorZoomFactor;
  canvas.style.width = `${Math.max(1, canvas.width * factor)}px`;
  canvas.style.height = `${Math.max(1, canvas.height * factor)}px`;
  editorZoomLabel.textContent = `${Math.round(factor * 100)}%`;
}
function changeEditorZoom(direction) {
  const current = editorZoomMode === "fit" ? editorFitFactor() : editorZoomFactor;
  editorZoomFactor = Math.max(0.1, Math.min(4, Number((current * (direction > 0 ? 1.25 : 0.8)).toFixed(4))));
  editorZoomMode = "custom";
  updateEditorZoom();
}
document.querySelector("#editor-fit").addEventListener("click", () => { editorZoomMode = "fit"; updateEditorZoom(); });
document.querySelector("#editor-actual").addEventListener("click", () => { editorZoomMode = "custom"; editorZoomFactor = 1; updateEditorZoom(); });
document.querySelector("#editor-zoom-in").addEventListener("click", () => changeEditorZoom(1));
document.querySelector("#editor-zoom-out").addEventListener("click", () => changeEditorZoom(-1));
window.addEventListener("resize", () => { if (editorZoomMode === "fit") updateEditorZoom(); });

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL = 80 * 1024 * 1024;
const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff", "image/heic", "image/heif", "image/avif"];
function t(key, args = {}) { return ImageI18n.t(key, args); }
function status(key, args = {}) { statusKey = key; statusArgs = args; statusNode.textContent = key ? t(key, args) : ""; }
function size(bytes) { return `${(bytes / 1024).toFixed(1)} KB`; }
function resetResults() { inspection = null; comparisonData = null; details.hidden = true; comparison.hidden = true; if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = null; resultPreview.removeAttribute("src"); }
function drawFiles() {
  urls.forEach(url => URL.revokeObjectURL(url)); urls = []; list.replaceChildren();
  previewSection.hidden = selected.length === 0;
  previewCount.textContent = selected.length ? t("preview.count", {count: selected.length}) : "";
  for (const [index, file] of selected.entries()) {
    const url = URL.createObjectURL(file); urls.push(url);
    const item = document.createElement("article"); item.className = "preview-item";
    const image = document.createElement("img"); image.src = url; image.alt = file.name; image.loading = "lazy";
    image.addEventListener("error", () => { const fallback = document.createElement("div"); fallback.className = "preview-fallback"; fallback.textContent = t("preview.unavailable"); fallback.dataset.previewFallback = ""; image.replaceWith(fallback); });
    const name = document.createElement("p"); name.textContent = file.name;
    const meta = document.createElement("p"); meta.textContent = size(file.size);
    const state = document.createElement("p"); state.className = "workflow-state"; state.textContent = t("workflow.ready"); const changed = imageStates[index] && JSON.stringify(imageStates[index].history[imageStates[index].index]) !== JSON.stringify(imageStates[index].history[0]); if (changed) { const mark = document.createElement("span"); mark.className = "edit-modified"; mark.textContent = t("workflow.modified"); state.append(" · ", mark); } const target = document.createElement("label"); target.className = "batch-target"; const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = batchTargets.has(index); checkbox.setAttribute("aria-label", t("workflow.select_target", {name:file.name})); checkbox.addEventListener("click", event => event.stopPropagation()); checkbox.addEventListener("change", () => { if (checkbox.checked) batchTargets.add(index); else batchTargets.delete(index); }); target.append(checkbox, document.createTextNode(t("workflow.batch_target"))); target.addEventListener("click", event => event.stopPropagation()); item.append(image, name, meta, state, target); item.classList.toggle("active", index === activeIndex); item.tabIndex = 0; item.setAttribute("role", "button"); item.addEventListener("click", () => selectImage(index)); item.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectImage(index); } }); list.append(item);
  }
  if (window.ImageToolkitLive) window.ImageToolkitLive.refresh();
}
function setFiles(files) {
  const next = Array.from(files);
  if (next.length > MAX_FILES) { status("error.batch_count"); return; }
  if (next.some(file => file.size > MAX_BYTES)) { status("error.upload_limit"); return; }
  if (next.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) { status("error.batch_size"); return; }
  if (next.some(file => file.type && !allowed.includes(file.type))) { status("error.unsupported_format"); return; }
  selected = next; batchTargets.clear(); copiedEdits = null; document.getElementById("paste-edits").disabled = true; activeIndex = 0; imageStates = next.map(() => ({history:[captureEdits()], index:0})); history = imageStates[0]?.history || []; historyIndex = imageStates[0]?.index ?? -1; resetResults(); drawFiles(); loadEditor(); updateActiveLabel(); updateHistoryButtons(); status(next.length ? "status.selected" : "", {count: next.length});
}
function options(data) {
  for (const name of ["output_format", "quality", "width", "height", "rotate", "crop_left", "crop_top", "crop_width", "crop_height", "watermark_text", "watermark_opacity", "watermark_position", "brightness", "contrast", "saturation", "sharpness", "watermark_scale", "crop_aspect"]) {
    const value = document.getElementById(name).value;
    if (value !== "") data.append(name, value);
  }
  if (document.querySelector("#watermark_logo").files[0]) data.append("watermark_logo", document.querySelector("#watermark_logo").files[0]);
  for (const name of ["flip_horizontal", "flip_vertical", "optimize"]) data.append(name, document.getElementById(name).checked ? "true" : "false");
}
const errors = {UPLOAD_LIMIT:"error.upload_limit", EMPTY_FILE:"error.empty_file", UNSUPPORTED_FORMAT:"error.unsupported_format", INVALID_FILE:"error.invalid_file", PIXEL_LIMIT:"error.pixel_limit", OUTPUT_PIXEL_LIMIT:"error.output_limit", UNSUPPORTED_OUTPUT:"error.unsupported_output", CROP_INCOMPLETE:"error.crop_incomplete", CROP_INVALID:"error.crop_invalid", BATCH_COUNT_LIMIT:"error.batch_count", BATCH_SIZE_LIMIT:"error.batch_size", OUTPUT_SIZE_LIMIT:"error.output_size", ANIMATED_UNSUPPORTED:"error.animated_unsupported", WATERMARK_INVALID:"error.watermark_invalid"};
const jobIndicator = document.querySelector("#job-indicator");
const jobPhase = document.querySelector("#job-phase");
function updateJobProgress(loaded, total) {
  if (!total || loaded >= total) {
    jobIndicator.removeAttribute("value");
    jobPhase.textContent = t("workflow.server_processing");
    return;
  }
  const percent = Math.min(99, Math.round(loaded / total * 100));
  jobIndicator.value = percent;
  jobIndicator.max = 100;
  jobPhase.textContent = `${t("workflow.uploading")} ${percent}%`;
}
function beginJobProgress() {
  jobIndicator.value = 0;
  jobIndicator.max = 100;
  jobPhase.textContent = t("workflow.uploading");
}
function request(path, data, signal = undefined) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.responseType = "blob";
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const fail = key => { if (settled) return; settled = true; cleanup(); reject(new Error(key)); };
    const abort = () => xhr.abort();
    if (signal?.aborted) { fail("workflow.cancelled"); return; }
    signal?.addEventListener("abort", abort, {once:true});
    xhr.upload.addEventListener("progress", event => {
      if (!progressPanel.hidden && event.lengthComputable) updateJobProgress(event.loaded, event.total);
    });
    xhr.upload.addEventListener("load", () => {
      if (!progressPanel.hidden) updateJobProgress(1, 1);
    });
    xhr.addEventListener("abort", () => fail("workflow.cancelled"));
    xhr.addEventListener("error", () => fail("error.network"));
    xhr.addEventListener("load", async () => {
      if (settled) return;
      if (xhr.status < 200 || xhr.status >= 300) {
        let body = {};
        try { body = JSON.parse(await xhr.response.text()); } catch (_) {}
        fail(errors[body.detail] || (xhr.status === 422 ? "error.validation" : "error.request_failed"));
        return;
      }
      settled = true;
      cleanup();
      resolve({blob: async () => xhr.response, json: async () => JSON.parse(await xhr.response.text())});
    });
    xhr.send(data);
  });
}
function showInspection() {
  if (!inspection) return;
  details.textContent = ["format", "width", "height", "mode", "bytes"].map(key => `${t(`info.${key}`)}: ${inspection[key]}`).join("\n");
  details.hidden = false;
}
function showComparison() {
  if (!comparisonData) return;
  comparisonText.textContent = `${t("compare.before")}: ${size(comparisonData.before)} · ${t("compare.after")}: ${size(comparisonData.after)} · ${t("compare.change")}: ${((1 - comparisonData.after / comparisonData.before) * 100).toFixed(1)}%`;
  comparison.hidden = false;
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let activeServerJob = null;
let jobCancelRequested = false;
const jobTokens = new Map();
const jobHeaders = id => ({"X-Job-Token": jobTokens.get(id) || ""});
async function downloadJob(id) {
  const response = await fetch(`/api/jobs/${id}/download`, {headers:jobHeaders(id), cache:"no-store"});
  if (response.status === 404 || response.status === 410) throw new Error("RESULT_EXPIRED");
  if (!response.ok) throw new Error("DOWNLOAD_FAILED");
  download(await response.blob(), "image-toolkit-batch.zip");
}
const waitForJob = async (jobId, signal) => {
  for (;;) {
    if (signal.aborted || jobCancelRequested) {
      await fetch(`/api/jobs/${jobId}/cancel`, {method:"POST", headers:jobHeaders(jobId)});
      throw new Error("workflow.cancelled");
    }
    const response = await fetch(`/api/jobs/${jobId}`, {cache:"no-store", headers:jobHeaders(jobId)});
    if (!response.ok) throw new Error("error.request_failed");
    const job = await response.json();
    jobIndicator.value = job.percent;
    jobIndicator.max = 100;
    jobPhase.textContent = t("workflow.job_progress", {completed:job.completed,total:job.total,percent:job.percent}) + (job.current ? ` · ${job.current}` : "");
    if (job.state === "completed") return job;
    if (job.state === "cancelled") throw new Error("workflow.job_cancelled");
    if (job.state === "failed") throw new Error(errors[job.error] || "error.request_failed");
    await new Promise(resolve => setTimeout(resolve, 450));
  }
};
async function runServerBatch(data, signal) {
  const response = await request("/api/jobs", data, signal);
  const job = await response.json();
  activeServerJob = job.id;
  jobTokens.set(job.id, job.access_token);
  rememberJob(job.id, job.access_token);
  historyCache.delete(job.id);
  await renderJobHistory();
  try { await waitForJob(job.id, signal); } finally { await renderJobHistory(); }
  const result = await fetch(`/api/jobs/${job.id}/download`, {cache:"no-store", headers:jobHeaders(job.id)});
  if (!result.ok) throw new Error("error.request_failed");
  return result.blob();
}
async function run(action) {
  if (busy) return;
  if (!selected.length) { status("error.no_file"); return; }
  busy = true; jobCancelRequested = false; activeServerJob = null; currentController = new AbortController(); progressPanel.hidden = action === "inspect"; if (action !== "inspect") beginJobProgress(); inspectButton.disabled = true; convertButton.disabled = true; status("status.processing");
  try {
    if (action === "inspect") {
      const data = new FormData(); data.append("file", selected[activeIndex]);
      inspection = await (await request("/api/inspect", data, currentController.signal)).json();
      showInspection(); status("status.inspected"); return;
    }
    const batch = selected.length > 1;
    const data = new FormData();
    for (const file of selected) data.append(batch ? "files" : "file", file);
    if (batch) {
      const edits = imageStates.map(state => serializeEdits(state.history[state.index]));
      data.append("settings_json", JSON.stringify(edits));
      const logo = document.getElementById("watermark_logo").files[0];
      if (logo) data.append("watermark_logo", logo);
    } else options(data);
    const blob = batch ? await runServerBatch(data, currentController.signal) : await (await request("/api/convert", data, currentController.signal)).blob();
    const format = document.querySelector("#output_format").value;
    const ext = format === "jpeg" ? "jpg" : format;
    download(blob, batch ? "image-toolkit-batch.zip" : `converted.${ext}`);
    if (!batch) {
      originalPreview.src = urls[activeIndex];
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob); resultPreview.src = resultUrl;
      comparisonData = {before:selected[activeIndex].size, after:blob.size}; showComparison();
      document.querySelector("#compare-original").src = urls[activeIndex];
      document.querySelector("#compare-result").src = resultUrl;
      updateComparison();
    } else { resetResults(); }
    status("status.completed");
  } catch (error) { status(error.message?.startsWith("error.") || error.message?.startsWith("workflow.") ? error.message : "error.request_failed"); }
  finally { busy = false; currentController = null; activeServerJob = null; progressPanel.hidden = true; inspectButton.disabled = false; convertButton.disabled = false; }
}
zone.addEventListener("click", event => { if (event.target !== input) input.click(); });
zone.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") {event.preventDefault(); input.click();} });
for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, event => {event.preventDefault(); zone.classList.add("dragging");});
for (const type of ["dragleave", "drop"]) zone.addEventListener(type, event => {event.preventDefault(); zone.classList.remove("dragging");});
zone.addEventListener("drop", event => setFiles(event.dataTransfer.files));
input.addEventListener("change", () => setFiles(input.files));
inspectButton.addEventListener("click", () => run("inspect"));
form.addEventListener("submit", event => {event.preventDefault(); run("convert");});
document.querySelector("#clear").addEventListener("click", () => {if (busy) return; input.value = ""; selected = []; batchTargets.clear(); copiedEdits = null; document.getElementById("paste-edits").disabled = true; imageStates = []; activeIndex = 0; drawFiles(); resetResults(); loadEditor(); updateActiveLabel(); status("");});
ImageI18n.onChange(() => {drawEditor();showInspection(); showComparison(); if (statusKey) status(statusKey, statusArgs); if (selected.length) previewCount.textContent = t("preview.count", {count: selected.length}); for (const node of list.querySelectorAll("[data-preview-fallback]")) node.textContent = t("preview.unavailable");});
ImageI18n.init().catch(() => status("error.network"));

function loadEditor() {
  editorImage = null; selection = null; dragStart = null;
  if (editorUrl) URL.revokeObjectURL(editorUrl);
  editorImage = null; editorUrl = null; editorSection.hidden = true;
  if (!selected.length) return;
  const url = URL.createObjectURL(selected[activeIndex]); editorUrl = url;
  const img = new Image();
  img.onload = () => {if (editorUrl !== url) return; editorImage = img; editorSection.hidden = false; editorZoomMode = "fit"; drawEditor();};
  img.onerror = () => {if (editorUrl === url) editorSection.hidden = true;};
  img.src = url;
}
function getCrop() {
  const names = ["crop_left", "crop_top", "crop_width", "crop_height"];
  const values = names.map(name => document.getElementById(name).value);
  if (values.some(value => value === "")) return null;
  return values.map(Number);
}
function drawEditor() {
  if (!editorImage) return;
  const sourceWidth = editorImage.naturalWidth; const sourceHeight = editorImage.naturalHeight;
  const scale = Math.min(1, 760 / sourceWidth, 500 / sourceHeight);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const crop = getCrop();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(editorImage, 0, 0, canvas.width, canvas.height);
  if (crop) {
    const [x,y,w,h] = crop;
    ctx.fillStyle = "rgba(12,22,44,.45)"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save(); ctx.beginPath(); ctx.rect(x*scale,y*scale,w*scale,h*scale); ctx.clip(); ctx.drawImage(editorImage,0,0,canvas.width,canvas.height); ctx.restore();
    ctx.strokeStyle = "#4d69dd"; ctx.lineWidth = 2; ctx.strokeRect(x*scale,y*scale,w*scale,h*scale);
    coordinateNode.textContent = t("editor.coords", {left:x,top:y,width:w,height:h});
  } else coordinateNode.textContent = "";
  const angle = Number(document.querySelector("#rotate").value) * Math.PI / 180;
  const flipH = document.querySelector("#flip_horizontal").checked ? -1 : 1;
  const flipV = document.querySelector("#flip_vertical").checked ? -1 : 1;
  const watermark = document.querySelector("#watermark_text").value;
  const position = document.querySelector("#watermark_position").value;
  const opacity = Number(document.querySelector("#watermark_opacity").value) / 100;
  const base = document.createElement("canvas"); base.width = canvas.width; base.height = canvas.height;
  base.getContext("2d").drawImage(canvas,0,0);
  const swap = Math.abs(Math.round(angle / (Math.PI / 2))) % 2 === 1;
  canvas.width = swap ? base.height : base.width; canvas.height = swap ? base.width : base.height;
  ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(angle); ctx.scale(flipH,flipV);
  ctx.drawImage(base,-base.width/2,-base.height/2); ctx.restore();
  const brightness = Number(document.querySelector("#brightness").value);
  const contrast = Number(document.querySelector("#contrast").value);
  const saturation = Number(document.querySelector("#saturation").value);
  const filtered = document.createElement("canvas");
  filtered.width = canvas.width;
  filtered.height = canvas.height;
  const filteredContext = filtered.getContext("2d");
  filteredContext.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
  filteredContext.drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(filtered, 0, 0);
  if (watermark) {
    ctx.save(); ctx.globalAlpha = Math.max(0,Math.min(1,opacity));
    ctx.font = `${Math.max(12,Math.min(30,Math.round(canvas.width/24)))}px sans-serif`;
    ctx.textBaseline = "middle"; ctx.textAlign = position.endsWith("left") ? "left" : position.endsWith("right") ? "right" : "center";
    const margin = 12; const x = position.endsWith("left") ? margin : position.endsWith("right") ? canvas.width-margin : canvas.width/2;
    const y = position.startsWith("top") ? margin+12 : position.startsWith("bottom") ? canvas.height-margin-12 : canvas.height/2;
    ctx.lineWidth = 2; ctx.strokeStyle = "black"; ctx.fillStyle = "white"; ctx.strokeText(watermark,x,y,canvas.width-24); ctx.fillText(watermark,x,y,canvas.width-24); ctx.restore();
  }
  updateEditorZoom();
  if (window.ImageToolkitLive) window.ImageToolkitLive.preview();
}
function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const angle = Number(document.querySelector("#rotate").value);
  const swapped = angle === 90 || angle === 270;
  const x = (event.clientX-rect.left)/rect.width; const y = (event.clientY-rect.top)/rect.height;
  const h = document.querySelector("#flip_horizontal").checked; const v = document.querySelector("#flip_vertical").checked;
  const fx = h ? 1-x : x; const fy = v ? 1-y : y;
  let ox = fx, oy = fy;
  if (angle === 90) {ox=fy;oy=1-fx;}
  if (angle === 180) {ox=1-fx;oy=1-fy;}
  if (angle === 270) {ox=1-fy;oy=fx;}
  return [Math.round(Math.max(0,Math.min(1,ox))*editorImage.naturalWidth),Math.round(Math.max(0,Math.min(1,oy))*editorImage.naturalHeight)];
}
canvas.addEventListener("pointerdown", event => {if (!editorImage) return; dragStart=pointerPosition(event); canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener("pointermove", event => {
  if (!dragStart || !editorImage) return;
  const point=pointerPosition(event); const left=Math.min(dragStart[0],point[0]); const top=Math.min(dragStart[1],point[1]);
  let width=Math.abs(dragStart[0]-point[0]); let height=Math.abs(dragStart[1]-point[1]);
  const ratio = document.querySelector("#crop_aspect").value;
  if (ratio !== "free") { const [rw,rh] = ratio.split(":").map(Number); height = Math.min(editorImage.naturalHeight - top, Math.round(width * rh / rw)); width = Math.min(width, Math.round(height * rw / rh)); }
  if (width < 1 || height < 1) return;
  ["crop_left","crop_top","crop_width","crop_height"].forEach((name,i)=>document.getElementById(name).value=[left,top,width,height][i]);
  drawEditor();
});
canvas.addEventListener("pointerup",()=>{if(dragStart)pushHistory();dragStart=null;});
canvas.addEventListener("pointercancel",()=>{dragStart=null;});
document.querySelector("#crop-reset").addEventListener("click",()=>{["crop_left","crop_top","crop_width","crop_height"].forEach(name=>document.getElementById(name).value="");drawEditor();pushHistory();});
for (const name of ["crop_left","crop_top","crop_width","crop_height","rotate","flip_horizontal","flip_vertical","watermark_text","watermark_opacity","watermark_position"]) document.getElementById(name).addEventListener("input",drawEditor);

const editIds = ["width","height","quality","rotate","flip_horizontal","flip_vertical","crop_left","crop_top","crop_width","crop_height","watermark_text","watermark_opacity","watermark_position","watermark_scale","brightness","contrast","saturation","sharpness","crop_aspect","optimize"];
let history = [];
let historyIndex = -1;
let restoring = false;
function captureEdits() { return Object.fromEntries(editIds.map(id => { const el = document.getElementById(id); return [id, el.type === "checkbox" ? el.checked : el.value]; })); }
function applyEdits(snapshot) { if (!snapshot) return; restoring = true; for (const [id, value] of Object.entries(snapshot)) { const el = document.getElementById(id); if (el.type === "checkbox") el.checked = value; else el.value = value; } restoring = false; drawEditor(); updateAdjustmentValues(); updateHistoryButtons(); }
function pushHistory() { if (restoring) return; const state = captureEdits(); if (JSON.stringify(state) === JSON.stringify(history[historyIndex])) return; history = history.slice(0, historyIndex + 1); history.push(state); if (history.length > 50) history.shift(); historyIndex = history.length - 1; if (imageStates[activeIndex]) { imageStates[activeIndex].history = history; imageStates[activeIndex].index = historyIndex; } updateHistoryButtons(); drawFiles(); }
function updateHistoryButtons() { document.getElementById("undo").disabled = historyIndex <= 0; document.getElementById("redo").disabled = historyIndex >= history.length - 1; document.getElementById("reset-edits").disabled = historyIndex <= 0; }
function updateAdjustmentValues() { for (const id of ["brightness","contrast","saturation","sharpness"]) document.getElementById(`${id}-value`).textContent = `${Number(document.getElementById(id).value).toFixed(2)}×`; }
for (const id of editIds) document.getElementById(id).addEventListener("change", () => { pushHistory(); drawEditor(); updateAdjustmentValues(); });
document.querySelector("#undo").addEventListener("click", () => { if (historyIndex > 0) applyEdits(history[--historyIndex]); if (imageStates[activeIndex]) imageStates[activeIndex].index = historyIndex; });
document.querySelector("#redo").addEventListener("click", () => { if (historyIndex < history.length - 1) applyEdits(history[++historyIndex]); if (imageStates[activeIndex]) imageStates[activeIndex].index = historyIndex; });
document.querySelector("#reset-edits").addEventListener("click", () => { applyEdits(history[0]); pushHistory(); });
function updateComparison() { const value = Number(document.querySelector("#compare-range").value); document.querySelector("#compare-result").style.clipPath = `inset(0 0 0 ${value}%)`; }
document.querySelector("#compare-range").addEventListener("input", updateComparison);
for (const id of ["brightness","contrast","saturation","sharpness"]) document.getElementById(id).addEventListener("input", () => { drawEditor(); updateAdjustmentValues(); });
pushHistory();


updateAdjustmentValues(); updateHistoryButtons();

function serializeEdits(state) {
  const result = {output_format:document.getElementById("output_format").value};
  const numeric = new Set(["width","height","quality","rotate","crop_left","crop_top","crop_width","crop_height","watermark_opacity","brightness","contrast","saturation","sharpness","watermark_scale"]);
  for (const [id,value] of Object.entries(state)) {
    result[id] = numeric.has(id) ? (value === "" ? null : Number(value)) : value;
  }
  return result;
}
function updateActiveLabel() {
  document.getElementById("active-image-label").textContent = selected.length ? t("batch.editing", {name:selected[activeIndex].name}) : "";
}
function selectImage(index) {
  if (busy || index === activeIndex || !imageStates[index]) return;
  imageStates[activeIndex].history = history;
  imageStates[activeIndex].index = historyIndex;
  activeIndex = index;
  history = imageStates[index].history;
  historyIndex = imageStates[index].index;
  applyEdits(history[historyIndex]);
  drawFiles(); loadEditor(); resetResults(); updateActiveLabel();
}
function applySnapshotToTargets(snapshot, targets) {
  if (!selected.length || busy || !snapshot) return;
  for (const index of targets) {
    if (!imageStates[index]) continue;
    if (index === activeIndex) {
      applyEdits(structuredClone(snapshot));
      pushHistory();
    } else {
      const record = imageStates[index];
      const current = record.history[record.index];
      if (JSON.stringify(current) === JSON.stringify(snapshot)) continue;
      const next = record.history.slice(0, record.index + 1);
      next.push(structuredClone(snapshot));
      if (next.length > 50) next.shift();
      imageStates[index] = {history:next,index:next.length - 1};
    }
  }
  resetResults(); drawFiles(); updateHistoryButtons();
}
document.getElementById("copy-edits").addEventListener("click", () => {
  if (!selected.length || busy) return;
  copiedEdits = structuredClone(captureEdits());
  document.getElementById("paste-edits").disabled = false;
  status("workflow.copied");
});
document.getElementById("paste-edits").addEventListener("click", () => {
  if (!copiedEdits || !selected.length || busy) return;
  applySnapshotToTargets(copiedEdits, [activeIndex]);
  status("workflow.pasted");
});
document.getElementById("apply-selected").addEventListener("click", () => {
  if (!selected.length || busy) return;
  if (!batchTargets.size) { status("workflow.no_targets"); return; }
  const count = batchTargets.size;
  applySnapshotToTargets(captureEdits(), [...batchTargets]);
  status("workflow.applied", {count});
});
document.getElementById("apply-all").addEventListener("click", () => {
  if (!selected.length || busy) return;
  const state = captureEdits();
  for (let index=0; index<imageStates.length; index++) {
    if (index === activeIndex) continue;
    imageStates[index] = {history:[structuredClone(state)],index:0};
  }
  resetResults(); updateHistoryButtons();
});
const presetMessage = document.getElementById("preset-message");
const presetFields = ["output_format", ...editIds];
function presetSnapshot() {
  return Object.fromEntries(presetFields.map(id => {
    const el = document.getElementById(id);
    return [id, el.type === "checkbox" ? el.checked : el.value];
  }));
}
function presetNotice(key) { presetMessage.dataset.statusKey = key; presetMessage.textContent = t(key); }
document.getElementById("preset-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({schema:"image-toolkit-preset", version:1, settings:presetSnapshot()},null,2)], {type:"application/json"});
  download(blob,"image-toolkit-preset.json");
  presetNotice("presets.exported");
});
document.getElementById("preset-import").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error("invalid");
    const payload = JSON.parse(await file.text());
    if (payload.schema !== "image-toolkit-preset" || payload.version !== 1 || !payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) throw new Error("invalid");
    const entries = Object.entries(payload.settings);
    if (entries.length !== presetFields.length || entries.some(([id]) => !presetFields.includes(id))) throw new Error("invalid");
    for (const id of presetFields) {
      const el = document.getElementById(id);
      const value = payload.settings[id];
      if (el.type === "checkbox") { if (typeof value !== "boolean") throw new Error("invalid"); }
      else if (typeof value !== "string" || value.length > 120 || (el.type === "number" || el.type === "range") && value !== "" && (!Number.isFinite(Number(value)) || el.min !== "" && Number(value) < Number(el.min) || el.max !== "" && Number(value) > Number(el.max)) || el.tagName === "SELECT" && !Array.from(el.options).some(option => option.value === value)) throw new Error("invalid");
    }
    for (const id of presetFields) {
      const el = document.getElementById(id);
      if (el.type === "checkbox") el.checked = payload.settings[id]; else el.value = payload.settings[id];
    }
    drawEditor(); updateAdjustmentValues(); pushHistory(); presetNotice("presets.imported");
  } catch { presetNotice("presets.invalid"); }
  finally { event.target.value = ""; }
});
document.addEventListener("keydown", event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.target.closest("input,textarea,select,[contenteditable]")) return;
  if (event.key.toLowerCase() === "z") {event.preventDefault(); document.getElementById("undo").click();}
  if (event.key.toLowerCase() === "y") {event.preventDefault(); document.getElementById("redo").click();}
});
ImageI18n.onChange(() => {updateActiveLabel(); if (presetMessage.dataset.statusKey) presetNotice(presetMessage.dataset.statusKey);});

function removeSelectedImage() {
  if (busy || !selected.length) return;
  const previous = selected.length;
  selected.splice(activeIndex, 1);
  batchTargets = new Set([...batchTargets].filter(index => index !== activeIndex).map(index => index > activeIndex ? index - 1 : index));
  imageStates.splice(activeIndex, 1);
  if (activeIndex >= selected.length) activeIndex = Math.max(0, selected.length - 1);
  if (selected.length) {
    history = imageStates[activeIndex].history;
    historyIndex = imageStates[activeIndex].index;
    applyEdits(history[historyIndex]);
  } else {
    history = [];
    historyIndex = -1;
    input.value = "";
  }
  resetResults(); drawFiles(); loadEditor(); updateActiveLabel(); updateHistoryButtons();
  status("workflow.removed", {count:previous - selected.length});
}
async function downloadSelectedImage() {
  if (busy || !selected.length) return;
  busy = true;
  currentController = new AbortController();
  progressPanel.hidden = false;
  beginJobProgress();
  inspectButton.disabled = true;
  convertButton.disabled = true;
  status("status.processing");
  try {
    const file = selected[activeIndex];
    const data = new FormData();
    data.append("file", file);
    options(data);
    const response = await request("/api/convert", data, currentController.signal);
    const blob = await response.blob();
    const format = document.getElementById("output_format").value;
    const ext = format === "jpeg" ? "jpg" : format;
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "image";
    download(blob, `${stem}.${ext}`);
    comparisonData = {before:file.size, after:blob.size};
    originalPreview.src = urls[activeIndex];
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    resultPreview.src = resultUrl;
    document.getElementById("compare-original").src = urls[activeIndex];
    document.getElementById("compare-result").src = resultUrl;
    showComparison(); updateComparison();
    status("status.completed");
  } catch (error) {
    status(error.message?.startsWith("error.") || error.message?.startsWith("workflow.") ? error.message : "error.request_failed");
  } finally {
    busy = false; currentController = null; progressPanel.hidden = true;
    inspectButton.disabled = false; convertButton.disabled = false;
  }
}
document.getElementById("remove-selected").addEventListener("click", removeSelectedImage);
document.getElementById("download-selected").addEventListener("click", downloadSelectedImage);
document.getElementById("cancel-request").addEventListener("click", () => {
  if (activeServerJob) {
    jobCancelRequested = true;
    fetch(`/api/jobs/${activeServerJob}/cancel`, {method:"POST", headers:jobHeaders(activeServerJob)}).catch(() => {});
  } else currentController?.abort();
});

const HISTORY_KEY = "image-toolkit.job-history.v2";
const HISTORY_RETENTION_MS = 86400000 + 1800000;
const historySelection = new Set();
function saveHistoryRecords(records) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, 20))); } catch {} }
function historyRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value.filter(item => item && /^[a-f0-9]{32}$/.test(item.id) && typeof item.token === "string" && item.token.length > 20 && (!item.saved_at || Date.now() - item.saved_at < HISTORY_RETENTION_MS)).slice(0, 20) : [];
  } catch { return []; }
}
function historyIds() { return historyRecords().map(item => item.id); }
function rememberJob(id, token) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([{id, token, saved_at:Date.now()}, ...historyRecords().filter(item => item.id !== id)].slice(0, 20))); } catch {}
}
function historyLabel(key) { return t(`history.${key}`); }
function jobErrorLabel(code) { return errors[code] ? t(errors[code]) : t(`job_error.${code}`) !== `job_error.${code}` ? t(`job_error.${code}`) : code; }
const historyCache = new Map();
let historyRenderRunning = false;
async function fetchHistoryEntries(records, force = false) {
  const pending = records.filter(item => {
    const cached = historyCache.get(item.id);
    if (!cached) return true;
    if (cached.kind === "expired" || cached.kind === "unavailable") return false;
    if (cached.kind === "retry" && Date.now() < cached.retryAt) return false;
    if (cached.kind === "job" && cached.job.expires_at && Date.now() >= cached.job.expires_at * 1000) {
      historyCache.set(item.id, {kind:"expired"});
      return false;
    }
    return force || (cached.kind === "job" && ["queued", "running"].includes(cached.job.state));
  });
  if (!pending.length) return;
  try {
    const response = await fetch("/api/jobs/history", {
      method:"POST", cache:"no-store",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({entries:pending})
    });
    if (!response.ok) throw new Error("FETCH_FAILED");
    const payload = await response.json();
    for (const item of payload.entries || []) {
      if (item.kind === "job") historyCache.set(item.id, {kind:"job", job:item.job});
      else historyCache.set(item.id, {kind:item.kind === "expired" ? "expired" : "unavailable"});
    }
  } catch {
    for (const item of pending) historyCache.set(item.id, {kind:"retry", retryAt:Date.now() + 30000});
  }
}
async function renderJobHistory(force = false) {
  if (historyRenderRunning) return;
  historyRenderRunning = true;
  try {
    const target = document.querySelector("#history-list");
    if (!target) return;
    const records = historyRecords();
    for (const item of records) jobTokens.set(item.id, item.token);
    for (const id of historyCache.keys()) if (!records.some(item => item.id === id)) historyCache.delete(id);
    await fetchHistoryEntries(records, force);
    const fragment = document.createDocumentFragment();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = historyLabel("empty");
      fragment.append(empty);
    }
    for (const {id} of records) {
      const article = document.createElement("article");
      article.className = "history-entry";
      const selectLabel = document.createElement("label");
      selectLabel.className = "history-entry-select";
      const selectBox = document.createElement("input");
      selectBox.type = "checkbox";
      selectBox.checked = historySelection.has(id);
      selectBox.addEventListener("change", () => { if (selectBox.checked) historySelection.add(id); else historySelection.delete(id); });
      selectLabel.append(selectBox, document.createTextNode(historyLabel("select")));
      article.append(selectLabel);
      const entry = historyCache.get(id) || {kind:"retry"};
      if (entry.kind !== "job") {
        const message = document.createElement("p");
        message.textContent = historyLabel(entry.kind === "expired" ? "expired" : entry.kind === "unavailable" ? "denied" : "unavailable");
        article.append(message);
        fragment.append(article);
        continue;
      }
      const job = entry.job;
      const heading = document.createElement("p");
      heading.className = "history-heading";
      heading.textContent = `${historyLabel(job.state)} · ${job.completed}/${job.total} · ${job.percent}%`;
      article.append(heading);
      const items = document.createElement("ul");
      items.className = "history-items";
      for (const item of job.details || []) {
        const li = document.createElement("li");
        li.textContent = `${item.name} — ${historyLabel(item.state)}${item.error ? ` (${jobErrorLabel(item.error)})` : ""}`;
        items.append(li);
      }
      article.append(items);
      if (job.error) {
        const error = document.createElement("p");
        error.className = "history-error";
        error.textContent = `${historyLabel("error")}: ${jobErrorLabel(job.error)}`;
        article.append(error);
      }
      if (job.state === "completed") {
        const link = document.createElement("button");
        link.type = "button";
        link.textContent = historyLabel("download");
        link.className = "history-download";
        link.addEventListener("click", async () => {
          try { await downloadJob(id); }
          catch (error) {
            if (error.message === "RESULT_EXPIRED") {
              link.disabled = true;
              link.textContent = historyLabel("expired");
            } else status("error.request_failed");
          }
        });
        article.append(link);
      }
      fragment.append(article);
    }
    target.replaceChildren(fragment);
  } finally {
    historyRenderRunning = false;
  }
}
function removeHistoryRecords(ids) {
  const remove = new Set(ids);
  saveHistoryRecords(historyRecords().filter(item => !remove.has(item.id)));
  for (const id of remove) { historyCache.delete(id); historySelection.delete(id); if (id !== activeServerJob) jobTokens.delete(id); }
  renderJobHistory();
}
document.querySelector("#history-remove-selected").addEventListener("click", () => {
  if (historySelection.size && window.confirm(historyLabel("confirm_selected"))) removeHistoryRecords(historySelection);
});
document.querySelector("#history-clear-all").addEventListener("click", () => {
  if (historyRecords().length && window.confirm(historyLabel("confirm_all"))) removeHistoryRecords(historyIds());
});
document.querySelector("#history-remove-expired").addEventListener("click", async () => {
  await renderJobHistory(true);
  const expired = historyRecords().filter(item => ["expired", "unavailable"].includes(historyCache.get(item.id)?.kind)).map(item => item.id);
  if (expired.length && window.confirm(historyLabel("confirm_expired"))) removeHistoryRecords(expired);
});
document.querySelector("#history-refresh").addEventListener("click", () => renderJobHistory(true));
ImageI18n.onChange(() => renderJobHistory());
renderJobHistory();

let historyRefreshRunning = false;
async function refreshHistoryAutomatically() {
  if (document.hidden || busy || historyRefreshRunning || historyRenderRunning || !historyRecords().length) return;
  if (!historyRecords().some(item => { const entry = historyCache.get(item.id); return !entry || (entry.kind === "job" && ["queued", "running"].includes(entry.job.state)) || (entry.kind === "retry" && Date.now() >= entry.retryAt); })) return;
  historyRefreshRunning = true;
  try { await renderJobHistory(); } finally { historyRefreshRunning = false; }
}
setInterval(refreshHistoryAutomatically, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshHistoryAutomatically(); });
