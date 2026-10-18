import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import toast from "@t007/toast";
import * as tmg from "tmg-media-player/super";
import { nums, stoast, installButton, clearSettingsButton, videosDropBox, foldersDropBox } from "./modules/consts";
import "./modules/storage";
import { getPickedHandles, getDroppedHandles, getDroppedFiles, getHandlesFiles } from "./modules/handles";
import { initUI, defaultUI } from "./modules/display";
import { handleFiles, restoreSession, clearSettings, clearFiles } from "./modules/content";

inject({ mode: import.meta.env.PROD ? "production" : "development" }), injectSpeedInsights();
t007.TOAST_DEFAULT_OPTIONS.closeButton = false;

let installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  installPrompt = null;

// Bootstrapping IIFEs
(async function logVisitor() {
  VI.isNew = VI.isNew == null ? true : false;
  VI.visitCount += 1;
  VI.lastVisited = VI.lastVisit ? tmg.utils.formatUITime(new Date(VI.lastVisit).getTime() - Date.now(), "date", false) : "Just now";
  try {
    await fetch("../api/log-ip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...VI, screenW: screen.width, screenH: screen.height, platform: navigator.platform, touchScreen: navigator.maxTouchPoints > 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  } catch {}
  localStorage[_lsik] = JSON.stringify({ ...VI, lastVisit: new Date().toISOString() });
})();

(async function registerServiceWorker() {
  if (tmg.utils.isDef(SharedArrayBuffer)) console.log("✅ TVP isolation active: SharedArrayBuffer is ready for FFmpeg.");
  else console.warn("⚠️ TVP isolation failed: FFmpeg might not work.");
  if (location.protocol === "file:") return;
  if (!("serviceWorker" in navigator)) return toast.warn("Offline support is currently unavailable");
  try {
    await navigator.serviceWorker.register("TVP_sw.js");
  } catch (err) {
    toast.error("Offline caching failed due to " + err.message);
    toast("Don’t worry, your local videos still play fine", { vibrate: true, icon: "🎬" });
  }
})();

(async function launchOpenedFiles() {
  if (!("launchQueue" in window)) return;
  launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams?.files?.length) return;
    initUI();
    const allFiles = await getHandlesFiles(launchParams.files),
      videoFiles = allFiles.filter((file) => (file.type || tmg.utils.getMimeTypeFromExtension(file.name)).match(/^(video|audio)\//)),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You opened ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only media files are supported`);
    handleFiles(videoFiles, null, launchParams.files);
  });
})();

(async function checkVaultUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  const { usage, quota } = await navigator.storage.estimate(),
    percent = (usage / quota) * 100;
  console.log(` 📦 TVP Storage: ${tmg.utils.formatSize(usage)} used of ${tmg.utils.formatSize(quota)} (${percent.toFixed(2)}%)`);
  if (usage / quota > 80) toast.warn(`Storage is ${percent.toFixed(2)}% full, sessions may be forgotten`);
})();

(async function requestPersist() {
  if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
})();

(async function displayToasts() {
  (VI.isNew || !/(second|minute|hour)/.test(VI.lastVisited)) && toast(VI.isNew ? `Welcome! you seem new here, do visit again` : `Welcome back! it's been ${VI.lastVisited.replace(" ago", "")} since your last visit`, { icon: "👋" });
  const session = await sessionPromise;
  if (!session) return;
  stoast(`You have a session from ${tmg.utils.formatUITime(session.lastUpdated - Date.now(), "date", false)}`, { id: "session", icon: "🎞️", actions: { [nums.files ? "Combine" : "Restore"]: () => (clearInterval(sessionTInt), restoreSession(session)), Dismiss: stoast.defaults.onClose } });
  window.sessionTInt = setInterval(() => stoast.update("session", { render: `You have a session from ${tmg.utils.formatUITime(session.lastUpdated - Date.now(), "date", false)}` }), 60000);
})();

!tmg.utils.IS_MOBILE && setTimeout(() => ffmpeg.load());

