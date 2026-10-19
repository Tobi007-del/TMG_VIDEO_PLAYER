import * as tmg from "tmg-media-player/super";
import { silence } from "sia-reactor/modules";
import { queue } from "./consts";

const { createFFmpeg, fetchFile } = FFmpeg;
window.ffmpeg = createFFmpeg({ log: false, corePath: "assets/ffmpeg/ffmpeg-core.js" });

// ===========================================================================
// MAIN TRACK DEPLOYMENT & EXTRACTION
// ===========================================================================

export async function deploySubs(files, thumbnail) {
  if (!files?.length) return;
  const plItem = thumbnail.getPlItem(),
    id = (thumbnail.dataset.trackId ??= plItem.media.settings.metadata.id + "_sub"),
    subs = [],
    tracks = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i].name;
    let txt = await files[i].text();
    tmg.utils.getExtension(name) === "srt" && (txt = tmg.utils.srtToVtt(txt));
    const data = { buffer: new TextEncoder().encode(txt), lang: getSubLang(name, thumbnail.ffName) },
      { buffer, srclang = "", label = "" } = getSubMeta(data);
    subs.push(data), tracks.push({ id: `${id}_${i}`, kind: "captions", label, srclang, src: URL.createObjectURL(new Blob([buffer], { type: "text/vtt" })), default: i === 0 });
  }
  silence(() => {
    plItem.media.intent.tracks = [...plItem.media.intent.tracks.filter((t) => t.kind !== "captions"), ...tracks];
    MC?.plug("playlist")?.item?.media.settings.metadata.id === plItem.media.settings.metadata.id && (MC.media.intent.tracks = plItem.media.intent.tracks);
  });
  await DB.set(id, subs, "subtitles");
  thumbnail.dataset.captionState = "filled";
}

export async function deployTracks(file, thumbnail, autocancel = !tmg.utils.isDef(SharedArrayBuffer) || tmg.utils.IS_MOBILE, item = thumbnail.getPlItem()) {
  const id = (thumbnail.dataset.trackId = thumbnail.dataset.trackId ?? item.media.settings.metadata.id + "_sub");
  thumbnail.setAttribute("data-caption-state", item?.media.intent.tracks[0] ? "loading" : "waiting");
  // 1. THE VAULT CHECK (Instant IDB Access)
  const subBuffer = await DB.get(id, "subtitles"),
    chapBuffer = await DB.get(id + "_chap", "chapters");
  if (subBuffer || chapBuffer) {
    silence(() => {
      item.media.intent.tracks = item.media.intent.tracks.filter((t) => ((subBuffer && t.kind === "captions") || (chapBuffer && t.kind === "chapters") ? false : true));
      subBuffer &&
        (Array.isArray(subBuffer) ? subBuffer : [subBuffer]).forEach((data, i, _) => {
          const { buffer, srclang = "", label = "" } = getSubMeta(data);
          item.media.intent.tracks.push({ id: `${id}_${i}`, kind: "captions", label, srclang, default: i === 0, src: URL.createObjectURL(new Blob([buffer], { type: "text/vtt" })) });
        });
      chapBuffer && item.media.intent.tracks.push({ id: id + "_chap", kind: "chapters", label: "Chapters", srclang: "en", src: URL.createObjectURL(new Blob([chapBuffer], { type: "text/vtt" })) });
      MC?.plug("playlist").item?.media.settings.metadata.id === item.media.settings.metadata.id && (MC.media.intent.tracks = item.media.intent.tracks);
    });
    if (subBuffer) return console.log(`✨TVP IDB Vault Hit: Tracks restored for ${id}`), thumbnail.setAttribute("data-caption-state", "filled");
  }
  // 2. THE FACTORY (FFmpeg Processing)
  const target = file || item.media.intent.src;
  autocancel && thumbnail.setAttribute("data-caption-state", "empty");
  const subs = [];
  let chap;
  const res = await queue.add(
    async () =>
      await extractTracks(target, id, async (p) => {
        if (p.type === "subtitle") {
          const i = subs.push(p.data) - 1,
            { buffer, srclang = "", label = "" } = getSubMeta(p.data);
          silence(() => {
            item.media.intent.tracks.push({ id: `${id}_${i}`, kind: "captions", label, srclang, default: i === 0, src: URL.createObjectURL(new Blob([buffer], { type: "text/vtt" })) });
            MC?.plug("playlist").item?.media.settings.metadata.id === item.media.settings.metadata.id && (MC.media.intent.tracks = item.media.intent.tracks);
          });
        } else if (p.type === "chapter") {
          item.media.intent.tracks?.forEach((t) => t.kind === "chapters" && t.src.startsWith("blob:") && URL.revokeObjectURL(t.src));
          const track = { id: id + "_chap", kind: "chapters", label: "Chapters", srclang: "en", src: URL.createObjectURL(new Blob([(chap = p.data)], { type: "text/vtt" })) };
          silence(() => {
            item.media.intent.tracks = [...item.media.intent.tracks.filter((t) => t.kind !== "chapters"), track];
            MC?.plug("playlist").item?.media.settings.metadata.id === item.media.settings.metadata.id && (MC.media.intent.tracks = item.media.intent.tracks);
          });
        }
      }),
    id,
    autocancel,
    () => thumbnail.setAttribute("data-caption-state", "loading")
  );
  if (res.cancelled || !res.success) return thumbnail.setAttribute("data-caption-state", "empty");
  subs.length && (await DB.set(id, subs, "subtitles")), chap && (await DB.set(id + "_chap", chap, "chapters"));
  thumbnail.setAttribute("data-caption-state", subs.length ? "filled" : "empty");
}

