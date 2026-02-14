var lsk = "TVP_visitor_info",
  vi = JSON.parse(localStorage[lsk] || `{ "visitorId": "${crypto?.randomUUID?.() || tmg.uid()}", "visitCount": 0 }`),
  formatVisit = (d, sx = "") => ((d = Math.floor((new Date().getTime() - new Date(d).getTime()) / 1000)), `${d < 60 ? `${d} second` : d < 3600 ? `${Math.floor(d / 60)} minute` : d < 86400 ? `${Math.floor(d / 3600)} hour` : `${Math.floor(d / 86400)} day`}`.replace(/(\d+)\s(\w+)/g, (_, n, u) => `${n} ${u}${n == 1 ? "" : "s"}`) + sx); // this one's just for terse practice :)
(async function logVisitor() {
  vi.isNew = vi.isNew == null ? true : false;
  vi.visitCount += 1;
  vi.lastVisited = vi.lastVisit ? formatVisit(vi.lastVisit, " ago") : "Just now";
  try {
    const response = await fetch("../api/log-ip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...vi, screenW: screen.width, screenH: screen.height, platform: navigator.platform, touchScreen: navigator.maxTouchPoints > 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    console.log("TVP logged visitor info: ", await response.json());
  } catch (err) {
    console.error("TVP couldn't log info: ", err);
  }
  localStorage[lsk] = JSON.stringify({ ...vi, lastVisit: new Date().toISOString() });
})();
(async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Toast.warn("Offline support is currently unavailable");
  try {
    await navigator.serviceWorker.register("TVP_sw.js");
  } catch (error) {
    Toast.error("Offline caching failed: " + error.message);
    Toast("Don’t worry, your local videos still play fine", { vibrate: true, icon: "🎬" });
  }
})();
(async function checkVaultUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  const { usage, quota } = await navigator.storage.estimate(),
    percent = (usage / quota) * 100;
  console.log(`TVP Storage: ${tmg.formatSize(usage)} used of ${tmg.formatSize(quota)} (${percent.toFixed(2)}%)`);
  if (usage / quota > 80) Toast.warn(`Storage is ${percent.toFixed(2)}% full, sessions may be forgotten`);
})();
(async function requestPersistence() {
  if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
})();

let canSession = "launchQueue" in window || "showOpenFilePicker" in window || "showDirectoryPicker" in window || "getAsFileSystemHandle" in DataTransferItem.prototype,
  sessionHandles = [],
  sessionTId, // session toast id
  sessionTInt, // session toast interval for updating last updated time every minute
  installed = true,
  installPrompt = null,
  video = document.getElementById("video"),
  mP = null, // media player
  readyTId,
  numOfBytes = 0,
  numOfFiles = 0,
  totalTime = 0,
  placeholderItem = null;
