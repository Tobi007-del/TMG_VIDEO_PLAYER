import toast from "@t007/toast";
import { confirm } from "@t007/dialog";
import * as tmg from "tmg-media-player/super";
import { silence } from "sia-reactor/modules";
import { setPath } from "sia-reactor/utils";
import { fileList, contentLines, containers, clearSettingsButton, nums, deletedHandles, scroller, stoast, queue, defaults } from "./consts";
import { deployTracks, deploySubs, matchSubsToThumbnails } from "./deploy";
import { getHandlesFiles } from "./handles";
import { initUI, defaultUI, readyUI, errorUI, dispatchPlayerReadyToast, teachColorBasics, playlistSort } from "./display";

export async function clearSettings(prompt = false) {
  const ok = prompt && (await confirm("Are you sure you want to clear your settings?", { title: "Clear Settings", confirmText: "Clear" }));
  if (prompt && !ok) return;
  await toast.promise(Memory.clearSettings(), { pending: "Clearing settings...", success: { render: "Settings cleared successfully", actions: false }, error: "Failed to clear settings.", id: "settings" });
  setColors(), clearSettingsButton.classList.remove("shown");
}

export async function clearFiles(skipPrompt = false) {
  const ok = skipPrompt === true || (await confirm("Are you sure you want to clear all files?", { title: "Clear Files", confirmText: "Clear" }));
  if (!ok) return;
  toast.dismiss("ready");
  if (MP) MC.media.intent.paused = true;
  video.removeAttribute("src"), video.removeAttribute("poster");
  Array.prototype.forEach.call(containers, (c) => {
    const vid = c.querySelector("video");
    if (vid.src?.startsWith("blob:")) URL.revokeObjectURL(vid.src);
    const plItem = vid.getPlItem?.();
    plItem?.media?.intent?.tracks?.forEach((t) => t.src.startsWith("blob:") && URL.revokeObjectURL(t.src));
    queue.drop(vid.dataset.trackId);
  });
  window.video = MP?.detach();
  window.MP = window.MC = null;
  video.removeAttribute("src");
  deletedHandles.clear();
  nums.files = nums.bytes = nums.time = 0;
  await toast.promise(Memory.clearSession(), { pending: "Clearing files...", success: { render: "Cleared all files from your session, Settings too?", autoClose: 5000, actions: { Clear: () => clearSettings() } }, error: "Failed to clear session files.", id: "settings" });
  defaultUI(), clearSettingsButton.classList.add("shown");
}