export async function extractTracks(file, id, onProgress) {
  const metaName = `meta${id}.txt`,
    inputName = `video${id}.${tmg.utils.getExtension(file.name || file) || "mp4"}`;
  try {
    !ffmpeg.isLoaded() && (await ffmpeg.load());
    console.log(`🎥 TVP processing file with FFmpeg: '${file.name || file}'`);
    ffmpeg.FS("writeFile", inputName, await fetchFile(file));
    let logData = "";
    ffmpeg.setLogger(({ message }) => (logData += message + "\n"));
    await ffmpeg.run("-i", inputName, "-f", "ffmetadata", metaName).catch(() => {});
    ffmpeg.setLogger(() => {});
    let match,
      idx = 0;
    const sstreams = [],
      sregex = /Stream #\d+:\d+.*?(?:\(([a-zA-Z]{2,3})\))?: Subtitle/g;
    while ((match = sregex.exec(logData)) !== null) sstreams.push({ index: idx++, lang: match[1] || "eng" });
    sstreams.sort((a, b) => (a.lang === primaryLang ? -1 : b.lang === primaryLang ? 1 : a.index - b.index));
    console.log(`🛠 Extracting ${sstreams.length} streams dynamically...`);
    try {
      const chapStr = metadataToVTT(new TextDecoder().decode(ffmpeg.FS("readFile", metaName)));
      chapStr && (await onProgress({ type: "chapter", data: chapStr }), console.log("✅ Chapter metadata deployed."));
      ffmpeg.FS("unlink", metaName);
    } catch {
      console.log("⚠️ No embedded metadata found.");
    }
    for (const target of sstreams) {
      const subName = `cue${id}_${target.index}.vtt`;
      try {
        await ffmpeg.run("-i", inputName, "-map", `0:s:${target.index}`, "-f", "webvtt", subName);
        await onProgress({ type: "subtitle", data: { buffer: ffmpeg.FS("readFile", subName), lang: target.lang } });
        ffmpeg.FS("unlink", subName);
      } catch {
        console.log(`⚠️ No embedded stream ${target.index} found.`);
      }
    }
    return { success: true };
  } catch (err) {
    return console.error("❌ TVP tracks extraction failed:", err), { success: false, error: err.toString() };
  } finally {
    try {
      ffmpeg.FS("unlink", inputName);
    } catch {}
  }
}

