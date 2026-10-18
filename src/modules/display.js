import toast from "@t007/toast";
import * as tmg from "tmg-media-player/super";
import { playerContainer, fileList, contentLines, nums } from "./consts";

export function defaultUI() {
  if (MC?.config.playlist.content?.length || nums.files) return;
  playerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">No videos currently selected :&lpar;</p>`;
}

export function initUI() {
  if (MC?.config.playlist.content?.length || nums.files) return;
  playerContainer.classList.add("loading");
  video.classList.add("stall");
  document.body.classList.remove("light");
  fileList.innerHTML = "";
}

export function readyUI() {
  video.classList.remove("stall"), MC.media.pseudoElement.classList.remove("stall");
  playerContainer.classList.remove("loading");
  MC.config.on("settings.css.brandColor", ({ value }) => setColors(value, false), { init: "auto" });
  MC.config.on("settings.css.themeColor", ({ value }) => setColors(false, value), { init: "auto" });
}

export function errorUI(error) {
  playerContainer.classList.remove("loading");
  video.classList.add("stall");
  document.body.classList.add("light");
  fileList.innerHTML = `<p id="no-files-text">${error}!</p>`;
}

export function dispatchPlayerReadyToast(hour = new Date().getHours()) {
  if (!nums.files) return;
  const timeLines = readyLines[hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night"] || [],
    combined = [...timeLines, ...readyLines.default, ...timeLines],
    { body, icon } = combined[Math.floor(Math.random() * combined.length)];
  toast(body, { id: "ready", vibrate: true, icon, image: "assets/images/lone-tree.jpg" });
}

export const readyLines = {
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
    { icon: "✅", body: "Scene Loaded, Ready to Play." },
    { icon: "✨", body: "Showtime Unlocked." },
    { icon: "🎉", body: "Player Ready, Let the Magic Begin!" },
    { icon: "📽️", body: "The Reel is Spinning..." },
    { icon: "🎥", body: "Scene One, Take One; Playback Engaged." },
    { icon: "🍿", body: "Popcorn Ready? Your Movie Is." },
    { icon: "🎭", body: "Curtains Up. Prepare to Be Amazed." },
  ],
};

export const teachColorBasics = tmg.utils.limited(
  (_id) => {
    if (MC?.config.settings.css.syncWithMedia.brandColor) _id = MC.plug("settings.toasts").toast("Visit more settings to change your video's brand color", { icon: "🎨", autoClose: 15000, hideProgressBar: false, actions: { Open: () => (toast.dismiss(_id), MC.plug("settings.panel").toggleMore()) } });
  },
  { key: "teach_brandColor", maxTimes: 6, perSession: 2 }
);

export function playlistSort(files, playlist) {
  return Array.from(playlist.content || [], (item) => files.find((f) => f.name.startsWith(item.media.settings.metadata.title))).filter(Boolean);
}