export async function restoreSession(session, handles = session.handles, state = !nums.files ? Memory.getState() : session.state, files = [], sureHandles = []) {
  stoast.info(`${nums.files ? "Combining your sessions" : "Restoring your session"} now`, { id: "session", icon: true, actions: false }), await tmg.utils.deepBreath();
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
      Array.isArray(file) ? files.push(...file.filter((file) => file.type.match(/^(video|audio)\//))) : files.push(file);
      sureHandles.push(handle);
      stoast.success(`Restored ${name} successfully`, { id: "session", actions: false });
      await (resp === "User not needed" ? tmg.utils.deepBreath() : tmg.utils.mockAsync(200));
    } catch (err) {
      console.error(`TVP skipped handle "${name}":`, err);
      stoast.error(`Skipped ${name}, something went wrong`, { id: "session", actions: false });
      await (err === "User denied" ? tmg.utils.deepBreath() : tmg.utils.mockAsync(800));
    }
  }
  if (sureHandles.length || state?.config.playlist.content?.some((i) => !i.media.intent.src.startsWith("blob:"))) stoast.success(`Your ${nums.files ? "sessions have been combined" : "session has been restored"} :)`, { id: "session", autoClose: true, actions: false });
  else return stoast.error(`Your ${nums.files ? "sessions were not combined" : "session was not restored"} :(`, { id: "session", actions: { Reload: () => location.reload(), Dismiss: () => stoast.dismiss("session") } });

  handleFiles(files, state, sureHandles);
}

export async function handleFiles(files, restored = null, handles = null, subFiles = []) {
  try {
    const remoteItems = restored?.config.playlist.content?.filter((item) => !item.media.intent.src.startsWith("blob:")) || [];
    if (!files?.length && !remoteItems.length && !nums.files) return defaultUI();
    initUI();

    if (handles?.length) (window.sessionHandles = [...sessionHandles, ...handles.filter((h) => !sessionHandles.some((sh) => sh.name === h.name))]), Memory.saveHandles();
    for (const file of (files = !restored ? tmg.utils.smartFlatSort(files) : playlistSort(files, restored.config.playlist))) nums.files++, (nums.bytes += file.size);
    await tmg.utils.deepBreath();

    const stateMap = new Map(restored?.config.playlist.content?.map((v) => [v.media.settings.metadata.title, v]) || []),
      list = fileList.appendChild(document.getElementById("media-list") || tmg.utils.createEl("ul", { id: "media-list" })),
      thumbnails = [];

    for (let i = 0; i < files.length; i++) {
      const ffName = tmg.utils.noExtension(files[i].name, false),
        state = stateMap.get(ffName);
      if ((restored && !state) || !!Array.prototype.find.call(containers, (c) => c.lastElementChild.ffName === ffName)) {
        nums.files--, (nums.bytes -= files[i].size);
        thumbnails.push(null);
        continue;
      }
      const item = buildListItem(files[i], state, restored);
      thumbnails.push(item.thumbnail), list.append(item.li), files.length < 50 && (await tmg.utils.breath());
    }
    for (const rItem of remoteItems) {
      if (Array.prototype.find.call(containers, (c) => c.lastElementChild.mediaId === rItem.media.settings.metadata.id)) {
        thumbnails.push(null);
        continue;
      }
      const item = buildListItem(null, rItem, restored);
      thumbnails.push(item.thumbnail), list.append(item.li), remoteItems.length < 50 && (await tmg.utils.breath());
    }

    const content = [];
    const deployVideos = async (files) => {
      for (let i = 0; i < files.length; i++) {
        if (!thumbnails[i]) continue;
        const url = URL.createObjectURL(files[i]),
          state = stateMap.get(thumbnails[i].ffName),
          item = state ?? { media: { intent: { tracks: [] }, settings: { metadata: { id: tmg.utils.uid(), title: thumbnails[i].ffName, artist: "TMG Video Player", profile: "assets/icons/tmg-icon.jpeg", links: { artist: "https://tmg-video-player.vercel.app", profile: "https://github.com/Tobi007-del/tmg-media-player" } } } }, settings: { time: { start: 0 }, controlPanel: { timeline: { previews: true } } } };
        item._renderedLi = thumbnails[i].closest("li");
        (item.media.intent.src = url), (item.media.intent.poster = ""), (item.media.intent.tracks = item.media.intent.tracks.filter((t) => !t.src.startsWith("blob:")));
        content.push(item), readyNail(thumbnails[i], item);
      }
      for (let i = 0; i < remoteItems.length; i++) {
        const thumbIdx = files.length + i;
        if (!thumbnails[thumbIdx]) continue;
        const item = remoteItems[i];
        item._renderedLi = thumbnails[thumbIdx].closest("li");
        content.push(item);
      }
      if (restored) {
        const orderMap = new Map(restored.config.playlist.content.map((v, i) => [v.media.settings.metadata.id, i]));
        content.sort((a, b) => (orderMap.get(a.media.settings.metadata.id) ?? Infinity) - (orderMap.get(b.media.settings.metadata.id) ?? Infinity));
      }
      if (!MC) {
        const setUpList = (renderList) => {
          MC.config.on("playlist.content", ({ currentTarget: { value } }) => {
            if (!value || !document.getElementById("media-list")) return;
            for (let i = (nums.time = 0); i < value.length; i++) value[i].media.settings.metadata.id || setPath(value[i], "media.settings.metadata.id", tmg.utils.uid()), (nums.time += tmg.utils.safeNum(value[i].media.status.duration));
            (renderList ??= tmg.utils.createListRenderer({
              container: list,
              getKey: (item) => item.media.settings.metadata.id,
              createNode: (item) => {
                let li = item._renderedLi;
                if (li) return delete item._renderedLi, li;
                const stashed = deletedHandles.get(item.media.settings.metadata.id);
                if (stashed) stashed.handle && (sessionHandles.push(stashed.handle), Memory.saveHandles()), stashed.file && (nums.files++, (nums.bytes += stashed.file.size)), deletedHandles.delete(item.media.settings.metadata.id);
                const { li: resLi, thumbnail } = buildListItem(stashed?.file || null, item);
                return stashed?.file && readyNail(thumbnail, item), deployTracks(stashed?.file || item.media.intent.src, (thumbnails.push(thumbnail), thumbnail), undefined, item), resLi;
              },
              updateNode: (li, item, index) => {
                li.classList.toggle("playing", MC.config.light.disabled && index === MC.media.state.currentItem);
                li.querySelector("video").poster = item.media.intent.poster;
                li.querySelector(".file-name span:last-child").innerHTML = item.media.settings.metadata.title || "<i>Unknown</i>";
                if (item.media.status.duration) li.querySelector(".file-duration span:last-child").textContent = item.media.status.isLive ? "LIVE" : tmg.utils.formatMediaTime({ time: item.media.status.duration });
              },
              initNode: (li, register) => li.querySelector("video")?.mediaId && register(li.querySelector("video").mediaId),
              destroyNode: (li) => {
                const id = li.querySelector("video")?.mediaId,
                  idx = thumbnails.findIndex((t) => t?.mediaId === id);
                idx !== -1 && thumbnails.splice(idx, 1), !MC.config.playlist.content.some((item) => item.media.settings.metadata.id === id) && li.cleanUpDB?.(true);
              },
            }))(value);
          });
        };
        video.addEventListener(
          "tmginit",
          () => {
            const mc = (MC = MP.ctlr);
            mc.media.once("status.loadedMetadata", () => (setTimeout(dispatchPlayerReadyToast, 500), setTimeout(teachColorBasics, 3000)));
            mc.media.on("state.currentTime", ({ value }) => value > 3 && mc.config.light.disabled && containers[mc.media.state.currentItem]?.style.setProperty("--video-progress-position", tmg.utils.getMediaProgress(mc.media)));
            mc.media.on("state.paused", ({ value }) => containers[mc.media.state.currentItem]?.classList.toggle("paused", value));
            mc.media.on("state.currentItem", ({ value }) => mc.config.light.disabled && Array.prototype.forEach.call(contentLines, (line, i) => line.classList.toggle("playing", i === value)));
            readyUI(), setUpList();
          },
          { once: true }
        );
        const newMP = new tmg.Player({ ...defaults, "light.disabled": restored?.config.light.disabled ?? false, "playlist.content": content, "media.intent.src": restored ? content.find((item) => item.media.settings.metadata.id === restored.media.settings.metadata.id)?.media.intent.src : undefined, "media.intent.paused": restored?.media.state.paused ?? true });
        (window.MP = newMP), (window.MC = newMP.ctlr), newMP.attach(video);
      } else MC.config.playlist.content = [...(MC.config.playlist.content || []), ...content];
    };
    if (nums.files || remoteItems.length) {
      deployVideos(files), await tmg.utils.deepBreath();
      const subMap = subFiles.length ? (files.length === 1 ? new Map([[thumbnails[0], subFiles]]) : matchSubsToThumbnails(subFiles, thumbnails)) : null;
      await Promise.all(thumbnails.map(async (t, i, _, m = subMap?.get(t)) => t && (m?.length ? await deploySubs(m, t) : await deployTracks(i < files.length ? files[i] : t.getPlItem()?.media.intent.src, t, undefined))));
    }
    if (!nums.files && !MC?.config.playlist.content?.length) return defaultUI();
  } catch (error) {
    console.error("TVP files handling failed:", error), errorUI(error);
  }
}

export const readyNail = (thumbnail, item) => {
  (thumbnail.src = item.media.intent.src), (thumbnail.poster = item.media.intent.poster), (thumbnail.mediaId = item.media.settings.metadata.id);
  thumbnail.getPlItem = (plItem = MC?.config.playlist.content.find((v) => v.media.settings.metadata.id === item.media.settings.metadata.id)) => (thumbnail.plItem = plItem ?? thumbnail.plItem ?? item);
  thumbnail.getPlIndex = () => MC?.config.playlist.content.findIndex((v) => v.media.settings.metadata.id === item.media.settings.metadata.id);
};

export const buildListItem = (file, item, restored = false) => {
  const ffName = file ? tmg.utils.noExtension(file.name, false) : item?.media.settings.metadata.title,
    li = tmg.utils.createEl("li", { className: "content-line" }, { fileName: file ? file.name : item?.media.settings.metadata.title || "" });
  const thumbnail = tmg.utils.createEl(
    "video",
    {
      className: "thumbnail",
      preload: "metadata",
      muted: true,
      playsInline: true,
      onloadedmetadata: ({ target }, item = thumbnail.getPlItem() ?? item) => {
        target.currentTime = tmg.utils.parseIfPercent(MC?.config.light.preview.max ?? 4, target.duration, 0.25);
        if (item) silence(() => (item.media.status.duration = target.duration)), (restored || !file) && thumbnail.parentElement.style.setProperty("--video-progress-position", item.media.status.isLive ? 1 : tmg.utils.safeNum(item.settings.time.start / target.duration));
      },
      onerror: ({ target }) => {
        file && li.classList.add("error");
        if (!file || tmg.utils.safeNum(target.duration)) return;
        li.querySelector(".file-duration span:last-child").classList.add("failed");
        li.querySelector(".file-duration span:last-child").innerHTML = "Failed to Load";
      },
    },
    { captionState: "waiting" }
  );
  thumbnail.ffName = ffName;
  if (!file) readyNail(thumbnail, item);
  const thumbnailContainer = tmg.utils.createEl("span", { className: "thumbnail-container paused", innerHTML: `<button><svg class="play-icon" preserveAspectRatio="xMidYMid meet" viewBox="0 0 25 25"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg class="playing-icon" width="24" height="24" viewBox="0 0 24 24" class="bars-animated"><rect x="4" width="3" height="10" fill="white"></rect><rect x="10" width="3" height="10" fill="white"></rect><rect x="16" width="3" height="10" fill="white"></rect></svg></button>`, onclick: () => MC.plug("playlist").moveTo(thumbnail.getPlIndex()) }).appendChild(thumbnail).parentElement;
  tmg.utils.isDef(item?.media.status.duration) && thumbnailContainer.style.setProperty("--video-progress-position", item.media.status.isLive ? 1 : tmg.utils.safeNum(item.settings.time.start / item.media.status.duration));
  const captionsInput = tmg.utils.createEl("input", {
    type: "file",
    accept: ".srt, .vtt",
    multiple: true,
    onchange: async (e) => {
      const files = Array.from(e.target.files).filter((f) => /\.(srt|vtt)$/i.test(f.name));
      if (!files.length) return (thumbnail.dataset.captionState = "empty"), toast.warn("Only .srt and .vtt caption files are currently supported");
      await deploySubs(files, thumbnail);
    },
    oncancel: () => (thumbnail.dataset.captionState = "empty"),
  });
  const captionsBtn = tmg.utils.createEl("button", { title: "(Toggle / DblClick→Load) Captions", className: "captions-btn", innerHTML: `<svg viewBox="0 0 25 25" style="scale: 1.15;"><path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"/><svg>` }).appendChild(captionsInput).parentElement;
  tmg.utils.addSafeClicks(
    captionsBtn,
    ({ target }) => {
      if (target.matches("input")) return;
      if (thumbnail.dataset.captionState === "empty") {
        thumbnail._captionTid = setTimeout(() => (thumbnail.dataset.captionState = "loading"), 1000);
        return captionsBtn.querySelector("input").click();
      } else if (thumbnail.dataset.captionState === "filled") {
        const plItem = thumbnail.getPlItem();
        plItem?.media.intent.tracks?.forEach((t) => t.kind === "captions" && t.src.startsWith("blob:") && URL.revokeObjectURL(t.src));
        thumbnail.dataset.trackId && DB.remove(thumbnail.dataset.trackId, "subtitles");
        silence(() => {
          if (plItem.media) plItem.media.intent.tracks = plItem.media.intent.tracks.filter((t) => t.kind !== "captions");
          if (MC.plug("playlist").item?.media.settings.metadata.id === plItem.media.settings.metadata.id) MC.media.intent.tracks = plItem.media.intent.tracks;
        });
      } else if (!queue.drop(thumbnail.dataset.trackId)) return;
      thumbnail.dataset.captionState = "empty";
    },
    async () => thumbnail.dataset.captionState === "empty" && (file || thumbnail.getPlItem()?.media.intent.src) && (await deployTracks(file || thumbnail.getPlItem()?.media.intent.src, thumbnail, false))
  );
  const deleteBtn = tmg.utils.createEl("button", { title: "Remove Video", className: "delete-btn", innerHTML: `<svg width="20px" height="20px" viewBox="0 0 24 24" fill="none"><path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 17.069 22H6.93a2 2 0 0 1-1.995-1.858L4.07 8H3a1 1 0 0 1 0-2h4V4zm2 2h6V4H9v2zM6.074 8l.857 12H17.07l.857-12H6.074zM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1z" fill="#0D0D0D"/></svg>`, onclick: () => (MC?.config.playlist.content?.length > 1 ? MC?.plug("playlist").remove(thumbnail.getPlIndex()) : clearFiles()) });
  li.cleanUpDB = (light = false) => {
    if (!light && file && thumbnail.src?.startsWith("blob:")) URL.revokeObjectURL(thumbnail.src);
    const plItem = thumbnail.getPlItem();
    plItem?.media.intent.tracks?.forEach((t) => t.src.startsWith("blob:") && URL.revokeObjectURL(t.src));
    const tId = thumbnail.dataset.trackId;
    tId && (queue.drop(tId), !light && (DB.remove(tId, "subtitles"), DB.remove(tId + "_chap", "chapters")));
    if (!file) return;
    const hIdx = sessionHandles.findIndex((h) => h.name === file.name),
      handle = hIdx !== -1 ? sessionHandles.splice(hIdx, 1)[0] : null;
    handle && Memory.saveHandles(), light && deletedHandles.set(thumbnail.mediaId, { handle, file });
    nums.files--, (nums.bytes -= file.size);
  };
  const dragHandle = tmg.utils.createEl("span", { title: "Drag to Reorder", className: "drag-handle", innerHTML: `<svg fill="#000000" height="20px" width="20px" viewBox="0 0 24 24"><path d="M10,6H6V2h4V6z M18,2h-4v4h4V2z M10,10H6v4h4V10z M18,10h-4v4h4V10z M10,18H6v4h4V18z M18,18h-4v4h4V18z"/></svg>` });
  dragHandle.addEventListener(
    "pointerdown",
    (e) => {
      navigator.vibrate?.([50]);
      let list = li.parentElement,
        oldIdx = thumbnail.getPlIndex(),
        initialOffsetY = list.getBoundingClientRect().top,
        initialScrollY = document.body.scrollTop,
        placeholderLi = tmg.utils.createEl("div", { className: "drag-placeholder" }, {}, { cssText: `height:${li.offsetHeight}px;width:${li.offsetWidth}px;` });
      list.insertBefore(placeholderLi, li.nextElementSibling), li.classList.add("dragging");
      li.style.top = `${(li.top = tmg.utils.clamp(0, e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
      function onPointerMove(e) {
        e.preventDefault();
        tmg.utils.RAFLoop("listItemDragging", () => {
          li.style.top = `${(li.top = tmg.utils.clamp(0, document.body.scrollTop - initialScrollY + e.clientY - initialOffsetY - li.offsetHeight / 2, list.offsetHeight - li.offsetHeight))}px`;
          scroller.drive(e.clientY, !(li.top > 0 && li.top < list.offsetHeight - li.offsetHeight));
          const afterLine = tmg.utils.getElSiblingAt(e.clientY, "y", list.querySelectorAll(".content-line:not(.dragging)"));
          afterLine ? list.insertBefore(placeholderLi, afterLine) : list.append(placeholderLi);
        });
      }
      function onPointerUp() {
        navigator.vibrate?.([50]);
        tmg.utils.cancelRAFLoop("listItemDragging");
        scroller.reset();
        li.classList.remove("dragging");
        placeholderLi.parentElement.replaceChild(li, placeholderLi), (placeholderLi = null), MC?.plug("playlist").move(oldIdx, Array.prototype.indexOf.call(contentLines, li));
        ["pointermove", "pointerup", "pointercancel"].forEach((e, i) => document.removeEventListener(e, !i ? onPointerMove : onPointerUp));
      }
      ["pointermove", "pointerup", "pointercancel"].forEach((evt) => document.addEventListener(evt, evt === "pointermove" ? onPointerMove : onPointerUp, { passive: false }));
    },
    { passive: false }
  );
  li.append(thumbnailContainer, tmg.utils.createEl("span", { className: "file-info-wrapper", innerHTML: `<p class="file-name"><span>Name: </span><span>${ffName || "<i>Unknown</i>"}</span></p>${file ? `<p class="file-size"><span>Size: </span><span>${file ? tmg.utils.formatSize(file.size) : "N/A"}</span></p>` : ""}<p class="file-duration"><span>Duration: </span><span>${item?.media.status.isLive ? "LIVE" : item?.media.status.duration ? tmg.utils.formatMediaTime({ time: item.media.status.duration }) : !file ? "-:--" : restored ? "Reinitializing..." : "Initializing..."}</span></p>` }), ...(!file && !tmg.utils.getExtension(item.media.intent.src, false) ? [] : [captionsBtn]), deleteBtn, dragHandle);
  return { li, thumbnail, container: thumbnailContainer };
};
