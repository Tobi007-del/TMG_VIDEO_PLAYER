import Toast from "/T007_TOOLS/T007_toast_library/T007_toast.js"

(async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register('TVP_sw.js').catch(error => console.log('Service Worker Registration failed with ' + error))
  } else console.error("Service workers are not supported")
})()

let installPrompt = null;
const installButton = document.querySelector("#install");
installButton.style.display = "none";

window.addEventListener("beforeinstallprompt", (event) => {
  installPrompt = event;
  installButton.style.display = "flex"
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) {
    return;
  }
  const result = await installPrompt.prompt();
  console.log(`Install prompt was: ${result.outcome}`);
  if (result.outcome === "accepted") installButton.style.display = "none"
  installPrompt = null;
});

window.addEventListener("appinstalled", () => {
  console.log("TVP installed!");
  installButton.style.display = "none";
});

const videoWorker = window.Worker ? new Worker('TVP_worker.js') : null,
videoPlayerContainer = document.getElementById("video-player-container"),
uploadInput = document.getElementById("file-input"),
fileList = document.getElementById("file-list"),
dropBox = document.getElementById("drop-box"),
clearBtn = document.getElementById("clear-button"),
mediaList = document.getElementById("file-list"),
readyLines = {
  morning: [
    `🌅&nbsp;&nbsp;A new day, a new story begins.`,
    `☕&nbsp;&nbsp;Morning loaded. Your video is hot and fresh.`,
    `🌤️&nbsp;&nbsp;Rise and stream`,
  ],
  afternoon: [
    `🌞&nbsp;&nbsp;Midday grind meets epic rewind.`,
    `🥪&nbsp;&nbsp;Lunch break? Cue the film.`,
    `🕶️&nbsp;&nbsp;Cool visuals for the warm sun`,
  ],
  evening: [
    `🌇&nbsp;&nbsp;Golden hour, golden content.`,
    `📺&nbsp;&nbsp;Relax mode: ON.`,
    `🍝&nbsp;&nbsp;Dinner and a digital show`,
  ],
  night: [
    `🌙&nbsp;&nbsp;Midnight premiere loaded.`,
    `🛌&nbsp;&nbsp;Last one before bed... maybe.`,
    `💤&nbsp;&nbsp;Sweet streams are made of this`,
  ],
  default: [
    `🎬&nbsp;&nbsp;Lights, Camera, Action!`,
    `✅&nbsp;&nbsp;Scene Loaded — Ready to Play.`,
    `✨&nbsp;&nbsp;Showtime Unlocked.`,
    `🎉&nbsp;&nbsp;Player Ready – Let the Magic Begin!`,
    `🎬&nbsp;&nbsp;Lights, Camera, Action!`,
    `📽️&nbsp;&nbsp;The Reel is Spinning...`,
    `🎥&nbsp;&nbsp;Scene One, Take One — Playback Engaged.`,
    `🍿&nbsp;&nbsp;Popcorn Ready? Your Movie Is.`,
    `🎭&nbsp;&nbsp;Curtains Up. Prepare to Be Amazed.`,
  ]
},
LINE_HEIGHT = 80,
SCROLL_MARGIN = 80 // px from top/bottom to trigger scroll

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


function emptyUI() {
  if (numberOfFiles < 1) {
    videoPlayerContainer.classList.remove("loading")
    video.classList.add("stall")
    document.body.classList.add("light")
    fileList.innerHTML = `<p id="no-files-text">No videos currently selected!</p>`
  }
}

function initUI() {
  if (numberOfFiles < 1) {
    videoPlayerContainer.classList.add("loading")
    video.classList.add("stall")
    document.body.classList.remove("light")
    fileList.innerHTML = ""
  }
}

function readyUI() {
  video.classList.remove("stall")
  videoPlayerContainer.classList.remove("loading")
}

function errorUI(error) {
  videoPlayerContainer.classList.remove("loading")
  video.classList.add("stall")
  document.body.classList.add("light")
  fileList.innerHTML = `<p id="no-files-text">${error}!</p>`
}