// Window Events & Shell Actions
window.addEventListener(
  "load",
  () => (
    document.body.classList.toggle("offline", !navigator.onLine),
    navigator.onLine &&
      fetch("https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png", { method: "HEAD", cache: "no-cache" })
        .then((res) => document.body.classList.toggle("offline", !res.ok))
        .catch(() => document.body.classList.add("offline"))
  )
);
window.addEventListener("online", () => document.body.classList.remove("offline"));
window.addEventListener("offline", () => document.body.classList.add("offline"));
window.addEventListener("beforeinstallprompt", (e) => ((installed = false), (installPrompt = e), (installButton.style.display = "flex")));
window.addEventListener("appinstalled", () => ((installed = true), (installButton.style.display = "none"), toast.success("TVP was installed successfully!")));

installButton.addEventListener("click", async () => {
  const res = await installPrompt?.prompt?.();
  if (res?.outcome === "accepted") (installButton.style.display = "none"), (installPrompt = null);
});

document.getElementById("clear-files-button").addEventListener("click", clearFiles);
document.getElementById("sort-files-button")?.addEventListener("click", (e) => (MC?.plug("playlist").sort((e.currentTarget.dataset.dir = e.currentTarget.dataset.dir === "desc" ? "asc" : "desc")), (e.currentTarget.style.scale = e.currentTarget.dataset.dir === "desc" ? "1 -1" : "1")));
document.getElementById("shuffle-files-button")?.addEventListener("click", () => MC?.plug("playlist").shuffle());
clearSettingsButton.addEventListener("click", () => clearSettings(true));

nums.on("bytes", ({ value }) => (document.getElementById("total-size").textContent = tmg.utils.formatSize(value, 2)), { init: true });
nums.on("files", ({ value }) => (document.getElementById("total-num").textContent = value), { init: true });
nums.on("time", ({ value }) => (document.getElementById("total-time").textContent = tmg.utils.formatMediaTime({ time: value })), { init: true });

// File Pickers
[
  { input: videosDropBox.lastElementChild, recurse: false },
  { input: foldersDropBox.lastElementChild, recurse: true },
].forEach(({ input, recurse }) => {
  input.addEventListener("click", () => setTimeout(initUI, 1000));
  input.addEventListener("cancel", defaultUI);
  async function handleInput(e, useHandles = false) {
    useHandles && e.preventDefault();
    const handles = useHandles ? await getPickedHandles(recurse) : null;
    if (useHandles && !handles?.length) return defaultUI();
    const allFiles = useHandles ? await getHandlesFiles(handles) : e.target.files,
      videoFiles = Array.prototype.filter.call(allFiles, (file) => (file.type || tmg.utils.getMimeTypeFromExtension(file.name)).match(/^(video|audio)\//)),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You picked ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only media files are supported`);
    stoast.dismiss("session"), handleFiles(videoFiles, null, handles);
  }
  !((!recurse ? "showOpenFilePicker" : "showDirectoryPicker") in window) ? input.addEventListener("change", handleInput) : input.addEventListener("click", (e) => handleInput(e, true));
});

// Drag & Drop
[videosDropBox, foldersDropBox].forEach((dropBox) => {
  dropBox.addEventListener("dragenter", (e) => (e.preventDefault(), e.currentTarget.classList.add("active")));
  dropBox.addEventListener("dragover", (e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy")));
  dropBox.addEventListener("dragleave", (e) => (e.preventDefault(), e.currentTarget.classList.remove("active")));
  async function handleDrop(e, useHandles = false) {
    e.preventDefault();
    const handles = useHandles ? await getDroppedHandles(e, initUI) : null,
      allFiles = useHandles ? await getHandlesFiles(handles) : await getDroppedFiles(e, initUI),
      videoFiles = allFiles.filter((file) => (file.type || tmg.utils.getMimeTypeFromExtension(file.name)).match(/^(video|audio)\//)),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You dropped ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only media files are supported`);
    stoast.dismiss("session"), handleFiles(videoFiles, null, handles);
    [videosDropBox, foldersDropBox].forEach((el) => el.classList.remove("active"));
  }
  !("getAsFileSystemHandle" in DataTransferItem.prototype) ? dropBox.addEventListener("drop", handleDrop) : dropBox.addEventListener("drop", (e) => handleDrop(e, true));
});

import { field } from "@t007/input";
field({}); // for inclusion
