import Toast from "/T007_TOOLS/T007_toast_library/T007_toast.js";

(async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker
      .register("TVP_sw.js")
      .catch((error) =>
        console.log("Service Worker Registration failed with " + error)
      );
  } else console.error("Service workers are not supported");
})();

let installPrompt = null;
const installButton = document.querySelector("#install");
installButton.style.display = "none";

window.addEventListener("beforeinstallprompt", (event) => {
  installPrompt = event;
  installButton.style.display = "flex";
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) {
    return;
  }
  const result = await installPrompt.prompt();
  console.log(`TVP Install prompt was: ${result.outcome}`);
  if (result.outcome === "accepted") installButton.style.display = "none";
  installPrompt = null;
});

window.addEventListener("appinstalled", () => {
  console.log("TVP installed!");
  installButton.style.display = "none";
});

function isWebkitDirectorySupported() {
  const input = document.createElement("input");
  return "webkitdirectory" in input;
}

const videoWorker = window.Worker ? new Worker("TVP_worker.js") : null,
  videoPlayerContainer = document.getElementById("video-player-container"),
  uploadVideosInput = document.getElementById("videos-file-input"),
  uploadFoldersInput = document.getElementById("folders-file-input"),
  fileList = document.getElementById("file-list"),
  videosDropBox = document.getElementById("videos-drop-box"),
  foldersDropBox = document.getElementById("folders-drop-box"),
  clearBtn = document.getElementById("clear-button"),
  mediaList = document.getElementById("file-list"),
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
  videoPlayer = null,
  numberOfBytes = 0,
  numberOfFiles = 0,
  totalTime = 0,
  dragItem = null,
  dragPosY = 0,
  placeholderItem = null,
  startY = 0,
  offsetY = 0,
  autoScrollId = null,
  autoScrollAccId = null,
  LINES_PER_SEC = 3,
  SCROLL_SPEED = 0; // px per frame

if (!isWebkitDirectorySupported()) foldersDropBox.remove();

function emptyUI() {
  if (numberOfFiles < 1) {
    videoPlayerContainer.classList.remove("loading");
    video.classList.add("stall");
    document.body.classList.add("light");
    fileList.innerHTML = `<p id="no-files-text">No videos currently selected :&lpar;</p>`;
  }
}

function initUI() {
  if (numberOfFiles < 1) {
    videoPlayerContainer.classList.add("loading");
    video.classList.add("stall");
    document.body.classList.remove("light");
    fileList.innerHTML = "";
    updateUI();
  }
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
  document.getElementById("total-size").textContent =
    formatBytes(numberOfBytes);
  document.getElementById("total-time").textContent = tmg.formatTime(totalTime);
}

function clearFiles() {
  document
    .querySelectorAll(".thumbnail-container")
    .forEach((container) =>
      container.style.setProperty("--video-progress-position", 0)
    );
  numberOfBytes = numberOfFiles = totalTime = 0;
  video.removeAttribute("src");
  video.onplay = video.onpause = video.ontimeupdate = null;
  videoPlayer?.detach();
  videoPlayer = null;
  video = document.getElementById("video");
  document
    .querySelectorAll(".thumbnail")
    ?.forEach((video) => URL.revokeObjectURL(video.src));
  emptyUI();
}