function updateUI() {
  document.getElementById("total-num").textContent = numberOfFiles
  document.getElementById("total-size").textContent = formatBytes(numberOfBytes)
  document.getElementById("total-time").textContent = window.tmg.formatTime(totalTime)
}

function clearFiles() {
  document.querySelectorAll(".thumbnail-container").forEach(container => container.style.setProperty("--video-progress-position", 0))
  numberOfBytes = numberOfFiles = totalTime = 0
  video.removeAttribute("src")
  video.onplay = video.onpause = video.ontimeupdate = null
  videoPlayer?.detach()
  videoPlayer = null
  video = document.getElementById("video")
  document.querySelectorAll(".thumbnail")?.forEach(video => URL.revokeObjectURL(video.src))
  emptyUI()
}

uploadInput.addEventListener("click", () => setTimeout(initUI, 1000))
uploadInput.addEventListener("cancel", handleFileCancel)
uploadInput.addEventListener("change", handleFileInput)
dropBox.addEventListener("dragenter", handleDragEnter)
dropBox.addEventListener("dragover", handleDragOver)
dropBox.addEventListener("dragleave", handleDragLeave)
dropBox.addEventListener("drop", handleDrop)
clearBtn.addEventListener("click", clearFiles)

function handleFiles(files) {
try {
if (files?.length > 0) {
  initUI() 
  // providing some available metrics to the user 
  for (const file of files) {
    numberOfBytes += file.size
    numberOfFiles++
  }
  updateUI();
  //building the media list
  const list = document.getElementById("media-list") || document.createElement("ul")
  list.id = "media-list"
  fileList.appendChild(list)
  const thumbnails = []
  let playlist = []
  for (let i = 0; i < files.length; i++) {
    const li = document.createElement("li")
    li.classList.add("content-line")
    li.dataset.fileName = files[i].name
    list.appendChild(li)
    const thumbnailContainer = document.createElement("span")
    thumbnailContainer.classList.add("thumbnail-container")
    thumbnailContainer.onclick = () => videoPlayer.Player.movePlaylistTo(videoPlayer.Player.playlist.findIndex(vid => vid.src === thumbnailContainer.querySelector("video").src))
    li.appendChild(thumbnailContainer)
    const playbtn = document.createElement("button")
    playbtn.innerHTML = 
    `
    <svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25">
      <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
    </svg>         
    <svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" width="3" height="10" fill="white"></rect>
      <rect x="10" width="3" height="10" fill="white"></rect>
      <rect x="16" width="3" height="10" fill="white"></rect>
    </svg>
    `
    thumbnailContainer.appendChild(playbtn)
    const thumbnail = document.createElement("video")
    thumbnails.push(thumbnail)
    thumbnail.classList.add("thumbnail")
    thumbnailContainer.appendChild(thumbnail)
    const span = document.createElement("span")
    span.classList.add("file-info-wrapper")
    const size = files[i].size
    span.innerHTML = 
    `
      <p class="file-name"><span>Name: </span><span>${files[i].name}</span></p>
      <p class="file-size"><span>Size: </span><span>${formatBytes(size)}</span></p>
      <p class="file-duration"><span>Duration: </span><span>Initializing...</span></p>
    `
    li.appendChild(span)
    const dragHandle = document.createElement("span");
    dragHandle.className = "drag-handle";
    dragHandle.innerHTML = 
    `
    <svg fill="#000000" height="20px" width="20px" version="1.1" id="XMLID_308_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" xml:space="preserve">
      <path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/>
    </svg>
    `;
    dragHandle.title = "Drag to reorder";
    li.appendChild(dragHandle);
    let clientY = 0,
    initialScrollY = 0,
    maxOffset = 0,
    lastTime = performance.now()
    dragHandle.addEventListener('pointerdown', e => {
      navigator.vibrate?.([50]);
      dragItem = li;
      const rect = li.getBoundingClientRect();
      // Calculate the pointer offset
      offsetY = list.getBoundingClientRect().top;
      startY = rect.top - offsetY;
      // Clone transparent placeholder
      placeholderItem = document.createElement('div');
      placeholderItem.className = 'drag-placeholder';
      placeholderItem.style.height = `${rect.height}px`;
      placeholderItem.style.width = `${rect.width}px`;
      li.parentNode.insertBefore(placeholderItem, li.nextSibling);
      // Style dragged line
      li.classList.add('dragging');
      li.style.position = 'absolute';
      li.style.top = `${startY}px`;
      li.style.zIndex = '999';
      li.style.touchAction = 'none';
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      const listRect = list.getBoundingClientRect()
      offsetY = listRect.top;
      maxOffset = listRect.height;
      initialScrollY = window.scrollY
      startDragLoop()
    });
    function startDragLoop() {
      function update() {
        const now = performance.now(),
        delta = now - lastTime
        lastTime = now
        SCROLL_SPEED = ((LINES_PER_SEC * LINE_HEIGHT) * delta) / 1000
        if (!dragItem) return
        const scrollY = window.scrollY - initialScrollY
        dragPosY = window.tmg.clamp(0, scrollY + clientY - offsetY - dragItem.offsetHeight/2, maxOffset - dragItem.offsetHeight)
        dragItem.style.top = `${dragPosY}px`;
        if (dragPosY > 0 && dragPosY < (maxOffset - dragItem.offsetHeight)) {
          // if (autoScrollAccId === null) autoScrollAccId = setTimeout(() => LINES_PER_SEC += 1, 3000)
          // else if(LINES_PER_SEC > 3) LINES_PER_SEC = Math.max(++LINES_PER_SEC, 6)
          autoScroll(clientY);
        } 
        // else {
        //   clearTimeout(autoScrollAccId)
        //   autoScrollAccId = null
        //   LINES_PER_SEC = 3
        // }
        recomputeList()
        autoScrollId = requestAnimationFrame(update)
      }
      autoScrollId = requestAnimationFrame(update)
    }
    function onPointerMove(e) {
      clientY = e.clientY
    }
    function recomputeList() {
      const children = Array.from(list.querySelectorAll('.content-line:not(.dragging)'))
      const afterLine = children.reduce((closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = clientY - box.top - (box.height/2)
        if (offset < 0 && offset > closest.offset) return {offset: offset, element: child}
        else return closest
      }, {offset: Number.NEGATIVE_INFINITY}).element
      if (afterLine) list.insertBefore(placeholderItem, afterLine)
      else list.appendChild(placeholderItem)
    }
    function onPointerUp() {
      navigator.vibrate?.([50]);
      autoScrollId && cancelAnimationFrame(autoScrollId);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp)
      placeholderItem.parentNode.insertBefore(dragItem, placeholderItem);
      dragItem.classList.remove('dragging');
      dragItem.style = ''; // remove inline styles
      placeholderItem.remove();
      dragItem = null;
      placeholderItem = null;
      rebuildPlaylistFromUI();
    }  
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = 
    `
    <svg width="20px" height="20px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="#0D0D0D"/>
    </svg>
    `;
    deleteBtn.title = "Remove video";
    li.appendChild(deleteBtn);
    // Delete button handler
    deleteBtn.addEventListener("click", e => {
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
      numberOfBytes -= size
      totalTime = getTotalTimeFromUI();
      updateUI()
    });        
  }
  const deployVideos = objectURLs => {
    objectURLs.forEach((url, n) => {
      playlist.push({
        src : url, 
        media : {
          title: files[n].name,
          artist: "TMG Video Player",
        },
        settings : {
          previewImages: true
        }
      })
      thumbnails[n].onloadedmetadata = ({target}) => {
        totalTime += target.duration
        target.currentTime = 2
        document.getElementById("total-time").textContent = window.tmg.formatTime(totalTime)
        target.closest(".content-line").querySelector(".file-duration span:last-child").innerHTML = `${window.tmg.formatTime(target.duration)}`
      }
      thumbnails[n].src = url
    })
    if (!videoPlayer) {
      const containers = document.getElementsByClassName("thumbnail-container")
      video.addEventListener("tmgready", readyUI, {once:true})
      videoPlayer = new tmg.Player({playlist: playlist})
      videoPlayer.build.playlist[0].settings.startTime = 2
      videoPlayer.attach(video)
      video.addEventListener("loadedmetadata", dispatchPlayerReadyToast, {once:true})
      video.ontimeupdate = () => {
        if (video.currentTime > 3) containers[videoPlayer.Player?.currentPlaylistIndex]?.style.setProperty("--video-progress-position", video.currentTime/video.duration)
      }
      video.onplay = () => {
        highlightCurrentPlaying(videoPlayer.Player.currentPlaylistIndex);
        containers[videoPlayer.Player?.currentPlaylistIndex]?.classList.remove("paused")
      }
      video.onpause = () => {
        containers[videoPlayer.Player?.currentPlaylistIndex]?.classList.add("paused")
      }
    } else videoPlayer.Player.playlist = videoPlayer.Player.playlist ? [...videoPlayer.Player.playlist, ...playlist] : playlist         
  }   
  if (window.Worker) {
    videoWorker.onmessage = ({ data: objectURLs }) => deployVideos(objectURLs)
    videoWorker.postMessage(files)
  } else {
    const objectURLs = files.map(file => URL.createObjectURL(file))
    deployVideos(objectURLs)
  }
} else if (numberOfFiles < 1) emptyUI()
} catch(error) {
  console.error(error)
  errorUI(error)
}
}

