import Toast from "./T007_toast.js";

(async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Toast.warn("Offline support is unavailable here");
  try {
    await navigator.serviceWorker.register("TVP_sw.js");
  } catch (error) {
    Toast.error("Offline caching failed: " + error.message);
    Toast("Don’t worry, your local videos still play fine", { vibrate: true, icon: "🎬" });
  }
})();

const { createFFmpeg, fetchFile } = FFmpeg,
  ffmpeg = createFFmpeg({ log: false, corePath: "assets/ffmpeg/ffmpeg-core.js" }),
  installButton = document.getElementById("install"),
  videoPlayerContainer = document.getElementById("video-player-container"),
  uploadVideosInput = document.getElementById("videos-file-input"),
  uploadFoldersInput = document.getElementById("folders-file-input"),
  fileList = document.getElementById("file-list"),
  videosDropBox = document.getElementById("videos-drop-box"),
  foldersDropBox = document.getElementById("folders-drop-box"),
  clearBtn = document.getElementById("clear-button"),
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
      { icon: "🎬", body: "Lights, Camera, Action!" },
      { icon: "📽️", body: "The Reel is Spinning..." },
      { icon: "🎥", body: "Scene One, Take One — Playback Engaged." },
      { icon: "🍿", body: "Popcorn Ready? Your Movie Is." },
      { icon: "🎭", body: "Curtains Up. Prepare to Be Amazed." },
    ],
  },
  LINE_HEIGHT = 80,
  SCROLL_MARGIN = 80; // px from top/bottom to trigger scroll

let video = document.getElementById("video"),
  installPrompt = null,
  mP = null, // media player
  numberOfBytes = 0,
  numberOfFiles = 0,
  totalTime = 0,
  placeholderItem = null,
  autoScrollId = null,
  autoScrollAccId = null,
  scrollSpeed = 0,
  LINES_PER_SEC = 3; // px per frame, cranks up

installButton.style.display = "none";
if (!isWebkitDirectorySupported()) foldersDropBox.remove();
if (!tmg.queryMediaMobile()) setTimeout(() => ffmpeg.load(), 2000); // let the UI breathe, don't suffocate it

window.addEventListener("load", () => {
  if ("navigator" in window) {
    document.body.classList.toggle("offline", !navigator.onLine);
    if (navigator.onLine) {
      fetch("https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png", { method: "HEAD", cache: "no-cache" })
        .then((response) => document.body.classList.toggle("offline", !response.ok))
        .catch(() => document.body.classList.add("offline"));
    }
  }
});
window.addEventListener("online", () => document.body.classList.remove("offline"));
window.addEventListener("offline", () => document.body.classList.add("offline"));
window.addEventListener("beforeinstallprompt", (event) => {
  installPrompt = event;
  installButton.style.display = "flex";
});
window.addEventListener("appinstalled", () => {
  installButton.style.display = "none";
  Toast.success("TVP was installed successfully!");
});

installButton.addEventListener("click", async () => {
  const result = await installPrompt?.prompt?.();
  if (result.outcome === "accepted") installButton.style.display = "none";
  installPrompt = null;
});
clearBtn.addEventListener("click", clearFiles);

