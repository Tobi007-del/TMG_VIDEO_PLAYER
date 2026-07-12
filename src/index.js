import * as tmg from "tmg-media-player/super";
import toast, { toaster } from "@t007/toast";
import { confirm } from "@t007/dialog";
import { initVScrollerator } from "@t007/utils/hooks/vanilla";
import { IndexedDBAdapter, LocalStorageAdapter } from "sia-reactor/modules";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { parsePathObj } from "sia-reactor/utils";

(inject(), injectSpeedInsights()); // Realtime Vercel Analytics

// ===========================================================================
// GLOBAL CONTEXT & SYSTEM VARS
// ===========================================================================

window._lsik = "TVP_visitor_info"; // localStorage info key
window.canSession = "launchQueue" in window || "showOpenFilePicker" in window || "showDirectoryPicker" in window || "getAsFileSystemHandle" in DataTransferItem.prototype;
window.sessionHandles = []; // global handle access of current session handles

// ===========================================================================
// STORAGE ADAPTERS & MEMORY BRIDGE
// ===========================================================================

window.DB = new IndexedDBAdapter({
  dbName: "TVP_Sessions",
  version: 2, // New World
  debug: true,
  stores: ["handles", "subtitles", "chapters"], // first is default: "handles"
  onidb() {
    if (!canSession) throw new Error("TVP Session Persistence is not needed here");
  },
  onversionchange: () => (toast.info(`TVP updated in another ${installed ? "window" : "tab"}. Reloading...`), location.reload()),
  onblocked: () => toast.warn(`Please close other ${installed ? "windows" : "tabs"} of TVP to apply updates`),
});

window.Memory = {
  adapter: new LocalStorageAdapter({ key: window._lssk }),
  _expiryDays: 70 * 7, // the Bible said "seventy times seven", so here we are
  getState() {
    return this.adapter.get();
  },
  async getSession() {
    const state = this.getState(),
      session = await DB.get("last_handles");
    if (!state?.config.playlist?.content || !session) return null;
    console.log("🎞 TVP found an ongoing session:", state, session);
    return (Date.now() - session.lastUpdated) / (1000 * 60 * 60 * 24) > this._expiryDays ? (await this.clearSession(), console.log("🎞 TVP cleaned up expired session.")) : { state, handles: session.handles, lastUpdated: session.lastUpdated };
  },
  async saveHandles() {
    sessionHandles.length ? await DB.set("last_handles", { handles: sessionHandles, lastUpdated: Date.now() }) : await this.clearSession();
  },
  async clearSession() {
    this.adapter.set(window._lssk, { config: { settings: this.getState()?.config.settings || {} } }); // might not wanna clear settings
    ((sessionHandles = []), await DB.clear());
  },
  clearSettings() {
    const state = this.getState();
    this.adapter.set(window._lssk, (delete state.config.settings, state));
  },
};

window.tmg = tmg;
window.MP = null;

// ===========================================================================
// UI STATE & METRICS
// ===========================================================================

let installed = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
  installPrompt = null,
  sessionTInt,
  video = document.getElementById("video"),
  placeholderItem = null;

const installButton = document.getElementById("install"),
  clearSettingsButton = document.getElementById("clear-settings-button"),
  videoPlayerContainer = document.getElementById("video-player-container"),
  fileList = document.getElementById("file-list"),
  contentLines = document.getElementsByClassName("content-line"),
  containers = document.getElementsByClassName("thumbnail-container"),
  videosDropBox = document.getElementById("videos-drop-box"),
  foldersDropBox = document.getElementById("folders-drop-box");
const readyLines = {
  morning: [
    { icon: "🌅", body: "A new day, a new story begins." },
    { icon: "☕", body: "Morning loaded. Your video is hot and fresh." },
    { icon: "🌤️", body: "Rise and stream" },
  ],
  afternoon: [
    { icon: "🌞", body: "Midday grind meets epic rewind." },
    { icon: "🥪", body: "Lunch break? Cue the film." },
    { icon: "🕶️", body: "Cool visuals for the warm sun" },
  ],
  evening: [
    { icon: "🌇", body: "Golden hour, golden content." },
    { icon: "📺", body: "Relax mode: ON." },
    { icon: "🍝", body: "Dinner and a digital show" },
  ],
  night: [
    { icon: "🌙", body: "Midnight premiere loaded." },
    { icon: "🛌", body: "Last one before bed... maybe." },
    { icon: "💤", body: "Sweet streams are made of this" },
  ],
  default: [
    { icon: "🎬", body: "Lights, Camera, Action!" },
    { icon: "✅", body: "Scene Loaded — Ready to Play." },
    { icon: "✨", body: "Showtime Unlocked." },
    { icon: "🎉", body: "Player Ready – Let the Magic Begin!" },
    { icon: "📽️", body: "The Reel is Spinning..." },
    { icon: "🎥", body: "Scene One, Take One — Playback Engaged." },
    { icon: "🍿", body: "Popcorn Ready? Your Movie Is." },
    { icon: "🎭", body: "Curtains Up. Prepare to Be Amazed." },
  ],
};
const primaryLang = "eng",
  whitelist = ["eng", "spa", "fra", "jpn"],
  langNames = new Intl.DisplayNames(["en"], { type: "language" }),
  vi = JSON.parse(localStorage[_lsik] || `{ "visitorId": "${crypto?.randomUUID?.() || tmg.utils.uid()}", "visitCount": 0 }`),
  stoast = toaster({ autoClose: false, closeButton: false, dragToClose: false }),
  scroller = initVScrollerator({ lineHeight: 80, margin: 80, car: document.body }),
  queue = new tmg.AsyncQueue(),
  nums = { bytes: 0, files: 0, time: 0 },
  { createFFmpeg, fetchFile } = FFmpeg,
  ffmpeg = createFFmpeg({ log: false, corePath: "assets/ffmpeg/ffmpeg-core.js" }),
  formatVisit = (d, sx = "") => ((d = Math.floor((Date.now() - new Date(d).getTime()) / 1000)), `${d < 60 ? `${d} second` : d < 3600 ? `${Math.floor(d / 60)} minute` : d < 86400 ? `${Math.floor(d / 3600)} hour` : d < 604800 ? `${Math.floor(d / 86400)} day` : d < 2592000 ? `${Math.floor(d / 604800)} week` : d < 31536000 ? `${Math.floor(d / 2592000)} month` : `${Math.floor(d / 31536000)} year`}`.replace(/(\d+)\s(\w+)/g, (_, n, u) => (n == 1 ? `${u[0] == "h" ? "an" : "a"} ${u}` : `${n} ${u}s`)) + sx);

