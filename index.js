const uploadInput = document.getElementById("file-input"),
fileList = document.getElementById("file-list"),
video = document.getElementById("video"),
dropBox = document.getElementById("drop-box");

let videoPlayer

uploadInput.addEventListener("change", handleFileInput);
dropBox.addEventListener("dragenter", handleDragEnter)
dropBox.addEventListener("dragover", handleDragOver)
dropBox.addEventListener("dragleave", handleDragLeave)
dropBox.addEventListener("drop", handleDrop)

let numberOfBytes = 0,
numberOfFiles = 0,
totalTime = 0;

function handleFiles(files) {
    //showing preview thumbnails of files
if (files?.length) {
    if (numberOfFiles < 1) fileList.innerHTML = "";

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

    const list = document.createElement("ul");
    fileList.appendChild(list);
    let playlist = []
    for (let i = 0; i < files.length; i++) {
        const li = document.createElement("li");
        list.appendChild(li);
        const videoSrc = URL.createObjectURL(files[i]);
        playlist.push({
            src: videoSrc, media: 
            {
                title: files[i].name,
                author: "TMG Video Player",
                artwork: [
                    {
                        src: "/TMG_MEDIA_PROTOTYPE/assets/icons/movie-tape.png"
                    }
                ]
            }
        });
        const thumbnailContainer = document.createElement("span");
        thumbnailContainer.classList.add("thumbnail-container");
        thumbnailContainer.onclick = () => videoPlayer.movePlaylistTo(numberOfFiles - (files.length - i))
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
        video.onloadeddata = function({target}) {
            totalTime += target.duration;
            target.currentTime = 2;
            document.getElementById("total-time").textContent = tmg.formatDuration(totalTime);
            span.innerHTML += `<br> Duration: ${tmg.formatDuration(video.duration)}`;
        }
    }
    if (!videoPlayer) {
        video.classList.remove("stall")
        videoPlayer = new tmg.Player({playlist: playlist})
        videoPlayer.attach(video)
    } else {
        videoPlayer.playlist = videoPlayer.playlist ? [...videoPlayer.playlist, ...playlist] : playlist;
    }
    document.getElementById("total-num").textContent = numberOfFiles;
    document.getElementById("total-size").textContent = output;
}
}

function handleFileInput({target}) {
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
    const files = [...dt.files]?.filter(file => file.type.includes("video"))
    handleFiles(files);
    dropBox.classList.remove("active");
}