function handleFileCancel() {
  emptyUI()
}

function handleFileInput({target}) {
  if ([...target.files].some(file => !file.type.includes("video"))) Toast({ data: { type:"warning", body: "Only video files are supported" } })
  const files = [...target.files]?.filter(file => file.type.includes("video"))
  handleFiles(files)
}

function handleDragEnter(e) {
  e.stopPropagation()
  e.preventDefault()
  dropBox.classList.add("active")
}

function handleDragOver(e) {
  e.stopPropagation()
  e.preventDefault()
}

function handleDragLeave(e) {
  e.stopPropagation()
  e.preventDefault()
  dropBox.classList.remove("active")
}

function handleDrop(e) {
  e.stopPropagation()
  e.preventDefault() 
  const dt = e.dataTransfer
  if ([...dt.files].some(file => !file.type.includes("video"))) Toast({ data: { type:"warning", body: "You can only drop video files!" } })
  const files = [...dt.files]?.filter(file => file.type.includes("video"))
  handleFiles(files)
  dropBox.classList.remove("active")
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
  mediaList.querySelectorAll(".content-line").forEach(li => total += li.querySelector("video")?.duration);
  return total;
}

function rebuildPlaylistFromUI() {
  // Rebuild playlist array from current UI order
  const newPlaylist = [];
  mediaList.querySelectorAll(".content-line").forEach(li => {
    const src = li.querySelector("video")?.src
    newPlaylist.push(videoPlayer.Player.playlist.find(vid => vid.src === src))
  });
  
  if(videoPlayer?.Player) {
    videoPlayer.Player.playlist = newPlaylist;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1000;
  const dm = 2; // decimals
  const sizes = ["B","KB","MB","GB","TB","PB","EB","ZB","YB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
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

  Toast({ data: { body: message }, vibrate: true });
}

window.addEventListener('online', () => document.body.classList.remove("offline"))
window.addEventListener('offline', () => document.body.classList.add("offline"))

window.addEventListener("load", () => {
  if ('navigator' in window) {
    document.body.classList.toggle("offline", !navigator.onLine)
    if (navigator.onLine) {
      fetch("https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png", { method: "HEAD", cache: "no-cache" })
      .then(response => document.body.classList.toggle("offline", !response.ok))
      .catch(error => document.body.classList.add("offline"))
    }
  }
})

window.addEventListener('beforeunload', function() {  
  if (!document.activeElement) document.querySelectorAll(".thumbnail")?.forEach(video => URL.revokeObjectURL(video.src))
})  