// ===========================================================================
// INITIALIZATION IIFES (Fire & Forget)
// ===========================================================================

const prevGet = window.Memory.adapter.get.bind(window.Memory.adapter);
window.Memory.adapter.get = function (key, reviver) {
  let state = prevGet(key, reviver);
  if (state?.playlist && !state.config)
    (toast.info("Migrating your saved session to the latest version...", { icon: "⚙️" }), this.set(this.config.key, (state = { config: { playlist: { content: state.playlist || [] }, lightState: { disabled: state.hasPlayed } }, media: { state: { paused: state.paused } } }))); // settings shape has changed too much
  else if (state?.config?.playlist && Array.isArray(state.config.playlist)) ((state.config.playlist = { content: state.config.playlist }), this.set(this.config.key, state));
  return state;
}; // V1 -> V2 MIGRATION LAYER

(async function logVisitor() {
  vi.isNew = vi.isNew == null ? true : false;
  vi.visitCount += 1;
  vi.lastVisited = vi.lastVisit ? formatVisit(vi.lastVisit, " ago") : "Just now";
  try {
    const response = await fetch("../api/log-ip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...vi, screenW: screen.width, screenH: screen.height, platform: navigator.platform, touchScreen: navigator.maxTouchPoints > 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  } catch (err) {
    // console.error("TVP couldn't log info: ", err);
  }
  localStorage[_lsik] = JSON.stringify({ ...vi, lastVisit: new Date().toISOString() });
})();

(async function registerServiceWorker() {
  if (crossOriginIsolated) console.log("✅ TVP isolation active: SharedArrayBuffer is ready for FFmpeg.");
  else console.warn("⚠️ TVP isolation failed: FFmpeg might not work.");
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
      videoFiles = allFiles.filter((file) => (file.type || tmg.utils.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You opened ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
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

!tmg.utils.IS_MOBILE && setTimeout(() => ffmpeg.load());

// ===========================================================================
// WINDOW EVENTS & BOOTSTRAPPING
// ===========================================================================

window.addEventListener("load", async () => {
  const session = !nums.files && (await Memory.getSession());
  if (session) stoast(`You have an ongoing session from ${formatVisit(session.lastUpdated, " ago")}`, { id: "session", icon: "🎞️", actions: { Restore: () => (clearInterval(sessionTInt), restoreSession(session)), Dismiss: () => (clearInterval(sessionTInt), stoast.info("You can reload the page to see this prompt again", { id: "session", icon: true, autoClose: 5000, closeButton: !tmg.utils.IS_MOBILE, dragToClose: true, actions: { Reload: () => location.reload() } })) } });
  if (session) sessionTInt = setInterval(() => stoast.update("session", { render: `You have an ongoing session from ${formatVisit(session.lastUpdated, " ago")}` }), 60000);

  (vi.isNew || !/(second|minute|hour)/.test(vi.lastVisited)) && toast(vi.isNew ? `Welcome! you seem new here, do visit again` : `Welcome back! it's been ${vi.lastVisited.replace(" ago", "")} since your last visit`, { icon: "👋" });

  document.body.classList.toggle("offline", !navigator.onLine);
  navigator.onLine &&
    fetch("https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png", { method: "HEAD", cache: "no-cache" })
      .then((res) => document.body.classList.toggle("offline", !res.ok))
      .catch(() => document.body.classList.add("offline"));
});
window.addEventListener("online", () => document.body.classList.remove("offline"));
window.addEventListener("offline", () => document.body.classList.add("offline"));
window.addEventListener("beforeinstallprompt", (e) => ((installed = false), (installPrompt = e), (installButton.style.display = "flex")));
window.addEventListener("appinstalled", () => ((installed = true), (installButton.style.display = "none"), toast.success("TVP was installed successfully!")));

installButton.addEventListener("click", async () => {
  const res = await installPrompt?.prompt?.();
  if (res.outcome === "accepted") ((installButton.style.display = "none"), (installPrompt = null));
});
document.getElementById("clear-files-button").addEventListener("click", clearFiles);
clearSettingsButton.addEventListener("click", () => clearSettings(true));

// ===========================================================================
// DRAG & DROP PIPELINE
// ===========================================================================

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
    console.log("📁 TVP Handle Kind:", handles?.[0]?.kind, "Full Object:", handles?.[0]);
    const allFiles = useHandles ? await getHandlesFiles(handles) : e.target.files,
      videoFiles = Array.prototype.filter.call(allFiles, (file) => (file.type || tmg.utils.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You picked ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, handles);
  }
  !((!recurse ? "showOpenFilePicker" : "showDirectoryPicker") in window) ? input.addEventListener("change", handleInput) : input.addEventListener("click", (e) => handleInput(e, true));
});

[videosDropBox, foldersDropBox].forEach((dropBox, i) => {
  dropBox.addEventListener("dragenter", (e) => (e.preventDefault(), e.currentTarget.classList.add("active")));
  dropBox.addEventListener("dragover", (e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy")));
  dropBox.addEventListener("dragleave", (e) => (e.preventDefault(), e.currentTarget.classList.remove("active")));
  async function handleDrop(e, useHandles = false) {
    e.preventDefault();
    const handles = useHandles ? await getDroppedHandles(e, initUI) : null,
      allFiles = useHandles ? await getHandlesFiles(handles) : await getDroppedFiles(e, initUI),
      videoFiles = allFiles.filter((file) => (file.type || tmg.utils.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You dropped ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, handles);
    [videosDropBox, foldersDropBox].forEach((el) => el.classList.remove("active"));
  }
  !("getAsFileSystemHandle" in DataTransferItem.prototype) ? dropBox.addEventListener("drop", handleDrop) : dropBox.addEventListener("drop", (e) => handleDrop(e, true));
});

// ===========================================================================
// UI UPDATERS
// ===========================================================================

function defaultUI() {
  if (MP?.controller?.config.playlist.content?.length || nums.files) return;
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">No videos currently selected :&lpar;</p>`;
  updateUI();
}

function initUI() {
  if (MP?.controller?.config.playlist.content?.length || nums.files) return;
  videoPlayerContainer.classList.add("loading");
  video.classList.add("stall");
  document.body.classList.remove("light");
  fileList.innerHTML = "";
  updateUI();
}

function readyUI() {
  video.classList.remove("stall");
  videoPlayerContainer.classList.remove("loading");
  setTimeout(() => MP.controller.toast?.(`You're welcome${vi.isNew ? "" : " back"} to TVP`, { icon: "🎬", image: "assets/images/lone-tree.jpg" }), 500);
  MP.controller.config.on("settings.css.brandColor", ({ value }) => setColors(value, false), { init: "auto" });
  MP.controller.config.on("settings.css.themeColor", ({ value }) => setColors(false, value), { init: "auto" });
}

function errorUI(error) {
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">${error}!</p>`;
}

function updateUI() {
  document.getElementById("total-num").textContent = nums.files;
  document.getElementById("total-size").textContent = tmg.utils.formatSize(nums.bytes, 2);
  document.getElementById("total-time").textContent = tmg.utils.formatMediaTime({ time: nums.time });
}

// ===========================================================================
// SESSION CONTROLLERS
// ===========================================================================

async function restoreSession({ handles }) {
  const state = Memory.getState(),
    files = [],
    sureHandles = [];

  (stoast.info("Restoring your ongoing session now", { id: "session", icon: true, actions: false }), await tmg.utils.deepBreath());
  for (const handle of handles) {
    const name = `${handle.name} ${handle.kind === "file" ? "" : "folder"}`;
    try {
      const resp = await new Promise(async (res, rej) => {
        if ((await handle.queryPermission({ mode: "read" })) === "granted") return res("User not needed");
        (function request() {
          stoast.info(`We need permission to restore ${name}`, { id: "session", actions: { OK: async () => ((await handle.requestPermission({ mode: "read" })) === "granted" ? res() : stoast.warn(`Grant permissions to restore ${handle.name}`, { id: "session", actions: { Retry: request, Skip: () => rej("User denied") } })), DENY: () => rej("User denied") } });
        })();
      });
      const file = handle.kind === "file" ? await handle.getFile() : await getHandlesFiles([handle]);
      tmg.utils.isArr(file) ? files.push(...file.filter((file) => file.type.startsWith("video/"))) : files.push(file);
      sureHandles.push(handle);
      stoast.success(`Restored ${name} successfully`, { id: "session", actions: false });
      await (resp === "User not needed" ? tmg.utils.deepBreath() : tmg.utils.mockAsync(200));
    } catch (err) {
      console.error(`TVP skipped handle "${name}":`, err);
      stoast.error(`Skipped ${name}, something went wrong`, { id: "session", actions: false });
      await (err === "User denied" ? tmg.utils.deepBreath() : tmg.utils.mockAsync(800));
    }
  }
  if (sureHandles.length) stoast.success("Your ongoing session has been restored :)", { id: "session", actions: false });
  else return stoast.error("Your ongoing session was not restored :(", { id: "session", actions: { Reload: () => location.reload(), Dismiss: () => stoast.dismiss("session") } });

  handleFiles(files, state, sureHandles);
}

async function clearSettings(prompt = false) {
  const ok = prompt && (await confirm("Are you sure you want to clear your settings?", { title: "Clear Settings", confirmText: "Clear" }));
  if (prompt && !ok) return;
  (Memory.clearSettings(), setColors());
  clearSettingsButton.classList.remove("shown");
  toast.success("Settings cleared successfully", { id: "settings", actions: false });
}

async function clearFiles(skipPrompt = false) {
  const ok = skipPrompt === true || (await confirm("Are you sure you want to clear all files?", { title: "Clear Files", confirmText: "Clear" }));
  if (!ok) return;
  toast.dismiss("ready");
  if (MP) MP.controller.media.intent.paused = true;
  (video.removeAttribute("src"), video.removeAttribute("poster"));
  video.onplay = video.onpause = video.ontimeupdate = null;
  Array.prototype.forEach.call(containers, (c) => {
    const vid = c.querySelector("video");
    if (vid.src?.startsWith("blob:")) URL.revokeObjectURL(vid.src);
    const plItem = vid.getPlItem?.();
    plItem?.media?.intent?.tracks?.forEach((t) => t.src?.startsWith("blob:") && URL.revokeObjectURL(t.src));
    queue.drop(vid.dataset.trackId);
  });
  video = MP?.detach();
  MP = null;
  nums.files = nums.bytes = nums.time = 0;
  (Memory.clearSession(), defaultUI(), clearSettingsButton.classList.add("shown"));
  toast.success("Cleared all files from your session, Settings too?", { id: "settings", autoClose: 5000, actions: { Clear: () => clearSettings() } });
}

// ===========================================================================
// CORE ENGINE: FILE PROCESSING & DEPLOYMENT
// ===========================================================================

async function handleFiles(files, restored = null, handles = null) {
  try {
    if (!files?.length && !nums.files) return defaultUI();
    (stoast.dismiss("session"), initUI());

    if (handles?.length) ((sessionHandles = [...sessionHandles, ...handles.filter((h) => !sessionHandles.some((sh) => sh.name === h.name))]), Memory.saveHandles());
    for (const file of (files = !restored ? tmg.utils.smartFlatSort(files) : playlistSort(files, restored.config.playlist))) (nums.files++, (nums.bytes += file.size));
    (updateUI(), await tmg.utils.deepBreath());

    const stateMap = new Map(restored?.config.playlist.content?.map((v) => [v.media.settings.metadata.title, v]) || []),
      list = fileList.appendChild(document.getElementById("media-list") || tmg.utils.createEl("ul", { id: "media-list" })),
      thumbnails = [];

    const buildListItem = (file, state, remoteItem) => {
      const name = file ? file.name : remoteItem.media.settings.metadata.title || "External URL",
        ffName = file ? tmg.utils.noExtension(file.name) : remoteItem.media.settings.metadata.title,
        isRemote = !file;
      const li = tmg.utils.createEl("li", { className: "content-line" }, { fileName: name });
      const thumbnail = tmg.utils.createEl(
        "video",
        {
          className: "thumbnail",
          preload: "metadata",
          muted: true,
          playsInline: true,
          onloadedmetadata: ({ target }) => {
            if (file) {
              nums.time += tmg.utils.safeNum(target.duration);
              document.getElementById("total-time").textContent = tmg.utils.formatMediaTime({ time: nums.time });
            }
            target.currentTime = tmg.utils.parseIfPercent(MP?.controller?.config.lightState.preview.time ?? 4, target.duration);
            li.querySelector(".file-duration span:last-child").innerHTML = `${tmg.utils.formatMediaTime({ time: target.duration })}`;
            if (restored || isRemote) thumbnail.parentElement?.style.setProperty("--video-progress-position", tmg.utils.safeNum((state?.settings?.time?.start || 0) / target.duration));
          },
          onerror: ({ target }) => {
            li.classList.add("error");
            if (tmg.utils.safeNum(target.duration)) return;
            li.querySelector(".file-duration span:last-child").classList.add("failed");
            li.querySelector(".file-duration span:last-child").innerHTML = "Failed to Load";
          },
        },
        { captionState: "waiting" }
      );
      thumbnail.ffName = ffName;
      if (isRemote) {
        thumbnail.src = remoteItem.media.intent.src;
        thumbnail.mediaId = remoteItem.media.settings.metadata.id;
        thumbnail.getPlItem = (plItem = MP?.controller?.config.playlist.content?.find((v) => v.media.settings.metadata.id === remoteItem.media.settings.metadata.id)) => (thumbnail.plItem = plItem ?? thumbnail.plItem ?? remoteItem);
        thumbnail.getPlIndex = () => MP?.controller?.config.playlist.content?.findIndex((v) => v.media.settings.metadata.id === remoteItem.media.settings.metadata.id);
      }
      const thumbnailContainer = tmg.utils.createEl("span", { className: "thumbnail-container", innerHTML: `<button><svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated"><rect x="4" width="3" height="10" fill="white"></rect><rect x="10" width="3" height="10" fill="white"></rect><rect x="16" width="3" height="10" fill="white"></rect></svg></button>`, onclick: () => MP.controller?.plug("playlist")?.moveTo(thumbnail.getPlIndex(), true) }).appendChild(thumbnail).parentElement;
      const captionsInput = tmg.utils.createEl("input", {
        type: "file",
        accept: ".srt, .vtt",
        onchange: async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const ext = tmg.utils.getExtension(f.name);
          if (!["srt", "vtt"].includes(ext)) return ((thumbnail.dataset.captionState = "empty"), toast.warn("Only .srt and .vtt caption files are currently supported"));
          let txt = await f.text();
          if (ext === "srt") txt = tmg.utils.srtToVtt(txt);
          DB.set((thumbnail.dataset.trackId = f.name), new TextEncoder().encode(txt), "subtitles");
          const plItem = thumbnail.getPlItem();
          plItem.media.intent.tracks = [{ id: f.name, kind: "captions", label: "English", srclang: "en", src: URL.createObjectURL(new Blob([txt], { type: "text/vtt" })), default: true }];
          if (MP.controller?.config.playlist.content?.[MP.controller.plug("playlist")?.state.currentIndex]?.media.settings.metadata.id === plItem.media?.settings?.metadata?.id) MP.controller.media.intent.tracks = plItem.media.intent.tracks;
          thumbnail.dataset.captionState = "filled";
        },
        oncancel: () => (thumbnail.dataset.captionState = "empty"),
      });
      const captionsBtn = tmg.utils.createEl("button", { title: "(Toggle / DblClick→Load) Captions", className: "captions-btn", innerHTML: `<svg viewBox="0 0 25 25" style="scale: 1.15;"><path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"/><svg>` }).appendChild(captionsInput).parentElement;
      tmg.utils.addSafeClicks(
        captionsBtn,
        ({ target }) => {
          if (target.matches("input")) return;
          if (thumbnail.dataset.captionState === "empty") {
            setTimeout(() => (thumbnail.dataset.captionState = "loading"), 1000);
            return captionsBtn.querySelector("input").click();
          } else if (thumbnail.dataset.captionState === "filled") {
            const plItem = thumbnail.getPlItem();
            plItem?.media?.intent?.tracks?.forEach((t) => t.kind === "captions" && t.src?.startsWith("blob:") && URL.revokeObjectURL(t.src));
            if (!thumbnail.dataset.trackId.startsWith("tmg-")) DB.remove(thumbnail.dataset.trackId, "subtitles");
            if (plItem.media) plItem.media.intent.tracks = plItem.media.intent.tracks.filter((t) => t.kind !== "captions");
            if (MP.controller?.config.playlist.content?.[MP.controller.plug("playlist")?.state.currentIndex]?.media.settings.metadata.id === plItem.media?.settings?.metadata?.id) MP.controller.media.intent.tracks = plItem.media.intent.tracks;
          } else if (!queue.drop(thumbnail.dataset.trackId)) return;
          thumbnail.dataset.captionState = "empty";
        },
        async () => thumbnail.dataset.captionState === "empty" && file && (await deployTracks(file, thumbnail, false))
      );
      const deleteBtn = tmg.utils.createEl("button", { title: "Remove Video", className: "delete-btn", innerHTML: `<svg width="20px" height="20px" viewBox="0 0 24 24" fill="none"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="#0D0D0D"/></svg>`, onclick: () => MP.controller?.plug("playlist")?.remove(thumbnail.getPlIndex()) });
      li.cleanupDB = () => {
        if (!isRemote && thumbnail.src?.startsWith("blob:")) URL.revokeObjectURL(thumbnail.src);
        const plItem = thumbnail.getPlItem();
        plItem?.media?.intent?.tracks?.forEach((t) => t.src?.startsWith("blob:") && URL.revokeObjectURL(t.src));
        queue.drop(thumbnail.dataset.trackId);
        (DB.remove(thumbnail.dataset.trackId, "subtitles"), DB.remove(thumbnail.dataset.trackId + "_chap", "chapters"));
        if (!isRemote) {
          const hIdx = sessionHandles.findIndex((h) => h.name === file.name);
          hIdx !== -1 && (sessionHandles.splice(hIdx, 1), Memory.saveHandles());
          (nums.files--, (nums.bytes -= file.size), (nums.time -= tmg.utils.safeNum(thumbnail.duration)));
        }
        if (!MP?.controller?.config.playlist.content?.length) return clearFiles(true);
        updateUI();
      };
      let placeholderItem;
      const dragHandle = tmg.utils.createEl("span", { title: "Drag to Reorder", className: "drag-handle", innerHTML: `<svg fill="#000000" height="20px" width="20px" viewBox="0 0 24 24"><path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/></svg>` });
      dragHandle.addEventListener(
        "pointerdown",
        (e) => {
          navigator.vibrate?.([50]);
          let initialOffsetY = list.getBoundingClientRect().top,
            initialScrollY = document.body.scrollTop;
          li.parentElement.insertBefore((placeholderItem = tmg.utils.createEl("div", { className: "drag-placeholder" }, {}, { cssText: `height:${li.offsetHeight}px;width:${li.offsetWidth}px;` })), li.nextElementSibling);
          li.classList.add("dragging");
          li.style.top = `${(li.top = tmg.utils.clamp(0, e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
          ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.addEventListener(e, !i ? onPointerMove : onPointerUp));
          function onPointerMove(e) {
            e.preventDefault();
            tmg.utils.RAFLoop("listItemDragging", () => {
              li.style.top = `${(li.top = tmg.utils.clamp(0, document.body.scrollTop - initialScrollY + e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
              scroller.drive(e.clientY, !(li.top > 0 && li.top < list.offsetHeight - li.offsetHeight));
              const afterLine = tmg.utils.getElSiblingAt(e.clientY, "y", list.querySelectorAll(".content-line:not(.dragging)"));
              afterLine ? list.insertBefore(placeholderItem, afterLine) : list.append(placeholderItem);
            });
          }
          function onPointerUp() {
            navigator.vibrate?.([50]);
            tmg.utils.cancelRAFLoop("listItemDragging");
            scroller.reset();
            li.classList.remove("dragging");
            placeholderItem.parentElement.replaceChild(li, placeholderItem);
            placeholderItem = null;
            syncPlaylist();
            ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.removeEventListener(e, !i ? onPointerMove : onPointerUp));
          }
        },
        { passive: false }
      );
      li.append(thumbnailContainer, tmg.utils.createEl("span", { className: "file-info-wrapper", innerHTML: `<p class="file-name"><span>Name: </span><span>${name}</span></p><p class="file-size"><span>Size: </span><span>${file ? tmg.utils.formatSize(file.size) : "N/A"}</span></p><p class="file-duration"><span>Duration: </span><span>${restored || isRemote ? "Rei" : "I"}nitializing...</span></p>` }), captionsBtn, deleteBtn, dragHandle);
      return { li, thumbnail, container: thumbnailContainer };
    };

    for (let i = 0; i < files.length; i++) {
      const ffName = tmg.utils.noExtension(files[i].name),
        state = stateMap.get(ffName);
      if ((restored && !state) || !!Array.prototype.find.call(containers, (c) => c.lastElementChild.ffName === ffName)) {
        (nums.files--, (nums.bytes -= files[i].size));
        thumbnails.push(null);
        continue;
      }
      const item = buildListItem(files[i], state);
      (thumbnails.push(item.thumbnail), list.append(item.li), await tmg.utils.breath());
    }

    const content = [];
    const deployVideos = async (files) => {
      for (let i = 0; i < files.length; i++) {
        if (!thumbnails[i]) continue;
        const url = URL.createObjectURL(files[i]),
          state = stateMap.get(thumbnails[i].ffName),
          item = state ?? {
            media: { intent: {}, settings: { metadata: { id: tmg.utils.uid(), title: thumbnails[i].ffName, artist: "TMG Video Player", profile: "assets/icons/tmg-icon.jpeg", links: { artist: "https://tmg-video-player.vercel.app", profile: "https://github.com/Tobi007-del/tmg-media-player" } } } },
            settings: { time: { start: 0 }, controlPanel: { timeline: { previews: true } } },
          };
        ((item.media.intent.src = url), (item.media.intent.tracks = (item.media.intent.tracks || []).filter((t) => !t.src.startsWith("blob:"))), content.push(item));
        const thumb = thumbnails[i];
        thumb.src = url;
        thumb.mediaId = item.media.settings.metadata.id;
        thumb.getPlItem = (plItem = MP?.controller?.config.playlist.content?.find((v) => v.media.settings.metadata.id === item.media.settings.metadata.id)) => (thumb.plItem = plItem ?? thumb.plItem ?? item);
        thumb.getPlIndex = () => MP?.controller?.config.playlist.content?.findIndex((v) => v.media.settings.metadata.id === item.media.settings.metadata.id);
      }
      if (!MP) {
        const setUpList = (renderList) => {
          MP.controller.config.on("playlist.content", ({ currentTarget: { value: content } }) => {
            if (!content || !document.getElementById("media-list")) return;
            const validContent = content.filter((item) => item?.media?.settings?.metadata?.id && item?.media?.intent?.src);
            (renderList ??= tmg.utils.createListRenderer({
              container: list,
              getKey: (item) => item.media?.settings?.metadata?.id,
              createNode: (item) => {
                const { li, thumbnail } = buildListItem(null, null, item);
                return (thumbnails.push(thumbnail), li);
              },
              updateNode: (li, item, index) => {
                li.classList.toggle("playing", index === MP.controller.plug("playlist")?.state.currentIndex);
                const nameEl = li.querySelector(".file-name span:last-child");
                if (nameEl) nameEl.textContent = item.media?.settings?.metadata?.title || li.fileName || "";
              },
              initNode: (li, register) => li.querySelector("video")?.mediaId && register(li.querySelector("video").mediaId),
              destroyNode: (li) => {
                const id = li.querySelector("video")?.mediaId,
                  idx = thumbnails.findIndex((t) => t?.mediaId === id);
                idx !== -1 && thumbnails.splice(idx, 1);
                const stillInPlaylist = MP.controller?.config.playlist.content?.some((item) => item?.media?.settings?.metadata?.id === id);
                if (!stillInPlaylist) li.cleanupDB?.();
              },
            }))(validContent);
          });
        };
        video.addEventListener(
          "tmginit",
          () => {
            const i = restored && content.findIndex((item) => item.media.settings.metadata.id === restored.media.settings.metadata.id),
              should = restored?.config.lightState.disabled && i !== -1;
            should && MP.controller.plug("playlist").moveTo(i);
            should && (thumbnails[i]?.closest("li")?.classList.add("playing"), thumbnails[i]?.parentElement?.classList.toggle("paused", video.paused));
            (readyUI(), setUpList());
          },
          { once: true }
        );
        MP = new tmg.Player({
          lightState: restored?.config?.lightState ?? { disabled: false },
          "playlist.content": content,
          "media.state.paused": restored?.media?.state?.paused ?? true,
          "media.settings.metadata": { artist: "TMG Video Player", profile: "assets/icons/tmg-icon.jpeg", links: { artist: "https://tmg-video-player.vercel.app", profile: "https://github.com/Tobi007-del/tmg-media-player" } },
          "settings.controlPanel.timeline.bufferMarks": false,
          "settings.captions.font.size.value": 200,
          "settings.captions.font.weight.value": 700,
          "settings.captions.background.opacity.value": 0,
          "settings.captions.characterEdgeStyle.value": "drop-shadow",
          "settings.overlay.behavior.value": "auto",
          "settings.persist": { key: window._lssk, adapter: Memory.adapter, throttle: 2500, strict: true, beforeHydrate: (p) => (p.config && (delete p.config.playlist, delete p.config.lightState), p.media?.settings && delete p.media.settings.metadata, p.media?.state && delete p.media.state.paused) },
          "settings.persist.blacklist.media": ["state.src", "state.sources", "state.tracks", "state.srcObject", "state.poster", "state.fullscreen", "state.pictureInPicture"],
          noPlugList: [],
          cloneOnDetach: true,
        });
        MP.attach(video);
        console.log(MP);
        video.addEventListener("loadedmetadata", () => setTimeout(dispatchPlayerReadyToast, 500), { once: true });
        video.ontimeupdate = ({ target: { currentTime: ct, duration: d } }) => MP.controller?.throttle("TVP_thumbnail_update", () => ct > 3 && MP.controller?.config.lightState.disabled && containers[MP.controller?.plug("playlist")?.state.currentIndex]?.style.setProperty("--video-progress-position", tmg.utils.safeNum(ct / d)), 2500);
        video.onplay = () => {
          const idx = MP.controller.plug("playlist")?.state.currentIndex;
          for (let i = 0; i < contentLines.length; i++) contentLines[i].classList.toggle("playing", i === idx);
          containers[idx]?.classList.remove("paused");
        };
        video.onpause = () => containers[MP.controller?.plug("playlist")?.state.currentIndex]?.classList.add("paused");
      } else MP.controller.config.playlist.content = [...(MP.controller.config.playlist.content || []), ...content];
    };
    nums.files && (deployVideos(files), await tmg.utils.deepBreath());
    nums.files && (await Promise.all(files.map(async (_, i) => thumbnails[i] && (await deployTracks(files[i], thumbnails[i], undefined)))));
    if (!nums.files && !MP?.controller?.config.playlist.content?.length) return defaultUI();
  } catch (error) {
    (console.error("TVP files handling failed:", error), errorUI(error));
  }
}

// ===========================================================================
// FFmpeg PIPELINE: TEXT TRACKS EXTRACTION
// ===========================================================================

async function deployTracks(file, thumbnail, autocancel = !crossOriginIsolated || tmg.utils.IS_MOBILE, item = thumbnail.getPlItem()) {
  const id = (thumbnail.dataset.trackId = thumbnail.dataset.trackId ?? item.media.settings.metadata.id + "_sub");
  thumbnail.setAttribute("data-caption-state", item?.media.intent.tracks[0] ? "loading" : "waiting");
  // 1. THE VAULT CHECK (Instant IDB Access)
  const subBuffers = await DB.get(id, "subtitles"),
    chapBuffer = await DB.get(id + "_chap", "chapters");
  if (subBuffers || chapBuffer) {
    console.log(`✨TVP IDB Vault Hit: Tracks restored for ${id}`);
    item.media.intent.tracks = item.media.intent.tracks.filter((t) => t.kind !== "captions" && t.kind !== "chapters");
    if (subBuffers) {
      const counts = {};
      (Array.isArray(subBuffers) ? subBuffers : [subBuffers]).forEach((data, i, _) => {
        const { buffer, srclang, label } = getSubMeta(data, counts);
        item.media.intent.tracks.push({ id: `${id}_${i}`, kind: "captions", label, srclang, default: i === 0, src: URL.createObjectURL(new Blob([buffer], { type: "text/vtt" })) });
      });
    }
    if (chapBuffer) item.media.intent.tracks.push({ id: id + "_chap", kind: "chapters", label: "Chapters", srclang: "en", src: URL.createObjectURL(new Blob([chapBuffer], { type: "text/vtt" })) });
    if (MP.controller?.config.playlist.content?.[MP.controller.plug("playlist")?.state.currentIndex]?.media.settings.metadata.id === item.media.settings.metadata.id) MP.controller.media.intent.tracks = item.media.intent.tracks;
    return thumbnail.setAttribute("data-caption-state", subBuffers ? "filled" : "empty");
  }
  // 2. THE FACTORY (FFmpeg Processing)
  autocancel && thumbnail.setAttribute("data-caption-state", "empty");
  let extractedSubs = [];
  const counts = {};
  const res = await queue.add(
    async () =>
      await extractTracks(file, id, async (p) => {
        if (p.type === "subtitle") {
          extractedSubs.push(p.data);
          await DB.set(id, extractedSubs, "subtitles");
          const i = extractedSubs.length - 1,
            { buffer, srclang, label } = getSubMeta(p.data, counts);
          const newTrack = { id: `${id}_${i}`, kind: "captions", label: label || "", srclang: srclang || "", default: i === 0, src: URL.createObjectURL(new Blob([buffer], { type: "text/vtt" })) };
          item.media.intent.tracks = [...(item.media.intent.tracks || []), newTrack];
          if (MP.controller?.config.playlist.content?.[MP.controller.plug("playlist")?.state.currentIndex]?.media.settings.metadata.id === item.media.settings.metadata.id) MP.controller.media.intent.tracks = item.media.intent.tracks;
          thumbnail.setAttribute("data-caption-state", "filled");
        } else if (p.type === "chapter") {
          await DB.set(id + "_chap", new TextEncoder().encode(p.data), "chapters");
          item.media.intent.tracks?.forEach((t) => t.kind === "chapters" && t.src?.startsWith("blob:") && URL.revokeObjectURL(t.src));
          const chapterTrack = { id: id + "_chap", kind: "chapters", label: "Chapters", srclang: "en", src: URL.createObjectURL(new Blob([p.data], { type: "text/vtt" })) };
          item.media.intent.tracks = [...item.media.intent.tracks.filter((t) => t.kind !== "chapters"), chapterTrack];
          if (MP.controller?.config.playlist.content?.[MP.controller.plug("playlist")?.state.currentIndex]?.media.settings.metadata.id === item.media.settings.metadata.id) MP.controller.media.intent.tracks = item.media.intent.tracks;
        }
      }),
    id,
    autocancel,
    () => thumbnail.setAttribute("data-caption-state", "loading")
  );
  if (res.cancelled) return thumbnail.setAttribute("data-caption-state", "empty");
}

async function extractTracks(file, id, onProgress) {
  const metaName = `meta${id}.txt`,
    inputName = `video${id}${tmg.utils.getExtension(file.name)}`;
  try {
    console.log(`🎥 TVP processing file with FFmpeg: '${file.name}'`);
    !ffmpeg.isLoaded() && (await ffmpeg.load());
    ffmpeg.FS("writeFile", inputName, await fetchFile(file));
    let logData = "";
    (ffmpeg.setLogger(({ message }) => (logData += message + "\n")), await ffmpeg.run("-i", inputName).catch(() => {}), ffmpeg.setLogger(() => {}));
    const subStreams = [];
    let match,
      idx = 0;
    const regex = /Stream #\d+:\d+.*?(?:\(([a-zA-Z]{2,3})\))?: Subtitle/g;
    while ((match = regex.exec(logData)) !== null) subStreams.push({ index: idx++, lang: match[1] || "eng" });
    subStreams.sort((a, b) => (a.lang === primaryLang ? -1 : b.lang === primaryLang ? 1 : a.index - b.index));
    console.log(`🛠 Extracting ${subStreams.length} streams dynamically...`);
    try {
      await ffmpeg.run("-i", inputName, "-f", "ffmetadata", metaName);
      const chapStr = metadataToVTT(new TextDecoder().decode(ffmpeg.FS("readFile", metaName)));
      chapStr && (await onProgress({ type: "chapter", data: chapStr }), console.log("✅ Chapter metadata deployed."));
      ffmpeg.FS("unlink", metaName);
    } catch (e) {
      console.log("⚠️ No embedded metadata found.");
    }
    for (const target of subStreams) {
      // if (!whitelist.includes(target.lang)) continue;
      const subName = `cue${id}_${target.index}.vtt`;
      try {
        await ffmpeg.run("-i", inputName, "-map", `0:s:${target.index}`, "-f", "webvtt", subName);
        await onProgress({ type: "subtitle", data: { buffer: ffmpeg.FS("readFile", subName), lang: target.lang } });
        // console.log(`✅ Subtitle ${target.index} (${target.lang}) deployed.`);
        ffmpeg.FS("unlink", subName);
      } catch (e) {
        console.log(`⚠️ No embedded subtitle stream ${target.index} found.`);
      }
    }
    return { success: true };
  } catch (err) {
    return (console.error("❌ TVP tracks extraction failed:", err), { success: false, error: err.toString() });
  } finally {
    try {
      ffmpeg.FS("unlink", inputName);
    } catch {}
  }
}

// ===========================================================================
// BROWSER FILE SYSTEM HANDLERS
// ===========================================================================

async function getDroppedFiles(e, preTask) {
  e.preventDefault();
  const dtItems = e.dataTransfer.items || [];
  if (dtItems.length > 0) preTask?.();
  const traverseFileTree = async (item) => {
    return new Promise((resolve) => {
      if (item.isFile) item.file(resolve, () => resolve([]));
      else if (item.isDirectory)
        item.createReader().readEntries(async (entries) => {
          try {
            const nestedFiles = await Promise.all(entries.map(traverseFileTree));
            resolve(nestedFiles.flat());
          } catch {
            resolve([]);
          }
        });
      else resolve([]);
    });
  };
  const promises = [];
  for (let i = 0; i < dtItems.length; i++) {
    const entry = dtItems[i].webkitGetAsEntry?.();
    promises.push(entry ? traverseFileTree(entry) : Promise.resolve(dtItems[i].kind === "file" ? dtItems[i].getAsFile() : []));
  }
  return (await Promise.all(promises)).flat().filter(Boolean);
}

async function getDroppedHandles(e, preTask) {
  const dtTtems = e.dataTransfer.items || [];
  if (dtTtems.length > 0) preTask?.();
  const handlePromises = Array.prototype.map.call(dtTtems, (item) => (item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null));
  return (await Promise.all(handlePromises)).filter(Boolean);
}

async function getPickedHandles(directory = false) {
  try {
    const options = { multiple: true, id: "tvp_file_picker", startIn: "videos", types: [{ description: "TVP Video Files", accept: { "video/*": [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".mpeg", ".mp3", ".ogg"] } }] };
    return directory ? [await window.showDirectoryPicker?.(options)] : await window.showOpenFilePicker?.(options);
  } catch (err) {
    return []; // user cancelled
  }
}

async function getHandlesFiles(handles) {
  const files = [];
  for (const h of handles) {
    if (h.kind === "file") files.push(await h.getFile());
    else if (h.kind === "directory")
      for await (const entry of h.values()) {
        if (entry.kind === "file") files.push(await entry.getFile());
        else if (entry.kind === "directory" && entry.name[0] !== ".") files.push(...(await getHandlesFiles([entry])));
      }
  }
  return files;
}

// ===========================================================================
// UTILITIES & NOTIFICATIONS
// ===========================================================================

function dispatchPlayerReadyToast(hour = new Date().getHours()) {
  if (!nums.files) return;
  const timeLines = readyLines[hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night"] || [],
    combined = [...timeLines, ...readyLines.default, ...timeLines],
    { body, icon } = combined[Math.floor(Math.random() * combined.length)];
  toast(body, { id: "ready", vibrate: true, icon });
}

function syncPlaylist() {
  const map = Object.fromEntries(MP.controller.config.playlist.content?.map((v) => [v.media.settings.metadata.id, v]) || []);
  MP.controller.config.playlist.content = Array.from(contentLines, (li) => map[li.querySelector("video")?.mediaId]).filter(Boolean);
}

function playlistSort(files, playlist) {
  return Array.from(playlist.content || [], (item) => files.find((f) => f.name.startsWith(item.media.settings.metadata.title))).filter(Boolean);
}

function metadataToVTT(metaText) {
  const blocks = metaText.split("[CHAPTER]");
  if (blocks.length <= 1) return null; // No chapters found
  const formatTime = (seconds) => {
    const str = (v, pad = 2) => Math.floor(v).toString().padStart(pad, "0");
    return `${str(seconds / 3600)}:${str((seconds % 3600) / 60)}:${str(seconds % 60)}.${str((seconds % 1) * 1000, 3)}`;
  };
  let vtt = "WEBVTT\n\n";
  const chapters = [];
  for (let i = 1, len = blocks.length; i < len; i++) {
    const block = blocks[i].trim(),
      tbMch = block.match(/TIMEBASE=(\d+)\/(\d+)/),
      startMch = block.match(/START=(\d+)/),
      endMch = block.match(/END=(\d+)/),
      titleMch = block.match(/title=(.+)/i);
    if (tbMch && startMch && endMch) {
      const tb = parseInt(tbMch[1], 10) / parseInt(tbMch[2], 10);
      chapters.push({ start: parseInt(startMch[1], 10) * tb, end: parseInt(endMch[1], 10) * tb, title: titleMch ? titleMch[1].trim() : `Chapter ${i}` });
    }
  }
  return !chapters.length ? null : (chapters.forEach((ch) => (vtt += `${formatTime(ch.start)} --> ${formatTime(ch.end)}\n${ch.title}\n\n`)), vtt);
}

function getSubMeta(data, counts = {}, name = "English") {
  try {
    name = langNames.of(data.lang || "eng");
  } catch {}
  counts[name] = (counts[name] || 0) + 1;
  return { buffer: data.buffer || data, srclang: data.lang?.slice(0, 2) || "en", label: counts[name] > 1 ? `${name} ${counts[name]}` : name };
}
