import Toast from "/T007_TOOLS/T007_toast_library/T007_toast.js";

(async function registerServiceWorker() {
    if ("serviceWorker" in navigator) 
        await navigator.serviceWorker.register('TVP_sw.js').catch(error => console.log('Service Worker Registration failed with ' + error))
    else console.error("Service workers are not supported")
})()

const videoPlayerContainer = document.getElementById("video-player-container"),
uploadInput = document.getElementById("file-input"),
fileList = document.getElementById("file-list"),
video = document.getElementById("video"),
dropBox = document.getElementById("drop-box");

let videoPlayer

function emptyUI() {
    if (numberOfFiles < 1) {
        videoPlayerContainer.classList.remove("loading");
        video.classList.add("stall");
        document.body.classList.add("light");
        fileList.innerHTML = `<p id="no-files-text">No videos currently selected!</p>`;
    }
}

function initUI() {
    if (numberOfFiles < 1) {
        videoPlayerContainer.classList.add("loading");
        video.classList.add("stall");
        document.body.classList.remove("light")
        fileList.innerHTML = "";
    }
}

function cleanUI() {
    video.classList.remove("stall")
    videoPlayerContainer.classList.remove("loading");
}

uploadInput.addEventListener("click", () => setTimeout(initUI, 1000));
uploadInput.addEventListener("cancel", handleFileCancel);
uploadInput.addEventListener("change", handleFileInput);
dropBox.addEventListener("dragenter", handleDragEnter);
dropBox.addEventListener("dragover", handleDragOver);
dropBox.addEventListener("dragleave", handleDragLeave);
dropBox.addEventListener("drop", handleDrop);

let numberOfBytes = 0,
numberOfFiles = 0,
totalTime = 0;

function handleFiles(files) {
if (files?.length > 0) {
    initUI()
    // Calculate total size
    for (const file of files) {
      numberOfBytes += file.size;
      numberOfFiles++;
    }

    // Approximate to the closest prefixed unit
    const units = ["B","KiB","MiB","GiB","TiB","PiB","EiB","ZiB","YiB",];
    const exponent = Math.min(Math.floor(Math.log(numberOfBytes) / Math.log(1024)),units.length - 1);
    const approx = numberOfBytes / 1e3 ** exponent;
    const output = exponent === 0 ? `${numberOfBytes} bytes` : `${approx.toFixed(3)} ${units[exponent]} (${numberOfBytes} bytes)`;

    const list = document.getElementById("media-list") || document.createElement("ul");
    list.id = "media-list"
    fileList.appendChild(list);
    let playlist = []
    for (let i = 0; i < files.length; i++) {
        const li = document.createElement("li");
        list.appendChild(li);
        const videoSrc = URL.createObjectURL(files[i]);
        playlist.push({
            src : videoSrc, 
            media : {
                title: files[i].name,
                artist: "TMG Video Player",
            },
            settings : {
                previewImages: true
            }
        });
        const thumbnailContainer = document.createElement("span");
        thumbnailContainer.classList.add("thumbnail-container");
        thumbnailContainer.onclick = () => videoPlayer.Player.movePlaylistTo(numberOfFiles - (files.length - i))
        li.appendChild(thumbnailContainer);
        const playbtn = document.createElement("button");
        playbtn.innerHTML = 
        `
            <svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25">
                <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
            </svg>            
        `
        thumbnailContainer.appendChild(playbtn);
        const video = document.createElement("video");
        video.src = videoSrc
        video.classList.add("thumbnail")
        thumbnailContainer.appendChild(video)
        const span = document.createElement("span");
        span.classList.add("file-info");
        const size = files[i].size;
        const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024), units.length - 1));
        const approx = size / 1e3 ** exponent;
        span.innerHTML = `${files[i].name} -> (${exponent === 0 ? `${size}bytes` : `${approx.toFixed(3)} ${units[exponent]}`})`;
        li.appendChild(span);
        URL.revokeObjectURL(files[i]);
        video.onloadedmetadata = function({target}) {
            totalTime += target.duration;
            target.currentTime = 2;
            document.getElementById("total-time").textContent = tmg.formatDuration(totalTime);
            span.innerHTML += `<br> Duration: ${tmg.formatDuration(video.duration)}`;
        }
    }
    if (!videoPlayer) {
        video.addEventListener("loadedmetadata", () => video.currentTime = 2, {once: true});
        video.addEventListener("canplay", cleanUI, {once: true});
        videoPlayer = new tmg.Player({playlist: playlist});
        videoPlayer.attach(video);
    } else {
        videoPlayer.Player.playlist = videoPlayer.Player.playlist ? [...videoPlayer.Player.playlist, ...playlist] : playlist;
    }
    document.getElementById("total-num").textContent = numberOfFiles;
    document.getElementById("total-size").textContent = output;
} else if (numberOfFiles < 1) emptyUI()
}

function handleFileCancel() {
    emptyUI()
}

function handleFileInput({target}) {
    if ([...target.files].some(file => !file.type.includes("video"))) new Toast({text: "Only video files are supported"})
    const files = [...target.files]?.filter(file => file.type.includes("video"))
    handleFiles(files)
}

function handleDragEnter(e) {
    e.stopPropagation();
    e.preventDefault();
    dropBox.classList.add("active");
}

function handleDragOver(e) {
    e.stopPropagation();
    e.preventDefault();
}

function handleDragLeave(e) {
    e.stopPropagation();
    e.preventDefault();
    dropBox.classList.remove("active");
}

function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault(); 
    const dt = e.dataTransfer;
    if ([...dt.files].some(file => !file.type.includes("video"))) new Toast({text: "You can only drop video files!"})
    const files = [...dt.files]?.filter(file => file.type.includes("video"))
    handleFiles(files);
    dropBox.classList.remove("active");
}

window.addEventListener('online', () => document.body.classList.remove("offline"))
window.addEventListener('offline', () => document.body.classList.add("offline"))

window.addEventListener("load", () => {
    if ('navigator' in window) {
        document.body.classList.toggle("offline", !navigator.onLine)
        if (navigator.onLine) {
            fetch("https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png", {
                method: "HEAD", 
                cache: "no-cache"
            })
            .then(response => document.body.classList.toggle("offline",!response.ok))
            .catch(error => document.body.classList.add("offline"))
        }
    }
})