[uploadVideosInput, uploadFoldersInput].forEach((input) => {
  input.addEventListener("click", () => setTimeout(initUI, 1000));
  input.addEventListener("cancel", defaultUI);
  input.addEventListener("change", ({ target }) => {
    const allFiles = [...target.files];
    if (allFiles?.some((file) => !file.type.startsWith("video/"))) Toast.warn("Only video files are supported");
    handleFiles(allFiles?.filter((file) => file.type.startsWith("video/")));
  });
});
[videosDropBox, foldersDropBox].forEach((dropBox) => {
  dropBox.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.currentTarget.classList.add("active");
  });
  dropBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  dropBox.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("active");
  });
  dropBox.addEventListener("drop", async function handleDrop(e) {
    e.preventDefault();
    const dtItems = [...(e.dataTransfer.items || [])];
    const traverseFileTree = async (item) => {
      return new Promise((resolve) => {
        if (item.isFile) item.file(resolve, () => resolve([]));
        else if (item.isDirectory) {
          const dirReader = item.createReader();
          dirReader.readEntries(async (entries) => {
            try {
              const nestedFiles = await Promise.all(entries.map(traverseFileTree));
              resolve(nestedFiles.flat());
            } catch {
              resolve([]);
            }
          });
        } else resolve([]);
      });
    };
    const promises = [];
    for (let i = 0; i < dtItems.length; i++) {
      const entry = dtItems[i].webkitGetAsEntry?.();
      if (entry) promises.push(traverseFileTree(entry));
      else if (dtItems[i].kind === "file") promises.push(Promise.resolve(dtItems[i].getAsFile()));
      else return Promise.resolve([]);
    }
    const flatFiles = (await Promise.all(promises)).flat().filter(Boolean);
    const videoFiles = flatFiles.filter((file) => (file.type || getMimeTypeFromExtension(file.name)).startsWith("video/"));
    const rejectedCount = flatFiles.length - videoFiles.length;
    if (rejectedCount > 0) Toast.warn(`You dropped ${rejectedCount} unsupported file${rejectedCount > 1 ? "s" : ""}. Only video files are supported.`);
    if (videoFiles.length > 0) handleFiles(videoFiles);
    videosDropBox.classList.remove("active");
    foldersDropBox.classList.remove("active");
  });
});

function defaultUI() {
  if (numberOfFiles >= 1) return;
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">No videos currently selected :&lpar;</p>`;
}

function initUI() {
  if (numberOfFiles >= 1) return;
  videoPlayerContainer.classList.add("loading");
  video.classList.add("stall");
  document.body.classList.remove("light");
  fileList.innerHTML = "";
  updateUI();
}

function readyUI() {
  video.classList.remove("stall");
  videoPlayerContainer.classList.remove("loading");
}

function errorUI(error) {
  videoPlayerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">${error}!</p>`;
}

function updateUI() {
  document.getElementById("total-num").textContent = numberOfFiles;
  document.getElementById("total-size").textContent = formatBytes(numberOfBytes);
  document.getElementById("total-time").textContent = tmg.formatTime(totalTime);
}

function clearFiles() {
  numberOfBytes = numberOfFiles = totalTime = 0;
  video.removeAttribute("src");
  video.onplay = video.onpause = video.ontimeupdate = null;
  mP?.detach();
  mP = null;
  video = document.getElementById("video");
  [...containers].forEach((c) => {
    const vid = c.querySelector("video");
    URL.revokeObjectURL(vid.src);
    cancelJob(vid.dataset.captionId);
    c.style.setProperty("--video-progress-position", 0);
  });
  defaultUI();
}

