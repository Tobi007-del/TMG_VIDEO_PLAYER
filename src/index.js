import "@t007/toast/style.css";
import "@t007/dialog/style.css";
import "@t007/input/style.css";

import toast, { toaster } from "@t007/toast";
import { confirm } from "@t007/dialog";
import { field } from "@t007/input";
import { initVScrollerator } from "@t007/utils/hooks/vanilla";
import { IndexedDBAdapter } from "sia-reactor/modules";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { NOOP } from "sia-reactor";

inject(), injectSpeedInsights(); // Realtime Vercel Analytics

// global variables
window._lsik = "TVP_visitor_info"; // localStorage info key
window.canSession = "launchQueue" in window || "showOpenFilePicker" in window || "showDirectoryPicker" in window || "getAsFileSystemHandle" in DataTransferItem.prototype;
window.sessionHandles = []; // global handle access of current session handles
window.DB = new IndexedDBAdapter({
  dbName: "TVP_Sessions",
  debug: true,
  stores: ["handles", "subtitles"], // first is default: "handles"
  onidb() {
    if (!canSession) throw new Error("TVP Session Persistence is not allowed here"); // to be caught by vault promises and handled gracefully, No IDB for you :(
  },
  onversionchange: () => (toast.info(`TVP updated in another ${installed ? "window" : "tab"}. Reloading...`), location.reload()),
  onblocked: () => toast.warn(`Please close other ${installed ? "windows" : "tabs"} of TVP to apply updates`),
});
window.Memory = {
  _expiryDays: 60, // 30 days of no sessions
  getState() {
    return JSON.parse(localStorage[_lssk] || "null");
  },
  async getSession() {
    const state = this.getState(),
      session = await DB.get("last_handles");
    if (!state?.playlist || !session) return null; // no session handles, no session
    return (Date.now() - session.lastUpdated) / (1000 * 60 * 60 * 24) > this._expiryDays ? (await this.clearSession(), console.log("TVP cleaned up expired session.")) : { state, handles: session.handles, lastUpdated: session.lastUpdated };
  },
  async save(snapshot) {
    localStorage[_lssk] = JSON.stringify({ settings: snapshot?.settings, playlist: snapshot?.playlist, media: snapshot?.media, hasPlayed: snapshot?.lightState?.disabled, paused: video.paused });
    sessionHandles.length ? await DB.set("last_handles", { handles: sessionHandles, lastUpdated: Date.now() }) : await this.clearSession();
  },
  async clearSession() {
    localStorage[_lssk] = JSON.stringify({ settings: this.getState()?.settings || {} }); // might not wanna clear settings
    (sessionHandles = []), await DB.clear();
  },
  clearSettings() {
    const { playlist, media, hasPlayed, paused } = this.getState();
    localStorage[_lssk] = JSON.stringify({ playlist, media, hasPlayed, paused });
  },
};
// app logic variables
let installed = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true,
  installPrompt = null, // beforeinstallprompt event object
  sessionTInt, // session toast interval for updating last updated time every minute
  mP = null, // media player
  video = document.getElementById("video"),
  placeholderItem = null;
const installButton = document.getElementById("install"),
  clearSettingsButton = document.getElementById("clear-settings-button"),
  videoPlayerContainer = document.getElementById("video-player-container"),
  fileList = document.getElementById("file-list"),
  contentLines = document.getElementsByClassName("content-line"),
  containers = document.getElementsByClassName("thumbnail-container"), // only playlist index is a guaranteed index
  videosDropBox = document.getElementById("videos-drop-box"),
  foldersDropBox = document.getElementById("folders-drop-box"),
  readyLines = {
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
  },
  vi = JSON.parse(localStorage[_lsik] || `{ "visitorId": "${crypto?.randomUUID?.() || tmg.uid()}", "visitCount": 0 }`),
  stoast = toaster({ autoClose: false, closeButton: false, dragToClose: false }), // yeah, my lib supports toasters that store defaults in bulk, eg. for loading toast reset perks. restore toasts will sha stay put when needed
  scroller = initVScrollerator({ lineHeight: 80, margin: 80, car: document.body }),
  queue = new tmg.AsyncQueue(),
  nums = { bytes: 0, files: 0, time: 0 },
  { createFFmpeg, fetchFile } = FFmpeg,
  ffmpeg = createFFmpeg({ log: false, corePath: "assets/ffmpeg/ffmpeg-core.js" }),
  formatVisit = (d, sx = "") => ((d = Math.floor((new Date().getTime() - new Date(d).getTime()) / 1000)), `${d < 60 ? `${d} second` : d < 3600 ? `${Math.floor(d / 60)} minute` : d < 86400 ? `${Math.floor(d / 3600)} hour` : `${Math.floor(d / 86400)} day`}`.replace(/(\d+)\s(\w+)/g, (_, n, u) => `${n} ${u}${n == 1 ? "" : "s"}`) + sx); // this one's just for terse practice :)
