import * as tmg from "tmg-media-player/super";
import { toaster } from "@t007/toast";
import { reactive } from "sia-reactor";
import { initVScrollerator } from "@t007/utils/hooks/vanilla";

// System Keys
window._lsik = "TVP_visitor_info";
window._lsvk = "TVP_settings_version";
window._lssk ||= "TVP_last_session_state";
window.SV = 12;
window.VI = JSON.parse(localStorage[_lsik] || `{"visitorId":"${crypto?.randomUUID?.() || tmg.utils.uid()}","visitCount":0}`);
window.MP = window.MC = null;
window.canSession = "launchQueue" in window || "showOpenFilePicker" in window || "showDirectoryPicker" in window || "getAsFileSystemHandle" in DataTransferItem.prototype;
window.sessionHandles = [];
window.sessionTInt = null;
window.video = document.getElementById("video");

// Reactive Metrics
export const nums = reactive({ bytes: 0, files: 0, time: 0 }),
  defaults = {
    devMode: !import.meta.env.PROD,
    "playlist.allowOverride": true,
    "light.preview.tease": true,
    "media.intent.poster": "",
    "media.settings.metadata": {
      artist: "TMG Video Player",
      profile: "assets/icons/tmg-icon.jpeg",
      links: {
        artist: "https://tmg-video-player.vercel.app",
        profile: "https://github.com/Tobi007-del/tmg-media-player",
      },
    },
    "settings.captions.font.size.value": 200,
    "settings.captions.font.weight.value": 700,
    "settings.captions.background.opacity.value": 0,
    "settings.captions.characterEdgeStyle.value": "drop-shadow",
    "settings.overlay.behavior.value": "auto",
    "settings.keys.showOverlay": false,
    "settings.controlPanel.progressBar": true,
    "settings.css.syncWithMedia.brandColor": true,
    "settings.frame.main.usePoster": false,
    "settings.persist": {
      key: _lssk,
      throttle: 2500,
      strict: true,
      beforeHydrate: (p) => (p.config && (delete p.config.playlist, delete p.config.light), p.media?.settings && delete p.media.settings.metadata, p.media?.state && delete p.media.state.paused),
    },
    "settings.persist.blacklist.media": ["state.src", "state.sources", "state.srcObject", "state.tracks", "state.poster", "state.fullscreen", "state.pictureInPicture"],
    noPlugList: [],
    safeDetach: true,
  };

export const deletedHandles = new Map();

// DOM References
export const playerContainer = document.getElementById("video-player-container"),
  fileList = document.getElementById("file-list"),
  contentLines = document.getElementsByClassName("content-line"),
  containers = document.getElementsByClassName("thumbnail-container"),
  videosDropBox = document.getElementById("videos-drop-box"),
  foldersDropBox = document.getElementById("folders-drop-box"),
  installButton = document.getElementById("install"),
  clearSettingsButton = document.getElementById("clear-settings-button");

// Async Pipeline & Motion
export const queue = new tmg.AsyncQueue(),
  scroller = initVScrollerator({ lineHeight: 80, margin: 80, car: document.body });

export const stoast = toaster({
  autoClose: false,
  closeButton: false,
  onClose: (_, user = true) => user && (clearInterval(sessionTInt), !nums.files ? stoast.info("Reload the page to be prompted again", { id: "session", icon: true, autoClose: 5000, actions: { Reload: () => location.reload() } }) : stoast.dismiss("session")),
});