function handleFiles(files) {
  try {
    if (files?.length > 0) {
      initUI();
      files = smartFlatSort(files);
      // providing some available metrics to the user
      for (const file of files) {
        numberOfBytes += file.size;
        numberOfFiles++;
      }
      updateUI();
      //building the media list
      const list = document.getElementById("media-list") || tmg.createEl("ul", { id: "media-list" });
      const fragment = document.createDocumentFragment();
      const thumbnails = [];
      for (let i = 0; i < files.length; i++) {
        const li = tmg.createEl("li", { className: "content-line" }, { fileName: files[i].name });
        const thumbnailContainer = tmg.createEl("span", {
          className: "thumbnail-container",
          onclick: () => mP.Controller.movePlaylistTo(mP.Controller.playlist.findIndex((vid) => vid.src === thumbnailContainer.querySelector("video").src)),
        });
        li.appendChild(thumbnailContainer);
        const playbtn = tmg.createEl("button", {
          innerHTML: `
            <svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25">
              <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
            </svg>         
            <svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated">
              <rect x="4" width="3" height="10" fill="white"></rect>
              <rect x="10" width="3" height="10" fill="white"></rect>
              <rect x="16" width="3" height="10" fill="white"></rect>
            </svg>
          `,
        });
        thumbnailContainer.appendChild(playbtn);
        const thumbnail = tmg.createEl("video", {
          className: "thumbnail",
          preload: "metadata",
          muted: true,
          playsInline: true,
          onloadedmetadata: ({ target }) => {
            totalTime += tmg.parseNumber(target.duration);
            if (tmg.parseNumber(target.duration) > 12) target.currentTime = 2;
            document.getElementById("total-time").textContent = tmg.formatTime(totalTime);
            li.querySelector(".file-duration span:last-child").innerHTML = `${tmg.formatTime(target.duration)}`;
          },
          onerror: ({ target }) => {
            li.classList.add("error");
            if (tmg.parseNumber(target.duration)) return;
            li.querySelector(".file-duration span:last-child").classList.add("failed");
            li.querySelector(".file-duration span:last-child").innerHTML = "Failed to Load";
          },
        });
        thumbnails.push(thumbnail);
        thumbnailContainer.appendChild(thumbnail);
        const span = tmg.createEl("span", {
          className: "file-info-wrapper",
          innerHTML: `
          <p class="file-name"><span>Name: </span><span>${files[i].name}</span></p>
          <p class="file-size"><span>Size: </span><span>${formatBytes(files[i].size)}</span></p>
          <p class="file-duration"><span>Duration: </span><span>Initializing...</span></p>
        `,
        });
        li.appendChild(span);
        let startY, clientY, offsetY, maxOffset, initialScrollY, dragPosY, lastTime;
        const dragHandle = tmg.createEl("span", {
          title: "Drag to reorder",
          className: "drag-handle",
          innerHTML: `
            <svg fill="#000000" height="20px" width="20px" viewBox="0 0 24 24">
              <path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/>
            </svg>
          `,
        });
        dragHandle.addEventListener(
          "pointerdown",
          (e) => {
            navigator.vibrate?.([50]);
            const rect = li.getBoundingClientRect(),
              listRect = list.getBoundingClientRect();
            startY = rect.top - offsetY;
            clientY = e.clientY;
            offsetY = listRect.top;
            maxOffset = listRect.height;
            initialScrollY = window.scrollY;
            lastTime = performance.now();
            placeholderItem = tmg.createEl(
              "div",
              { className: "drag-placeholder" },
              {},
              {
                height: `${rect.height}px`,
                width: `${rect.width}px`,
              }
            );
            li.parentElement.insertBefore(placeholderItem, li.nextElementSibling);
            li.classList.add("dragging");
            li.style.cssText = `position:absolute;top:${startY}px;z-index:999;`;
            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
            document.addEventListener("pointercancel", onPointerUp);
            dragLoop();
          },
          { passive: false }
        );
        function onPointerMove(e) {
          clientY = e.clientY;
        }
        function dragLoop() {
          function update() {
            const now = performance.now();
            scrollSpeed = (LINES_PER_SEC * LINE_HEIGHT * (now - lastTime)) / 1000;
            lastTime = now;
            dragPosY = tmg.clamp(0, window.scrollY - initialScrollY + clientY - offsetY - li.offsetHeight / 2, maxOffset - li.offsetHeight);
            li.style.top = `${dragPosY}px`;
            if (dragPosY > 0 && dragPosY < maxOffset - li.offsetHeight) {
              if (clientY < SCROLL_MARGIN || clientY > window.innerHeight - SCROLL_MARGIN) {
                if (autoScrollAccId === null) autoScrollAccId = setTimeout(() => (LINES_PER_SEC += 1), 2000);
                else if (LINES_PER_SEC > 3) LINES_PER_SEC = Math.min(LINES_PER_SEC + 1, 10);
                if (clientY < SCROLL_MARGIN) window.scrollBy(0, -scrollSpeed); // Scroll upward
                else if (clientY > window.innerHeight - SCROLL_MARGIN) window.scrollBy(0, scrollSpeed); // Scroll downward
              } else {
                clearTimeout(autoScrollAccId);
                autoScrollAccId = null;
                LINES_PER_SEC = 3;
              }
            }
            recomputeList();
            autoScrollId = requestAnimationFrame(update);
          }
          autoScrollId = requestAnimationFrame(update);
        }
        function recomputeList() {
          const children = [...list.querySelectorAll(".content-line:not(.dragging)")];
          const afterLine = children.reduce(
            (closest, child) => {
              const box = child.getBoundingClientRect();
              const offset = clientY - box.top - box.height / 2;
              if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
              else return closest;
            },
            { offset: Number.NEGATIVE_INFINITY }
          ).element;
          if (afterLine) list.insertBefore(placeholderItem, afterLine);
          else list.appendChild(placeholderItem);
        }
        function onPointerUp() {
          navigator.vibrate?.([50]);
          clearTimeout(autoScrollAccId);
          cancelAnimationFrame(autoScrollId);
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          document.removeEventListener("pointercancel", onPointerUp);
          placeholderItem.parentElement.replaceChild(li, placeholderItem);
          li.classList.remove("dragging");
          li.style.cssText = ""; // remove inline styles
          placeholderItem = autoScrollId = autoScrollAccId = null;
          LINES_PER_SEC = 3;
          rebuildPlaylistFromUI();
        }
        li.appendChild(dragHandle);
        const deleteBtn = tmg.createEl("button", {
          title: "Remove video",
          className: "delete-btn",
          innerHTML: `
            <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none">
              <path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="#0D0D0D"/>
            </svg>
          `,
          onclick() {
            URL.revokeObjectURL(thumbnail.src);
            cancelJob(thumbnail.dataset.captionId);
            li.remove();
            if (numberOfFiles <= 1) return clearFiles();
            else rebuildPlaylistFromUI();
            numberOfFiles--;
            numberOfBytes -= files[i].size;
            totalTime -= tmg.parseNumber(thumbnail.duration);
            updateUI();
          },
        });
        li.appendChild(deleteBtn);
        fragment.appendChild(li);
      }
      list.appendChild(fragment);
      fileList.appendChild(list);
      const playlist = [];
      const deployVideos = (objectURLs) => {
        objectURLs.forEach((url, i) => {
          playlist.push({
            src: url,
            media: { title: files[i].name, artist: "TMG Video Player" },
            settings: { time: { previews: true } },
          });
          thumbnails[i].src = url;
        });
        if (!mP) {
          video.addEventListener("tmgready", readyUI, { once: true });
          mP = new tmg.Player({
            playlist,
            settings: {
              captions: {
                font: {
                  size: { value: 200 },
                  weight: { value: "700" },
                },
                background: {
                  opacity: { value: 0 },
                },
                characterEdgeStyle: { value: "drop-shadow" },
              },
            },
          });
          mP.build.playlist[0].settings.time.start = 2;
          mP.attach(video);
          video.addEventListener("loadedmetadata", dispatchPlayerReadyToast, { once: true });
          video.ontimeupdate = () => {
            mP.Controller.throttle(
              "progressSetting",
              () => {
                if (video.currentTime > 3) containers[mP.Controller.currentPlaylistIndex]?.style.setProperty("--video-progress-position", tmg.parseNumber(video.currentTime / video.duration));
              },
              1000
            );
          };
          video.onplay = () => {
            fileList.querySelectorAll(".content-line").forEach((li, i) => li.classList.toggle("playing", i === mP.Controller.currentPlaylistIndex));
            containers[mP.Controller.currentPlaylistIndex]?.classList.remove("paused");
          };
          video.onpause = () => containers[mP.Controller.currentPlaylistIndex]?.classList.add("paused");
        } else mP.Controller.playlist = [...mP.Controller.playlist, ...playlist];
      };
      const deployCaptions = async () => {
        await Promise.all(
          playlist.map(async (item, i) => {
            const id = `${Date.now()}_${i}`;
            thumbnails[i].setAttribute?.("data-caption-id", id);
            const res = await queueJob(() => extractCaptions(files[i], id), id);
            if (res.success && !res.cancelled && item) {
              item.tracks = [res.track];
              if (mP.Controller.playlist[mP.Controller.currentPlaylistIndex] === item) mP.Controller.tracks = item.tracks;
              return { ok: true, item };
            } else return { ok: false, error: res.error };
          })
        );
      };
      deployVideos(files.map((file) => URL.createObjectURL(file)));
      if (!tmg.queryMediaMobile()) deployCaptions();
    } else if (numberOfFiles < 1) defaultUI();
  } catch (error) {
    console.error(error);
    errorUI(error);
  }
}