uploadVideosInput.addEventListener("click", () => setTimeout(initUI, 1000));
uploadVideosInput.addEventListener("cancel", handleFileCancel);
uploadVideosInput.addEventListener("change", handleFileInput);
uploadFoldersInput.addEventListener("click", () => setTimeout(initUI, 1000));
uploadFoldersInput.addEventListener("cancel", handleFileCancel);
uploadFoldersInput.addEventListener("change", handleFileInput);
videosDropBox.addEventListener("dragenter", handleDragEnter);
videosDropBox.addEventListener("dragover", handleDragOver);
videosDropBox.addEventListener("dragleave", handleDragLeave);
videosDropBox.addEventListener("drop", handleDrop);
foldersDropBox.addEventListener("dragenter", handleDragEnter);
foldersDropBox.addEventListener("dragover", handleDragOver);
foldersDropBox.addEventListener("dragleave", handleDragLeave);
foldersDropBox.addEventListener("drop", handleDrop);
clearBtn.addEventListener("click", clearFiles);

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
    const looseCombo = name.match(
      /s(\d{1,2}).*?(?:ep|e|episode)[\s\-]?(\d{1,3})/
    );
    if (looseCombo) return [parseInt(looseCombo[1]), parseInt(looseCombo[2])];
    // Match Roman numerals like "Season IV Episode IX"
    const roman = name.match(
      /season\s+([ivxlcdm]+).*?(?:ep|e|episode)?\s*([ivxlcdm]+)/i
    );
    if (roman) return [romanToInt(roman[1]), romanToInt(roman[2])];
    // Match fallback single-episode formats like "Ep12", "Episode 5", "E7" without season info
    const loose = name.match(/(?:ep|episode|e)(\d{1,3})/);
    if (loose) return [999, parseInt(loose[1])]; // Put these at the end with fake season 999
    // Totally unmatchable junk (e.g. "Behind the Scenes", "Bonus Feature")
    return [9999, 9999]; // Hard fallback — gets sorted dead last
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
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const sortedFiles = [];
  for (const [, group] of sortedGroups) {
    group.sort(sortByEpisode);
    sortedFiles.push(...group);
  }
  return sortedFiles;
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
      const list =
        document.getElementById("media-list") || document.createElement("ul");
      list.id = "media-list";
      fileList.appendChild(list);
      const thumbnails = [];
      let playlist = [];
      for (let i = 0; i < files.length; i++) {
        const li = document.createElement("li");
        li.classList.add("content-line");
        li.dataset.fileName = files[i].name;
        list.appendChild(li);
        const thumbnailContainer = document.createElement("span");
        thumbnailContainer.classList.add("thumbnail-container");
        thumbnailContainer.onclick = () =>
          videoPlayer.Player.movePlaylistTo(
            videoPlayer.Player.playlist.findIndex(
              (vid) => vid.src === thumbnailContainer.querySelector("video").src
            )
          );
        li.appendChild(thumbnailContainer);
        const playbtn = document.createElement("button");
        playbtn.innerHTML = `
    <svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25">
      <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
    </svg>         
    <svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" width="3" height="10" fill="white"></rect>
      <rect x="10" width="3" height="10" fill="white"></rect>
      <rect x="16" width="3" height="10" fill="white"></rect>
    </svg>
    `;
        thumbnailContainer.appendChild(playbtn);
        const thumbnail = document.createElement("video");
        thumbnails.push(thumbnail);
        thumbnail.classList.add("thumbnail");
        thumbnailContainer.appendChild(thumbnail);
        const span = document.createElement("span");
        span.classList.add("file-info-wrapper");
        const size = files[i].size;
        span.innerHTML = `
      <p class="file-name"><span>Name: </span><span>${files[i].name}</span></p>
      <p class="file-size"><span>Size: </span><span>${formatBytes(
        size
      )}</span></p>
      <p class="file-duration"><span>Duration: </span><span>Initializing...</span></p>
    `;
        li.appendChild(span);
        const dragHandle = document.createElement("span");
        dragHandle.className = "drag-handle";
        dragHandle.innerHTML = `
    <svg fill="#000000" height="20px" width="20px" version="1.1" id="XMLID_308_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" xml:space="preserve">
      <path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/>
    </svg>
    `;
        dragHandle.title = "Drag to reorder";
        li.appendChild(dragHandle);
        let clientY = 0,
          initialScrollY = 0,
          maxOffset = 0,
          lastTime = performance.now();
        dragHandle.addEventListener("pointerdown", (e) => {
          navigator.vibrate?.([50]);
          dragItem = li;
          const rect = li.getBoundingClientRect();
          // Calculate the pointer offset
          offsetY = list.getBoundingClientRect().top;
          startY = rect.top - offsetY;
          // Clone transparent placeholder
          placeholderItem = document.createElement("div");
          placeholderItem.className = "drag-placeholder";
          placeholderItem.style.height = `${rect.height}px`;
          placeholderItem.style.width = `${rect.width}px`;
          li.parentNode.insertBefore(placeholderItem, li.nextSibling);
          // Style dragged line
          li.classList.add("dragging");
          li.style.position = "absolute";
          li.style.top = `${startY}px`;
          li.style.zIndex = "999";
          li.style.touchAction = "none";
          document.addEventListener("pointermove", onPointerMove);
          document.addEventListener("pointerup", onPointerUp);
          const listRect = list.getBoundingClientRect();
          offsetY = listRect.top;
          maxOffset = listRect.height;
          initialScrollY = window.scrollY;
          startDragLoop();
        });
        function startDragLoop() {
          function update() {
            const now = performance.now(),
              delta = now - lastTime;
            lastTime = now;
            SCROLL_SPEED = (LINES_PER_SEC * LINE_HEIGHT * delta) / 1000;
            if (!dragItem) return;
            const scrollY = window.scrollY - initialScrollY;
            dragPosY = tmg.clamp(
              0,
              scrollY + clientY - offsetY - dragItem.offsetHeight / 2,
              maxOffset - dragItem.offsetHeight
            );
            dragItem.style.top = `${dragPosY}px`;
            if (dragPosY > 0 && dragPosY < maxOffset - dragItem.offsetHeight) {
              // if (autoScrollAccId === null) autoScrollAccId = setTimeout(() => LINES_PER_SEC += 1, 3000)
              // else if(LINES_PER_SEC > 3) LINES_PER_SEC = Math.max(++LINES_PER_SEC, 6)
              autoScroll(clientY);
            }
            // else {
            //   clearTimeout(autoScrollAccId)
            //   autoScrollAccId = null
            //   LINES_PER_SEC = 3
            // }
            recomputeList();
            autoScrollId = requestAnimationFrame(update);
          }
          autoScrollId = requestAnimationFrame(update);
        }
        function onPointerMove(e) {
          clientY = e.clientY;
        }
        function recomputeList() {
          const children = Array.from(
            list.querySelectorAll(".content-line:not(.dragging)")
          );
          const afterLine = children.reduce(
            (closest, child) => {
              const box = child.getBoundingClientRect();
              const offset = clientY - box.top - box.height / 2;
              if (offset < 0 && offset > closest.offset)
                return { offset: offset, element: child };
              else return closest;
            },
            { offset: Number.NEGATIVE_INFINITY }
          ).element;
          if (afterLine) list.insertBefore(placeholderItem, afterLine);
          else list.appendChild(placeholderItem);
        }
        function onPointerUp() {
          navigator.vibrate?.([50]);
          autoScrollId && cancelAnimationFrame(autoScrollId);
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          placeholderItem.parentNode.insertBefore(dragItem, placeholderItem);
          dragItem.classList.remove("dragging");
          dragItem.style = ""; // remove inline styles
          placeholderItem.remove();
          dragItem = null;
          placeholderItem = null;
          rebuildPlaylistFromUI();
        }
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.innerHTML = `
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="#0D0D0D"/>
    </svg>
    `;
        deleteBtn.title = "Remove video";
        li.appendChild(deleteBtn);
        // Delete button handler
        deleteBtn.addEventListener("click", (e) => {
          const thumbnailVideo = li.querySelector("video.thumbnail");
          if (thumbnailVideo) {
            URL.revokeObjectURL(thumbnailVideo.src);
          }
          li.remove();
          // If no files left, update UI accordingly
          if (numberOfFiles <= 1) {
            return clearFiles();
          } else {
            rebuildPlaylistFromUI();
          }
          // Update counts
          numberOfFiles--;
          numberOfBytes -= size;
          totalTime = getTotalTimeFromUI();
          updateUI();
        });
      }
      const deployVideos = (objectURLs) => {
        objectURLs.forEach((url, n) => {
          playlist.push({
            src: url,
            media: {
              title: files[n].name,
              artist: "TMG Video Player",
            },
            settings: {
              previewImages: true,
            },
          });
          thumbnails[n].onloadedmetadata = ({ target }) => {
            totalTime += target.duration;
            target.currentTime = 2;
            document.getElementById("total-time").textContent =
              tmg.formatTime(totalTime);
            target
              .closest(".content-line")
              .querySelector(
                ".file-duration span:last-child"
              ).innerHTML = `${tmg.formatTime(target.duration)}`;
          };
          thumbnails[n].onerror = ({ target }) => {
            const line = target.closest(".content-line");
            line.classList.add("error");
            if (tmg.formatNumber(target.duration) > 0) return;
            line
              .querySelector(".file-duration span:last-child")
              .classList.add("failed");
            line.querySelector(".file-duration span:last-child").innerHTML =
              "Failed to Load";
          };
          thumbnails[n].src = url;
        });
        if (!videoPlayer) {
          const containers = document.getElementsByClassName(
            "thumbnail-container"
          );
          video.addEventListener("tmgready", readyUI, { once: true });
          videoPlayer = new tmg.Player({ playlist: playlist });
          videoPlayer.build.playlist[0].settings.startTime = 2;
          videoPlayer.attach(video);
          video.addEventListener("loadedmetadata", dispatchPlayerReadyToast, {
            once: true,
          });
          video.ontimeupdate = () => {
            if (video.currentTime > 3)
              containers[
                videoPlayer.Player?.currentPlaylistIndex
              ]?.style.setProperty(
                "--video-progress-position",
                video.currentTime / video.duration
              );
          };
          video.onplay = () => {
            highlightCurrentPlaying(videoPlayer.Player.currentPlaylistIndex);
            containers[
              videoPlayer.Player?.currentPlaylistIndex
            ]?.classList.remove("paused");
          };
          video.onpause = () => {
            containers[videoPlayer.Player?.currentPlaylistIndex]?.classList.add(
              "paused"
            );
          };
        } else
          videoPlayer.Player.playlist = videoPlayer.Player.playlist
            ? [...videoPlayer.Player.playlist, ...playlist]
            : playlist;
      };
      if (window.Worker) {
        videoWorker.onmessage = ({ data: objectURLs }) =>
          deployVideos(objectURLs);
        videoWorker.postMessage(files);
      } else {
        const objectURLs = files.map((file) => URL.createObjectURL(file));
        deployVideos(objectURLs);
      }
    } else if (numberOfFiles < 1) emptyUI();
  } catch (error) {
    console.error(error);
    errorUI(error);
  }
}