const DB = {
  _db: null,
  onErr: (act, comment = "(likely a Support issue or Private Mode)") => (console.warn(`TVP_DB: ${act} failed ${comment}`), null),
  async idb() {
    if (!canSession) throw new Error("TVP Session Persistence is not allowed here"); // to be caught by vault promises and handled gracefully, No IDB for you :(
    if (this._db) return this._db;
    return new Promise((res) => {
      const req = indexedDB.open("TVP_Sessions", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("handles")) db.createObjectStore("handles");
        if (!db.objectStoreNames.contains("subtitles")) db.createObjectStore("subtitles");
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => (req.result.close(), Toast.info(`TVP updated in another ${installed ? "window" : "tab"}. Reloading...`), location.reload());
        res((this._db = req.result));
      };
      req.onblocked = () => Toast.warn(`Please close other ${installed ? "windows" : "tabs"} of TVP to apply updates`);
    });
  },
  get vault() {
    return new Proxy(
      {},
      {
        get: (_, store) => ({
          get: async (key) => {
            try {
              const req = (await this.idb()).transaction(store).objectStore(store).get(key);
              return new Promise((res) => (req.onsuccess = () => res(req.result)));
            } catch (e) {
              return this.onErr(`Get [${store}]`);
            }
          },
          put: async (val, key) => {
            try {
              const req = (await this.idb()).transaction(store, "readwrite").objectStore(store).put(val, key);
              return new Promise((res) => (req.onsuccess = () => res(true)));
            } catch (e) {
              return this.onErr(`Put [${store}]`);
            }
          },
          delete: async (key) => {
            try {
              const req = (await this.idb()).transaction(store, "readwrite").objectStore(store).delete(key);
              return new Promise((res) => (req.onsuccess = () => res(true)));
            } catch (e) {
              return this.onErr(`Delete [${store}]`);
            }
          },
          clear: async () => {
            try {
              const req = (await this.idb()).transaction(store, "readwrite").objectStore(store).clear();
              return new Promise((res) => (req.onsuccess = () => res(true)));
            } catch (e) {
              return this.onErr(`Clear [${store}]`);
            }
          },
        }),
      }
    );
  },
  async clear(stores = ["handles", "subtitles"]) {
    for (const store of Array.isArray(stores) ? stores : [stores]) await this.vault[store].clear();
  },
};
const Memory = {
  _stateKey: "TVP_last_session_state",
  _expiryDays: 30, // 30 days of no sessions
  getState() {
    return JSON.parse(localStorage.getItem(this._stateKey) || "null");
  },
  async getSession() {
    const state = this.getState(),
      session = await DB.vault.handles.get("last_handles");
    if (!state?.playlist || !session) return null; // no session handles, no session
    return (Date.now() - session.lastUpdated) / (1000 * 60 * 60 * 24) > this._expiryDays ? (this.clear(), console.log("TVP expired session cleaned up.")) : { state, handles: session.handles, lastUpdated: session.lastUpdated };
  },
  async save(snapshot) {
    localStorage.setItem(this._stateKey, JSON.stringify({ settings: snapshot.settings, playlist: snapshot.playlist, media: snapshot.media, paused: video.paused }));
    sessionHandles.length ? await DB.vault.handles.put({ handles: sessionHandles, lastUpdated: Date.now() }, "last_handles") : await this.clear();
  },
  async clear() {
    localStorage.setItem(this._stateKey, JSON.stringify({ settings: this.getState()?.settings || {} })); // might not wanna clear settings
    if (await DB.clear()) sessionHandles = [];
  },
  clearSettings() {
    const { playlist, playlistIndex, paused } = this.getState();
    localStorage.setItem(this._stateKey, JSON.stringify({ playlist, playlistIndex, paused }));
  },
};
const { createFFmpeg, fetchFile } = FFmpeg,
  installButton = document.getElementById("install"),
  videoPlayerContainer = document.getElementById("video-player-container"),
  uploadVideosInput = document.getElementById("videos-file-input"),
  uploadFoldersInput = document.getElementById("folders-file-input"),
  fileList = document.getElementById("file-list"),
  videosDropBox = document.getElementById("videos-drop-box"),
  foldersDropBox = document.getElementById("folders-drop-box"),
  clearFilesBtn = document.getElementById("clear-files-button"),
  containers = document.getElementsByClassName("thumbnail-container"),
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
  queue = new tmg.AsyncQueue(),
  ffmpeg = createFFmpeg({ log: false, corePath: "assets/ffmpeg/ffmpeg-core.js" }),
  scroller = tmg.initVScrollerator({ lineHeight: 80, margin: 80 }),
  initState = Memory.getState();