const queue = [];
let queueRunning = false;

function queueJob(task, id) {
  return new Promise((resolve) => {
    queue.push({ id, cancelled: false, task, resolve });
    processQueue();
  });
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    if (job.cancelled) {
      job.resolve({ success: false, cancelled: true });
      continue;
    }
    job.resolve(await job.task());
  }
  queueRunning = false;
}

function cancelJob(id) {
  const job = queue.find((j) => j.id === id);
  if (job) job.cancelled = true;
}

async function extractCaptions(file, id) {
  try {
    console.log(`🎥 Processing file: '${file.name}'`);
    const inputName = `video${id}.mp4`;
    const outputName = `cue${id}.vtt`;
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    ffmpeg.FS("writeFile", inputName, await fetchFile(file));
    console.log("🛠 Extracting first subtitle stream to .vtt...");
    await ffmpeg.run("-i", inputName, "-map", "0:s:0", "-f", "webvtt", outputName);
    const vttData = ffmpeg.FS("readFile", outputName);
    ffmpeg.FS("unlink", inputName);
    ffmpeg.FS("unlink", outputName);
    console.log("✅ First subtitle stream extracted successfully.");
    return { success: true, track: { id, kind: "captions", label: "English", srclang: "en", src: URL.createObjectURL(new Blob([vttData.buffer], { type: "text/vtt" })), default: true } };
  } catch (err) {
    console.error("❌ Subtitle stream extraction failed:", err);
    return { success: false, error: err.toString() };
  }
}