// async IIFEs for better readability and to run fire-and-forget important logic on page load
(async function logVisitor() {
  vi.isNew = vi.isNew == null ? true : false;
  vi.visitCount += 1;
  vi.lastVisited = vi.lastVisit ? formatVisit(vi.lastVisit, " ago") : "Just now";
  try {
    const response = await fetch("../api/log-ip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...vi, screenW: screen.width, screenH: screen.height, platform: navigator.platform, touchScreen: navigator.maxTouchPoints > 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    // console.log("TVP logged visitor info: ", await response.json());
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
      videoFiles = allFiles.filter((file) => (file.type || tmg.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You opened ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, launchParams.files);
  });
})();
(async function checkVaultUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  const { usage, quota } = await navigator.storage.estimate(),
    percent = (usage / quota) * 100;
  console.log(`TVP Storage: ${tmg.formatSize(usage)} used of ${tmg.formatSize(quota)} (${percent.toFixed(2)}%)`);
  if (usage / quota > 80) toast.warn(`Storage is ${percent.toFixed(2)}% full, sessions may be forgotten`);
})();
(async function requestPersist() {
  if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
})();
!tmg.queryMediaMobile() && setTimeout(() => ffmpeg.load()); // let the UI breathe, don't suffocate it yet :)
// window listeners
window.addEventListener("load", async () => {
  const session = !nums.files && (await Memory.getSession());
  if (session) stoast(`You have an ongoing session from ${formatVisit(session.lastUpdated, " ago")}`, { id: "session", icon: "🎞️", actions: { Restore: () => (clearInterval(sessionTInt), restoreSession(session)), Dismiss: () => (clearInterval(sessionTInt), stoast.info("You can reload the page to see this prompt again", { id: "session", icon: true, autoClose: 5000, closeButton: !tmg.ON_MOBILE, dragToClose: true, actions: { Reload: () => location.reload() } })) } });
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
// other listeners
installButton.addEventListener("click", async () => {
  const res = await installPrompt?.prompt?.();
  if (res.outcome === "accepted") (installButton.style.display = "none"), (installPrompt = null);
});
document.getElementById("clear-files-button").addEventListener("click", clearFiles);
clearSettingsButton.addEventListener("click", () => clearSettings(true));
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
    console.log("TVP Handle Kind:", handles?.[0]?.kind, "Full Object:", handles?.[0]);
    const allFiles = useHandles ? await getHandlesFiles(handles) : e.target.files,
      videoFiles = Array.prototype.filter.call(allFiles, (file) => (file.type || tmg.getMimeTypeFromExtension(file.name)).startsWith("video/")),
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
      videoFiles = allFiles.filter((file) => (file.type || tmg.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) toast.warn(`You dropped ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, handles);
    [videosDropBox, foldersDropBox].forEach((el) => el.classList.remove("active"));
  }
  !("getAsFileSystemHandle" in DataTransferItem.prototype) ? dropBox.addEventListener("drop", handleDrop) : dropBox.addEventListener("drop", (e) => handleDrop(e, true));
});
// UI utils
function defaultUI() {
  if (nums.files) return;
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">No videos currently selected :&lpar;</p>`;
  updateUI();
}
function initUI() {
  if (nums.files) return;
  videoPlayerContainer.classList.add("loading");
  video.classList.add("stall");
  document.body.classList.remove("light");
  fileList.innerHTML = "";
  updateUI();
}
function readyUI() {
  video.classList.remove("stall");
  videoPlayerContainer.classList.remove("loading");
  setTimeout(() => mP.Controller?.toast?.(`You're welcome${vi.isNew ? "" : " back"} to TVP`, { icon: "🎬", image: "assets/images/lone-tree.jpg" }), 500);
  mP.Controller?.config.on("settings.css.brandColor", ({ value }) => setColors(value, false), { immediate: "auto" });
  mP.Controller?.config.on("settings.css.themeColor", ({ value }) => setColors(false, value), { immediate: "auto" });
}
function errorUI(error) {
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">${error}!</p>`;
}
function updateUI() {
  document.getElementById("total-num").textContent = nums.files;
  document.getElementById("total-size").textContent = tmg.formatSize(nums.bytes, 2);
  document.getElementById("total-time").textContent = tmg.formatMediaTime({ time: nums.time });
}
// Session utils
async function restoreSession({ handles }) {
  const state = Memory.getState(),
    files = [],
    sureHandles = [];
  stoast.info("Restoring your ongoing session now", { id: "session", icon: true, actions: false }), await tmg.deepBreath(); // take a deep breath browser, it's comming in hot. adding delays between toasts for better UX
  for (const handle of handles) {
    const name = `${handle.name} ${handle.kind === "file" ? "" : "folder"}`;
    try {
      const resp = await new Promise(async (res, rej) => {
        if ((await handle.queryPermission({ mode: "read" })) === "granted") return res("User not needed"); // it's practically instant so no loading toast
        (function request() {
          stoast.info(`We need permission to restore ${name}`, { id: "session", actions: { OK: async () => ((await handle.requestPermission({ mode: "read" })) === "granted" ? res() : stoast.warn(`Grant permissions to restore ${handle.name}`, { id: "session", actions: { Retry: request, Skip: () => rej("User denied") } })), DENY: () => rej("User denied") } });
        })();
      });
      const file = handle.kind === "file" ? await handle.getFile() : await getHandlesFiles([handle]);
      tmg.isArr(file) ? files.push(...file.filter((file) => file.type.startsWith("video/"))) : files.push(file), sureHandles.push(handle);
      stoast.success(`Restored ${name} successfully`, { id: "session", actions: false }), await (resp === "User not needed" ? tmg.deepBreath() : tmg.mockAsync(200)); // perceive the success without slowing down the flow at all
    } catch (err) {
      console.error(`TVP skipped handle "${name}":`, err);
      stoast.error(`Skipped ${name}, something went wrong`, { id: "session", actions: false }), await (err === "User denied" ? tmg.deepBreath() : tmg.mockAsync(800)); // perceive the failure without slowing down the flow
    }
  }
  if (sureHandles.length) stoast.success("Your ongoing session has been restored :)", { id: "session", actions: false }), await tmg.deepBreath();
  else return stoast.error("Your ongoing session was not restored :(", { id: "session", actions: { Reload: () => location.reload(), Dismiss: () => stoast.dismiss("session") } });
  handleFiles(files, state, sureHandles);
}
function saveSession() {
  mP && nums.files && Memory.save(mP.Controller.config);
}
// File utils
async function clearSettings(prompt = false) {
  const ok = prompt && (await confirm("Are you sure you want to clear your settings?", { title: "Clear Settings", confirmText: "Clear" }));
  if (prompt && !ok) return;
  Memory.clearSettings(), setColors();
  clearSettingsButton.classList.remove("shown");
  toast.success("Settings cleared successfully", { id: "settings", actions: false });
}
async function clearFiles() {
  const ok = await confirm("Are you sure you want to clear all files?", { title: "Clear Files", confirmText: "Clear" });
  if (!ok) return;
  toast.dismiss("ready"), video.pause(), video.removeAttribute("src"), video.removeAttribute("poster");
  video.onplay = video.onpause = video.ontimeupdate = null;
  video = mP?.detach();
  mP = null;
  Array.prototype.forEach.call(containers, (c) => {
    const vid = c.querySelector("video");
    URL.revokeObjectURL(vid.src);
    const playlistItem = vid.getPlItem?.();
    if (playlistItem?.tracks?.[0]?.src?.startsWith("blob:")) URL.revokeObjectURL(playlistItem.tracks[0].src);
    queue.drop(vid.dataset.captionId);
  });
  nums.files = nums.bytes = nums.time = 0;
  Memory.clearSession(), defaultUI();
  clearSettingsButton.classList.add("shown");
  toast.success("Cleared all files from your session, Settings too?", { id: "settings", autoClose: 5000, actions: { Clear: () => clearSettings() } });
}
async function handleFiles(files, restored = null, handles = null) {
  try {
    if (!files?.length && !nums.files) return defaultUI();
    stoast.dismiss("session"), initUI();
    if (handles?.length) sessionHandles = [...sessionHandles, ...handles.filter((h) => !sessionHandles.some((sh) => sh.name === h.name))];
    for (const file of (files = !restored ? smartFlatSort(files) : playlistSort(files, restored.playlist))) nums.files++, (nums.bytes += file.size); // providing some available metrics to the user
    updateUI(), await tmg.deepBreath(); // browser breathe small first, UI; u still update nah
    const stateMap = new Map(restored?.playlist?.map((v) => [v.media.title, v]) || []), // Pre-map for O(1) lookups
      list = fileList.appendChild(document.getElementById("media-list") || tmg.createEl("ul", { id: "media-list" })), // building the media list
      thumbnails = [];
    for (let i = 0; i < files.length; i++) {
      const ffName = tmg.noExtension(files[i].name), // file formatted name
        state = stateMap.get(ffName);
      if ((restored && !state) || !!Array.prototype.find.call(containers, (c) => c.lastElementChild.ffName === ffName)) {
        nums.files--, (nums.bytes -= files[i].size), thumbnails.push(null);
        continue; // prevents duplicates & skips files incase user deleted file but not directory handle
      }
      const li = tmg.createEl("li", { className: "content-line" }, { fileName: files[i].name });
      const thumbnail = tmg.createEl(
        "video",
        {
          className: "thumbnail",
          preload: "metadata",
          muted: true,
          playsInline: true,
          onloadedmetadata: ({ target }) => {
            nums.time += tmg.safeNum(target.duration);
            target.currentTime = tmg.parseIfPercent(tmg.DEFAULT_VIDEO_BUILD.lightState.preview.time, target.duration);
            document.getElementById("total-time").textContent = tmg.formatMediaTime({ time: nums.time });
            li.querySelector(".file-duration span:last-child").innerHTML = `${tmg.formatMediaTime({ time: target.duration })}`;
            restored && thumbnails[i]?.parentElement?.style.setProperty("--video-progress-position", tmg.safeNum(state.settings.time.start / target.duration));
          },
          onerror: ({ target }) => {
            li.classList.add("error");
            if (tmg.safeNum(target.duration)) return;
            li.querySelector(".file-duration span:last-child").classList.add("failed");
            li.querySelector(".file-duration span:last-child").innerHTML = "Failed to Load";
          },
        },
        { captionState: "waiting" }
      );
      thumbnails.push(((thumbnail.ffName = ffName), thumbnail));
      const thumbnailContainer = tmg.createEl("span", { className: "thumbnail-container", innerHTML: `<button><svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated"><rect x="4" width="3" height="10" fill="white"></rect><rect x="10" width="3" height="10" fill="white"></rect><rect x="16" width="3" height="10" fill="white"></rect></svg></button>`, onclick: () => mP.Controller?.movePlaylistTo(thumbnail.getPlIndex(), true) }).appendChild(thumbnail).parentElement;
      const captionsInput = tmg.createEl("input", {
        type: "file",
        accept: ".srt, .vtt",
        onchange: async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const ext = tmg.getExtension(f.name);
          if (!["srt", "vtt"].includes(ext)) return (thumbnail.dataset.captionState = "empty"), toast.warn("Only .srt and .vtt caption files are currently supported");
          let txt = await f.text();
          if (ext === "srt") txt = tmg.srtToVtt(txt);
          DB.set((thumbnail.dataset.captionId = f.name), new TextEncoder().encode(txt), "subtitles"); // storing these too for the magic tricks, no need for file pickers, it's light
          const playlistItem = thumbnail.getPlItem(); // storing name as id so it will not be `tmg-` prefixed like our UID's for later logic
          playlistItem.tracks = [{ id: f.name, kind: "captions", label: "English", srclang: "en", src: URL.createObjectURL(new Blob([txt], { type: "text/vtt" })), default: true }];
          if (mP.Controller?.config.playlist[mP.Controller.currentPlaylistIndex].media.id === playlistItem.media?.id) mP.Controller.config.tracks = playlistItem.tracks;
          thumbnail.dataset.captionState = "filled";
        },
        oncancel: () => (thumbnail.dataset.captionState = "empty"),
      });
      const captionsBtn = tmg.createEl("button", { title: "(Toggle / DblClick→Load) Captions", className: "captions-btn", innerHTML: `<svg viewBox="0 0 25 25" style="scale: 1.15;"><path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"/><svg>` }).appendChild(captionsInput).parentElement;
      tmg.addSafeClicks(
        captionsBtn,
        ({ target }) => {
          if (target.matches("input")) return;
          if (thumbnail.dataset.captionState === "empty") {
            setTimeout(() => (thumbnail.dataset.captionState = "loading"), 1000);
            return captionsBtn.querySelector("input").click();
          } else if (thumbnail.dataset.captionState === "filled") {
            const playlistItem = thumbnail.getPlItem();
            URL.revokeObjectURL(playlistItem.tracks?.[0]?.src); // no deleting from IDB just yet, KB's for restoration magic tricks
            if (!thumbnail.dataset.captionId.startsWith("tmg-")) DB.remove(thumbnail.dataset.captionId, "subtitles"); // delete if not ffmpeg's, we can't guarantee identity when repicked, input ain't slow like ffmpeg
            playlistItem.tracks = [];
            if (mP.Controller?.config.playlist[mP.Controller.currentPlaylistIndex].media.id === playlistItem.media?.id) mP.Controller.config.tracks = [];
          } else if (!queue.drop(thumbnail.dataset.captionId)) return; // cancels if waiting and returns if loading since current job is shifted from queue
          thumbnail.dataset.captionState = "empty";
        },
        async () => thumbnail.dataset.captionState === "empty" && (await deployCaption(files[i], thumbnail, false))
      );
      const deleteBtn = tmg.createEl("button", {
        title: "Remove Video",
        className: "delete-btn",
        innerHTML: `<svg width="20px" height="20px" viewBox="0 0 24 24" fill="none"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="#0D0D0D"/></svg>`,
        onclick() {
          URL.revokeObjectURL(thumbnail.src);
          const playlistItem = thumbnail.getPlItem();
          if (playlistItem.tracks?.[0]?.src?.startsWith("blob:")) URL.revokeObjectURL(playlistItem.tracks[0].src);
          queue.drop(thumbnail.dataset.captionId);
          DB.remove(thumbnail.dataset.captionId, "subtitles");
          li.remove();
          const hIdx = sessionHandles.findIndex((h) => h.name === files[i].name);
          if (hIdx !== -1) sessionHandles.splice(hIdx, 1);
          saveSession();
          if (nums.files <= 1) return clearFiles();
          else syncPlaylist();
          nums.files--, (nums.bytes -= files[i].size), (nums.time -= tmg.safeNum(thumbnail.duration));
          updateUI();
        },
      });
      const dragHandle = tmg.createEl("span", { title: "Drag to Reorder", className: "drag-handle", innerHTML: `<svg fill="#000000" height="20px" width="20px" viewBox="0 0 24 24"><path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/></svg>` });
      dragHandle.addEventListener(
        "pointerdown",
        (e) => {
          navigator.vibrate?.([50]);
          let initialOffsetY = list.getBoundingClientRect().top,
            initialScrollY = document.body.scrollTop;
          li.parentElement.insertBefore((placeholderItem = tmg.createEl("div", { className: "drag-placeholder" }, {}, { cssText: `height:${li.offsetHeight}px;width:${li.offsetWidth}px;` })), li.nextElementSibling);
          li.classList.add("dragging");
          li.style.top = `${(li.top = tmg.clamp(0, e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
          ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.addEventListener(e, !i ? onPointerMove : onPointerUp));
          function onPointerMove(e) {
            e.preventDefault();
            mP.Controller?.RAFLoop("listItemDragging", () => {
              li.style.top = `${(li.top = tmg.clamp(0, document.body.scrollTop - initialScrollY + e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
              scroller.drive(e.clientY, !(li.top > 0 && li.top < list.offsetHeight - li.offsetHeight));
              const afterLine = tmg.getElSiblingAt(e.clientY, "y", list.querySelectorAll(".content-line:not(.dragging)"));
              afterLine ? list.insertBefore(placeholderItem, afterLine) : list.append(placeholderItem);
            });
          }
          function onPointerUp() {
            navigator.vibrate?.([50]);
            mP.Controller?.cancelRAFLoop("listItemDragging");
            scroller.reset();
            li.classList.remove("dragging");
            placeholderItem.parentElement.replaceChild(li, placeholderItem), (placeholderItem = null);
            syncPlaylist();
            ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.removeEventListener(e, !i ? onPointerMove : onPointerUp));
          }
        },
        { passive: false }
      );
      li.append(thumbnailContainer, tmg.createEl("span", { className: "file-info-wrapper", innerHTML: `<p class="file-name"><span>Name: </span><span>${files[i].name}</span></p><p class="file-size"><span>Size: </span><span>${tmg.formatSize(files[i].size)}</span></p><p class="file-duration"><span>Duration: </span><span>${restored ? "Rei" : "I"}nitializing...</span></p>` }), captionsBtn, deleteBtn, dragHandle);
      list.append(li), await tmg.breath(); // scroll step feel, also avoided fragment, need to prevent global file(name) duplicates, depends on containers "live" Nodelist, eighter this hack or some storage overhead, fragment might be unnecessary sef and unorthodox
    }
    const playlist = [];
    const deployVideos = (files) => {
      for (let i = 0; i < files.length; i++) {
        if (!thumbnails[i]) continue; // skip files incase user deleted file but not directory handle
        const url = URL.createObjectURL(files[i]),
          state = stateMap.get(thumbnails[i].ffName),
          item = state ?? { media: { id: tmg.uid(), title: thumbnails[i].ffName }, "settings.time.previews": true, "settings.time.start": 0 };
        playlist.push(((item.src = url), item));
        (thumbnails[i].src = url), (thumbnails[i].mediaId = item.media.id);
        thumbnails[i].getPlItem = () => (thumbnails[i].playlistItem = mP?.Controller?.config?.playlist?.find((v) => v.media.id === item.media.id) ?? thumbnails[i].playlistItem ?? {});
        thumbnails[i].getPlIndex = () => mP?.Controller?.config?.playlist?.findIndex((v) => v.media.id === item.media.id);
      }
      if (!mP) {
        video.addEventListener(
          "tmgattached",
          () => {
            const i = restored && playlist.findIndex((item) => item.media.id === restored.media.id),
              should = (restored?.hasPlayed || restored?.lightState?.disabled) && i !== -1; // having a taste of backwards compat
            should && mP.Controller?.movePlaylistTo(i, !restored.paused);
            should && thumbnails[i]?.closest("li")?.classList.add("playing");
            should && thumbnails[i]?.parentElement?.classList.toggle("paused", video.paused);
            mP.Controller.config.on("*", () => mP.Controller?.throttle("TVP_session_save", saveSession, 2500), { immediate: true });
            readyUI();
          },
          { once: true }
        );
        mP = new tmg.Player({ cloneOnDetach: true, playlist, "media.artist": "TMG Video Player", "media.profile": "assets/icons/tmg-icon.jpeg", "media.links.artist": "https://tmg-video-player.vercel.app", "media.links.profile": "https://github.com/Tobi007-del/tmg-media-player", "settings.captions.font.size.value": 200, "settings.captions.font.weight.value": 700, "settings.captions.background.opacity.value": 0, "settings.captions.characterEdgeStyle.value": "drop-shadow", "settings.overlay.behavior": "auto" });
        mP.configure({ settings: (restored ?? Memory.getState())?.settings ?? {}, lightState: restored?.hasPlayed || restored?.lightState?.disabled ? { disabled: true } : {} }); // recursive mixing in & having anoda taste of backwards compat
        mP.attach(video);
        window.addEventListener("pagehide", saveSession);
        document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveSession());
        video.addEventListener("loadedmetadata", () => setTimeout(dispatchPlayerReadyToast, 500), { once: true });
        video.ontimeupdate = ({ target: { currentTime: ct, duration: d } }) => mP.Controller?.throttle("TVP_thumbnail_update", () => ct > 3 && mP.Controller?.config.lightState.disabled && containers[mP.Controller?.currentPlaylistIndex]?.style.setProperty("--video-progress-position", tmg.safeNum(ct / d)), 2500);
        video.onplay = () => {
          for (let i = 0; i < contentLines.length; i++) contentLines[i].classList.toggle("playing", i === mP.Controller?.currentPlaylistIndex);
          containers[mP.Controller?.currentPlaylistIndex]?.classList.remove("paused");
        };
        video.onpause = () => containers[mP.Controller?.currentPlaylistIndex]?.classList.add("paused");
      } else mP.Controller.config.playlist = [...mP.Controller.config.playlist, ...playlist];
    };
    nums.files && (deployVideos(files), await tmg.deepBreath(), await tmg.deepBreath()); // video deployment is no small job, take 2 breaths; browser, captions can chill
    nums.files && (await Promise.all(files.map(async (_, i) => thumbnails[i] && (await deployCaption(files[i], thumbnails[i], undefined, stateMap.get(tmg.noExtension(files[i].name)))))));
    if (!nums.files) return defaultUI();
  } catch (error) {
    console.error("TVP files handling failed:", error), errorUI(error);
  }
}
// Caption utils
async function deployCaption(file, thumbnail, autocancel = !crossOriginIsolated || tmg.queryMediaMobile(), item) {
  const id = item?.tracks?.[0]?.id ?? thumbnail.dataset.captionId ?? tmg.uid(); // checking captionId since we never clear it, incase in IDB; Magic! :)
  thumbnail.setAttribute("data-caption-id", id);
  thumbnail.setAttribute("data-caption-state", item?.tracks?.[0] ? "loading" : "waiting");
  // 1. THE VAULT CHECK (Instant)
  const buffer = await DB.get(id, "subtitles");
  if (buffer) {
    console.log(`✨TVP IDB Vault Hit: Subtitles restored for ${id}`);
    const track = item?.tracks?.[0] ?? { id, kind: "captions", label: "English", srclang: "en", default: true };
    (item ??= thumbnail.getPlItem()).tracks = [((track.src = URL.createObjectURL(new Blob([buffer], { type: "text/vtt" }))), track)];
    if (mP.Controller?.config.playlist[mP.Controller.currentPlaylistIndex].media.id === item.media.id) mP.Controller.config.tracks = item.tracks;
    return thumbnail.setAttribute("data-caption-state", "filled");
  }
  // 2. THE FACTORY (FFmpeg - only if Vault is empty)
  autocancel && thumbnail.setAttribute("data-caption-state", "empty");
  const res = await queue.add(
    async () => await extractCaptions(file, id),
    id,
    autocancel,
    () => thumbnail.setAttribute("data-caption-state", "loading")
  );
  if (res.success) await DB.set(id, res.vttData.buffer, "subtitles");
  if (!res.cancelled) thumbnail.setAttribute("data-caption-state", res.success ? "filled" : "empty");
  if (!res.success) return;
  (item = thumbnail.getPlItem()).tracks = [res.track];
  if (mP.Controller?.config.playlist[mP.Controller.currentPlaylistIndex].media.id === item.media.id) mP.Controller.config.tracks = item.tracks;
}
async function extractCaptions(file, id) {
  const outputName = `cue${id}.vtt`,
    inputName = `video${id}${tmg.getExtension(file.name)}`;
  try {
    console.log(`🎥 TVP processing file with FFmpeg: '${file.name}'`);
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    ffmpeg.FS("writeFile", inputName, await fetchFile(file));
    console.log("🛠 Extracting first subtitle stream to .vtt...");
    await ffmpeg.run("-i", inputName, "-map", "0:s:0", "-f", "webvtt", outputName);
    const vttData = ffmpeg.FS("readFile", outputName);
    console.log("✅ First subtitle stream extracted successfully.");
    return { success: true, vttData, track: { id, kind: "captions", label: "English", srclang: "en", src: URL.createObjectURL(new Blob([vttData.buffer], { type: "text/vtt" })), default: true } };
  } catch (err) {
    console.error("❌ TVP VTT stream extraction failed:", err);
    return { success: false, error: err.toString() };
  } finally {
    try {
      ffmpeg.FS("unlink", inputName);
    } catch {}
    try {
      ffmpeg.FS("unlink", outputName);
    } catch {}
  }
}
// File helpers
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
// Misc helpers
function dispatchPlayerReadyToast(hour = new Date().getHours()) {
  if (!nums.files) return;
  const timeLines = readyLines[hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night"] || [],
    combined = [...timeLines, ...readyLines.default, ...timeLines],
    { body, icon } = combined[Math.floor(Math.random() * combined.length)];
  toast(body, { id: "ready", vibrate: true, icon });
}
function syncPlaylist() {
  const map = Object.fromEntries(mP.Controller.config.playlist.map((v) => [v.media.id, v]));
  mP.Controller.config.playlist = Array.from(contentLines, (li) => map[li.querySelector("video")?.mediaId]).filter(Boolean);
}
function playlistSort(files, playlist) {
  return Array.from(playlist, (item) => files.find((f) => f.name.startsWith(item.media.title))).filter(Boolean);
}
function parseRomanNum(roman, valid = /^[IVXLCDM]+$/i.test(roman), ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }) {
  if (!valid) return 0; // ← Invalid input
  return roman
    .toUpperCase() // Ensure consistent uppercase (e.g., 'iv' becomes 'IV')
    .split("") // Turn into array of characters: 'XIV' → ['X','I','V']
    .reduce((acc, val, i, arr) => {
      const curr = ROMAN[val] || 0, // Current character's value
        next = ROMAN[arr[i + 1]] || 0; // Look ahead to the next character (if any)
      return acc + (curr < next ? -curr : curr); // Subtractive notation: if current is less than next (e.g., I before V → 4); Otherwise, just add normally
    }, 0); // Start accumulator at 0
}
function smartFlatSort(files, debug = false, stripExt = tmg.noExtension, log = debug ? (title, ...body) => console.log(`[Sorter][${title}]`, ...body) : NOOP, bCache = new Map(), kCache = new Map(), groups = new Map()) {
  debug && console.time("[Sorter]"), log("Init", `Sorting ${files.length} items...`);
  // Extracts the main series title + optional season
  function getNamePrefix(name, base = stripExt(name), match = base.match(/(.*?)(?:(?:s|season)[\s\-]?)(\d+).*?(?:(?:e|ep|episode)[\s\-]?)(\d+)?/i)) {
    // prettier-ignore
    return bCache.set(name, base), (match ? (match[1].replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase() + " s" + match[2].padStart(2, "0")) : base.replace(/(?:(?:e|ep|episode|part)[\s\-]?)\d+/gi, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase()) || "unknown";
  }
  // Extract episode key: season, episode number(s), or special flags
  function extractEpisodeKey(name, base = bCache.get(name).toLowerCase()) {
    // Match lazy formats like "S02 - Episode 3", "S3 ep4", "S5E 7" (not strict SxxEyy)
    const combo = base.match(/(?:(?:s|season)[\s\-]?)(\d+).*?(?:(?:e|ep|episode)[\s\-]?)(\d+)/);
    if (combo) return [parseInt(combo[1]), parseInt(combo[2])];
    // Match "1x01", "5x12" — alternate style used by some encoders or fansubs
    const alt = base.match(/(\d+)x(\d+)/);
    if (alt) return [parseInt(alt[1]), parseInt(alt[2])];
    // Match Roman numerals like "Season IV Episode IX"
    const roman = base.match(/(?:(?:s|season)[\s\-]?)([ivxlcdm]+).*?(?:(?:e|ep|episode)[\s\-]?)([ivxlcdm]+)/i);
    if (roman) return [parseRomanNum(roman[1], true), parseRomanNum(roman[2], true)];
    // Match fallback single-episode formats like "Ep12", "Episode 5", "E7", "Part 2" without season info
    const loose = base.match(/(?:(?:e|ep|episode|part)[\s\-]?)(\d+)/);
    if (loose) return [999, parseInt(loose[1])]; // Put these at the end with fake season 999
    // Totally unmatchable junk (e.g. "Behind the Scenes", "Bonus Feature")
    return [Infinity, Infinity]; // Hard fallback — gets sorted dead last
  }
  for (const file of files) {
    const key = getNamePrefix(file.name);
    let group = groups.get(key);
    log("Prefix", `"${file.name}" -> "${key}"`), (group ?? (groups.set(key, (group = [])), group)).push(file);
  }
  const sortedFiles = [],
    byGroup = ([a], [b], diff = a === "unknown" ? 1 : b === "unknown" ? -1 : a.localeCompare(b)) => (log("Group Compare", `[${a}] vs [${b}] = ${diff > 0 ? "B first" : diff < 0 ? "A first" : "Tie"}`), diff), // Sort groups alphabetically by their prefix
    getKey = (name, key = kCache.get(name)) => (key ? key : (kCache.set(name, (key = extractEpisodeKey(name))), key)),
    byEpisode = (a, b, ak = getKey(a.name), bk = getKey(b.name), diff = ak[0] !== bk[0] ? ak[0] - bk[0] : ak[1] - bk[1]) => (log("Episode Compare", `[${ak}] vs [${bk}] = ${diff > 0 ? "B first" : diff < 0 ? "A first" : "Tie"}  ("${a.name}" / "${b.name}")`), diff), // season | episode
    sortedGroups = (log("Groups", `Identified ${groups.size} group(s)`, groups), [...groups.entries()].sort(byGroup)); // Sort groups alphabetically by their prefix
  for (const [, group] of sortedGroups) group.sort(byEpisode), sortedFiles.push(...group);
  return log("Done", sortedFiles), debug && console.timeEnd("[Sorter]"), sortedFiles;
}

field({}); // just so input lib is bundled
