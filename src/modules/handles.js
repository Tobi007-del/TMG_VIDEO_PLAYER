export async function getDroppedFiles(e, preTask) {
  e.preventDefault();
  const dtItems = e.dataTransfer.items || [];
  if (dtItems.length > 0) preTask?.();
  const traverseFileTree = async (item) =>
    new Promise((resolve) => {
      if (item.isFile) item.file(resolve, () => resolve([]));
      else if (item.isDirectory)
        item.createReader().readEntries(async (entries) => {
          try {
            resolve((await Promise.all(entries.map(traverseFileTree))).flat());
          } catch {
            resolve([]);
          }
        });
      else resolve([]);
    });
  const promises = [];
  for (let i = 0; i < dtItems.length; i++) {
    const entry = dtItems[i].webkitGetAsEntry?.();
    promises.push(entry ? traverseFileTree(entry) : Promise.resolve(dtItems[i].kind === "file" ? dtItems[i].getAsFile() : []));
  }
  return (await Promise.all(promises)).flat().filter(Boolean);
}

export async function getDroppedHandles(e, preTask) {
  const dtItems = e.dataTransfer.items || [];
  if (dtItems.length > 0) preTask?.();
  const handlePromises = Array.prototype.map.call(dtItems, (item) => (item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null));
  return (await Promise.all(handlePromises)).filter(Boolean);
}

export async function getPickedHandles(directory = false) {
  try {
    const options = { multiple: true, id: "tvp_file_picker", startIn: "videos", types: [{ description: "TVP Video Files", accept: { "video/*": [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".mpeg", ".mp3", ".ogg"] } }] };
    return directory ? [await window.showDirectoryPicker?.(options)] : await window.showOpenFilePicker?.(options);
  } catch {
    return [];
  }
}

export async function getHandlesFiles(handles) {
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