function rebuildPlaylistFromUI() {
  const map = Object.fromEntries(mP.Controller.playlist.map((v) => [v.src, v]));
  mP.Controller.playlist = Array.from(fileList.querySelectorAll(".content-line"), (li) => map[li.querySelector("video")?.src]);
}

function dispatchPlayerReadyToast() {
  const hour = new Date().getHours();
  let timeKey = "default";
  if (hour >= 5 && hour < 12) timeKey = "morning";
  else if (hour >= 12 && hour < 17) timeKey = "afternoon";
  else if (hour >= 17 && hour < 21) timeKey = "evening";
  else timeKey = "night";
  const timeLines = readyLines[timeKey] || [];
  const combined = [...timeLines, ...readyLines.default, ...timeLines];
  const message = combined[Math.floor(Math.random() * combined.length)];
  Toast(message.body, { vibrate: true, icon: message.icon });
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
    return roman
      .toUpperCase() // Ensure consistent uppercase (e.g., 'iv' becomes 'IV')
      .split("") // Turn into array of characters: 'XIV' → ['X','I','V']
      .reduce((acc, val, i, arr) => {
        const curr = ROMAN[val] || 0; // Current character's value
        const next = ROMAN[arr[i + 1]] || 0; // Look ahead to the next character (if any)
        // Subtractive notation: if current is less than next (e.g., I before V → 4)
        // Otherwise, just add normally
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

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1e3)), units.length - 1);
  return `${(bytes / Math.pow(1e3, exponent)).toFixed(decimals).replace(/\.0+$/, "")} ${units[exponent]}`;
}

function getMimeTypeFromExtension(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const mimeTypes = {
    avi: "video/x-msvideo",
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    mov: "video/quicktime", // Apple MOV format
    flv: "video/x-flv", // Flash Video
    webm: "video/webm", // WebM format
    ogg: "video/ogg", // Ogg video format
    wmv: "video/x-ms-wmv", // Windows Media Video
    "3gp": "video/3gpp", // 3GPP Video
    mpeg: "video/mpeg", // MPEG video format
    ts: "video/mp2t", // MPEG transport stream
  };
  return mimeTypes[ext] || "application/octet-stream"; // Default to binary stream
}

function isWebkitDirectorySupported() {
  const input = tmg.createEl("input", { type: "file" });
  return "webkitdirectory" in input;
}