// ===========================================================================
// UTILITIES & METADATA PARSING
// ===========================================================================

export const primaryLang = "eng",
  langNames = new Intl.DisplayNames(["en"], { type: "language" }),
  langMap = new Map();
for (let i = 0; i < 26; i++) for (let j = 0, c, n; j < 26; j++) (c = String.fromCharCode(97 + i, 97 + j)), (n = langNames.of(c)) !== c && (langMap.set(c, c), langMap.set(n.toLowerCase(), c));

export function metadataToVTT(metaText) {
  const blocks = metaText.split("[CHAPTER]");
  if (blocks.length <= 1) return null;
  const formatTime = (seconds) => {
    const str = (v, pad = 2) => Math.floor(v).toString().padStart(pad, "0");
    return `${str(seconds / 3600)}:${str((seconds % 3600) / 60)}:${str(seconds % 60)}.${str((seconds % 1) * 1000, 3)}`;
  };
  let vtt = "WEBVTT\n\n";
  const chapters = [];
  for (let i = 1, len = blocks.length; i < len; i++) {
    const block = blocks[i].trim(),
      tbMch = block.match(/TIMEBASE=(\d+)\/(\d+)/),
      startMch = block.match(/START=(\d+)/),
      endMch = block.match(/END=(\d+)/),
      titleMch = block.match(/title=(.+)/i);
    if (tbMch && startMch && endMch) {
      const tb = parseInt(tbMch[1], 10) / parseInt(tbMch[2], 10);
      chapters.push({ start: parseInt(startMch[1], 10) * tb, end: parseInt(endMch[1], 10) * tb, title: titleMch ? titleMch[1].trim() : `Chapter ${i}` });
    }
  }
  return !chapters.length ? null : (chapters.forEach((ch) => (vtt += `${formatTime(ch.start)} --> ${formatTime(ch.end)}\n${ch.title}\n\n`)), vtt);
}

export function getSubMeta(data, name = "English") {
  try {
    name = langNames.of(data.lang || "eng");
  } catch {}
  return { buffer: data.buffer || data, srclang: data.lang?.slice(0, 2) || "en", label: data.label || name };
}

export function getSubLang(name, title = "") {
  // prettier-ignore
  const clean = tmg.utils.noExtension(name, false).replace(new RegExp(title.replace(/[^a-z0-9]+/gi, "[^a-z0-9]+"), "i"), "").replace(/[^a-z]+/gi, " ").trim().toLowerCase();
  try {
    return langNames.of(clean) ? (clean === "english" ? "eng" : clean) : "eng";
  } catch {
    return "eng";
  }
}

const isTag = (t) => /^(forced|sdh|cc)$/.test(t) || langMap.has(t) || (t.length === 3 && !/\d/.test(t) && langNames.of(t) !== t),
  tokenize = (n) => tmg.utils.noExtension(n).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
  toSubTokens = (n, toks = tokenize(n)) => {
    toks.length > 1 && /^\d+$/.test(toks.at(-1)) && isTag(toks.at(-2)) && toks.pop();
    while (toks.length > 1 && isTag(toks.at(-1))) toks.pop();
    return new Set(toks);
  };

export function matchSubsToThumbnails(subFiles, thumbnails, map = new Map()) {
  for (const s of subFiles) {
    let best = null, maxJ = 0, sToks = toSubTokens(s.name);
    for (const t of thumbnails) {
      if (!t) continue;
      const vToks = new Set(tokenize(t.ffName)), inter = [...sToks].filter((k) => vToks.has(k)).length, j = inter / (sToks.size + vToks.size - inter);
      j > maxJ && j > 0.2 && ((maxJ = j), (best = t));
    }
    best && (map.has(best) ? map.get(best).push(s) : map.set(best, [s]));
  }
  return map;
}// Tnks to JACCARD SIMILARITY COEFFICIENT for the matching algorithm.