function handleFileCancel() {
  emptyUI();
}

function handleFileInput({ target }) {
  const allFiles = [...target.files];
  if (allFiles?.some((file) => !file.type.startsWith("video/")))
    Toast.warn("Only video files are supported");
  const videoFiles = allFiles?.filter((file) => file.type.startsWith("video/"));
  handleFiles(videoFiles);
}

function handleDragEnter(e) {
  e.stopPropagation();
  e.preventDefault();
  e.currentTarget.classList.add("active");
}

function handleDragOver(e) {
  e.stopPropagation();
  e.preventDefault();
}

function handleDragLeave(e) {
  e.stopPropagation();
  e.preventDefault();
  e.currentTarget.classList.remove("active");
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

async function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();
  const dtItems = Array.from(e.dataTransfer.items || []);
  const traverseFileTree = async (item) => {
    return new Promise((resolve) => {
      if (item.isFile) item.file(resolve, () => resolve([]));
      else if (item.isDirectory) {
        const dirReader = item.createReader();
        dirReader.readEntries(async (entries) => {
          try {
            const nestedFiles = await Promise.all(
              entries.map(traverseFileTree)
            );
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
    else if (dtItems[i].kind === "file")
      promises.push(Promise.resolve(dtItems[i].getAsFile()));
    else return Promise.resolve([]);
  }
  const flatFiles = (await Promise.all(promises)).flat().filter(Boolean);
  const videoFiles = flatFiles.filter((file) =>
    (file.type || getMimeTypeFromExtension(file.name)).startsWith("video/")
  );
  const rejectedCount = flatFiles.length - videoFiles.length;
  if (rejectedCount > 0)
    Toast.warn(
      `You dropped ${rejectedCount} unsupported file${
        rejectedCount > 1 ? "s" : ""
      }. Only video files are supported.`
    );
  if (videoFiles.length > 0) handleFiles(videoFiles);
  videosDropBox.classList.remove("active");
  foldersDropBox.classList.remove("active");
}

function highlightCurrentPlaying(index) {
  const listItems = mediaList.querySelectorAll("li");
  listItems.forEach((li, i) => {
    if (i === index) {
      li.classList.add("playing");
    } else {
      li.classList.remove("playing");
    }
  });
}

function getTotalTimeFromUI() {
  let total = 0;
  mediaList
    .querySelectorAll(".content-line")
    .forEach((li) => (total += li.querySelector("video")?.duration));
  return total;
}

function rebuildPlaylistFromUI() {
  // Rebuild playlist array from current UI order
  const newPlaylist = [];
  mediaList.querySelectorAll(".content-line").forEach((li) => {
    const src = li.querySelector("video")?.src;
    newPlaylist.push(
      videoPlayer.Player.playlist.find((vid) => vid.src === src)
    );
  });

  if (videoPlayer?.Player) {
    videoPlayer.Player.playlist = newPlaylist;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1000;
  const dm = 2; // decimals
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1
  );
  return `${(bytes / Math.pow(k, i)).toFixed(dm)} ${sizes[i]}`;
}

function autoScroll(clientY) {
  // Scroll upward
  if (clientY < SCROLL_MARGIN) {
    window.scrollBy(0, -SCROLL_SPEED);
  }
  // Scroll downward
  else if (clientY > window.innerHeight - SCROLL_MARGIN) {
    window.scrollBy(0, SCROLL_SPEED);
  }
}

function dispatchPlayerReadyToast() {
  const hour = new Date().getHours();

  // Determine time bucket
  let timeKey = "default";
  if (hour >= 5 && hour < 12) timeKey = "morning";
  else if (hour >= 12 && hour < 17) timeKey = "afternoon";
  else if (hour >= 17 && hour < 21) timeKey = "evening";
  else timeKey = "night";

  const themedLines = readyLines.default;
  const timeLines = readyLines[timeKey] || [];

  // Combine both and select a random line
  const combined = [...timeLines, ...themedLines, ...timeLines];
  const message = combined[Math.floor(Math.random() * combined.length)];

  Toast(message.body, { vibrate: true, icon: message.icon });
}

window.addEventListener("online", () =>
  document.body.classList.remove("offline")
);
window.addEventListener("offline", () =>
  document.body.classList.add("offline")
);

window.addEventListener("load", () => {
  if ("navigator" in window) {
    document.body.classList.toggle("offline", !navigator.onLine);
    if (navigator.onLine) {
      fetch(
        "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
        { method: "HEAD", cache: "no-cache" }
      )
        .then((response) =>
          document.body.classList.toggle("offline", !response.ok)
        )
        .catch((error) => document.body.classList.add("offline"));
    }
  }
});

window.addEventListener("beforeunload", function () {
  if (!document.activeElement)
    document
      .querySelectorAll(".thumbnail")
      ?.forEach((video) => URL.revokeObjectURL(video.src));
});