initState?.settings && setColors(initState.settings.css.brandColor, initState.settings.css.themeColor);
if (!tmg.queryMediaMobile()) setTimeout(() => ffmpeg.load()); // let the UI breathe, don't suffocate it
// window listeners
window.addEventListener("load", async () => {
  if ("navigator" in window) {
    document.body.classList.toggle("offline", !navigator.onLine);
    navigator.onLine &&
      fetch("https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png", { method: "HEAD", cache: "no-cache" })
        .then((response) => document.body.classList.toggle("offline", !response.ok))
        .catch(() => document.body.classList.add("offline"));
  }
  (vi.isNew || !/(second|minute|hour)/.test(vi.lastVisited)) && Toast(vi.isNew ? `Welcome! you seem new here, do visit again` : `Welcome back! it's been ${vi.lastVisited.replace(" ago", "")} since your last visit`, { icon: "👋" });
  const session = await Memory.getSession();
  if (session) sessionTId = Toast(`You have an ongoing session from ${formatVisit(session.lastUpdated, " ago")}`, { icon: "🎞️", autoClose: false, closeButton: false, dragToClose: false, actions: { Restore: () => restoreSession(session), Dismiss: () => Toast.info(sessionTId, { render: "You can reload the page to see this prompt again", icon: true, actions: false, autoClose: true, closeButton: true }) } });
  if (session) sessionTInt = setInterval(() => Toast.update(sessionTId, { render: `You have an ongoing session from ${formatVisit(session.lastUpdated, " ago")}` }), 60000);
});
window.addEventListener("online", () => document.body.classList.remove("offline"));
window.addEventListener("offline", () => document.body.classList.add("offline"));
window.addEventListener("beforeinstallprompt", (e) => ((installPrompt = e), (installed = false), (installButton.style.display = "flex")));
window.addEventListener("appinstalled", () => ((installButton.style.display = "none"), (installed = true), Toast.success("TVP was installed successfully!")));
// other listeners
installButton.addEventListener("click", async () => {
  const result = await installPrompt?.prompt?.();
  if (result.outcome === "accepted") installButton.style.display = "none";
  installPrompt = null;
});
clearFilesBtn.addEventListener("click", clearFiles);
[
  { input: uploadVideosInput, recurse: false },
  { input: uploadFoldersInput, recurse: true },
].forEach(({ input, recurse }) => {
  input.addEventListener("click", () => setTimeout(initUI, 1000));
  input.addEventListener("cancel", defaultUI);
  async function handleInput(e, useHandles = false) {
    useHandles && e.preventDefault();
    const handles = useHandles ? await getPickedHandles(recurse) : null;
    console.log("DEBUG - Handle Kind:", handles?.[0]?.kind, "Full Object:", handles?.[0]);
    if (useHandles && !handles?.length) return defaultUI();
    const allFiles = useHandles ? await getHandlesFiles(handles) : [...e.target.files],
      videoFiles = allFiles.filter((file) => (file.type || tmg.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) Toast.warn(`You picked ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, handles);
  }
  !((!recurse ? "showOpenFilePicker" : "showDirectoryPicker") in window) ? input.addEventListener("change", handleInput) : input.addEventListener("click", (e) => handleInput(e, true));
});
[videosDropBox, foldersDropBox].forEach((dropBox, i) => {
  if (!((i ? "webkitdirectory" : "files") in HTMLInputElement.prototype)) return dropBox.remove();
  dropBox.addEventListener("dragenter", (e) => (e.preventDefault(), e.currentTarget.classList.add("active")));
  dropBox.addEventListener("dragover", (e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy")));
  dropBox.addEventListener("dragleave", (e) => (e.preventDefault(), e.currentTarget.classList.remove("active")));
  async function handleDrop(e, useHandles = false) {
    e.preventDefault();
    const handles = useHandles ? await getDroppedHandles(e) : null,
      allFiles = useHandles ? await getHandlesFiles(handles) : await getDroppedFiles(e, initUI),
      videoFiles = allFiles.filter((file) => (file.type || tmg.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) Toast.warn(`You dropped ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, handles);
    [videosDropBox, foldersDropBox].forEach((el) => el.classList.remove("active"));
  }
  !("getAsFileSystemHandle" in DataTransferItem.prototype) ? dropBox.addEventListener("drop", handleDrop) : dropBox.addEventListener("drop", (e) => handleDrop(e, true));
});
(async function launchWithOpenedFiles() {
  if (!("launchQueue" in window)) return;
  launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams?.files?.length) return;
    initUI();
    const allFiles = await getHandlesFiles(launchParams.files),
      videoFiles = allFiles.filter((file) => (file.type || tmg.getMimeTypeFromExtension(file.name)).startsWith("video/")),
      rejectedCount = allFiles.length - videoFiles.length;
    if (rejectedCount > 0) Toast.warn(`You opened ${rejectedCount} unsupported file${rejectedCount == 1 ? "" : "s"}. Only video files are supported`);
    handleFiles(videoFiles, null, launchParams.files);
  });
})();

function defaultUI() {
  if (numOfFiles >= 1) return;
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">No videos currently selected :&lpar;</p>`;
  updateUI();
}
function initUI() {
  if (numOfFiles >= 1) return;
  videoPlayerContainer.classList.add("loading");
  video.classList.add("stall");
  document.body.classList.remove("light");
  fileList.innerHTML = "";
  updateUI();
}
function readyUI() {
  video.classList.remove("stall");
  videoPlayerContainer.classList.remove("loading");
  setTimeout(() => mP.Controller?.toast(`You're welcome${vi.isNew ? "" : " back"} to TVP`, { icon: "🎬", image: "assets/images/lone-tree.jpg" }));
  mP.Controller?.config.on("settings.css.brandColor", ({ target: { value } }) => setColors(value, false), { immediate: "auto" });
  mP.Controller?.config.on("settings.css.themeColor", ({ target: { value } }) => setColors(false, value), { immediate: "auto" });
}
function errorUI(error) {
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">${error}!</p>`;
}
function updateUI() {
  document.getElementById("total-num").textContent = numOfFiles;
  document.getElementById("total-size").textContent = tmg.formatSize(numOfBytes, 2);
  document.getElementById("total-time").textContent = tmg.formatMediaTime({ time: totalTime });
}

async function restoreSession({ state, handles }) {
  const files = [],
    sureHandles = [];
  (clearInterval(sessionTInt), Toast.info(sessionTId, { render: "Restoring your ongoing session now", icon: true, actions: false }));
  for (const handle of handles) {
    const name = `${handle.name} ${handle.kind === "file" ? "" : "folder"}`;
    try {
      Toast.loading(sessionTId, { render: `Restoring ${name}...`, actions: false });
      await new Promise(async (res, rej) => {
        if ((await handle.queryPermission({ mode: "read" })) === "granted") return res("No permission needed from User");
        (function request() {
          Toast.info(sessionTId, {
            render: `We need permission to restore ${name}`,
            actions: {
              OK: async () => ((await handle.requestPermission({ mode: "read" })) === "granted" ? res() : Toast.warn(sessionTId, { render: `Grant permissions to restore ${handle.name}`, actions: { Retry: request, Skip: () => rej("User denied permission") } })),
              DENY: () => rej("User refused permission prompt"),
            },
            autoClose: false,
            closeButton: false,
            dragToClose: false,
          });
        })();
      });
      const file = handle.kind === "file" ? await handle.getFile() : await getHandlesFiles([handle]);
      (tmg.isArr(file) ? files.push(...file.filter((file) => file.type.startsWith("video/"))) : files.push(file), sureHandles.push(handle));
      Toast.success(sessionTId, { render: `Restored ${name} successfully`, actions: false });
    } catch (e) {
      console.error(`TVP Skipping zombie ${name} handle`);
      Toast.error(sessionTId, { render: `Skipped ${name}, something went wrong`, actions: false });
    }
  }
  if (!sureHandles.length) return Toast.error(sessionTId, { render: "Your ongoing session could not be restored :(", autoClose: true, closeButton: true });
  handleFiles(files, state, sureHandles);
}
function saveSession() {
  mP && numOfFiles && Memory.save(mP.Controller.config.snapshot());
}

async function clearFiles() {
  const ok = await Confirm("Are you sure you want to clear all files?", { title: "Clear Files", confirmText: "Clear" });
  if (!ok) return;
  (Toast.dismiss(readyTId), video.pause(), video.removeAttribute("src"));
  video.onplay = video.onpause = video.ontimeupdate = null;
  video = mP?.detach();
  mP = null;
  [...containers].forEach((c) => {
    const vid = c.querySelector("video");
    URL.revokeObjectURL(vid.src);
    const playlistItem = vid.getPlItem?.();
    if (playlistItem?.tracks?.[0]?.src?.startsWith("blob:")) URL.revokeObjectURL(playlistItem.tracks[0].src);
    queue.drop(vid.dataset.captionId);
  });
  numOfFiles = numOfBytes = totalTime = 0;
  (Memory.clear(), defaultUI());
  const tId = Toast.success("Cleared your files and session data, Settings too?", { actions: { Clear: () => (Memory.clearSettings(), setColors(), Toast.success(tId, { render: "Settings cleared successfully", actions: false })) } });
}
function handleFiles(files, restored = null, handles = null) {
  try {
    if (files?.length > 0) {
      (initUI(), Toast.dismiss(sessionTId));
      if (handles?.length) sessionHandles = [...sessionHandles, ...handles.filter((h) => !sessionHandles.some((sh) => sh.name === h.name))];
      for (const file of (files = smartFlatSort(files))) (numOfFiles++, (numOfBytes += file.size)); // providing some available metrics to the user
      updateUI();
      const stateMap = new Map(restored?.playlist?.map((v) => [v.media.title, v]) || []), // Pre-map for O(1) lookups
        list = document.getElementById("media-list") || tmg.createEl("ul", { id: "media-list" }), //building the media list
        fragment = document.createDocumentFragment(),
        thumbnails = [];
      for (let i = 0; i < files.length; i++) {
        const state = stateMap.get(tmg.noExtension(files[i].name));
        if (restored && !state) {
          (numOfFiles--, (numOfBytes -= files[i].size), thumbnails.push(null));
          continue; // skip files incase user deleted file but not directory handle
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
              totalTime += tmg.safeNum(target.duration);
              if (tmg.safeNum(target.duration) > 12) target.currentTime = 2;
              document.getElementById("total-time").textContent = tmg.formatMediaTime({ time: totalTime });
              li.querySelector(".file-duration span:last-child").innerHTML = `${tmg.formatMediaTime({ time: target.duration })}`;
              restored && containers[i]?.style.setProperty("--video-progress-position", tmg.safeNum(state.settings.time.start / target.duration));
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
        thumbnails.push(thumbnail);
        const thumbnailContainer = tmg.createEl("span", { className: "thumbnail-container", innerHTML: `<button><svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated"><rect x="4" width="3" height="10" fill="white"></rect><rect x="10" width="3" height="10" fill="white"></rect><rect x="16" width="3" height="10" fill="white"></rect></svg></button>`, onclick: () => mP.Controller?.movePlaylistTo(thumbnail.getPlIndex(), true) }).appendChild(thumbnail).parentElement;
        const captionsInput = tmg.createEl("input", {
          type: "file",
          accept: ".srt, .vtt",
          onchange: async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const ext = tmg.getExtension(f.name);
            if (!["srt", "vtt"].includes(ext)) return ((thumbnail.dataset.captionState = "empty"), Toast.warn("Only .srt and .vtt files are currently supported"));
            let txt = await f.text();
            if (ext === "srt") txt = tmg.srtToVtt(txt);
            DB.vault.subtitles.put(new TextEncoder().encode(txt), (thumbnail.dataset.captionId = f.name)); // storing these too for the magic tricks, no need for file pickers, it's light
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
              if (!thumbnail.dataset.captionId.startsWith("tmg-")) DB.vault.subtitles.delete(thumbnail.dataset.captionId); // delete if not ffmpeg's, we can't guarantee identity when repicked, input ain't slow like ffmpeg
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
            DB.vault.subtitles.delete(thumbnail.dataset.captionId);
            li.remove();
            const hIdx = sessionHandles.findIndex((h) => h.name === files[i].name);
            if (hIdx !== -1) sessionHandles.splice(hIdx, 1);
            saveSession();
            if (numOfFiles <= 1) return clearFiles();
            else syncPlaylist();
            (numOfFiles--, (numOfBytes -= files[i].size), (totalTime -= tmg.safeNum(thumbnail.duration)));
            updateUI();
          },
        });
        const dragHandle = tmg.createEl("span", { title: "Drag to Reorder", className: "drag-handle", innerHTML: `<svg fill="#000000" height="20px" width="20px" viewBox="0 0 24 24"><path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/></svg>` });
        dragHandle.addEventListener(
          "pointerdown",
          () => {
            navigator.vibrate?.([50]);
            let initialOffsetY = list.getBoundingClientRect().top,
              initialScrollY = window.scrollY;
            li.classList.add("dragging");
            li.parentElement.insertBefore((placeholderItem = tmg.createEl("div", { className: "drag-placeholder" }, {}, { cssText: `height:${li.offsetHeight}px;width:${li.offsetWidth}px;` })), li.nextElementSibling);
            ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.addEventListener(e, !i ? onPointerMove : onPointerUp));
            function onPointerMove(e) {
              e.preventDefault();
              mP.Controller?.RAFLoop("listItemDragging", () => {
                li.style.top = `${(li.top = tmg.clamp(0, window.scrollY - initialScrollY + e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
                scroller.drive(e.clientY, !(li.top > 0 && li.top < list.offsetHeight - li.offsetHeight));
                const afterLine = tmg.getElSiblingAt(e.clientY, "y", [...list.querySelectorAll(".content-line:not(.dragging)")]);
                afterLine ? list.insertBefore(placeholderItem, afterLine) : list.append(placeholderItem);
              });
            }
            function onPointerUp() {
              navigator.vibrate?.([50]);
              mP.Controller?.cancelRAFLoop("listItemDragging");
              scroller.reset();
              li.classList.remove("dragging");
              (placeholderItem.parentElement.replaceChild(li, placeholderItem), (placeholderItem = null));
              syncPlaylist();
              ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.removeEventListener(e, !i ? onPointerMove : onPointerUp));
            }
          },
          { passive: false }
        );
        li.append(thumbnailContainer, tmg.createEl("span", { className: "file-info-wrapper", innerHTML: `<p class="file-name"><span>Name: </span><span>${files[i].name}</span></p><p class="file-size"><span>Size: </span><span>${tmg.formatSize(files[i].size)}</span></p><p class="file-duration"><span>Duration: </span><span>Initializing...</span></p>` }), captionsBtn, deleteBtn, dragHandle);
        fragment.append(li);
      }
      (list.append(fragment), fileList.append(list));
      const playlist = [];
      const deployVideos = (files, objectURLs) => {
        objectURLs.forEach((url, i) => {
          if (!thumbnails[i]) return URL.revokeObjectURL(url); // skip files incase user deleted file but not directory handle
          const state = stateMap.get(tmg.noExtension(files[i].name)),
            item = state ?? { media: { id: tmg.uid(), title: tmg.noExtension(files[i].name) }, "settings.time.previews": true, "settings.time.start": 0 };
          playlist.push(((item.src = url), item));
          ((thumbnails[i].src = url), (thumbnails[i].mediaId = item.media.id));
          thumbnails[i].getPlItem = () => (thumbnails[i].playlistItem = mP?.Controller?.config?.playlist?.find((v) => v.media.id === item.media.id) ?? thumbnails[i].playlistItem ?? {});
          thumbnails[i].getPlIndex = () => mP?.Controller?.config?.playlist?.findIndex((v) => v.media.id === item.media.id);
        });
        if (!mP) {
          video.addEventListener(
            "tmgattached",
            () => {
              const i = restored && playlist.findIndex((item) => item.media.id === restored.media.id);
              restored && mP.Controller?.movePlaylistTo(Math.max(0, i), !restored.paused);
              mP.Controller.config.on("*", () => mP.Controller?.throttle("TVP_session_save", saveSession, 2000), { immediate: true });
              readyUI();
            },
            { once: true }
          );
          mP = new tmg.Player({
            cloneOnDetach: true,
            playlist,
            "lightState.disabled": !!restored,
            "media.artist": "TMG Video Player",
            "media.profile": "assets/icons/tmg-icon.jpeg",
            "media.links.artist": "https://tmg-video-player.vercel.app",
            "media.links.profile": "https://tobi007-del.github.io/TMG_MEDIA_PROTOTYPE",
            "settings.captions.font.size.value": 200,
            "settings.captions.font.weight.value": 700,
            "settings.captions.background.opacity.value": 0,
            "settings.captions.characterEdgeStyle.value": "drop-shadow",
            "settings.overlay.behavior": "auto",
          });
          mP.configure({ settings: (restored ?? Memory.getState())?.settings ?? {} }); // recursive mixing in
          mP.attach(video);
          window.addEventListener("pagehide", saveSession);
          document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveSession());
          video.addEventListener("loadedmetadata", () => dispatchPlayerReadyToast(), { once: true });
          video.ontimeupdate = ({ target: { currentTime: ct, duration: d } }) => mP.Controller?.throttle("TVP_thumbnail_update", () => ct > 3 && containers[mP.Controller?.currentPlaylistIndex]?.style.setProperty("--video-progress-position", tmg.safeNum(ct / d)), 2000);
          video.onplay = () => {
            fileList.querySelectorAll(".content-line").forEach((li, i) => li.classList.toggle("playing", i === mP.Controller?.currentPlaylistIndex));
            containers[mP.Controller?.currentPlaylistIndex]?.classList.remove("paused");
          };
          video.onpause = () => containers[mP.Controller?.currentPlaylistIndex]?.classList.add("paused");
        } else mP.Controller.config.playlist = [...mP.Controller.config.playlist, ...playlist];
      };
      numOfFiles && deployVideos(files, files.map(URL.createObjectURL));
      numOfFiles && (async () => await Promise.all(playlist.map(async (_, i) => await deployCaption(files[i], thumbnails[i], undefined, stateMap.get(tmg.noExtension(files[i].name))))))();
    }
    if (numOfFiles < 1) defaultUI();
  } catch (error) {
    console.error(error);
    errorUI(error);
  }
}

async function deployCaption(file, thumbnail, autocancel = tmg.queryMediaMobile(), restored) {
  let item = restored,
    track = item?.tracks?.[0];
  const id = track?.id ?? thumbnail.dataset.captionId ?? tmg.uid(); // checking caption id since we never clear it, incase in IDB; Magic! :)
  thumbnail.setAttribute("data-caption-id", id);
  thumbnail.setAttribute("data-caption-state", track ? "loading" : "waiting");
  // 1. THE VAULT CHECK (Instant)
  const buffer = await DB.vault.subtitles.get(id);
  if (buffer) {
    console.log(`✨TVP IDB Vault Hit: Subtitles restored for ${id}`);
    track ??= { id, kind: "captions", label: "English", srclang: "en", default: true };
    track.src = URL.createObjectURL(new Blob([buffer], { type: "text/vtt" }));
    item.tracks = [track];
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
  if (res.success) await DB.vault.subtitles.put(res.vttData.buffer, id);
  if (!res.cancelled) thumbnail.setAttribute("data-caption-state", res.success ? "filled" : "empty");
  if (!(item = thumbnail.getPlItem()) || !res.success) return;
  item.tracks = [res.track];
  if (mP.Controller?.config.playlist[mP.Controller.currentPlaylistIndex].media.id === item.media.id) mP.Controller.config.tracks = item.tracks;
}
async function extractCaptions(file, id) {
  const outputName = `cue${id}.vtt`,
    inputName = `video${id}${file.name.slice(file.name.lastIndexOf("."))}`;
  try {
    console.log(`🎥 TVP FFmpeg Processing file: '${file.name}'`);
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    ffmpeg.FS("writeFile", inputName, await fetchFile(file));
    console.log("🛠 Extracting first subtitle stream to .vtt...");
    await ffmpeg.run("-i", inputName, "-map", "0:s:0", "-f", "webvtt", outputName);
    const vttData = ffmpeg.FS("readFile", outputName);
    console.log("✅ First subtitle stream extracted successfully.");
    return { success: true, vttData, track: { id, kind: "captions", label: "English", srclang: "en", src: URL.createObjectURL(new Blob([vttData.buffer], { type: "text/vtt" })), default: true } };
  } catch (err) {
    console.error("❌ VTT stream extraction failed:", err);
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

async function getDroppedFiles(e, preTask) {
  e.preventDefault();
  const dtItems = [...(e.dataTransfer.items || [])];
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
async function getDroppedHandles(e) {
  const items = [...(e.dataTransfer.items || [])],
    handlePromises = items.map((item) => (item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null));
  return await Promise.all(handlePromises.filter(Boolean));
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

function setColors(brand = "rgb(226, 110, 2)", theme = "white") {
  brand && document.documentElement.style.setProperty("--T_M_G-brand-color", brand);
  theme && document.documentElement.style.setProperty("--T_M_G-theme-color", theme);
}
function syncPlaylist() {
  const map = Object.fromEntries(mP.Controller.config.playlist.map((v) => [v.media.id, v]));
  mP.Controller.config.playlist = Array.from(fileList.querySelectorAll(".content-line"), (li) => map[li.querySelector("video")?.mediaId]).filter(Boolean);
}
function dispatchPlayerReadyToast(hour = new Date().getHours()) {
  const timeLines = readyLines[hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night"] || [],
    combined = [...timeLines, ...readyLines.default, ...timeLines],
    { body, icon } = combined[Math.floor(Math.random() * combined.length)];
  readyTId = Toast(body, { vibrate: true, icon });
}

function smartFlatSort(files) {
  // Extracts the main series title + optional season
  function getTitlePrefix(name) {
    const match = name.match(/(.*?)(s\d{1,2})(e\d{1,2})?/i);
    if (match) {
      return (
        match[1]
          .replace(/[^a-z0-9]+/gi, " ")
          .trim()
          .toLowerCase() +
        " " +
        match[2].toLowerCase()
      );
    }
    return name
      .replace(/(episode\s?\d+|ep\s?\d+|e\d+|part\s?\d+)/gi, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();
  }
  function romanToInt(roman) {
    // Map of Roman numeral characters to their integer values
    const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const valid = /^[IVXLCDM]+$/i.test(roman);
    if (!valid) return 0; // ← Invalid input
    return roman
      .toUpperCase() // Ensure consistent uppercase (e.g., 'iv' becomes 'IV')
      .split("") // Turn into array of characters: 'XIV' → ['X','I','V']
      .reduce((acc, val, i, arr) => {
        const curr = ROMAN[val] || 0; // Current character's value
        const next = ROMAN[arr[i + 1]] || 0; // Look ahead to the next character (if any)
        // Subtractive notation: if current is less than next (e.g., I before V → 4); Otherwise, just add normally
        return acc + (curr < next ? -curr : curr);
      }, 0); // Start accumulator at 0
  }
  // Extract episode key: season, episode number(s), or special flags
  function extractEpisodeKey(name) {
    name = name.toLowerCase(); // Normalize the name to lowercase for consistent matching
    // Match formats like "S02E05-E06" (multi-episode, we only care about the first one)
    const multiEp = name.match(/s(\d{1,2})e(\d{1,2})[-_. ]?e?(\d{1,2})/);
    if (multiEp) return [parseInt(multiEp[1]), parseInt(multiEp[2])];
    // Match standard format like "S01E01", "s5e3"
    const standard = name.match(/s(\d{1,2})e(\d{1,2})/);
    if (standard) return [parseInt(standard[1]), parseInt(standard[2])];
    // Match "1x01", "5x12" — alternate style used by some encoders or fansubs
    const alt = name.match(/(\d{1,2})x(\d{1,2})/);
    if (alt) return [parseInt(alt[1]), parseInt(alt[2])];
    // Match special episodes in format "S00E05"
    const special = name.match(/s00e(\d{1,2})/);
    if (special) return [0, parseInt(special[1])]; // Special episodes get season 0
    // Match lazy formats like "S02 - Episode 3", "S3 ep4", "S5E 7" (not strict SxxEyy)
    const looseCombo = name.match(/s(\d{1,2}).*?(?:ep|e|episode)[\s\-]?(\d{1,3})/);
    if (looseCombo) return [parseInt(looseCombo[1]), parseInt(looseCombo[2])];
    // Match Roman numerals like "Season IV Episode IX"
    const roman = name.match(/season\s+([ivxlcdm]+).*?(?:ep|e|episode)?\s*([ivxlcdm]+)/i);
    if (roman) return [romanToInt(roman[1]), romanToInt(roman[2])];
    // Match fallback single-episode formats like "Ep12", "Episode 5", "E7" without season info
    const loose = name.match(/(?:ep|episode|e)(\d{1,3})/);
    if (loose) return [999, parseInt(loose[1])]; // Put these at the end with fake season 999
    // Totally unmatchable junk (e.g. "Behind the Scenes", "Bonus Feature")
    return [Infinity, Infinity]; // Hard fallback — gets sorted dead last
  }
  function sortByEpisode(a, b) {
    const ak = extractEpisodeKey(a.name);
    const bk = extractEpisodeKey(b.name);
    if (ak[0] !== bk[0]) return ak[0] - bk[0]; // season
    return ak[1] - bk[1]; // episode
  }
  const groups = new Map();
  for (const file of files) {
    const key = getTitlePrefix(file.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const sortedFiles = [];
  for (const [, group] of sortedGroups) {
    group.sort(sortByEpisode);
    sortedFiles.push(...group);
  }
  return sortedFiles;
}
