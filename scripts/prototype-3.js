"use strict";
// NOTE: boolean expressions used where fitting for code brevity, also comma assignment but sparingly
/* 
TODO: 
  editable settings
  video resolution
*/

const RAW = Symbol.for("S.I.A_RAW"); // "Get Original Obj" Marker
const REJECTABLE = Symbol.for("S.I.A_REJECTABLE"); // "State Vs. Intent" Marker
const INERTIA = Symbol.for("S.I.A_INERTIA"); // "No Proxy" Marker
const TERMINATOR = Symbol.for("S.I.A_TERMINATOR"); // "Obj Operation Terminator" Marker
const REOPTS = { LISTENER: ["capture", "once", "signal", "immediate"], MEDIATOR: ["lazy", "signal", "immediate"] };
const arrRx = /^([^\[\]]+)\[(\d+)\]$/;
class Event {
  static NONE = 0;
  static CAPTURING_PHASE = 1;
  static AT_TARGET = 2;
  static BUBBLING_PHASE = 3;
  constructor(payload, bubbles = true) {
    this.type = this.staticType = payload.type;
    this.target = payload.target;
    this.currentTarget = payload.currentTarget;
    this.root = payload.root;
    this.value = payload.target.value;
    this.oldValue = payload.target.oldValue;
    this.path = payload.target.path;
    this.rejectable = payload.rejectable;
    this.bubbles = bubbles;
    // this.timestamp = Date.now();
    this.eventPhase = Event.NONE;
    this._propagationStopped = false;
    this._immediatePropagationStopped = false;
    this._resolved = "";
    this._rejected = "";
  }
  get propagationStopped() {
    return this._propagationStopped;
  }
  stopPropagation() {
    this._propagationStopped = true;
  }
  get immediatePropagationStopped() {
    return this._immediatePropagationStopped;
  }
  stopImmediatePropagation() {
    this._propagationStopped = true;
    this._immediatePropagationStopped = true;
  }
  get resolved() {
    return this._resolved;
  }
  resolve(message) {
    if (!this.rejectable) return console.warn(`Ignored resolve() call on a non-rejectable ${this.staticType} at "${this.path}"`);
    if (this.eventPhase !== Event.CAPTURING_PHASE) console.warn(`Resolving an intent on ${this.staticType} at "${this.path}" outside of the capture phase is unadvised.`);
    if (this.rejectable) this._resolved = message || `Could ${this.staticType} intended value at "${this.path}"`;
  }
  get rejected() {
    return this._rejected;
  }
  reject(reason) {
    if (!this.rejectable) return console.warn(`Ignored reject() call on a non-rejectable ${this.staticType} at "${this.path}"`);
    if (this.eventPhase !== Event.CAPTURING_PHASE) console.warn(`Rejecting an intent on ${this.staticType} at "${this.path}" outside of the capture phase is unadvised.`);
    if (this.rejectable) this._rejected = reason || `Couldn't ${this.staticType} intended value at "${this.path}"`;
  }
  composedPath() {
    return tmg.getTrailPaths(this.path);
  }
}
class Reactor {
  getters = new Map();
  setters = new Map();
  watchers = new Map();
  listenersRecord = new Map();
  batch = new Map();
  isBatching = false;
  queue = null;
  proxyCache = new WeakMap();
  lineage = new WeakMap();
  get log() {
    return this.options?.debug ? console.log.bind(console, "[S.I.A Reactor]") : undefined;
  }
  constructor(obj = {}, options) {
    tmg.inert(this);
    this.core = this.proxied(obj);
    this.options = options;
  }
  proxied(obj, rejectable = false, p, k) {
    if (!obj || typeof obj !== "object") return obj;
    const tag = Object.prototype.toString.call(obj);
    if ((tag !== "[object Object]" && tag !== "[object Array]") || obj[INERTIA]) return obj;
    obj = obj[RAW] || obj;
    if (p && k) this.link(obj, p, k);
    if (this.proxyCache.has(obj)) return this.proxyCache.get(obj);
    rejectable ||= tmg.isIntent(obj);
    const proxy = new Proxy(obj, {
      get: (object, key, receiver) => {
        if (key === RAW) return object;
        let value = Reflect.get(object, key, receiver);
        const safeKey = String(key),
          paths = [];
        (this.log?.(`👀 [GET Trap] Initiated for "${safeKey}"`), this.trace(object, safeKey, paths));
        this.options?.get?.(object, key, receiver, paths);
        for (let i = 0; i < paths.length; i++) {
          if (!this.getters.has(paths[i])) continue;
          const target = { path: paths[i], value, key: safeKey, object: receiver };
          value = this.mediate(paths[i], { type: "get", target, currentTarget: target, root: this.core, rejectable }, false);
        }
        return this.proxied(value, rejectable, object, safeKey);
      },
      set: (object, key, value, receiver) => {
        const safeKey = String(key),
          paths = [],
          oldValue = Reflect.get(object, key, receiver);
        (this.log?.(`✏️ [SET Trap] Initiated for "${safeKey}"`), this.trace(object, safeKey, paths));
        if (this.options?.set?.(object, key, value, receiver, paths) === false) return (this.log?.(`⛔ [SET Trap] Pre-Flight Interceptor rejected "${safeKey}"`), false);
        for (let i = 0; i < paths.length; i++) {
          if (!this.setters.has(paths[i])) continue;
          const target = { path: paths[i], value, oldValue, key: safeKey, object: receiver },
            result = this.mediate(paths[i], { type: "set", target, currentTarget: target, root: this.core, rejectable }, true);
          if (result !== TERMINATOR) value = result;
          else this.log?.(`🛡️ [Mediator] Terminated Set on "${paths[i]}"`);
        }
        if (value === TERMINATOR) return true;
        if (!Reflect.set(object, key, value, receiver)) return false;
        if (!Object.is(value?.[RAW] || value, oldValue?.[RAW] || oldValue)) (this.unlink(oldValue, object, safeKey), this.link(value, object, safeKey));
        for (let i = 0; i < paths.length; i++) {
          const target = { path: paths[i], value, oldValue, key: safeKey, object: receiver };
          this.notify(paths[i], { type: "set", target, currentTarget: target, root: this.core, rejectable });
        }
        return true;
      },
      deleteProperty: (object, key) => {
        let value = undefined;
        const safeKey = String(key),
          paths = [],
          oldValue = Reflect.get(object, key);
        (this.log?.(`🗑️ [DELETE Trap] Initiated for "${safeKey}"`), this.trace(object, safeKey, paths));
        if (this.options?.deleteProperty?.(object, key, paths) === false) return (this.log?.(`⛔ [DELETE Trap] Pre-Flight Interceptor rejected "${safeKey}"`), false);
        for (let i = 0; i < paths.length; i++) {
          if (!this.setters.has(paths[i])) continue;
          const target = { path: paths[i], value, oldValue, key: safeKey, object: this.proxyCache.get(object) },
            result = this.mediate(paths[i], { type: "delete", target, currentTarget: target, root: this.core, rejectable }, true);
          if (result !== TERMINATOR) value = result;
          else this.log?.(`🛡️ [Mediator] Terminated Delete on "${paths[i]}"`);
        }
        if (value === TERMINATOR) return true;
        if (!Reflect.deleteProperty(object, key)) return false;
        this.unlink(oldValue, object, safeKey);
        for (let i = 0; i < paths.length; i++) {
          const target = { path: paths[i], value, oldValue, key: safeKey, object: this.proxyCache.get(object) };
          this.notify(paths[i], { type: "delete", target, currentTarget: target, root: this.core, rejectable });
        }
        return true;
      },
    });
    return (this.proxyCache.set(obj, proxy), proxy);
  }
  trace(target, key, paths, visited = new WeakSet()) {
    if (Object.is(target, this.core?.[RAW] || this.core)) return void paths.push(key);
    if (visited.has(target)) return;
    visited.add(target);
    const parents = this.lineage.get(target);
    if (!parents) return;
    for (let i = 0; i < parents.length; i++) {
      const { p, k } = parents[i];
      this.trace(p, k ? k + "." + key : key, paths, visited);
    }
  }
  link(child, p, k, es) {
    const target = child?.[RAW] || child;
    if (!tmg.isObj(target) && !tmg.isArr(target)) return;
    es = this.lineage.get(target) ?? (this.lineage.set(target, (es = [])), es);
    for (let i = 0; i < es.length; i++) if (Object.is(es[i].p, p) && es[i].k === k) return;
    es.push({ p, k });
  }
  unlink(child, p, k) {
    const target = child?.[RAW] || child;
    if (!target || typeof target !== "object") return;
    const es = this.lineage.get(target);
    if (es) for (let i = 0; i < es.length; i++) if (Object.is(es[i].p, p) && es[i].k === k) return void es.splice(i, 1);
  }
  mediate(path, payload, set) {
    let terminated = false,
      value = payload.target.value;
    const cords = (set ? this.setters : this.getters).get(path);
    if (!cords?.length) return value;
    for (let i = set ? 0 : cords.length - 1; i !== (set ? cords.length : -1); i += set ? 1 : -1) {
      if (set) terminated ||= value === TERMINATOR;
      if (cords[i].once) (cords.splice(i--, 1), !cords.length && (set ? this.setters : this.getters).delete(path));
      const response = set ? cords[i].cb(value, terminated, payload) : cords[i].cb(value, payload);
      if (!terminated) value = response;
    }
    return value;
  }
  notify(path, payload) {
    const cords = this.watchers.get(path);
    for (let i = 0; i < (cords?.length ?? 0); i++) {
      if (cords[i].once) (cords.splice(i--, 1), !cords.length && this.watchers.delete(path));
      cords[i].cb(payload.target.value, payload);
    }
    this.schedule(path, payload);
  }
  schedule(path, payload) {
    (this.batch.set(path, payload), this.initBatching());
  }
  initBatching() {
    if (this.isBatching) return;
    this.isBatching = true;
    queueMicrotask(() => this.flush());
  }
  flush() {
    (this.tick(this.batch.keys()), this.batch.clear(), (this.isBatching = false));
    if (this.queue?.size) for (const task of this.queue) task();
    this.queue?.clear();
  }
  wave(path, payload) {
    const e = new Event(payload),
      chain = tmg.getTrailRecords(this.core, path);
    e.eventPhase = Event.CAPTURING_PHASE;
    for (let i = 0; i <= chain.length - 2; i++) {
      if (e.propagationStopped) break;
      this.fire(chain[i], e, true);
    }
    if (e.propagationStopped) return;
    e.eventPhase = Event.AT_TARGET;
    this.fire(chain[chain.length - 1], e, true);
    !e.immediatePropagationStopped && this.fire(chain[chain.length - 1], e, false);
    if (!e.bubbles) return;
    e.eventPhase = Event.BUBBLING_PHASE;
    for (let i = chain.length - 2; i >= 0; i--) {
      if (e.propagationStopped) break;
      this.fire(chain[i], e, false);
    }
  }
  fire([path, object, value], e, isCapture) {
    const cords = this.listenersRecord.get(path);
    if (!cords?.length) return;
    e.type = path !== e.target.path ? "update" : e.staticType;
    e.currentTarget = { path, value, oldValue: e.type !== "update" ? e.target.oldValue : undefined, key: e.type !== "update" ? path : path.slice(path.lastIndexOf(".") + 1) || "", object };
    let tDepth, lDepth;
    for (let i = 0; i < cords.length; i++) {
      if (e.immediatePropagationStopped) break;
      if (cords[i].capture !== isCapture) continue;
      if (cords[i].depth !== undefined) {
        ((tDepth ??= this.getDepth(e.target.path)), (lDepth ??= this.getDepth(path)));
        if (tDepth > lDepth + cords[i].depth) continue;
      }
      if (cords[i].once) (cords.splice(i--, 1), !cords.length && this.listenersRecord.delete(path));
      cords[i].cb(e);
    }
  }
  bind(cord, signal) {
    signal?.aborted ? cord.clup() : signal?.addEventListener?.("abort", cord.clup, { once: true });
    if (signal && !signal.aborted) cord.sclup = () => signal.removeEventListener?.("abort", cord.clup);
    return cord.clup;
  }
  getContext(path) {
    const lastDot = path.lastIndexOf("."),
      value = path === "*" ? this.core : tmg.getAny(this.core, path),
      object = lastDot === -1 ? this.core : tmg.getAny(this.core, path.slice(0, lastDot));
    return { path, value, key: path.slice(lastDot + 1) || "", object };
  }
  getDepth(p, d = !p ? 0 : 1) {
    for (let i = 0; i < p.length; i++) if (p.charCodeAt(i) === 46) d++;
    return d;
  }
  tick(paths) {
    if (!paths) return this.flush();
    if ("string" === typeof paths) {
      const task = this.batch.get(paths);
      task && (this.wave(paths, task), this.batch.delete(paths));
    } else
      for (const path of paths) {
        const task = this.batch.get(path);
        task && (this.wave(path, task), this.batch.delete(path));
      }
  }
  stall(task) {
    ((this.queue ??= new Set()), this.queue.add(task), this.initBatching());
  }
  nostall(task) {
    return this.queue?.delete(task);
  }
  get(path, cb, opts) {
    const { lazy = false, once = false, signal, immediate = false } = tmg.parseEvOpts(opts, REOPTS.MEDIATOR);
    let cords = this.getters.get(path),
      cord;
    for (let i = 0; i < (cords?.length ?? 0); i++)
      if (Object.is(cords[i].cb, cb)) {
        cord = cords[i];
        break;
      }
    if (cord) return cord.clup;
    cord = { cb, once, clup: () => (lazy && this.nostall(task), this.noget(path, cb)) };
    if (immediate) (immediate !== "auto" || tmg.inAny(this.core, path)) && tmg.getAny(this.core, path);
    const task = () => (this.getters.get(path) ?? (this.getters.set(path, (cords = [])), cords)).push(cord);
    lazy ? this.stall(task) : task();
    return this.bind(cord, signal);
  }
  gonce(path, cb, opts) {
    return this.get(path, cb, { ...tmg.parseEvOpts(opts, REOPTS.MEDIATOR), once: true });
  }
  noget(path, cb) {
    const cords = this.getters.get(path);
    if (!cords) return undefined;
    for (let i = 0; i < cords.length; i++) if (Object.is(cords[i].cb, cb)) return (cords[i].sclup?.(), cords.splice(i--, 1), !cords.length && this.getters.delete(path), true);
    return false;
  }
  set(path, cb, opts) {
    const { lazy = false, once = false, signal, immediate = false } = tmg.parseEvOpts(opts, REOPTS.MEDIATOR);
    let cords = this.setters.get(path),
      cord;
    for (let i = 0; i < (cords?.length ?? 0); i++)
      if (Object.is(cords[i].cb, cb)) {
        cord = cords[i];
        break;
      }
    if (cord) return cord.clup;
    cord = { cb, once, clup: () => (lazy && this.nostall(task), this.noset(path, cb)) };
    if (immediate) (immediate !== "auto" || tmg.inAny(this.core, path)) && tmg.setAny(this.core, path, this.getContext(path).value);
    const task = () => (this.setters.get(path) ?? (this.setters.set(path, (cords = [])), cords)).push(cord);
    lazy ? this.stall(task) : task();
    return this.bind(cord, signal);
  }
  sonce(path, cb, opts) {
    return this.set(path, cb, { ...tmg.parseEvOpts(opts, REOPTS.MEDIATOR), once: true });
  }
  noset(path, cb) {
    const cords = this.setters.get(path);
    if (!cords) return undefined;
    for (let i = 0; i < cords.length; i++) if (Object.is(cords[i].cb, cb)) return (cords[i].sclup?.(), cords.splice(i--, 1), !cords.length && this.setters.delete(path), true);
    return false;
  }
  watch(path, cb, opts) {
    const { lazy = false, once = false, signal, immediate = false } = tmg.parseEvOpts(opts, REOPTS.MEDIATOR);
    let cords = this.watchers.get(path),
      cord;
    for (let i = 0; i < (cords?.length ?? 0); i++)
      if (Object.is(cords[i].cb, cb)) {
        cord = cords[i];
        break;
      }
    if (cord) return cord.clup;
    cord = { cb, once, clup: () => (lazy && this.nostall(task), this.nowatch(path, cb)) };
    if (immediate && immediate !== "auto" && tmg.inAny(this.core, path)) {
      const target = this.getContext(path);
      cb(target.value, { type: "init", target, currentTarget: target, root: this.core, rejectable: false });
    }
    const task = () => (cords ?? (this.watchers.set(path, (cords = [])), cords)).push(cord);
    lazy ? this.stall(task) : task();
    return this.bind(cord, signal);
  }
  wonce(path, cb, opts) {
    return this.watch(path, cb, { ...tmg.parseEvOpts(opts, REOPTS.MEDIATOR), once: true });
  }
  nowatch(path, cb) {
    const cords = this.watchers.get(path);
    if (!cords) return undefined;
    for (let i = 0; i < cords.length; i++) if (Object.is(cords[i].cb, cb)) return (cords[i].sclup?.(), cords.splice(i--, 1), !cords.length && this.watchers.delete(path), true);
    return false;
  }
  on(path, cb, options) {
    const { capture = false, once = false, signal, immediate = false, depth } = tmg.parseEvOpts(options, REOPTS.LISTENER);
    let cords = this.listenersRecord.get(path),
      cord;
    for (let i = 0; i < (cords?.length ?? 0); i++)
      if (Object.is(cords[i].cb, cb) && capture === cords[i].capture) {
        cord = cords[i];
        break;
      }
    if (cord) return cord.clup;
    cord = { cb, capture, depth, once, clup: () => this.off(path, cb, options) };
    if (immediate && (immediate !== "auto" || tmg.inAny(this.core, path))) {
      const target = this.getContext(path);
      cb(new Event({ type: "init", target, currentTarget: target, root: this.core, rejectable: false }, false));
    }
    (cords ?? (this.listenersRecord.set(path, (cords = [])), cords)).push(cord);
    return this.bind(cord, signal);
  }
  once(path, cb, options) {
    return this.on(path, cb, { ...tmg.parseEvOpts(options, REOPTS.LISTENER), once: true });
  }
  off(path, cb, options) {
    const cords = this.listenersRecord.get(path);
    if (!cords) return undefined;
    const { capture } = tmg.parseEvOpts(options, REOPTS.LISTENER);
    for (let i = 0; i < cords.length; i++) if (Object.is(cords[i].cb, cb) && cords[i].capture === capture) return (cords[i].sclup?.(), cords.splice(i--, 1), !cords.length && this.listenersRecord.delete(path), true);
    return false;
  }
  cascade({ type, currentTarget: { path, value: news, oldValue: olds } }, objSafe = true) {
    if (!tmg.isObj(news) || !tmg.isObj(olds) || (type !== "set" && type !== "delete")) return;
    const obj = objSafe ? tmg.mergeObjs(olds, news) : news,
      keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) tmg.setAny(this.core, path + "." + keys[i], obj[keys[i]]);
  }
  snapshot() {
    return tmg.deepClone(this.core);
  }
  reset() {
    (this.getters.clear(), this.setters.clear(), this.watchers.clear(), this.listenersRecord.clear());
    (this.queue?.clear(), this.batch.clear(), (this.isBatching = false));
    this.proxyCache = new WeakMap();
  }
  destroy() {
    (this.reset(), tmg.nuke(this));
  }
}
const methods = ["tick", "stall", "nostall", "get", "gonce", "noget", "set", "sonce", "noset", "watch", "wonce", "nowatch", "on", "once", "off", "cascade", "snapshot", "reset", "destroy"];
function reactive(target, options) {
  const descriptors = {},
    r = target instanceof Reactor ? target : new Reactor(target, options),
    locks = { writable: false, enumerable: false, configurable: true };
  for (const m of methods) descriptors[m] = { value: r[m].bind(r), ...locks };
  descriptors["__Reactor__"] = { value: r, ...locks };
  return (Object.defineProperties(r.core, descriptors), r.core);
}

class tmg_Video_Controller {
  constructor(medium, build) {
    this.setReadyState(0, medium); // had to be done before binding, for user info
    this.bindMethods(); // first thing, same this.cZoneWs throughout life cycle
    ((this.buildCache = { ...build }), (this.id = build.id), (this.video = medium));
    this.config = reactive(build); // merging the video build into the Video Player Instance
    this.settings = this.config.settings; // alias for devx, for non reassignable common config
    (this.guardGenericPaths(), this.guardTimeValues(), this.plugSources(), this.plugTracks(), this.plugPlaylist());
    const { src, sources, tracks } = this.config;
    this.log((this.buildCache = { ...this.buildCache, ...(src ? { src } : null), ...(sources?.length ? { sources } : null), tracks })); // adding some info incase user had them burnt into the html
    this.audioSetup = this.loaded = this.isScrubbing = this.buffering = this.inFullscreen = this.inFloatingPlayer = this.overTimeline = this.overVolume = this.overBrightness = this.gestureTouchXCheck = this.gestureTouchYCheck = this.gestureWheelXCheck = this.gestureWheelYCheck = this.shouldSetLastVolume = this.shouldSetLastBrightness = this.speedPointerCheck = this.speedCheck = this.skipPersist = this.shouldCancelTimeScrub = false;
    this.parentIntersecting = this.isIntersecting = this.gestureTouchCanCancel = this.canAutoMovePlaylist = this.stallCancelTimeScrub = true;
    this.currentPlaylistIndex = this.skipDuration = this.textTrackIndex = this.rewindPlaybackRate = this.playTriggerCounter = 0;
    this.wasPaused = !this.video.autoplay;
    this.sliderAptVolume = this.sliderAptBrightness = 5;
    ((this.throttleMap = new Map()), (this.rafLoopMap = new Map()), (this.rafLoopFnMap = new Map()));
    ((this.pfps = 30), (this.pframeDelay = Math.round(1000 / this.pfps))); // pseudo fps: just for frame stepping
    ((this.exportCanvas = tmg.createEl("canvas")), (this.exportContext = this.exportCanvas.getContext("2d", { willReadFrequently: true })));
    this.mutatingDOMM = true;
    (this.buildContainers(), this.buildPlayerInterface());
    this.plugControlPanelSettings();
    setTimeout(() => (this.mutatingDOMM = false));
    this.initPlayer();
    this.initSettingsUIManager();
  }
  guardGenericPaths = () => ["media", "media.links", "settings.toasts", "settings.toasts.nextVideoPreview", "settings.css", "settings.controlPanel", "lightState", "lightState.preview", "settings.time", "settings.playbackRate", "settings.volume", "settings.brightness"].forEach((p) => this.config.on(p, this.config.cascade));
  plugSources() {
    const { src, sources } = this.config;
    this.config.get("src", () => this.video.src);
    this.config.get("sources", () => tmg.getSources(this.video));
    this.config.watch("src", (value) => !tmg.isSameURL(this.config.src, value) && (tmg.removeSources(this.video), (this.video.src = value)));
    this.config.watch("sources", (value = []) => !tmg.isSameSources(this.config.sources, value) && (tmg.removeSources(this.video), tmg.addSources(value, this.video)));
    if ("src" in this.config) this.config.src = src;
    if ("sources" in this.config) this.config.sources = sources;
  }
  plugTracks() {
    const { tracks } = this.config;
    this.config.get("tracks", () => tmg.getTracks(this.video));
    this.config.watch("tracks", (value = []) => !tmg.isSameTracks(this.config.tracks, value) && (tmg.removeTracks(this.video), tmg.addTracks(value, this.video)));
    if ("tracks" in this.config) this.config.tracks = tracks;
  }
  plugPlaylist() {
    this.config.get("playlist", (value) => (value?.length ? value : null));
    this.config.set("playlist", (value) => value?.map((v) => tmg.mergeObjs(tmg.DEFAULT_VIDEO_ITEM_BUILD, tmg.parseAnyObj(v))));
    this.config.on(
      "playlist",
      ({ root }) => {
        if (this.readyState < 1) return;
        const v = root.playlist?.find((v) => (v.media.id && v.media.id === root.media.id) || tmg.isSameURL(v.src, root.src));
        this.currentPlaylistIndex = v ? root.playlist.indexOf(v) : 0;
        if (v) {
          root.media = v.media;
          ["min", "max", "start", "end", "previews"].forEach((prop) => (this.settings.time[prop] = v.settings.time[prop]));
          root.tracks = v.tracks ?? [];
          this.setControlsState("playlist");
        } else this.movePlaylistTo(this.currentPlaylistIndex);
      },
      { depth: 1 }
    );
    this.config.playlist = this.config.playlist;
  }
  setPosterState = (poster = this.config.media.artwork?.[0]?.src) => !tmg.isSameURL(poster, this.video.poster) && (poster ? this.video.setAttribute("poster", poster) : this.video.removeAttribute("poster"));
  plugMedia() {
    this.setImgLoadState({ target: this.DOM.videoProfile });
    ["media.title", "media.artist", "media.profile"].forEach((e) => this.config.watch(e, (value, { root }) => (root.settings.controlPanel[e.replace("media.", "")] = value)));
    ["media.links.title", "media.links.artist", "media.links.profile"].forEach((p) =>
      this.config.on(p, ({ target: { key, value } }) => {
        const el = key !== "profile" ? this.DOM[`video${tmg.capitalize(key)}`] : this.DOM.videoProfile?.parentElement;
        el && Object.entries({ href: value, "tab-index": value ? "0" : null, target: value ? "_blank" : null, rel: value ? "noopener noreferrer" : null }).forEach(([attr, val]) => (val ? el.setAttribute(attr, val) : el.removeAttribute(attr)));
      })
    );
    this.config.on("media.artwork", ({ currentTarget: { value } }) => this.setPosterState(value?.[0]?.src));
    this.config.on("media", () => !this.video.paused && this.syncMediaSession());
    this.config.media = this.config.media;
  }
  get payload() {
    return { readyState: this.readyState, initialized: this.readyState > 0, destroyed: this.readyState < 0, Controller: this };
  }
  setReadyState(state = (this.readyState ?? -1) + 1, medium) {
    this.readyState = tmg.clamp(0, state, 3);
    this.fire("tmgreadystatechange", this.payload, medium);
  }
  log(mssg, type, action) {
    if (!this.config.debug) return;
    switch (type) {
      case "error":
        return action === "swallow" ? console.warn(`TMG swallowed a Controller error:`, mssg) : console.error(`TMG Controller error:`, mssg);
      case "warn":
        return console.warn(`TMG Controller warning:`, mssg);
      default:
        return console.log(`TMG Controller log:`, mssg);
    }
  }
  fire = (eventName, detail = null, el = this.video, bubbles = true, cancelable = true) => eventName && el?.dispatchEvent(new CustomEvent(eventName, { detail, bubbles, cancelable }));
  notify = (event) => this.settings.notifiers && this.fire(event, null, this.DOM.notifiersContainer);
  plugToastsSettings = () => {
    this.config.on("settings.toasts.disabled", ({ target: { value } }) => value && t007.toast.dismissAll(this.id)); // dismissals are mandatory
    this.config.on("settings.toasts.nextVideoPreview.usePoster", ({ target: { value, object } }) => this.nextVideoPreview && (!value || !this.nextVideoPreview.poster) && (object[object.tease ? "tease" : "time"] = object[object.tease ? "tease" : "time"]));
    this.config.on("settings.toasts.nextVideoPreview.tease", ({ target: { value, object } }) => {
      if (this.nextVideoPreview) this.nextVideoPreview.ontimeupdate = ({ target: p }) => tmg.safeNum(p.currentTime) >= object.time && p.pause();
      value && (!object.usePoster || !this.nextVideoPreview.poster) && this.nextVideoPreview.play();
    });
    this.config.on("settings.toasts.nextVideoPreview.time", ({ target: { value, object } }) => this.nextVideoPreview && (!object.usePoster || !this.nextVideoPreview.poster) && (this.nextVideoPreview.currentTime = tmg.safeNum(value)));
    this.config.on("settings.toasts", ({ type, target: { path, key, value } }) => type === "update" && !path.match(/disabled|nextVideoPreview|captureAutoClose/) && t007.toast.doForAll("update", { [key]: value }, this.id));
  };
  get toast() {
    return !this.settings.toasts.disabled ? t007.toaster({ idPrefix: this.id, rootElement: this.videoContainer, ...this.settings.toasts }) : null;
  }
  bindMethods() {
    tmg.bindMethods(this, (method) => {
      const fn = this[method].bind(this);
      this[method] = (...args) => {
        const onError = (e) => {
          this.log?.(e, "error", "swallow");
          method !== "togglePlay" && this.toast?.("Something went wrong", { tag: "tmg-stwr" });
        };
        try {
          const result = fn(...args);
          return result instanceof Promise ? result.catch(onError) : result;
        } catch (e) {
          onError(e);
        }
      };
    });
  }
  bindNotifiers() {
    Array.prototype.forEach.call(this.DOM.notifiersContainer?.children ?? [], (n) => n.addEventListener("animationend", () => this.resetNotifiers("", true)));
    tmg.NOTIFIER_EVENTS.forEach((eN) => this.DOM.notifiersContainer?.addEventListener(eN, this._handleNotifierEvent));
  }
  _handleNotifierEvent = ({ type: eN }) => (this.resetNotifiers(), this.RAFLoop("notifying", () => this.resetNotifiers(eN)));
  resetNotifiers = (n = "", flush = false) => (flush && this.cancelRAFLoop("notifying"), this.DOM.notifiersContainer?.setAttribute("data-notify", n));
  throttle(key, fn, delay = 30, strict = true) {
    if (strict) {
      const now = performance.now();
      if (now - (this.throttleMap.get(key) ?? 0) < delay) return;
      return (this.throttleMap.set(key, now), fn());
    }
    if (this.throttleMap.has(key)) return;
    const id = setTimeout(() => this.throttleMap.delete(key), delay); // uses timeout so code runs when sync thread is free
    return (this.throttleMap.set(key, id), fn());
  }
  RAFLoop(key, fn) {
    this.rafLoopFnMap.set(key, fn);
    const loop = () => (this.rafLoopFnMap.get(key)?.(), this.rafLoopMap.set(key, requestAnimationFrame(loop)));
    !this.rafLoopMap.has(key) && this.rafLoopMap.set(key, requestAnimationFrame(loop)); // taps into that RAF power quite tersely
  }
  cancelRAFLoop = (key) => (cancelAnimationFrame(this.rafLoopMap.get(key)), this.rafLoopFnMap.delete(key), this.rafLoopMap.delete(key));
  cancelAllLoops = () => this.rafLoopMap.keys().forEach(this.cancelRAFLoop);
  cleanUpDOM() {
    this.mutatingDOMM = true;
    this.video.classList.remove("tmg-video", "tmg-media");
    (this.floatingWindow?.removeEventListener("pagehide", this._handleFloatingPlayerClose), this.floatingWindow?.close(), (this.floatingWindow = null));
    if (this.pseudoVideo.isConnected) (this.video.isConnected && this.deactivatePseudoMode(true), this.videoContainer.remove());
    else if (this.video.isConnected) this.videoContainer.parentElement?.replaceChild(this.video, this.videoContainer);
    setTimeout(() => (this.mutatingDOMM = false));
  }
  _destroy() {
    this.setReadyState(-1);
    this.slowDown();
    this.leaveSettingsView();
    t007.toast.dismissAll(this.id);
    (this.cancelAudio(), this.cancelAllLoops());
    (this.unobserveResize(), this.unobserveIntersection());
    this.video.cancelVideoFrameCallback?.(this.frameCallbackId);
    (this.setKeyEventListeners("remove"), this.setVideoEventListeners("remove"));
    this.cleanUpDOM(); // destruction is beyond repair
    return (this.video = this.cloneOnDetach ? tmg.cloneVideo(this.video) : this.video); // src resets - freezing, though not with web default `controls` :(
  }
  plugCSSSettings() {
    this.config.on(
      "settings.css",
      ({ type, target: { key, value } }) => {
        if (type !== "update" && type !== "init") return;
        const apply = (key, value) => {
          const pre = `tmg-video-${tmg.uncamelize(key, "-")}`,
            spec = () => (this.videoContainer.classList.forEach((cls) => cls.startsWith(pre) && this.videoContainer.classList.remove(cls)), this.videoContainer.classList.add(`${pre}-${value}`), true);
          ({ captionsCharacterEdgeStyle: spec, captionsTextAlignment: spec })[key]?.() ?? [this.videoContainer, this.pseudoVideoContainer].forEach((el) => el?.style.setProperty(`--${pre}`, value));
        };
        type !== "init" ? apply(key, value) : Object.keys(value).forEach((k) => k !== "syncWithMedia" && apply(k, value[k]));
      },
      { depth: 1, immediate: true }
    );
    this.CSSCache ??= {};
    ["captionsCharacterEdgeStyle", "captionsTextAlignment"].forEach((key) =>
      this.config.get(`settings.css.${key}`, () => {
        const pre = `tmg-video-${tmg.uncamelize(key, "-")}`,
          value = Array.prototype.find.call(this.videoContainer.classList ?? [], (cls) => cls.startsWith(pre))?.replace(`${pre}-`, "");
        return tmg.parseUIObj(this.settings.captions)[tmg.camelize(key.slice(8))].values.includes(value) ? value : "none";
      })
    );
    for (const sheet of document.styleSheets) {
      try {
        for (const cssRule of sheet.cssRules) {
          if (!cssRule.selectorText?.replace(/\s/g, "")?.includes(":root,.tmg-media-container")) continue;
          for (const property of cssRule.style) {
            if (!property.startsWith("--tmg-video-")) continue;
            const field = tmg.camelize(property.replace("--tmg-video-", ""));
            this.CSSCache[field] = cssRule.style.getPropertyValue(property);
            this.config.get(`settings.css.${field}`, () => getComputedStyle(this.videoContainer).getPropertyValue(property));
          }
        }
      } catch {
        continue;
      }
    }
  }
  initSettingsUIManager() {
    const options = [
        { option: "Light Blue", value: "#3198f5" },
        { option: "Hot Pink", value: "#ff69b4" },
        { option: "Fiery Red", value: "#ff0033" }, // more like, Youtube red :)
        { option: "Dark Turquoise", value: "#00ced1" },
        { option: "Custom Hue", value: "custom" },
        { option: "Video Derived", value: "auto" },
      ],
      gcolors = options.slice(0, -2).map((opt) => opt.value),
      defs = { brand: this.settings.css.brandColor ?? "#e26e02", theme: this.settings.css.themeColor ?? "#ffffff", bcolors: ["#e26e02", ...gcolors], tcolors: ["#ffffff", ...gcolors] },
      bField = createField?.({ type: "select", label: "Brand Color", helperText: { info: "You should just try changing your brand color for now" }, options: [{ option: "Tastey Orange", value: "#e26e02" }, ...options], value: !defs.bcolors.includes(defs.brand) ? (!this.settings.css.syncWithMedia.brandColor ? "custom" : "auto") : defs.brand }),
      cBField = createField?.({ type: "color" }),
      tField = createField?.({ type: "select", label: "Theme Color", helperText: { info: "You should also try changing your theme color for now" }, options: [{ option: "Pure White", value: "#ffffff" }, ...options], value: !defs.tcolors.includes(defs.theme) ? (!this.settings.css.syncWithMedia.themeColor ? "custom" : "auto") : defs.theme }),
      cTField = createField?.({ type: "color" }),
      bWrapper = tmg.createEl("div"),
      tWrapper = tmg.createEl("div");
    this.config.on("settings.css.brandColor", ({ target: { value = defs.brand } }) => ((cBField.inputEl.value = value), cBField.style.setProperty("--input-current-color", value)), { immediate: true });
    this.config.on("settings.css.themeColor", ({ target: { value = defs.theme } }) => ((cTField.inputEl.value = value), cTField.style.setProperty("--input-current-color", value)), { immediate: true });
    this.queryDOM(".tmg-video-settings-bottom-panel").append((bWrapper.append(bField, cBField), bWrapper), (tWrapper.append(tField, cTField), tWrapper));
    const id = { theme: "", brand: "" },
      sync = (cb, req = true, type = "brand") => ((this.settings.css.syncWithMedia[`${type}Color`] = req), cb(req)),
      assert = (opts, type = "brand") => this.toast?.update(id[type], { render: `Still here in case you change your choice about the ${type}`, ...opts }),
      onBColorChange = ({ target: { value: val } }) => {
        this.throttle(
          "brandColorPicking",
          async () => {
            id.brand && this.toast?.dismiss(id.brand);
            let col;
            if (val === "custom") return cBField.inputEl.click();
            if (val !== "auto") col = this.settings.css.brandColor = val;
            else col = this.settings.css.brandColor = (this.loaded ? await this.getMediaMainColor(this.currentTime, null) : null) ?? this.CSSCache.brandColor;
            const cb = (sync) => (bField.inputEl.value = defs.bcolors.includes(col) ? col : sync ? "auto" : "custom"),
              No = () => (sync(cb, false), assert({ actions: { Yes } })),
              Yes = () => (sync(cb, true), assert({ actions: { No } }));
            (sync(cb, val === "auto"), val === "auto" && (id.brand = this.toast?.("Should the brand color change anytime a video loads?", { icon: "🎨", autoClose: 15000, hideProgressBar: false, actions: { Yes, No }, onDismis: () => (id.brand = "") })));
          },
          30,
          false
        );
      },
      onTColorChange = ({ target: { value: val } }) => {
        this.throttle(
          "themeColorPicking",
          async () => {
            id.theme && this.toast?.dismiss(id.theme);
            let col;
            if (val === "custom") return cTField.inputEl.click();
            if (val !== "auto") col = this.settings.css.themeColor = val;
            else col = this.settings.css.themeColor = (this.loaded ? await this.getMediaMainColor(this.currentTime, null) : null) ?? this.CSSCache.themeColor;
            const cb = (sync) => (tField.inputEl.value = defs.tcolors.includes(col) ? col : sync ? "auto" : "custom"),
              No = () => (sync(cb, false, "theme"), assert({ actions: { Yes } }, "theme")),
              Yes = () => (sync(cb, true, "theme"), assert({ actions: { No } }, "theme"));
            (sync(cb, val === "auto", "theme"), val === "auto" && (id.theme = this.toast?.("Should the theme color change anytime a video loads?", { icon: "🎨", autoClose: 15000, hideProgressBar: false, actions: { Yes, No }, onDismiss: () => (id.theme = "") })));
          },
          30
        );
      };
    bField.inputEl.addEventListener("input", onBColorChange);
    cBField.inputEl.addEventListener("input", onBColorChange);
    tField.inputEl.addEventListener("input", onTColorChange);
    cTField.inputEl.addEventListener("input", onTColorChange);
  }
  buildContainers() {
    this.setPosterState(); // had to do this early for the UI
    this.video.parentElement?.insertBefore((this.videoContainer = tmg.createEl("div", { role: "region", ariaLabel: "Video Player", className: `tmg-video-container tmg-media-container${tmg.ON_MOBILE ? " tmg-video-mobile" : ""}${this.video.paused ? " tmg-video-paused" : ""}` }, { trackKind: "captions", volumeLevel: "muted", brightnessLevel: "dark" })), this.video);
    (this.pseudoVideoContainer = tmg.createEl("div", { role: "status", ariaLabel: "Video Player Placeholder", ariaLive: "polite", className: "tmg-pseudo-video-container tmg-media-container" })).append((this.pseudoVideo = tmg.createEl("video", { tmgPlayer: this.video.tmgPlayer, ariaHidden: true, className: "tmg-pseudo-video tmg-media", muted: true, autoplay: false })));
    this.plugCSSSettings(); // as soon as container is ready
    this.videoContainer.dataset.objectFit = this.settings.css.objectFit || "contain";
    (this.syncMediaAspectRatio(), this.syncWithMediaColor());
  }
  buildPlayerInterface() {
    this.videoContainer.insertAdjacentHTML(
      "beforeend",
      `
      <div class="tmg-video-container-content-wrapper">
        <div class="tmg-video-container-content">
          <div class="tmg-video-controls-container">
            <div class="tmg-video-curtain tmg-video-top-curtain"></div>
            <div class="tmg-video-curtain tmg-video-bottom-curtain"></div>
            <div class="tmg-video-curtain tmg-video-cover-curtain"></div>
          </div>
        </div>
        <div class="tmg-video-settings" inert>
          <div class="tmg-video-settings-content">
            <div class="tmg-video-settings-top-panel">
              <button type="button" class="tmg-video-settings-close-btn">
                <svg viewBox="0 0 25 25" class="tmg-video-settings-close-btn-icon">
                  <path transform="translate(0, 4)" d="M1.307,5.988 L6.616,1.343 C7.027,0.933 7.507,0.864 7.918,1.275 L7.918,4.407 C8.014,4.406 8.098,4.406 8.147,4.406 C13.163,4.406 16.885,7.969 16.885,12.816 C16.885,14.504 16.111,13.889 15.788,13.3 C14.266,10.52 11.591,8.623 8.107,8.623 C8.066,8.623 7.996,8.624 7.917,8.624 L7.917,11.689 C7.506,12.099 6.976,12.05 6.615,11.757 L1.306,7.474 C0.897,7.064 0.897,6.399 1.307,5.988 L1.307,5.988 Z"></path>
                </svg>
                <span>Close Settings</span>
              </button>                     
            </div>
            <div class="tmg-video-settings-bottom-panel"><p>No Settings Available Yet!</p></div>
          </div>
        </div>         
      </div>
      <div class="tmg-video-screen-locked-wrapper">
        <button type="button" title="Unlock Screen" class="tmg-video-screen-locked-btn" tabindex="-1">
          <svg class="tmg-video-screen-locked-icon" viewBox="0 0 512 512" data-control-title="Lock Screen" style="scale: 0.825;">
            <path d="M390.234 171.594v-37.375c.016-36.969-15.078-70.719-39.328-94.906A133.88 133.88 0 0 0 256 0a133.88 133.88 0 0 0-94.906 39.313c-24.25 24.188-39.344 57.938-39.313 94.906v37.375H24.906V512h462.188V171.594zm-210.343-37.375c.016-21.094 8.469-39.938 22.297-53.813C216.047 66.594 234.891 58.125 256 58.125s39.953 8.469 53.813 22.281c13.828 13.875 22.281 32.719 22.297 53.813v37.375H179.891zm-96.86 95.5h345.938v224.156H83.031z"/>
            <path d="M297.859 321.844c0-23.125-18.75-41.875-41.859-41.875-23.125 0-41.859 18.75-41.859 41.875 0 17.031 10.219 31.625 24.828 38.156l-9.25 60.094h52.562L273.016 360c14.609-6.531 24.843-21.125 24.843-38.156"/>
          </svg>  
          <svg class="tmg-video-screen-unlock-icon" viewBox="0 0 512 512" data-control-title="Lock Screen" style="scale: 0.875; translate: 0 -1px;">
            <path d="M186.984 203.297v-81.578c.016-19.141 7.688-36.219 20.219-48.813C219.766 60.391 236.859 52.719 256 52.703c19.141.016 36.234 7.688 48.813 20.203 12.531 12.594 20.203 29.672 20.219 48.813v43.406h52.703v-43.406c.016-33.531-13.672-64.125-35.656-86.063C320.125 13.656 289.531-.016 256 0c-33.531-.016-64.125 13.656-86.063 35.656-22 21.938-35.672 52.531-35.656 86.063v81.578H46.438V512h419.125V203.297zM99.141 256H412.86v203.297H99.141z"/>
            <path d="M293.969 339.547c0-20.969-17-37.953-37.969-37.953s-37.953 16.984-37.953 37.953c0 15.453 9.266 28.703 22.516 34.609l-8.391 54.5h47.672l-8.406-54.5c13.25-5.906 22.531-19.156 22.531-34.609"/>
          </svg>  
          <p>Unlock controls?</p>
        </button>
        <p>Screen Locked</p>
        <p>Tap to Unlock</p>
      </div>
      `
    );
    this.queryDOM(".tmg-video-container-content").prepend(this.video);
  }
  getPlayerElements() {
    const k = this.fetchKeyShortcutsForDisplay();
    const _batch = (...els) => els.filter(Boolean);
    return {
      pictureinpicturewrapper: tmg.createEl("div", {
        className: "tmg-video-picture-in-picture-wrapper",
        innerHTML: `<button type="button" class="tmg-video-picture-in-picture-icon-wrapper"><svg class="tmg-video-picture-in-picture-icon" viewBox="0 0 73 73"><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g transform="translate(2, 2)" fill-rule="nonzero" stroke-width="2" class="tmg-video-pip-icon-background"><rect x="-1" y="-1" width="71" height="71" rx="14"></rect></g><g transform="translate(15, 15)" fill-rule="nonzero"><g><polygon class="tmg-video-pip-icon-content-background" points="0 0 0 36 36 36 36 0"></polygon><rect class="tmg-video-pip-icon-content-backdrop" x="4.2890625" y="4.2890625" width="27.421875" height="13.2679687"></rect><g transform="translate(4.289063, 27.492187)"><rect x="0" y="0" width="3.1640625" height="2.109375" class="tmg-video-pip-icon-timeline-progress"></rect><rect x="7.3828125" y="0" width="20.0390625" height="2.109375" class="tmg-video-pip-icon-timeline-base"></rect></g><circle class="tmg-video-pip-icon-thumb-indicator" cx="9.5625" cy="28.546875" r="3.1640625"></circle><polygon class="tmg-video-pip-icon-content" points="31.7109375 17.5569609 31.7109375 23.2734375 4.2890625 23.2734375 4.2890625 17.5569609 13.78125 8.06477344 20.109375 14.3928984 24.328125 10.1741484"></polygon></g><g transform="translate(21, 26)"><polygon class="tmg-video-pip-icon-content-background" points="0 0 0 17.7727273 23 17.7727273 23 0"></polygon><rect class="tmg-video-pip-icon-content-backdrop" x="2.74023438" y="2.74023438" width="17.5195312" height="8.47675781"></rect><polygon class="tmg-video-pip-icon-content"points="20.2597656 11.2169473 20.2597656 14.8691406 2.74023438 14.8691406 2.74023438 11.2169473 8.8046875 5.15249414 12.8476562 9.19546289 15.5429687 6.50015039"></polygon></g></g></g></svg></button><p>Playing in picture-in-picture</p>`,
      }),
      meta: tmg.createEl("div", { className: "tmg-video-meta-wrapper-cover", innerHTML: `<a class="tmg-video-profile-link"><img alt="Profile" class="tmg-video-profile"></a><div class="tmg-video-meta-text-wrapper-cover"><div class="tmg-video-title-wrapper"><a class="tmg-video-title"></a></div><div class="tmg-video-artist-wrapper"><a class="tmg-video-artist"></a></div></div>` }, { draggableControl: "", dragId: "wrapper", controlId: "meta" }),
      videobuffer: tmg.createEl("div", { className: "tmg-video-buffer", innerHTML: `<div class="tmg-video-buffer-accent"></div><div class="tmg-video-buffer-eclipse"><div class="tmg-video-buffer-left"><div class="tmg-video-buffer-circle"></div></div><div class="tmg-video-buffer-right"><div class="tmg-video-buffer-circle"></div></div></div>` }),
      thumbnail: _batch(tmg.createEl("div", { className: "tmg-video-thumbnail" }), tmg.createEl("canvas", { className: "tmg-video-thumbnail" })),
      captionsContainer: tmg.createEl("div", { className: "tmg-video-captions-container" }, { part: "region" }),
      playpausenotifier: _batch(tmg.createEl("div", { className: "tmg-video-notifier tmg-video-play-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-play-notifier-icon"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg>` }), tmg.createEl("div", { className: "tmg-video-notifier tmg-video-pause-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-pause-notifier-icon"><path d="M14,19H18V5H14M6,19H10V5H6V19Z" /></svg>` })),
      prevnextnotifier: _batch(tmg.createEl("div", { className: "tmg-video-notifier tmg-video-prev-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-prev-icon"><rect x="4" y="5.14" width="2.5" height="14" transform="translate(2.1,0)"/><path d="M17,5.14V19.14L6,12.14L17,5.14Z" transform="translate(2.5,0)" /></svg>` }), tmg.createEl("div", { className: "tmg-video-notifier tmg-video-next-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-next-icon"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5,0)" /><rect x="19" y="5.14" width="2.5" height="14" transform="translate(-2.5,0)"/></svg>` })),
      captionsnotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-captions-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-subtitles-icon"><path style="scale: 0.5;" d="M44,6H4A2,2,0,0,0,2,8V40a2,2,0,0,0,2,2H44a2,2,0,0,0,2-2V8A2,2,0,0,0,44,6ZM12,26h4a2,2,0,0,1,0,4H12a2,2,0,0,1,0-4ZM26,36H12a2,2,0,0,1,0-4H26a2,2,0,0,1,0,4Zm10,0H32a2,2,0,0,1,0-4h4a2,2,0,0,1,0,4Zm0-6H22a2,2,0,0,1,0-4H36a2,2,0,0,1,0,4Z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-captions-icon" style="scale: 1.15;"><path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"></path></svg>` }),
      capturenotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-capture-notifier", innerHTML: `<svg viewBox="0 0 24 24" class="tmg-video-capture-icon"><path fill-rule="evenodd" d="M6.937 5.845c.07-.098.15-.219.25-.381l.295-.486C8.31 3.622 8.913 3 10 3h4c1.087 0 1.69.622 2.518 1.978l.295.486c.1.162.18.283.25.381q.071.098.12.155H20a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2.816q.05-.057.121-.155M4 8a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-3c-.664 0-1.112-.364-1.56-.987a8 8 0 0 1-.329-.499c-.062-.1-.27-.445-.3-.492C14.36 5.282 14.088 5 14 5h-4c-.087 0-.36.282-.812 1.022-.029.047-.237.391-.3.492a8 8 0 0 1-.327.5C8.112 7.635 7.664 8 7 8zm15 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2m-7 7a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/></svg>` }),
      playbackratenotifier: _batch(
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-playback-rate-notifier", innerHTML: `<svg viewBox="0 0 30 24"><path d="M22,5.14V19.14L11,12.14L22,5.14Z" /><path d="M11,5.14V19.14L0,12.14L11,5.14Z" /></svg><p class="tmg-video-playback-rate-notifier-text"></p><svg viewBox="0 0 30 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /><path d="M19,5.14V19.14L30,12.14L19,5.14Z" /></svg>` }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-playback-rate-notifier-content" }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-playback-rate-up-notifier", innerHTML: `<svg viewBox="0 0 30 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5, 0)" /><path d="M19,5.14V19.14L30,12.14L19,5.14Z" transform="translate(-2.5, 0)" /></svg>` }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-playback-rate-down-notifier", innerHTML: `<svg viewBox="0 0 30 24"><path d="M22,5.14V19.14L11,12.14L22,5.14Z" transform="translate(2.5, 0)" /><path d="M11,5.14V19.14L0,12.14L11,5.14Z" transform="translate(2.5, 0)" /></svg>` })
      ),
      volumenotifier: _batch(
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-volume-notifier-content" }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-volume-up-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-volume-up-notifier-icon" ><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" /></svg>` }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-volume-down-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-volume-down-notifier-icon"><path d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z" /></svg>` }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-volume-muted-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-volume-muted-notifier-icon"><path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" /></svg>` })
      ),
      brightnessnotifier: _batch(
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-brightness-notifier-content" }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-brightness-up-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-brightness-up-icon"><path transform="translate(1.5, 1.5)" style="scale: 1.05;" d="M10 14.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h3a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm0-15a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm-9 9h3a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm13.95 4.535l2.121 2.122a1 1 0 0 1-1.414 1.414l-2.121-2.121a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-2.12 2.12a1 1 0 1 1-1.415-1.413l2.121-2.122a1 1 0 0 1 1.414 0zM17.071 3.787a1 1 0 0 1 0 1.414L14.95 7.322a1 1 0 0 1-1.414-1.414l2.12-2.121a1 1 0 0 1 1.415 0zm-12.728 0l2.121 2.121A1 1 0 1 1 5.05 7.322L2.93 5.201a1 1 0 0 1 1.414-1.414z"></path></svg>` }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-brightness-down-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-brightness-down-icon"><path transform="translate(3.25, 3.25)" style="scale: 1.05;" d="M8 12.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm-7 7h1a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2zm11.95 4.535l.707.708a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-.707.707A1 1 0 0 1 2.343 13.1l.707-.708a1 1 0 0 1 1.414 0zm9.193-9.192a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zm-9.9 0l.707.707A1 1 0 1 1 3.05 5.322l-.707-.707a1 1 0 0 1 1.414-1.414z"></path></svg>` }),
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-brightness-dark-notifier", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-brightness-dark-icon"><path transform="translate(2, 2.5)" style="scale: 1.2;" d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8.5 2.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 11a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5-5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm-11 0a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9.743-4.036a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm-7.779 7.779a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm7.072 0a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707zM3.757 4.464a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707z"></path></svg>` })
      ),
      objectfitnotifier: _batch(
        tmg.createEl("div", { className: "tmg-video-notifier tmg-video-object-fit-notifier-content" }),
        tmg.createEl("div", {
          className: "tmg-video-notifier tmg-video-object-fit-contain-notifier",
          innerHTML: `<svg viewBox="0 0 16 16" style="scale: 0.78;"><rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3,3)"><path style="scale: 0.6;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.330152,212.999001 L532.488194,212.999001 C532.212773,212.999001 531.997715,213.222859 531.997715,213.499001 C531.997715,213.767068 532.21731,213.999001 532.488194,213.999001 L535.507237,213.999001 C535.643364,213.999001 535.764746,213.944316 535.852704,213.855661 C535.94109,213.763694 535.997715,213.642369 535.997715,213.508523 L535.997715,210.48948 C535.997715,210.214059 535.773858,209.999001 535.497715,209.999001 C535.229649,209.999001 534.997715,210.218596 534.997715,210.48948 L534.997715,212.252351 L530.217991,207.472627 C530.022487,207.277123 529.712749,207.283968 529.517487,207.47923 C529.327935,207.668781 529.319269,207.988118 529.510884,208.179734 L534.330152,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M521.667563,199 L523.509521,199 C523.784943,199 524,198.776142 524,198.5 C524,198.231934 523.780405,198 523.509521,198 L520.490479,198 C520.354351,198 520.232969,198.054685 520.145011,198.14334 C520.056625,198.235308 520,198.356632 520,198.490479 L520,201.509521 C520,201.784943 520.223858,202 520.5,202 C520.768066,202 521,201.780405 521,201.509521 L521,199.74665 L525.779724,204.526374 C525.975228,204.721878 526.284966,204.715034 526.480228,204.519772 C526.66978,204.33022 526.678447,204.010883 526.486831,203.819268 L521.667563,199 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/></g></svg><svg class="tmg-video-object-fit-fill-icon" data-control-title="Stretch${k["objectFit"]}" viewBox="0 0 16 16" style="scale: 0.75;"><rect x="4" y="4" width="8" height="8" rx="1" ry="1" fill="none" stroke-width="1.5" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3, 3)"><path style="scale: 0.65;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520, -198) translate(-3.25, 2.75)" /><path style="scale: 0.65;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520, -198) translate(2.5, -3.25)" /></g></svg>`,
        }),
        tmg.createEl("div", {
          className: "tmg-video-notifier tmg-video-object-fit-cover-notifier",
          innerHTML: `<svg viewBox="0 0 16 16" style="scale: 0.78;"><rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3,3)"><path style="scale: 0.6;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/></g></svg>`,
        }),
        tmg.createEl("div", {
          className: "tmg-video-notifier tmg-video-object-fit-fill-notifier",
          innerHTML: `<svg viewBox="0 0 16 16" style="scale: 0.78;"><rect x="4" y="4" width="8" height="8" rx="1" ry="1" fill="none" stroke-width="1.5" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3, 3)">  <path style="scale: 0.65;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520, -198) translate(-3.25, 2.75)" /><path style="scale: 0.65;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520, -198) translate(2.5, -3.25)" /></g></svg>`,
        })
      ),
      fwdnotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-fwd-notifier", innerHTML: `<svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg>` }),
      bwdnotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-bwd-notifier", innerHTML: `<svg viewBox="0 0 25 25"><path d="M17,5.14V19.14L6,12.14L17,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M17,5.14V19.14L6,12.14L17,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M17,5.14V19.14L6,12.14L17,5.14Z" /></svg>` }),
      scrubnotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-scrub-notifier", innerHTML: `<span><svg viewBox="0 0 25 25"><path d="M17,5.14V19.14L6,12.14L17,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M17,5.14V19.14L6,12.14L17,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M17,5.14V19.14L6,12.14L17,5.14Z" /></svg></span><p class="tmg-video-scrub-notifier-text" tabindex="-1">Double tap left or right to skip ${this.settings.time.skip} seconds</p><span><svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg></span>` }),
      cancelscrubnotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-cancel-scrub-notifier", innerText: "Release to cancel" }),
      touchtimelinenotifier: tmg.createEl("div", { className: "tmg-video-notifier tmg-video-touch-timeline-notifier tmg-video-touch-notifier" }),
      touchvolumenotifier: tmg.createEl("div", {
        className: "tmg-video-notifier tmg-video-touch-volume-notifier tmg-video-touch-vb-notifier",
        innerHTML: `<span class="tmg-video-touch-volume-content tmg-video-touch-vb-content">0</span><div class="tmg-video-touch-volume-slider tmg-video-touch-vb-slider"></div><span><svg viewBox="0 0 25 25" class="tmg-video-volume-high-icon"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"></path></svg><svg viewBox="0 0 25 25" class="tmg-video-volume-low-icon"><path d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z"></path></svg><svg viewBox="0 0 25 25" class="tmg-video-volume-muted-icon"><path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z"></path></svg></span>`,
      }),
      touchbrightnessnotifier: tmg.createEl("div", {
        className: "tmg-video-notifier tmg-video-touch-brightness-notifier tmg-video-touch-vb-notifier",
        innerHTML: `<span class="tmg-video-touch-brightness-content tmg-video-touch-vb-content">0</span><div class="tmg-video-touch-brightness-slider tmg-video-touch-vb-slider"></div><span><svg viewBox="0 0 25 25" class="tmg-video-brightness-high-icon"><path transform="translate(1.5, 1.5)" style="scale: 1.05;" d="M10 14.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h3a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm0-15a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm-9 9h3a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm13.95 4.535l2.121 2.122a1 1 0 0 1-1.414 1.414l-2.121-2.121a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-2.12 2.12a1 1 0 1 1-1.415-1.413l2.121-2.122a1 1 0 0 1 1.414 0zM17.071 3.787a1 1 0 0 1 0 1.414L14.95 7.322a1 1 0 0 1-1.414-1.414l2.12-2.121a1 1 0 0 1 1.415 0zm-12.728 0l2.121 2.121A1 1 0 1 1 5.05 7.322L2.93 5.201a1 1 0 0 1 1.414-1.414z"></path></svg><svg viewBox="0 0 25 25" class="tmg-video-brightness-low-icon"><path transform="translate(3.25, 3.25)" style="scale: 1.05;" d="M8 12.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm-7 7h1a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2zm11.95 4.535l.707.708a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-.707.707A1 1 0 0 1 2.343 13.1l.707-.708a1 1 0 0 1 1.414 0zm9.193-9.192a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zm-9.9 0l.707.707A1 1 0 1 1 3.05 5.322l-.707-.707a1 1 0 0 1 1.414-1.414z"></path></svg><svg viewBox="0 0 25 25" class="tmg-video-brightness-dark-icon"><path transform="translate(2, 2.5)" style="scale: 1.2;" d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8.5 2.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 11a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5-5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm-11 0a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9.743-4.036a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm-7.779 7.779a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm7.072 0a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707zM3.757 4.464a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707z"></path></svg></span>`,
      }),
      expandminiplayer: tmg.createEl("button", { className: "tmg-video-miniplayer-expand-btn", innerHTML: `<svg class="tmg-video-miniplayer-expand-icon" viewBox="0 -960 960 960" data-control-title="Expand miniplayer" style="scale: 0.9; rotate: 90deg;"><path d="M120-120v-320h80v184l504-504H520v-80h320v320h-80v-184L256-200h184v80H120Z"/></svg>` }, { draggableControl: "", controlId: "expandminiplayer" }),
      removeminiplayer: tmg.createEl("button", { className: "tmg-video-miniplayer-remove-btn", innerHTML: `<svg class="tmg-video-miniplayer-remove-icon" viewBox="0 -960 960 960" data-control-title="Remove miniplayer"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>` }, { draggableControl: "", controlId: "removeminiplayer" }),
      capture: tmg.createEl("button", { className: "tmg-video-capture-btn", innerHTML: `<svg viewBox="0 0 24 24" class="tmg-video-capture-icon" data-control-title="Capture${k["capture"]} ↔ DblClick→B&W (+alt)"><path fill-rule="evenodd" d="M6.937 5.845c.07-.098.15-.219.25-.381l.295-.486C8.31 3.622 8.913 3 10 3h4c1.087 0 1.69.622 2.518 1.978l.295.486c.1.162.18.283.25.381q.071.098.12.155H20a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2.816q.05-.057.121-.155M4 8a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-3c-.664 0-1.112-.364-1.56-.987a8 8 0 0 1-.329-.499c-.062-.1-.27-.445-.3-.492C14.36 5.282 14.088 5 14 5h-4c-.087 0-.36.282-.812 1.022-.029.047-.237.391-.3.492a8 8 0 0 1-.327.5C8.112 7.635 7.664 8 7 8zm15 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2m-7 7a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/></svg>` }, { draggableControl: "", controlId: "capture" }),
      fullscreenorientation: tmg.createEl(
        "button",
        {
          className: "tmg-video-fullscreen-orientation-btn",
          innerHTML: `<svg viewBox="0 0 512 512" class="tmg-video-fullscreen-orientation-icon" data-control-title="Change orientation" style="scale: 0.925;"><path d="M446.81,275.82H236.18V65.19c0-20.78-16.91-37.69-37.69-37.69H65.19c-20.78,0-37.69,16.91-37.69,37.69v255.32c0,20.78,16.91,37.68,37.69,37.68h88.62v88.62c0,20.78,16.9,37.69,37.68,37.69h255.32c20.78,0,37.69-16.91,37.69-37.69v-133.3C484.5,292.73,467.59,275.82,446.81,275.82zM65.19,326.19c-3.14,0-5.69-2.55-5.69-5.68V65.19c0-3.14,2.55-5.69,5.69-5.69h133.3c3.14,0,5.69,2.55,5.69,5.69v210.63h-12.69c-20.78,0-37.68,16.91-37.68,37.69v12.68H65.19zM452.5,446.81c0,3.14-2.55,5.69-5.69,5.69H191.49c-3.13,0-5.68-2.55-5.68-5.69V342.19v-28.68c0-2.94,2.24-5.37,5.1-5.66c0.19-0.02,0.38-0.03,0.58-0.03h28.69h226.63c3.14,0,5.69,2.55,5.69,5.69V446.81z"/><path d="M369.92,181.53c-6.25-6.25-16.38-6.25-22.63,0c-6.25,6.25-6.25,16.38,0,22.63l44.39,44.39c3.12,3.13,7.22,4.69,11.31,4.69c0.21,0,0.42-0.02,0.63-0.03c0.2,0.01,0.4,0.03,0.6,0.03c6.31,0,11.74-3.66,14.35-8.96l37.86-37.86c6.25-6.25,6.25-16.38,0-22.63c-6.25-6.25-16.38-6.25-22.63,0l-13.59,13.59v-86.58c0-8.84-7.16-16-16-16h-86.29l15.95-15.95c6.25-6.25,6.25-16.38,0-22.63c-6.25-6.25-16.38-6.25-22.63,0l-40.33,40.33c-5.19,2.65-8.75,8.03-8.75,14.25c0,0.19,0.02,0.37,0.03,0.56c-0.01,0.19-0.03,0.38-0.03,0.57c0,4.24,1.69,8.31,4.69,11.31l42.14,42.14c3.12,3.12,7.22,4.69,11.31,4.69s8.19-1.56,11.31-4.69c6.25-6.25,6.25-16.38,0-22.63l-15.95-15.95h72.54v73.05L369.92,181.53z"/></svg>`,
        },
        { draggableControl: "", controlId: "fullscreenorientation" }
      ),
      fullscreenlock: tmg.createEl("button", { className: "tmg-video-fullscreen-locked-btn", innerHTML: `<svg class="tmg-video-fullscreen-locked-icon" viewBox="0 0 512 512" data-control-title="Lock Screen" style="scale: 0.825;"><path d="M390.234 171.594v-37.375c.016-36.969-15.078-70.719-39.328-94.906A133.88 133.88 0 0 0 256 0a133.88 133.88 0 0 0-94.906 39.313c-24.25 24.188-39.344 57.938-39.313 94.906v37.375H24.906V512h462.188V171.594zm-210.343-37.375c.016-21.094 8.469-39.938 22.297-53.813C216.047 66.594 234.891 58.125 256 58.125s39.953 8.469 53.813 22.281c13.828 13.875 22.281 32.719 22.297 53.813v37.375H179.891zm-96.86 95.5h345.938v224.156H83.031z"/><path d="M297.859 321.844c0-23.125-18.75-41.875-41.859-41.875-23.125 0-41.859 18.75-41.859 41.875 0 17.031 10.219 31.625 24.828 38.156l-9.25 60.094h52.562L273.016 360c14.609-6.531 24.843-21.125 24.843-38.156"/></svg>` }, { draggableControl: "", controlId: "fullscreenlock" }),
      bigprev: tmg.createEl("button", { className: "tmg-video-big-prev-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-prev-icon" data-control-title="Previous video${k["prev"]}"><rect x="4" y="5.14" width="2.5" height="14" transform="translate(2.1,0)"/><path d="M17,5.14V19.14L6,12.14L17,5.14Z" transform="translate(2.5,0)" /></svg>` }, { draggableControl: "", dragId: "big", controlId: "bigprev" }),
      bigplaypause: tmg.createEl("button", { className: "tmg-video-big-play-pause-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-play-icon" data-control-title="Play${k["playPause"]}"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-pause-icon" data-control-title="Pause${k["playPause"]}"><path d="M14,19H18V5H14M6,19H10V5H6V19Z" /></svg><svg class="tmg-video-replay-icon" viewBox="0 -960 960 960" data-control-title="Replay${k["playPause"]}" ><path d="M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440h80q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l62 62-56 58-160-160 160-160 56 58-62 62h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z"/></svg>` }, { draggableControl: "", dragId: "big", controlId: "bigplaypause" }),
      bignext: tmg.createEl("button", { className: "tmg-video-big-next-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-next-icon" data-control-title="Next video${k["next"]}"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5,0)" /><rect x="19" y="5.14" width="2.5" height="14" transform="translate(-2.5,0)"/></svg>` }, { draggableControl: "", dragId: "big", controlId: "bignext" }),
      timeline: tmg.createEl("div", { className: "tmg-video-timeline-container", tabIndex: 0, role: "slider", "aria-label": "Video timeline", "aria-valuemin": "0", "aria-valuenow": "0", "aria-valuetext": "0 seconds out of 0 seconds", innerHTML: `<div class="tmg-video-timeline"><div class="tmg-video-seek-bars-wrapper"><div class="tmg-video-seek-bar tmg-video-base-seek-bar"></div><div class="tmg-video-seek-bar tmg-video-buffered-seek-bar"></div><div class="tmg-video-seek-bar tmg-video-preview-seek-bar"></div><div class="tmg-video-seek-bar tmg-video-played-seek-bar"></div></div><div class="tmg-video-thumb-indicator"></div><div class="tmg-video-preview-container"><div class="tmg-video-preview"></div><canvas class="tmg-video-preview"></canvas></div></div>` }, { controlId: "timeline" }),
      prev: tmg.createEl("button", { className: "tmg-video-prev-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-prev-icon" data-control-title="Previous video${k["prev"]}"><rect x="4" y="5.14" width="2.5" height="14" transform="translate(2.1,0)"/><path d="M17,5.14V19.14L6,12.14L17,5.14Z" transform="translate(2.5,0)" /></svg>` }, { draggableControl: "", controlId: "prev" }),
      playpause: tmg.createEl("button", { className: "tmg-video-play-pause-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-play-icon" data-control-title="Play${k["playPause"]}" style="scale: 1.25;"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-pause-icon" data-control-title="Pause${k["playPause"]}" style="scale: 1.25;"><path d="M14,19H18V5H14M6,19H10V5H6V19Z" /></svg><svg class="tmg-video-replay-icon" viewBox="0 -960 960 960" data-control-title="Replay${k["playPause"]}"><path d="M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440h80q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l62 62-56 58-160-160 160-160 56 58-62 62h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z"/></svg>` }, { draggableControl: "", controlId: "playpause" }),
      next: tmg.createEl("button", { className: "tmg-video-next-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-next-icon" data-control-title="Next video${k["next"]}"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5,0)" /><rect x="19" y="5.14" width="2.5" height="14" transform="translate(-2.5,0)"/></svg>` }, { draggableControl: "", controlId: "next" }),
      volume: tmg.createEl(
        "div",
        {
          className: "tmg-video-volume-container tmg-video-vb-container",
          innerHTML: `<button type="button" class="tmg-video-mute-btn tmg-video-vb-btn"><svg viewBox="0 0 25 25" class="tmg-video-volume-high-icon" data-control-title="Mute${k["mute"]}"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-volume-low-icon" data-control-title="Mute${k["mute"]}"><path d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-volume-muted-icon" data-control-title="Unmute${k["mute"]}"><path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" /></svg></button><span class="tmg-video-volume-slider-wrapper tmg-video-vb-slider-wrapper"><input class="tmg-video-volume-slider tmg-video-vb-slider" type="range" min="0" max="100" step="1"></span>`,
        },
        { draggableControl: "", controlId: "volume" }
      ),
      brightness: tmg.createEl(
        "div",
        {
          className: "tmg-video-brightness-container tmg-video-vb-container",
          innerHTML: `<button type="button" class="tmg-video-dark-btn tmg-video-vb-btn"><svg viewBox="0 0 25 25" class="tmg-video-brightness-high-icon" data-control-title="Darken${k["dark"]}"><path transform="translate(1.5, 1.5)" style="scale: 1.05;" d="M10 14.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h3a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm0-15a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm-9 9h3a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm13.95 4.535l2.121 2.122a1 1 0 0 1-1.414 1.414l-2.121-2.121a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-2.12 2.12a1 1 0 1 1-1.415-1.413l2.121-2.122a1 1 0 0 1 1.414 0zM17.071 3.787a1 1 0 0 1 0 1.414L14.95 7.322a1 1 0 0 1-1.414-1.414l2.12-2.121a1 1 0 0 1 1.415 0zm-12.728 0l2.121 2.121A1 1 0 1 1 5.05 7.322L2.93 5.201a1 1 0 0 1 1.414-1.414z"></path></svg><svg viewBox="0 0 25 25" class="tmg-video-brightness-low-icon" data-control-title="Brighten${k["dark"]}"><path transform="translate(3.25, 3.25)" style="scale: 1.05;" d="M8 12.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm-7 7h1a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2zm11.95 4.535l.707.708a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-.707.707A1 1 0 0 1 2.343 13.1l.707-.708a1 1 0 0 1 1.414 0zm9.193-9.192a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zm-9.9 0l.707.707A1 1 0 1 1 3.05 5.322l-.707-.707a1 1 0 0 1 1.414-1.414z"></path></svg><svg viewBox="0 0 25 25" class="tmg-video-brightness-dark-icon" data-control-title="Brighten${k["dark"]}"><path transform="translate(2, 2.5)" style="scale: 1.2;" d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8.5 2.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 11a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5-5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm-11 0a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9.743-4.036a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm-7.779 7.779a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm7.072 0a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707zM3.757 4.464a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707z"></path></svg></button><span class="tmg-video-brightness-slider-wrapper tmg-video-vb-slider-wrapper"><input class="tmg-video-brightness-slider tmg-video-vb-slider" type="range" min="0" max="100" step="1"></span>`,
        },
        { draggableControl: "", controlId: "brightness" }
      ),
      timeandduration: tmg.createEl("button", { className: "tmg-video-time-and-duration-btn", title: `Switch (mode${k["timeMode"]} / DblClick→format${k["timeFormat"]})`, innerHTML: `<div class="tmg-video-current-time">${this.toTimeText(this.video.currentTime)}</div><span class="tmg-video-time-bridge">/</span><div class="tmg-video-total-time">${this.toTimeText(this.video.duration)}</div>` }, { draggableControl: "", controlId: "timeandduration" }),
      playbackrate: tmg.createEl("button", { className: "tmg-video-playback-rate-btn", title: `Playback rate${k["playbackRateUp"]} ↔ DblClick${k["playbackRateDown"]}`, innerText: `${this.settings.playbackRate.value}x` }, { draggableControl: "", controlId: "playbackrate" }),
      captions: tmg.createEl("button", { className: "tmg-video-captions-btn", innerHTML: `<svg viewBox="0 0 25 25" data-control-title="Subtitles${k["captions"]}" class="tmg-video-subtitles-icon"><path style="scale: 0.5;" d="M44,6H4A2,2,0,0,0,2,8V40a2,2,0,0,0,2,2H44a2,2,0,0,0,2-2V8A2,2,0,0,0,44,6ZM12,26h4a2,2,0,0,1,0,4H12a2,2,0,0,1,0-4ZM26,36H12a2,2,0,0,1,0-4H26a2,2,0,0,1,0,4Zm10,0H32a2,2,0,0,1,0-4h4a2,2,0,0,1,0,4Zm0-6H22a2,2,0,0,1,0-4H36a2,2,0,0,1,0,4Z" /></svg><svg viewBox="0 0 25 25" data-control-title="Closed captions${k["captions"]}" class="tmg-video-captions-icon" style="scale: 1.15;"><path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"></path></svg>` }, { draggableControl: "", controlId: "captions" }),
      settings: tmg.createEl("button", { className: "tmg-video-settings-btn", innerHTML: `<svg class="tmg-video-settings-icon" viewBox="0 -960 960 960" data-control-title="Settings${k["settings"]}"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>` }, { draggableControl: "", controlId: "settings" }),
      objectfit: tmg.createEl(
        "button",
        {
          className: "tmg-video-object-fit-btn",
          innerHTML: `<svg class="tmg-video-object-fit-contain-icon" data-control-title="Crop to fit${k["objectFit"]}" viewBox="0 0 16 16" style="scale: 0.75;"><rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3,3)"><path style="scale: 0.6;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.330152,212.999001 L532.488194,212.999001 C532.212773,212.999001 531.997715,213.222859 531.997715,213.499001 C531.997715,213.767068 532.21731,213.999001 532.488194,213.999001 L535.507237,213.999001 C535.643364,213.999001 535.764746,213.944316 535.852704,213.855661 C535.94109,213.763694 535.997715,213.642369 535.997715,213.508523 L535.997715,210.48948 C535.997715,210.214059 535.773858,209.999001 535.497715,209.999001 C535.229649,209.999001 534.997715,210.218596 534.997715,210.48948 L534.997715,212.252351 L530.217991,207.472627 C530.022487,207.277123 529.712749,207.283968 529.517487,207.47923 C529.327935,207.668781 529.319269,207.988118 529.510884,208.179734 L534.330152,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M521.667563,199 L523.509521,199 C523.784943,199 524,198.776142 524,198.5 C524,198.231934 523.780405,198 523.509521,198 L520.490479,198 C520.354351,198 520.232969,198.054685 520.145011,198.14334 C520.056625,198.235308 520,198.356632 520,198.490479 L520,201.509521 C520,201.784943 520.223858,202 520.5,202 C520.768066,202 521,201.780405 521,201.509521 L521,199.74665 L525.779724,204.526374 C525.975228,204.721878 526.284966,204.715034 526.480228,204.519772 C526.66978,204.33022 526.678447,204.010883 526.486831,203.819268 L521.667563,199 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/></g></svg><svg class="tmg-video-object-fit-cover-icon" data-control-title="Fit to screen${k["objectFit"]}" viewBox="0 0 16 16" style="scale: 0.75;"><rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3,3)"><path style="scale: 0.6;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.330152,212.999001 L532.488194,212.999001 C532.212773,212.999001 531.997715,213.222859 531.997715,213.499001 C531.997715,213.767068 532.21731,213.999001 532.488194,213.999001 L535.507237,213.999001 C535.643364,213.999001 535.764746,213.944316 535.852704,213.855661 C535.94109,213.763694 535.997715,213.642369 535.997715,213.508523 L535.997715,210.48948 C535.997715,210.214059 535.773858,209.999001 535.497715,209.999001 C535.229649,209.999001 534.997715,210.218596 534.997715,210.48948 L534.997715,212.252351 L530.217991,207.472627 C530.022487,207.277123 529.712749,207.283968 529.517487,207.47923 C529.327935,207.668781 529.319269,207.988118 529.510884,208.179734 L534.330152,212.999001 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M521.667563,199 L523.509521,199 C523.784943,199 524,198.776142 524,198.5 C524,198.231934 523.780405,198 523.509521,198 L520.490479,198 C520.354351,198 520.232969,198.054685 520.145011,198.14334 C520.056625,198.235308 520,198.356632 520,198.490479 L520,201.509521 C520,201.784943 520.223858,202 520.5,202 C520.768066,202 521,201.780405 521,201.509521 L521,199.74665 L525.779724,204.526374 C525.975228,204.721878 526.284966,204.715034 526.480228,204.519772 C526.66978,204.33022 526.678447,204.010883 526.486831,203.819268 L521.667563,199 Z" transform="translate(-520 -198)"/><path style="scale: 0.6;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/></g></svg><svg class="tmg-video-object-fit-fill-icon" data-control-title="Stretch${k["objectFit"]}" viewBox="0 0 16 16" style="scale: 0.75;"><rect x="4" y="4" width="8" height="8" rx="1" ry="1" fill="none" stroke-width="1.5" stroke="currentColor"/><g stroke-width="1" stroke="currentColor" transform="translate(3, 3)"><path style="scale: 0.65;" d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520, -198) translate(-3.25, 2.75)" /><path style="scale: 0.65;" d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520, -198) translate(2.5, -3.25)" /></g></svg>`,
        },
        { draggableControl: "", controlId: "objectfit" }
      ),
      pictureinpicture: tmg.createEl("button", { className: "tmg-video-picture-in-picture-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-enter-picture-in-picture-icon" data-control-title="Picture-in-picture${k["pictureInPicture"]}"><path fill-rule="nonzero" d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm0 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8zM6.707 6.293l2.25 2.25L11 6.5V12H5.5l2.043-2.043-2.25-2.25 1.414-1.414z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-leave-picture-in-picture-icon" data-control-title="Exit picture-in-picture${k["pictureInPicture"]}"><path fill-rule="nonzero" d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm0 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8zm-9.5-6L9.457 9.043l2.25 2.25-1.414 1.414-2.25-2.25L6 12.5V7h5.5z"></path></svg>` }, { draggableControl: "", controlId: "pictureinpicture" }),
      theater: tmg.createEl("button", { className: "tmg-video-theater-btn", innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-enter-theater-icon" data-control-title="Cinema mode${k["theater"]}"><path fill-rule="evenodd" clip-rule="evenodd" d="M23 7C23 5.34315 21.6569 4 20 4H4C2.34315 4 1 5.34315 1 7V17C1 18.6569 2.34315 20 4 20H20C21.6569 20 23 18.6569 23 17V7ZM21 7C21 6.44772 20.5523 6 20 6H4C3.44772 6 3 6.44771 3 7V17C3 17.5523 3.44772 18 4 18H20C20.5523 18 21 17.5523 21 17V7Z"/></svg><svg viewBox="0 0 25 25" class="tmg-video-leave-theater-icon" data-control-title="Default view${k["theater"]}"><path d="M19 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H5V8h14v8z"></path></svg>` }, { draggableControl: "", controlId: "theater" }),
      fullscreen: tmg.createEl(
        "button",
        {
          className: "tmg-video-fullscreen-btn",
          innerHTML: `<svg viewBox="0 0 25 25" class="tmg-video-enter-fullscreen-icon" data-control-title="Full screen${k["fullscreen"]}" style="scale: 0.8;"><path d="M4 1.5C2.61929 1.5 1.5 2.61929 1.5 4V8.5C1.5 9.05228 1.94772 9.5 2.5 9.5H3.5C4.05228 9.5 4.5 9.05228 4.5 8.5V4.5H8.5C9.05228 4.5 9.5 4.05228 9.5 3.5V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H4Z" /><path d="M20 1.5C21.3807 1.5 22.5 2.61929 22.5 4V8.5C22.5 9.05228 22.0523 9.5 21.5 9.5H20.5C19.9477 9.5 19.5 9.05228 19.5 8.5V4.5H15.5C14.9477 4.5 14.5 4.05228 14.5 3.5V2.5C14.5 1.94772 14.9477 1.5 15.5 1.5H20Z" /><path d="M20 22.5C21.3807 22.5 22.5 21.3807 22.5 20V15.5C22.5 14.9477 22.0523 14.5 21.5 14.5H20.5C19.9477 14.5 19.5 14.9477 19.5 15.5V19.5H15.5C14.9477 19.5 14.5 19.9477 14.5 20.5V21.5C14.5 22.0523 14.9477 22.5 15.5 22.5H20Z" /><path d="M1.5 20C1.5 21.3807 2.61929 22.5 4 22.5H8.5C9.05228 22.5 9.5 22.0523 9.5 21.5V20.5C9.5 19.9477 9.05228 19.5 8.5 19.5H4.5V15.5C4.5 14.9477 4.05228 14.5 3.5 14.5H2.5C1.94772 14.5 1.5 14.9477 1.5 15.5V20Z" /></svg><svg viewBox="0 0 25 25" class="tmg-video-leave-fullscreen-icon" data-control-title="Exit full screen${k["fullscreen"]}" style="scale: 0.8;"><path d="M7 9.5C8.38071 9.5 9.5 8.38071 9.5 7V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H7.5C6.94772 1.5 6.5 1.94772 6.5 2.5V6.5H2.5C1.94772 6.5 1.5 6.94772 1.5 7.5V8.5C1.5 9.05228 1.94772 9.5 2.5 9.5H7Z" /><path d="M17 9.5C15.6193 9.5 14.5 8.38071 14.5 7V2.5C14.5 1.94772 14.9477 1.5 15.5 1.5H16.5C17.0523 1.5 17.5 1.94772 17.5 2.5V6.5H21.5C22.0523 6.5 22.5 6.94772 22.5 7.5V8.5C22.5 9.05228 22.0523 9.5 21.5 9.5H17Z" /><path d="M17 14.5C15.6193 14.5 14.5 15.6193 14.5 17V21.5C14.5 22.0523 14.9477 22.5 15.5 22.5H16.5C17.0523 22.5 17.5 22.0523 17.5 21.5V17.5H21.5C22.0523 17.5 22.5 17.0523 22.5 16.5V15.5C22.5 14.9477 22.0523 14.5 21.5 14.5H17Z" /><path d="M9.5 17C9.5 15.6193 8.38071 14.5 7 14.5H2.5C1.94772 14.5 1.5 14.9477 1.5 15.5V16.5C1.5 17.0523 1.94772 17.5 2.5 17.5H6.5V21.5C6.5 22.0523 6.94772 22.5 7.5 22.5H8.5C9.05228 22.5 9.5 22.0523 9.5 21.5V17Z" /></svg>`,
        },
        { draggableControl: "", controlId: "fullscreen" }
      ),
    };
  }
  plugControlPanelSettings() {
    this.config.set("settings.controlPanel.bottom", tmg.parsePanelBottomObj);
    const HTML = this.getPlayerElements(),
      getSplitControls = (row, spacer = "spacer") => {
        if (!row?.length) return { left: [], center: [], right: [] };
        const s1 = row.indexOf(spacer),
          s2 = row.indexOf(spacer, s1 + 1);
        return s1 === -1 ? { left: row, center: [], right: [] } : s2 === -1 ? { left: row.slice(0, s1), center: [], right: row.slice(s1 + 1) } : { left: row.slice(0, s1), center: row.slice(s1 + 1, s2), right: row.slice(s2 + 1) };
      },
      getZoneW = (value, fb) => (value.length === 1 ? (value.includes("meta") ? HTML.meta : value.includes("timeline") ? HTML.timeline : fb) : fb),
      fillSWrapper = (wrapper, zoneWs) => ((wrapper.innerHTML = ""), wrapper.append(...zoneWs.map((zoneW) => zoneW.cover ?? zoneW))),
      fillZone = (zoneW, controls) => zoneW.zone && ((zoneW.zone.innerHTML = ""), (controls || []).forEach((id) => HTML[id] && (tmg.isArr(HTML[id]) ? zoneW.zone.append(...HTML[id]) : zoneW.zone.append(HTML[id])))),
      buildWSkel = (side, isReverse) => {
        const zone = tmg.createEl("div", { className: `tmg-video-side-controls-wrapper tmg-video-${side}-side-controls-wrapper` }, { dropZone: "", scroller: isReverse ? "reverse" : "" }),
          cover = tmg.createEl("div", { className: `tmg-video-side-controls-wrapper-cover tmg-video-${side}-side-controls-wrapper-cover` });
        return (cover.append(zone), { cover, zone });
      };
    const controlsContainer = this.queryDOM(".tmg-video-controls-container"),
      notifiersContainer = tmg.createEl("div", { className: "tmg-video-notifiers-container" }, { notify: "" });
    notifiersContainer?.append(...[HTML.playpausenotifier, HTML.prevnextnotifier, HTML.captionsnotifier, HTML.capturenotifier, HTML.objectfitnotifier, HTML.playbackratenotifier, HTML.volumenotifier, HTML.brightnessnotifier, HTML.fwdnotifier, HTML.bwdnotifier, HTML.scrubnotifier, HTML.cancelscrubnotifier, HTML.touchtimelinenotifier, HTML.touchvolumenotifier, HTML.touchbrightnessnotifier].flat().filter(Boolean));
    ((this.zoneWs = { top: {}, center: {}, bottom: { 1: {}, 2: {}, 3: {} } }), (this.cZoneWs = { top: {}, center: [], bottom: { 1: {}, 2: {}, 3: {} } }));
    const topWrapper = tmg.createEl("div", { className: "tmg-video-top-controls-wrapper tmg-video-apt-controls-wrapper" }, { dropZone: "", dragId: "wrapper" });
    ((this.zoneWs.top.left = buildWSkel("left", false)), (this.zoneWs.top.center = buildWSkel("center", false)), (this.zoneWs.top.right = buildWSkel("right", true)));
    const centerWrapper = tmg.createEl("div", { className: "tmg-video-big-controls-wrapper" }, { dropZone: "", dragId: "big" });
    this.zoneWs.center = this.cZoneWs.center = { zone: centerWrapper };
    const bottomWrapper = tmg.createEl("div", { className: "tmg-video-bottom-controls-wrapper" });
    [1, 2, 3].forEach((i) => {
      bottomWrapper.append(tmg.createEl("div", { className: `tmg-video-bottom-sub-controls-wrapper tmg-video-bottom-${i}-sub-controls-wrapper tmg-video-apt-controls-wrapper` }, { dropZone: "", dragId: "wrapper" }));
      ((this.zoneWs.bottom[i].left = buildWSkel("left", false)), (this.zoneWs.bottom[i].center = buildWSkel("center", false)), (this.zoneWs.bottom[i].right = buildWSkel("right", true)));
    });
    controlsContainer.prepend(...[HTML.pictureinpicturewrapper, HTML.thumbnail, HTML.videobuffer, HTML.captionsContainer].flat().filter(Boolean), notifiersContainer, topWrapper, centerWrapper, bottomWrapper);
    this.pseudoVideoContainer.append(HTML.pictureinpicturewrapper?.cloneNode(true) || "");
    ["settings.controlPanel.title", "settings.controlPanel.artist", "settings.controlPanel.profile"].forEach((e) => this.config.on(e, ({ target: { key, value } }) => value !== true && (this.DOM[`video${tmg.capitalize(key)}`][key === "profile" ? "src" : "textContent"] = value || "")));
    this.config.on("settings.controlPanel.top", ({ target: { value } }) => {
      const t1 = getSplitControls(value);
      fillSWrapper(topWrapper, [(this.cZoneWs.top.left = getZoneW(t1.left, this.zoneWs.top.left)), (this.cZoneWs.top.center = getZoneW(t1.center, this.zoneWs.top.center)), (this.cZoneWs.top.right = getZoneW(t1.right, this.zoneWs.top.right))]);
      (fillZone(this.cZoneWs.top.left, t1.left), fillZone(this.cZoneWs.top.center, t1.center), fillZone(this.cZoneWs.top.right, t1.right));
    });
    this.config.on("settings.controlPanel.center", ({ target: { value } }) => fillZone(this.cZoneWs.center, value));
    this.config.on("settings.controlPanel.bottom", ({ target: { value } }) => {
      [1, 2, 3].forEach((i) => {
        const bn = getSplitControls(value[i]);
        fillSWrapper(bottomWrapper.children[i - 1], [(this.cZoneWs.bottom[i].left = getZoneW(bn.left, this.zoneWs.bottom[i].left)), (this.cZoneWs.bottom[i].center = getZoneW(bn.center, this.zoneWs.bottom[i].center)), (this.cZoneWs.bottom[i].right = getZoneW(bn.right, this.zoneWs.bottom[i].right))]);
        (fillZone(this.cZoneWs.bottom[i].left, bn.left), fillZone(this.cZoneWs.bottom[i].center, bn.center), fillZone(this.cZoneWs.bottom[i].right, bn.right));
      });
    });
    this.config.on("settings.controlPanel.buffer", ({ target: { value } }) => (this.videoContainer.dataset.buffer = value));
    this.config.on("settings.controlPanel.timeline.thumbIndicator", ({ target: { value } }) => (this.videoContainer.dataset.thumbIndicator = value));
    this.config.on("settings.controlPanel.progressBar", ({ target: { value } }) => this.videoContainer.classList.toggle("tmg-video-progress-bar", value));
    this.config.on("settings.controlPanel.draggable", ({ target: { value } }) => this.setDragEventListeners(value ? "add" : "remove"));
    this.settings.controlPanel = this.settings.controlPanel;
    (this.config.tick("settings.controlPanel"), this.config.tick(["settings.controlPanel.top", "settings.controlPanel.center", "settings.controlPanel.bottom"])); // needed for DOM retrieval
  }
  getZones = () => [...Object.values(this.zoneWs.top), ...Object.values(this.zoneWs.bottom).map((v) => Object.values(v))].flat().map((w) => w.zone);
  getUIZoneWCoord(target, zoneW = false) {
    let key;
    const pos = { 0: "left", 1: "center", 2: "right" }[[...target.parentElement.children].indexOf(target)],
      cws = this.queryDOM(".tmg-video-top-controls-wrapper, .tmg-video-bottom-sub-controls-wrapper", false, true);
    cws.forEach((w, i) => w.contains(target) && (key = { 0: "top.", 1: "bottom.1.", 2: "bottom.2.", 3: "bottom.3." }[i]));
    return zoneW ? { coord: key + pos, zoneW: tmg.getAny(this.zoneWs, key + pos) } : key + pos;
  }
  syncControlPanelToUI() {
    const id = (el) => el.dataset.controlId,
      derive = (zoneW, center = false) => [center ? "spacer" : "", ...(!zoneW.zone ? [id(zoneW)] : Array.from(zoneW.zone.children || [], id)), center && (zoneW.zone ? zoneW.zone.children.length : true) ? "spacer" : ""].filter(Boolean); // at lease one spacer
    this.settings.controlPanel.top = [...derive(this.cZoneWs.top.left), ...derive(this.cZoneWs.top.center, true), ...derive(this.cZoneWs.top.right)];
    this.settings.controlPanel.center = [...derive(this.zoneWs.center)];
    this.settings.controlPanel.bottom = {
      1: [...derive(this.cZoneWs.bottom[1].left), ...derive(this.cZoneWs.bottom[1].center, true), ...derive(this.cZoneWs.bottom[1].right)],
      2: [...derive(this.cZoneWs.bottom[2].left), ...derive(this.cZoneWs.bottom[2].center, true), ...derive(this.cZoneWs.bottom[2].right)],
      3: [...derive(this.cZoneWs.bottom[3].left), ...derive(this.cZoneWs.bottom[3].center, true), ...derive(this.cZoneWs.bottom[3].right)],
    };
  }
  queryDOM = (query, isPseudo = false, all = false) => (isPseudo ? this.pseudoVideoContainer : this.videoContainer)[all ? "querySelectorAll" : "querySelector"](query);
  retrieveDOM() {
    this.DOM = {
      screenLockedWrapper: this.queryDOM(".tmg-video-screen-locked-wrapper"),
      screenLockedBtn: this.queryDOM(".tmg-video-screen-locked-btn"),
      videoSettings: this.queryDOM(".tmg-video-settings"),
      videoContainerContentWrapper: this.queryDOM(".tmg-video-container-content-wrapper"),
      videoContainerContent: this.queryDOM(".tmg-video-container-content"),
      controlsContainer: this.queryDOM(".tmg-video-controls-container"),
      bigControlsWrapper: this.queryDOM(".tmg-video-big-controls-wrapper"),
      topControlsWrapper: this.queryDOM(".tmg-video-top-controls-wrapper"),
      bottomControlsWrapper: this.queryDOM(".tmg-video-bottom-controls-wrapper"),
      sideControlWrappers: this.videoContainer.getElementsByClassName("tmg-video-side-controls-wrapper"), // has to be dynamic
      pictureInPictureWrapper: this.queryDOM(".tmg-video-picture-in-picture-wrapper"),
      pictureInPictureIconWrapper: this.queryDOM(".tmg-video-picture-in-picture-icon-wrapper"),
      videoProfile: this.queryDOM(".tmg-video-profile"),
      videoTitle: this.queryDOM(".tmg-video-title"),
      videoArtist: this.queryDOM(".tmg-video-artist"),
      thumbnailImg: this.queryDOM("div.tmg-video-thumbnail"),
      thumbnailCanvas: this.queryDOM("canvas.tmg-video-thumbnail"),
      videoBuffer: this.queryDOM(".tmg-video-buffer"),
      notifiersContainer: this.queryDOM(".tmg-video-notifiers-container"),
      playbackRateNotifier: this.queryDOM(".tmg-video-playback-rate-notifier"),
      playbackRateNotifierText: this.queryDOM(".tmg-video-playback-rate-notifier-text"),
      playbackRateNotifierContent: this.queryDOM(".tmg-video-playback-rate-notifier-content"),
      volumeNotifierContent: this.queryDOM(".tmg-video-volume-notifier-content"),
      brightnessNotifierContent: this.queryDOM(".tmg-video-brightness-notifier-content"),
      objectFitNotifierContent: this.queryDOM(".tmg-video-object-fit-notifier-content"),
      scrubNotifier: this.queryDOM(".tmg-video-scrub-notifier"),
      cancelScrubNotifier: this.queryDOM(".tmg-video-cancel-scrub-notifier"),
      fwdNotifier: this.queryDOM(".tmg-video-fwd-notifier"),
      bwdNotifier: this.queryDOM(".tmg-video-bwd-notifier"),
      touchTimelineNotifier: this.queryDOM(".tmg-video-touch-timeline-notifier"),
      touchVolumeContent: this.queryDOM(".tmg-video-touch-volume-content"),
      touchVolumeNotifier: this.queryDOM(".tmg-video-touch-volume-notifier"),
      touchVolumeSlider: this.queryDOM(".tmg-video-touch-volume-slider"),
      touchBrightnessContent: this.queryDOM(".tmg-video-touch-brightness-content"),
      touchBrightnessNotifier: this.queryDOM(".tmg-video-touch-brightness-notifier"),
      touchBrightnessSlider: this.queryDOM(".tmg-video-touch-brightness-slider"),
      captionsContainer: this.queryDOM(".tmg-video-captions-container"),
      bigPrevBtn: this.queryDOM(".tmg-video-big-prev-btn"),
      bigPlayPauseBtn: this.queryDOM(".tmg-video-big-play-pause-btn"),
      bigNextBtn: this.queryDOM(".tmg-video-big-next-btn"),
      miniplayerExpandBtn: this.queryDOM(".tmg-video-miniplayer-expand-btn"),
      miniplayerRemoveBtn: this.queryDOM(".tmg-video-miniplayer-remove-btn"),
      fullscreenOrientationBtn: this.queryDOM(".tmg-video-fullscreen-orientation-btn"),
      captureBtn: this.queryDOM(".tmg-video-capture-btn"),
      fullscreenLockBtn: this.queryDOM(".tmg-video-fullscreen-locked-btn"),
      timelineContainer: this.queryDOM(".tmg-video-timeline-container"),
      timeline: this.queryDOM(".tmg-video-timeline"),
      previewContainer: this.queryDOM(".tmg-video-preview-container"),
      previewImg: this.queryDOM("div.tmg-video-preview"),
      previewCanvas: this.queryDOM("canvas.tmg-video-preview"),
      prevBtn: this.queryDOM(".tmg-video-prev-btn"),
      playPauseBtn: this.queryDOM(".tmg-video-play-pause-btn"),
      nextBtn: this.queryDOM(".tmg-video-next-btn"),
      objectFitBtn: this.queryDOM(".tmg-video-object-fit-btn"),
      volumeContainer: this.queryDOM(".tmg-video-volume-container"),
      volumeSlider: this.queryDOM(".tmg-video-volume-slider"),
      brightnessContainer: this.queryDOM(".tmg-video-brightness-container"),
      brightnessSlider: this.queryDOM(".tmg-video-brightness-slider"),
      timeAndDurationBtn: this.queryDOM(".tmg-video-time-and-duration-btn"),
      currentTimeElement: this.queryDOM(".tmg-video-current-time"),
      timeBridgeElement: this.queryDOM(".tmg-video-time-bridge"),
      totalTimeElement: this.queryDOM(".tmg-video-total-time"),
      muteBtn: this.queryDOM(".tmg-video-mute-btn"),
      darkBtn: this.queryDOM(".tmg-video-dark-btn"),
      captionsBtn: this.queryDOM(".tmg-video-captions-btn"),
      settingsBtn: this.queryDOM(".tmg-video-settings-btn"),
      playbackRateBtn: this.queryDOM(".tmg-video-playback-rate-btn"),
      pictureInPictureBtn: this.queryDOM(".tmg-video-picture-in-picture-btn"),
      theaterBtn: this.queryDOM(".tmg-video-theater-btn"),
      fullscreenBtn: this.queryDOM(".tmg-video-fullscreen-btn"),
      svgs: this.videoContainer.getElementsByTagName("svg"),
      draggableControls: this.queryDOM("[data-draggable-control]", false, true),
      dropZones: [...this.queryDOM("[data-drop-zone][data-drag-id]", false, true), ...this.getZones()],
      settingsCloseBtn: this.settings ? this.queryDOM(".tmg-video-settings-close-btn") : null,
    };
  }
  initPlayer() {
    this.retrieveDOM();
    (this.observeResize(), this.observeIntersection());
    this.setUpSvgs();
    (this.setVideoEventListeners(), this.setControlsEventListeners());
    (this.plugMedia(), this.plugLightState(), this.plugVolumeSettings(), this.plugBrightnessSettings(), this.plugPlaybackRateSettings(), this.plugCaptionsSettings());
    (this.plugTimeSettings(), this.plugModesSettings(), this.plugBetaSettings(), this.plugKeysSettings(), this.plugToastsSettings(), this.plugLocked());
    this[`toggle${tmg.capitalize(this.config.initialMode)}Mode`]?.(true);
    !this.video.currentSrc && this._handleLoadedError();
    this._handleLoadStart();
    this.setReadyState(1);
    !this.config.lightState.disabled ? this.addLightState() : this.initHeavyControls();
    this.plugDisabled();
  }
  plugLightState() {
    this.config.set("lightState.disabled", (value) => (this.readyState !== 1 ? TERMINATOR : value));
    this.config.on("lightState.disabled", ({ target: { value, object }, root }) => {
      if (value) {
        if (this.settings.time.start != null) this.actualTimeStart = this.currentTime = this.settings.time.start;
        this.videoContainer.classList.remove("tmg-video-light");
        this.video.removeEventListener("play", this.removeLightState);
        this.DOM.controlsContainer.removeEventListener("click", this._handleLightStateClick);
        this.initHeavyControls();
      } else {
        root.lightState.preview.usePoster = object.preview.usePoster;
        root.lightState.preview.time = object.preview.time;
        this.videoContainer.classList.add("tmg-video-light");
        this.video.addEventListener("play", this.removeLightState);
        this.DOM.controlsContainer.addEventListener("click", this._handleLightStateClick);
      }
    });
    this.config.on("lightState.controls", () => this.queryDOM("[data-control-id]", false, true).forEach((c) => (c.dataset.lightControl = this.isLight(c.dataset.controlId) ? "true" : "false")));
    this.config.on("lightState.preview.usePoster", ({ target: { value }, root }) => !root.lightState.disabled && (!value || !this.video.poster) && (this.currentTime = root.lightState.preview.time));
    this.config.on("lightState.preview.time", ({ target: { value, object }, root }) => !root.lightState.disabled && (!object.usePoster || !this.video.poster) && (this.currentTime = value));
    this.config.lightState = this.config.lightState;
  }
  addLightState = () => (this.config.lightState.disabled = false);
  removeLightState = () => {
    this.config.lightState.disabled = true;
    (this.isLight("bigplaypause") && this.stall(), this.togglePlay(true));
  };
  isLight = (controlId) => tmg.inBoolArrOpt(this.config.lightState.controls, controlId);
  _handleLightStateClick = ({ target }) => target === this.DOM.controlsContainer && this.removeLightState();
  stall() {
    this.showOverlay();
    this.DOM.bigPlayPauseBtn && this.videoContainer.classList.add("tmg-video-stall");
    this.DOM.bigPlayPauseBtn?.addEventListener("animationend", () => this.videoContainer.classList.remove("tmg-video-stall"), { once: true });
  }
  setControlState = (btn, { hidden = false, disabled = false }) => (btn?.classList?.toggle("tmg-video-control-hidden", hidden), btn?.classList?.toggle("tmg-video-control-disabled", disabled));
  setControlsState(controlId) {
    const atFirst = this.currentPlaylistIndex <= 0,
      atLast = !this.config.playlist || this.currentPlaylistIndex >= this.config.playlist.length - 1;
    const groups = {
      fullscreenlock: () => this.setControlState(this.DOM.fullscreenLockBtn, { hidden: !(tmg.ON_MOBILE && this.isUIActive("fullscreen")) }),
      fullscreenorientation: () => !this.isUIActive("fullscreen") && this.setControlState(this.DOM.fullscreenOrientationBtn, { hidden: true }),
      captions: () => this.setControlState(this.DOM.captionsBtn, { disabled: !this.video.textTracks[this.textTrackIndex] }),
      playbackrate: () => this.DOM.playbackRateBtn && (this.DOM.playbackRateBtn.textContent = `${this.settings.playbackRate.value}x`),
      pictureinpicture: () => this.setControlState(this.DOM.pictureInPictureBtn, { hidden: !this.settings.modes.pictureInPicture }),
      theater: () => this.setControlState(this.DOM.theaterBtn, { hidden: !this.settings.modes.theater }),
      fullscreen: () => this.setControlState(this.DOM.fullscreenBtn, { hidden: this.settings.modes.fullscreen.disabled }),
      playlist: () => {
        (this.DOM && this.setControlState(this.DOM.bigPrevBtn, { hidden: !(this.config.playlist?.length > 1), disabled: atFirst }), this.setControlState(this.DOM.bigNextBtn, { hidden: !(this.config.playlist?.length > 1), disabled: atLast }));
        (this.DOM && this.setControlState(this.DOM.prevBtn, { hidden: atFirst }), this.setControlState(this.DOM.nextBtn, { hidden: atLast }));
      },
    };
    if (tmg.isArr(controlId)) controlId.forEach((g) => groups[g]?.());
    else if (controlId) groups[controlId]?.();
    else Object.values(groups).forEach((fn) => fn());
  }
  setImgLoadState = ({ target: img }) => img?.setAttribute("data-loaded", img.complete && img.naturalWidth > 0);
  setImgFallback = ({ target: img }) => (img.src = TMG_VIDEO_ALT_IMG_SRC);
  setCanvasFallback = (canvas, context, img) => (img = canvas && tmg.createEl("img", { src: TMG_VIDEO_ALT_IMG_SRC, onload: () => context?.drawImage(img, 0, 0, canvas.width, canvas.height) }));
  initHeavyControls() {
    if (this.readyState !== 1) return;
    this.video.currentSrc && this._handleLoadedMetadata();
    (this.setContainersEventListeners(), this.setSettingsViewEventListeners());
    this.setReadyState(2);
    this._handleMediaIntersectionChange(this.isIntersecting); // not calling for parent cuz of apt autoplay
    !this.video.paused ? this.setReadyState(3) : this.video.addEventListener("play", () => this.setReadyState(3), { once: true });
  }
  setKeyEventListeners(act = "add", main = !this.isUIActive("settings"), area) {
    if ((act === "add" && this.readyState < 2) || this.disabled || this.settings.locked) return;
    main && [this.floatingWindow, area !== "floating" ? window : null].forEach((w) => w?.[`${act}EventListener`]("keydown", this._handleKeyDown));
    [this.floatingWindow, area !== "floating" ? window : null].forEach((w) => w?.[`${act}EventListener`]("keyup", main ? this._handleKeyUp : this._handleSettingsKeyUp));
  }
  setContainersEventListeners() {
    this.videoContainer.addEventListener("click", this._handleLockScreenClick);
    this.videoContainer.addEventListener("wheel", this._handleGestureWheel, { passive: false });
    [this.DOM.controlsContainer, this.DOM.bottomControlsWrapper].forEach((el) => {
      el.addEventListener("contextmenu", this._handleRightClick);
      el.addEventListener("click", this._handleAnyClick, true);
      (el.addEventListener("focusin", this._handleFocusIn, true), el.addEventListener("keydown", this._handleKeyFocusIn, true));
      ["pointermove", "dragenter", "scroll"].forEach((e) => el.addEventListener(e, this._handleHoverPointerActive, true));
      el.addEventListener("mouseleave", this._handleHoverPointerOut, true);
    });
    tmg.addSafeClicks(this.DOM.controlsContainer, this._handleClick, this._handleDblClick, true);
    this.DOM.controlsContainer.addEventListener("pointerdown", this._handleSpeedPointerDown, true);
    this.DOM.controlsContainer.addEventListener("touchstart", this._handleGestureTouchStart, true);
  }
  setVideoEventListeners(act = "add") {
    act !== "add" && !this.config.lightState.disabled && this.video.removeEventListener("play", this.removeLightState);
    this.video[`${act}EventListener`]("error", this._handleLoadedError);
    (this.video[`${act}EventListener`]("play", this._handlePlay), this.video[`${act}EventListener`]("pause", this._handlePause));
    (this.video[`${act}EventListener`]("waiting", this._handleBufferStart), this.video[`${act}EventListener`]("playing", this._handleBufferStop));
    this.video[`${act}EventListener`]("durationchange", this._handleDurationChange);
    this.video[`${act}EventListener`]("ratechange", this._handlePlaybackRateChange);
    this.video[`${act}EventListener`]("volumechange", this._handleNativeVolumeChange);
    this.video[`${act}EventListener`]("timeupdate", this._handleTimeUpdate);
    this.video[`${act}EventListener`]("progress", this._handleLoadedProgress);
    this.video[`${act}EventListener`]("loadstart", this._handleLoadStart);
    this.video[`${act}EventListener`]("loadedmetadata", this._handleLoadedMetadata);
    this.video[`${act}EventListener`]("loadeddata", this._handleLoadedData);
    this.video[`${act}EventListener`]("ended", this._handleEnded);
    this.video[`${act}EventListener`]("enterpictureinpicture", this._handleEnterPictureInPicture);
    this.video[`${act}EventListener`]("leavepictureinpicture", this._handleLeavePictureInPicture);
    this.video[`${act}EventListener`]("webkitendfullscreen", this._handleIOSFullscreenEnd);
    this.video.textTracks[`${act}EventListener`]("addtrack", this._handleTextTrackChange);
    this.video.textTracks[`${act}EventListener`]("removetrack", this._handleTextTrackChange);
    this.video.textTracks[`${act}EventListener`]("change", this._handleTextTrackChange);
  }
  setControlsEventListeners() {
    this.bindNotifiers(); // notifiers event listeners
    this.DOM.screenLockedBtn?.addEventListener("click", this._handleLockBtnClick);
    this.DOM.miniplayerExpandBtn?.addEventListener("click", this.expandMiniplayer);
    this.DOM.miniplayerRemoveBtn?.addEventListener("click", this.removeMiniplayer);
    this.DOM.fullscreenOrientationBtn?.addEventListener("click", () => this.changeScreenOrientation());
    this.DOM.fullscreenLockBtn?.addEventListener("click", this.lock);
    [this.DOM.bigPrevBtn, this.DOM.prevBtn].forEach((el) => el?.addEventListener("click", this.previousVideo));
    [this.DOM.bigPlayPauseBtn, this.DOM.playPauseBtn].forEach((el) => el?.addEventListener("click", this.togglePlay));
    [this.DOM.bigNextBtn, this.DOM.nextBtn].forEach((el) => el?.addEventListener("click", this.nextVideo));
    tmg.addSafeClicks(this.DOM.captureBtn, this.captureVideoFrame, () => this.captureVideoFrame("monochrome"));
    tmg.addSafeClicks(this.DOM.timeAndDurationBtn, this.toggleTimeMode, this.rotateTimeFormat);
    tmg.addSafeClicks(this.DOM.playbackRateBtn, this.rotatePlaybackRate, () => this.rotatePlaybackRate("backwards"));
    this.DOM.captionsBtn?.addEventListener("click", this.toggleCaptions);
    this.DOM.muteBtn?.addEventListener("click", this.toggleMute);
    this.DOM.darkBtn?.addEventListener("click", this.toggleDark);
    this.DOM.objectFitBtn?.addEventListener("click", this.rotateObjectFit);
    this.DOM.theaterBtn?.addEventListener("click", this.toggleTheaterMode);
    this.DOM.fullscreenBtn?.addEventListener("click", this.toggleFullscreenMode);
    [this.DOM.pictureInPictureBtn, this.DOM.pictureInPictureIconWrapper].forEach((el) => el?.addEventListener("click", this.togglePictureInPictureMode));
    this.DOM.settingsBtn?.addEventListener("click", this.toggleSettingsView);
    // timeline event listeners
    this.DOM.timelineContainer?.addEventListener("pointerdown", this._handleTimelinePointerDown);
    this.DOM.timelineContainer?.addEventListener("keydown", this._handleTimelineKeyDown);
    this.DOM.timeline?.addEventListener("mousemove", this._handleTimelineInput);
    ["mouseleave", "touchend", "touchcancel"].forEach((e) => this.DOM.timeline?.addEventListener(e, this.stopTimePreviewing));
    // captions container listeners
    this.DOM.captionsContainer?.addEventListener("pointerdown", this._handleCaptionsDragStart);
    // volume event listeners
    this.DOM.volumeSlider?.addEventListener("input", this._handleVolumeSliderInput);
    this.DOM.volumeContainer?.addEventListener("mousemove", this._handleVolumeContainerMouseMove);
    this.DOM.volumeContainer?.addEventListener("mouseleave", this._handleVolumeContainerMouseLeave);
    // brightness event listeners
    this.DOM.brightnessSlider?.addEventListener("input", this._handleBrightnessSliderInput);
    this.DOM.brightnessContainer?.addEventListener("mousemove", this._handleBrightnessContainerMouseMove);
    this.DOM.brightnessContainer?.addEventListener("mouseleave", this._handleBrightnessContainerMouseLeave);
    // image event listeners
    ["load", "error"].forEach((e) => this.DOM.videoProfile?.addEventListener(e, this.setImgLoadState));
    // pseudo event listeners
    this.queryDOM(".tmg-video-picture-in-picture-icon-wrapper", true).addEventListener("click", this.togglePictureInPictureMode);
  }
  setDragEventListeners(want = "add") {
    this.DOM.draggableControls?.forEach((c) => {
      c.dataset.dragId = c.dataset.dragId ?? "";
      const act = !tmg.inBoolArrOpt(this.settings.controlPanel.draggable, c.dataset.dragId) ? "remove" : want;
      c.dataset.draggableControl = c.draggable = act === "add";
      c[`${act}EventListener`]("dragstart", this._handleDragStart);
      c[`${act}EventListener`]("drag", this._handleDrag);
      c[`${act}EventListener`]("dragend", this._handleDragEnd);
    });
    this.DOM.dropZones?.forEach((c) => {
      c.dataset.dragId = c.dataset.dragId ?? "";
      const act = !tmg.inBoolArrOpt(this.settings.controlPanel.draggable, c.dataset.dragId) ? "remove" : want;
      c.dataset.dropZone = act === "add";
      c[`${act}EventListener`]("dragenter", this._handleDragEnter);
      c[`${act}EventListener`]("dragover", this._handleDragOver);
      c[`${act}EventListener`]("drop", this._handleDrop);
      c[`${act}EventListener`]("dragleave", this._handleDragLeave);
    });
  }
  setSettingsViewEventListeners() {
    this.DOM.settingsCloseBtn?.addEventListener("click", this.leaveSettingsView);
  }
  toggleSettingsView = async () => await (!this.isUIActive("settings") ? this.enterSettingsView : this.leaveSettingsView)();
  async enterSettingsView() {
    if (this.isUIActive("settings")) return;
    ((this.wasPaused = this.video.paused), this.togglePlay(false));
    this.videoContainer.classList.add("tmg-video-settings-view");
    await tmg.mockAsync(tmg.parseCSSTime(this.settings.css.settingsViewTransitionTime));
    this.showOverlay();
    (this.DOM.videoSettings.removeAttribute("inert"), this.DOM.videoContainerContent.setAttribute("inert", ""));
    this.DOM.settingsCloseBtn.focus();
    (this.setKeyEventListeners("add", false), this.setKeyEventListeners("remove", true));
  }
  async leaveSettingsView() {
    if (!this.isUIActive("settings")) return;
    this.videoContainer.classList.remove("tmg-video-settings-view");
    await tmg.mockAsync(tmg.parseCSSTime(this.settings.css.settingsViewTransitionTime));
    this.togglePlay(!this.wasPaused);
    (this.DOM.videoSettings.setAttribute("inert", ""), this.DOM.videoContainerContent.removeAttribute("inert"));
    this.DOM.settingsCloseBtn.blur();
    (this.setKeyEventListeners("remove", false), this.setKeyEventListeners("add", true));
  }
  _handleSettingsKeyUp(e) {
    const action = this.keyEventAllowed(e);
    if (action === false) return;
    else if (action) this.showOverlay();
    switch (action) {
      case "settings":
        return this.leaveSettingsView();
    }
  }
  observeResize() {
    this._handleMediaParentResize();
    tmg.initScrollAssist(this.DOM.videoTitle, { pxPerSecond: 60 });
    tmg.initScrollAssist(this.DOM.videoArtist, { pxPerSecond: 30 });
    Array.prototype.forEach.call(this.DOM.sideControlWrappers, (el) => {
      this._handleControlsWrapperResize(el);
      tmg.initScrollAssist(el, { pxPerSecond: 60 });
      el && tmg.resizeObserver.observe(el);
      el?.addEventListener("scroll", this._handleDirtyScroll, { passive: true });
    });
    [this.videoContainer, this.pseudoVideoContainer].forEach((el) => tmg.resizeObserver.observe(el));
  }
  unobserveResize() {
    tmg.removeScrollAssist(this.DOM.videoTitle);
    tmg.removeScrollAssist(this.DOM.videoArtist);
    Array.prototype.forEach.call(this.DOM.sideControlWrappers, (el) => {
      tmg.removeScrollAssist(el);
      el && tmg.resizeObserver.unobserve(el);
    });
    [this.videoContainer, this.pseudoVideoContainer].forEach((el) => tmg.resizeObserver.unobserve(el));
  }
  observeIntersection() {
    tmg.intersectionObserver.observe(this.videoContainer.parentElement);
    tmg.intersectionObserver.observe(this.video);
  }
  unobserveIntersection() {
    const p = this.pseudoVideoContainer.parentElement ?? this.videoContainer.parentElement;
    p && tmg.intersectionObserver.unobserve(p);
    tmg.intersectionObserver.unobserve(this.video);
  }
  _handleResize = (target) => (target.classList.contains("tmg-media-container") ? this._handleMediaParentResize(target.className.includes("pseudo")) : target.classList.contains("tmg-video-side-controls-wrapper") && this._handleControlsWrapperResize(target));
  _handleMediaParentResize(isPseudo = false) {
    const getTier = (container) => {
      const { offsetWidth: w, offsetHeight: h } = container;
      return { w, h, tier: h <= 130 ? "xxxxx" : w <= 280 ? "xxxx" : w <= 380 ? "xxx" : w <= 480 ? "xx" : w <= 630 ? "x" : "" };
    };
    if (!isPseudo) {
      const { w, h, tier } = getTier(this.videoContainer);
      ((this.settings.css.currentContainerWidth = `${w}px`), (this.settings.css.currentContainerHeight = `${h}px`));
      this.videoContainer.dataset.sizeTier = tier;
      this.syncThumbnailSize();
      (this.syncCaptionsSize(), this.previewCaptions("")); // reconstruct to rewrap text :(
    } else {
      const { tier } = getTier(this.pseudoVideoContainer);
      this.pseudoVideoContainer.dataset.sizeTier = tier;
    }
  }
  _handleControlsWrapperResize = (wrapper) => this._handleControlsView({ target: wrapper });
  _handleWindowResize() {
    if (!this.isUIActive("fullscreen")) this.toggleMiniplayerMode();
  }
  _handleOrientationChange() {
    if (!tmg.ON_MOBILE || this.settings.modes.fullscreen.onRotate === false || this.isUIActive("fullscreen")) return;
    const deg = "boolean" === typeof this.settings.modes.fullscreen.onRotate ? 90 : parseInt(this.settings.modes.fullscreen.onRotate);
    if (screen.orientation?.angle === deg || screen.orientation?.angle === 360 - deg) this.toggleFullscreenMode();
  }
  _handleMediaIntersectionChange(isIntersecting) {
    this.isIntersecting = isIntersecting;
    this.readyState > 1 && this.setKeyEventListeners(this.isIntersecting ? "add" : "remove"); // stateful
  }
  _handleMediaParentIntersectionChange(isIntersecting) {
    this.parentIntersecting = isIntersecting;
    (this._handleMediaAptAutoPlay(this.settings.auto.pause, false), this._handleMediaAptAutoPlay());
    this.readyState > 2 && this.toggleMiniplayerMode(); // behavioral
  }
  _handleMediaAptAutoPlay = (auto = this.settings.auto.play, bool = true, p = this.parentIntersecting ? "in" : "out") => (auto == `${p}-view-always` ? this.togglePlay(bool) : auto == `${p}-view` && this.readyState < 3 && this.togglePlay(bool));
  _handleVisibilityChange() {
    document.visibilityState !== "visible" && this.stopTimeScrubbing(); // tending to some observed glitches when visibility changes
  }
  _handleDirtyScroll({ currentTarget: el }) {
    if (el.scrollLeft > 0) el.dataset.hasScrolled = true;
    el.dataset.resetScrolled = el.scrollLeft === (el.dataset.scroller === "reverse" ? el.scrollWidth - el.clientWidth : 0);
  }
  _handleControlsView({ target: w }, spacer) {
    let c = w?.children?.[0];
    do {
      c?.setAttribute("data-displayed", getComputedStyle(c).display !== "none" ? "true" : "false");
      c?.setAttribute("data-spacer", false);
      if (c?.dataset.displayed === "true" && !spacer) spacer = c;
    } while ((c = c?.nextElementSibling));
    this.settings.css.currentTopWrapperHeight = this.DOM.topControlsWrapper.offsetHeight + "px";
    this.settings.css.currentBottomWrapperHeight = this.DOM.bottomControlsWrapper.offsetHeight + "px";
    if (w?.dataset.scroller !== "reverse") return;
    spacer?.setAttribute("data-spacer", true);
    if (w.dataset.resetScrolled === "true") w.dataset.hasScrolled = false;
    if (w.dataset.hasScrolled === "true" || w.scrollWidth <= w.clientWidth || w.scrollLeft === w.scrollWidth - w.clientWidth) return w.scrollWidth <= w.clientWidth && (w.dataset.hasScrolled = false);
    w.addEventListener("scroll", () => (w.dataset.hasScrolled = false), { once: true });
    w.scrollLeft = w.scrollWidth - w.clientWidth;
  }
  setUpSvgs() {
    Array.prototype.forEach.call(this.DOM.svgs, (svg) => {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const title = svg.getAttribute("data-control-title");
      if (title) svg.addEventListener("mouseover", () => (svg.parentElement.title = title));
    });
  }
  deactivate(message) {
    (this.showOverlay(), this.showUIMessage(message));
    (this.setCanvasFallback(this.DOM.previewCanvas, this.previewContext), this.setCanvasFallback(this.DOM.thumbnailCanvas, this.thumbnailContext));
    this.videoContainer.classList.add("tmg-video-inactive");
  }
  reactivate() {
    if (!this.videoContainer.classList.contains("tmg-video-inactive") || !this.loaded) return;
    this.removeUIMessage();
    this.videoContainer.classList.remove("tmg-video-inactive");
  }
  plugDisabled() {
    this.config.on("disabled", ({ target: { value } }) => {
      if (value) {
        (this.leaveSettingsView(), this.cancelAllLoops());
        this.videoContainer.classList.add("tmg-video-disabled");
        (this.togglePlay(false), this.showOverlay());
        this.DOM.videoContainerContent.setAttribute("inert", "");
        this.setKeyEventListeners("remove");
        this.toast?.warn("You cannot access the custom controls when disabled");
        this.log("You cannot access the custom controls when disabled", "warn");
      } else {
        this.videoContainer.classList.remove("tmg-video-disabled");
        this.DOM.videoContainerContent.removeAttribute("inert");
        this.setKeyEventListeners("add");
      }
    });
    this.config.disabled = this.config.disabled;
  }
  plugLocked() {
    this.config.on("settings.locked", async ({ target: { value } }) => {
      if (value) {
        this.leaveSettingsView();
        setTimeout(this.showLockedOverlay);
        this.videoContainer.classList.add("tmg-video-locked", "tmg-video-progress-bar");
        this.removeOverlay("force");
        this.setKeyEventListeners("remove");
      } else {
        this.removeLockedOverlay();
        await tmg.mockAsync(tmg.parseCSSTime(this.settings.css.switchTransitionTime));
        this.videoContainer.classList.toggle("tmg-video-progress-bar", this.settings.controlPanel.progressBar);
        this.videoContainer.classList.remove("tmg-video-locked");
        this.showOverlay();
        this.setKeyEventListeners("add");
      }
    });
    this.settings.locked = this.settings.locked;
  }
  lock = () => (this.settings.locked = true);
  unlock = () => (this.settings.locked = false);
  _handleLockBtnClick(e) {
    e.stopPropagation();
    this.delayLockedOverlay();
    e.currentTarget.classList.contains("tmg-video-control-unlock") ? this.unlock() : e.currentTarget.classList.add("tmg-video-control-unlock");
  }
  activatePseudoMode() {
    this.mutatingDOMM = true;
    ((this.pseudoVideo.id = this.video.id), (this.video.id = ""));
    this.pseudoVideo.className += " " + this.video.className.replace(/tmg-media|tmg-video/g, "");
    this.pseudoVideoContainer.className += " " + this.videoContainer.className.replace(/tmg-media-container|tmg-pseudo-video-container/g, "");
    this.videoContainer.parentElement?.insertBefore(this.pseudoVideoContainer, this.videoContainer);
    document.body.append(this.videoContainer);
    setTimeout(() => (this.mutatingDOMM = false));
  }
  deactivatePseudoMode(destroy) {
    this.mutatingDOMM = true;
    ((this.video.id = this.pseudoVideo.id), (this.pseudoVideo.id = ""));
    this.pseudoVideo.className = "tmg-pseudo-video tmg-media";
    this.pseudoVideoContainer.className = "tmg-pseudo-video-container tmg-media-container";
    this.pseudoVideoContainer.parentElement?.replaceChild(destroy ? this.video : this.videoContainer, this.pseudoVideoContainer);
    !destroy && setTimeout(() => (this.mutatingDOMM = false));
  }
  convertToMonoChrome(canvas, context) {
    const frame = context.getImageData(0, 0, canvas.width || 1, canvas.height || 1);
    for (let i = 0; i < frame.data.length / 4; i++) {
      const grey = (frame.data[i * 4 + 0] + frame.data[i * 4 + 1] + frame.data[i * 4 + 2]) / 3;
      ((frame.data[i * 4 + 0] = grey), (frame.data[i * 4 + 1] = grey), (frame.data[i * 4 + 2] = grey));
    }
    context.putImageData(frame, 0, 0);
  }
  async getVideoFrame(display, time = this.currentTime, raw = false, min = 0, video = this.pseudoVideo) {
    if (video !== this.video) {
      await this.frameReadyPromise; // wait for it to get set by last getter 5 lines below
      if (Math.abs(video.currentTime - time) > 0.01) {
        this.frameReadyPromise ??= new Promise((res) => video.addEventListener("timeupdate", () => res(null), { once: true }));
        video.currentTime = time; // small epsilon tolerance for video time comparison - 0.01(10ms)
      }
      this.frameReadyPromise = await this.frameReadyPromise;
    }
    ((this.exportCanvas.width = video.videoWidth || min), (this.exportCanvas.height = video.videoHeight || min));
    this.exportContext.drawImage(video, 0, 0, this.exportCanvas.width, this.exportCanvas.height);
    display === "monochrome" && this.convertToMonoChrome(this.exportCanvas, this.exportContext);
    if (raw === true) return { canvas: this.exportCanvas, context: this.exportContext };
    const blob = (this.exportCanvas.width || this.exportCanvas.height) && (await new Promise((res) => this.exportCanvas.toBlob(res)));
    return { blob, url: blob && URL.createObjectURL(blob) };
  }
  async captureVideoFrame(display = "", time = this.currentTime) {
    this.notify("capture");
    const tTxt = tmg.formatMediaTime({ time, format: "human", showMs: true }),
      fTxt = `video frame ${display === "monochrome" ? "in b&w " : ""}at ${tTxt}`,
      frameToastId = this.toast?.loading(`Capturing ${fTxt}...`, { delay: tmg.parseCSSTime(this.settings.css.notifiersAnimationTime), image: TMG_VIDEO_ALT_IMG_SRC, tag: `tmg-${this.config.media.title ?? "Video"}fcpa${tTxt}${display}` }),
      frame = await this.getVideoFrame(display, time, false, 0, this.video),
      filename = `${this.config.media.title ?? "Video"}_${display === "monochrome" ? `black&white_` : ""}at_${tTxt}.png`.replace(/[\/:*?"<>|\s]+/g, "_"); // system filename safe
    const Save = () => {
      this.toast?.loading(frameToastId, { render: `Saving ${fTxt}`, actions: {} });
      tmg.createEl("a", { href: frame.url, download: filename })?.click?.();
      this.toast?.success(frameToastId, { delay: 1000, render: `Saved ${fTxt}`, actions: {} });
    };
    const Share = () => {
      this.toast?.loading(frameToastId, { render: `Sharing ${fTxt}`, actions: {} });
      navigator.share?.({ title: this.config.media.title ?? "Video", text: `Captured ${fTxt}`, files: [new File([frame.blob], filename, { type: frame.blob.type })] }).then(
        () => this.toast?.success(frameToastId, { render: `Shared ${fTxt}`, actions: {} }),
        () => this.toast?.error(frameToastId, { render: `Failed sharing ${fTxt}`, actions: { Save } })
      ) || this.toast?.warn(frameToastId, { delay: 1000, render: `Couldn't share ${fTxt}`, actions: { Save } });
    };
    frame?.url ? this.toast?.success(frameToastId, { render: `Captured ${fTxt}`, image: frame.url, autoClose: this.settings.toasts.captureAutoClose, actions: { Save, Share }, onClose: () => URL.revokeObjectURL(frame.url) }) : this.toast?.error(frameToastId, { render: `Failed capturing ${fTxt}` });
  }
  async findGoodFrameTime({ time: t = this.currentTime, secondsLimit: s = 25, saturation: sat = 12, brightness: bri = 40 }) {
    const end = tmg.clamp(0, t + s, this.duration);
    for (; t <= end; t += 0.333) {
      const rgb = await tmg.getDominantColor((await this.getVideoFrame("", t, true, 1)).canvas, "rgb", true); // ~3 frames per second
      if (rgb && tmg.getRGBBri(rgb) > bri && tmg.getRGBSat(rgb) > sat) return t; // <= FIRST legit content frame
    }
    return null;
  }
  getMediaMainColor = async (time, poster = this.video.poster, config = {}) => await tmg.getDominantColor(poster ? poster : (await this.getVideoFrame("", time ? time : await this.findGoodFrameTime(config), true, 1)).canvas);
  async syncWithMediaColor(...args) {
    const color = this.loaded && (await this.getMediaMainColor(...args)),
      keys = Object.keys(this.settings.css.syncWithMedia).filter((k) => this.settings.css.syncWithMedia[k]);
    keys?.forEach((k) => (this.settings.css[k] = (this.loaded ? color : null) ?? this.CSSCache[k]));
  }
  syncMediaSession() {
    if (!navigator.mediaSession || (document.pictureInPictureElement && !this.isUIActive("pictureInPicture"))) return;
    if (this.config.media) navigator.mediaSession.metadata = new MediaMetadata(this.config.media);
    const set = (...args) => navigator.mediaSession.setActionHandler(...args);
    (set("play", () => this.togglePlay(true)), set("pause", () => this.togglePlay(false)));
    (set("seekbackward", () => this.skip(-this.settings.time.skip)), set("seekforward", () => this.skip(this.settings.time.skip)));
    set("previoustrack", this.config.playlist && this.currentPlaylistIndex > 0 ? this.previousVideo : null);
    set("nexttrack", this.config.playlist && this.currentPlaylistIndex < this.config.playlist.length - 1 ? this.nextVideo : null);
  }
  syncMediaAspectRatio() {
    this.mediaAspectRatio = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
    this.settings.css.aspectRatio = this.video.videoWidth && this.video.videoHeight ? `${this.video.videoWidth} / ${this.video.videoHeight}` : "16 / 9";
  }
  isUIActive(mode) {
    switch (mode) {
      case "miniplayer":
        return this.videoContainer.classList.contains("tmg-video-miniplayer");
      case "fullscreen":
        return this.videoContainer.classList.contains("tmg-video-fullscreen");
      case "pictureInPicture":
        return this.videoContainer.classList.contains("tmg-video-picture-in-picture");
      case "floatingPlayer":
        return this.videoContainer.classList.contains("tmg-video-floating-player");
      case "theater":
        return this.videoContainer.classList.contains("tmg-video-theater");
      case "settings":
        return this.videoContainer.classList.contains("tmg-video-settings-view");
      case "captions":
        return this.videoContainer.classList.contains("tmg-video-captions");
      case "captionsPreview":
        return this.videoContainer.classList.contains("tmg-video-captions-preview");
      case "overlay":
        return this.videoContainer.classList.contains("tmg-video-overlay");
      default:
        return false;
    }
  }
  showUIMessage = (message) => message && this.DOM.videoContainerContent.setAttribute("data-message", message);
  removeUIMessage = () => this.DOM.videoContainerContent.removeAttribute("data-message");
  get duration() {
    return tmg.safeNum(this.video.duration);
  }
  get currentTime() {
    return tmg.safeNum(this.video.currentTime);
  }
  set currentTime(value) {
    this.video.currentTime = tmg.safeNum(tmg.clamp(this.settings.time.min, value, this.settings.time.max));
  }
  _handleLoadedError(error) {
    this.loaded = false;
    this.settings.css.currentBufferedPosition = 0;
    this.deactivate(this.settings.errorMessages?.[this.video.error?.code ?? (error && 5)] || (typeof error === "string" && error) || error?.message || this.video.error?.message || (error && "An unknown error occurred with the video :("));
  }
  _handleLoadStart() {
    this.loaded = false;
    this.stats = { fps: 30 };
    (this.setControlsState(), this.setCaptionsState());
    this.showOverlay();
    this.settings.css.currentPlayedPosition = this.settings.css.currentThumbPosition = this.settings.css.currentBufferedPosition = 0;
  }
  _handleLoadedMetadata() {
    this.loaded = true;
    this.actualTimeStart = this.settings.time.start;
    if (this.settings.time.start != null && this.config.lightState.disabled) this.currentTime = this.actualTimeStart;
    this.pseudoVideo.src = this.video.currentSrc;
    this.pseudoVideo.crossOrigin = this.video.crossOrigin;
    this.pseudoVideo.addEventListener("timeupdate", ({ target: v }) => (v.ontimeupdate = this.syncCanvasPreviews), { once: true }); // anonymous low cost
    (this.syncMediaAspectRatio(), this.syncWithMediaColor());
    this.setCaptionsState();
    this.reactivate();
  }
  _handleLoadedData = this._handleDurationChange;
  _handleDurationChange = () => {
    this.DOM.totalTimeElement.textContent = this.toTimeText(this.video.duration);
    this.DOM.timelineContainer?.setAttribute("aria-valuemax", Math.floor(this.duration));
  };
  _handleLoadedProgress() {
    for (let i = 0; i < this.video.buffered.length; i++) if (this.video.buffered.start(this.video.buffered.length - 1 - i) < this.currentTime) return (this.settings.css.currentBufferedPosition = this.video.buffered.end(this.video.buffered.length - 1 - i) / this.duration);
  }
  togglePlay = async (bool) => await this.video[("boolean" === typeof bool ? bool : this.video.paused) ? "play" : "pause"]();
  replay = () => ((this.currentTime = 0), this.video.play()); // ! - start is 0 and falsy
  previousVideo = () => (this.currentTime >= 3 ? this.replay() : this.config.playlist && this.currentPlaylistIndex > 0 && this.movePlaylistTo(this.currentPlaylistIndex - 1, true));
  nextVideo = () => this.config.playlist && this.currentPlaylistIndex < this.config.playlist.length - 1 && this.movePlaylistTo(this.currentPlaylistIndex + 1, true);
  movePlaylistTo(index, shouldPlay) {
    if (!this.config.playlist) return this.setControlsState("playlist");
    this.currentPlaylistIndex = index;
    const v = this.config.playlist[index];
    this.config.media = v.media;
    ["min", "max", "start", "end", "previews"].forEach((prop) => (this.settings.time[prop] = v.settings.time[prop]));
    this.config.tracks = v.tracks ?? [];
    this.config.src = v.src || "";
    if ("sources" in v) this.config.sources = v.sources;
    "boolean" === typeof shouldPlay && this.togglePlay(shouldPlay);
    this.canAutoMovePlaylist = true;
  }
  autonextVideo() {
    if (!this.loaded || !this.config.playlist || this.settings.auto.next < 0 || !this.canAutoMovePlaylist || this.currentPlaylistIndex >= this.config.playlist.length - 1 || this.video.paused || this.buffering) return;
    this.canAutoMovePlaylist = false;
    const count = tmg.clamp(1, Math.round((this.settings.time.end ?? this.duration) - this.currentTime), this.settings.auto.next),
      v = this.config.playlist[this.currentPlaylistIndex + 1];
    const nVTId = this.toast?.("", {
      autoClose: count * 1000,
      hideProgressBar: false,
      position: "bottom-right",
      bodyHTML: `<span title="Play next video" class="tmg-video-next-preview-wrapper">
        <button type="button"><svg viewBox="0 0 25 25"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg></button>
        <video class="tmg-video-next-preview" poster="${v.media?.artwork?.[0]?.src}" src="${v.src || ""}" muted playsinline webkit-playsinline preload="metadata"></video>
        <p>${this.toTimeText(NaN)}</p>
      </span>
      <span class="tmg-video-next-info">
        <h2>Next Video in <span class="tmg-video-next-countdown">${count}</span></h2>
        ${v.media.title ? `<p class="tmg-video-next-title">${v.media.title}</p>` : ""}
      </span>`,
      onTimeUpdate: (time) => this.throttle("nextVideoCountdown", () => ((this.queryDOM(".tmg-video-next-countdown").textContent = Math.max(Math.round(count - time / 1000), 1)), 250)),
      onClose: (timeElapsed) => (removeListeners(), timeElapsed && this.nextVideo()),
      tag: "tmg-anvi",
    });
    const cleanUpWhenNeeded = () => !this.video.ended && cleanUp(),
      autoCleanUpToast = () => Math.floor((this.settings.time.end ?? this.duration) - this.currentTime) > this.settings.auto.next && cleanUp(),
      cleanUp = (permanent = false) => (t007.toast.dismiss(nVTId, "instant"), (this.nextVideoPreview = null), (this.canAutoMovePlaylist = !permanent)),
      removeListeners = () => ["timeupdate", "pause", "waiting"].forEach((e, i) => this.video.removeEventListener(e, !i ? autoCleanUpToast : cleanUpWhenNeeded));
    ["timeupdate", "pause", "waiting"].forEach((e, i) => this.video.addEventListener(e, !i ? autoCleanUpToast : cleanUpWhenNeeded));
    const nVP = (this.nextVideoPreview = this.queryDOM(".tmg-video-next-preview"));
    nVP?.toggleAttribute("poster", v.media?.artwork?.[0]?.src);
    v.sources?.length && tmg.addSources(v.sources, nVP);
    ["loadedmetadata", "loaded", "durationchange"].forEach((e) => nVP?.addEventListener(e, ({ target: p }) => (p.nextElementSibling.textContent = this.toTimeText(p.duration))));
    this.settings.toasts.nextVideoPreview = this.settings.toasts.nextVideoPreview; // force UI update
    nVP?.previousElementSibling?.addEventListener("click", () => (cleanUp(true), this.nextVideo()), true); // all admittedly a terse func, auto next shouldn't be deep
  }
  _handlePlay() {
    for (const media of document.querySelectorAll("video, audio")) media !== this.video && !media.paused && media.pause();
    this.videoContainer.classList.remove("tmg-video-paused");
    this.delayOverlay();
    this.syncMediaSession();
    this.leaveSettingsView();
    this.toggleMiniplayerMode();
    // this.frameCallbackId = this.video.requestVideoFrameCallback?.(this._handleFrameUpdate); // will start dis with S.I.A maybe, there's more efficient ways to log sef
    if (this.loaded || this.video.currentSrc) ((this.loaded = true), !this.video.error && this.reactivate());
  }
  _handlePause() {
    this.showOverlay();
    this.videoContainer.classList.add("tmg-video-paused");
    this._handleBufferStop();
  }
  _handleEnded = () => {
    this.showOverlay();
    this.videoContainer.classList.add("tmg-video-replay");
  };
  _handleBufferStart() {
    this.buffering = tmg.ON_MOBILE && this.currentSkipNotifier ? "skip" : true;
    tmg.ON_MOBILE && this.showOverlay();
    this.videoContainer.classList.add("tmg-video-buffering");
  }
  _handleBufferStop() {
    const buffered = this.buffering;
    this.buffering = false;
    tmg.ON_MOBILE && (buffered === "skip" ? this.removeOverlay() : this.delayOverlay());
    this.videoContainer.classList.remove("tmg-video-buffering");
  }
  plugTimeSettings() {
    this.config.set("settings.time.previews", (value, _, { target: { oldValue } }) => (tmg.isObj(value) && tmg.isObj(oldValue) ? tmg.mergeObjs(oldValue, value) : value));
    this.config.on("settings.time.previews", ({ type, currentTarget: { value } }) => {
      if (type === "update") return;
      const manual = value && value?.address && (value?.spf || (value?.cols && value?.rows));
      this.settings.css.altImgUrl = `url(${TMG_VIDEO_ALT_IMG_SRC})`;
      this.videoContainer.classList.toggle("tmg-video-no-previews", !value);
      this.videoContainer.dataset.previewType = value ? (manual ? (value?.cols && value?.rows ? "sprite" : "image") : "canvas") : "none";
      if (value?.cols && value?.rows && value?.address) this.settings.css.currentPreviewUrl = this.settings.css.currentThumbnailUrl = `url(${value.address})`;
      else this.settings.css.currentPreviewPosition = this.settings.css.currentThumbnailPosition = "center";
      if (!value || manual) return;
      ((this.previewContext ??= this.DOM.previewCanvas?.getContext("2d")), (this.thumbnailContext ??= this.DOM.thumbnailCanvas?.getContext("2d")));
      !this.loaded && (this.setCanvasFallback(this.DOM.previewCanvas, this.previewContext), this.setCanvasFallback(this.DOM.thumbnailCanvas, this.thumbnailContext), (this.pseudoVideo.ontimeupdate = null));
    });
    this.config.on("settings.css.currentThumbnailWidth", ({ target: { value } }) => (this.DOM.thumbnailCanvas.width = parseFloat(value)));
    this.config.on("settings.css.currentThumbnailHeight", ({ target: { value } }) => (this.DOM.thumbnailCanvas.height = parseFloat(value)));
    this.settings.time = this.settings.time;
  }
  guardTimeValues = () => ["lightState.preview.time", "settings.time.min", "settings.time.max", "settings.time.start", "settings.time.end", "settings.toasts.nextVideoPreview.time"].forEach((p) => this.config.get(p, this.toTimeVal));
  toTimeText = (time = this.video.currentTime, useMode = false, showMs = false) => (!useMode || this.settings.time.mode !== "remaining" ? tmg.formatMediaTime({ time, format: this.settings.time.format, elapsed: true, showMs }) : `${tmg.formatMediaTime({ time: this.video.duration - time, format: this.settings.time.format, elapsed: false, showMs })}`); // DRY quick util
  toTimeVal = (value) => tmg.parseIfPercent(value, this.duration);
  _handleTimelinePointerDown(e) {
    if (this.isScrubbing) return;
    this.isScrubbing = true;
    this.DOM.timelineContainer?.setPointerCapture(e.pointerId);
    ((this.lastTimelinePointerX = e.clientX), (this.lastTimelineThumbPosition = Number(this.settings.css.currentThumbPosition)));
    this.wasPaused = this.video.paused;
    this.scrubbingId = setTimeout(() => {
      this.togglePlay(false);
      this.videoContainer.classList.add("tmg-video-scrubbing");
      tmg.ON_MOBILE && this.DOM.scrubNotifier?.classList.add("tmg-video-control-active");
    }, 100);
    this.syncThumbnailSize();
    this._handleTimelineInput(e);
    this.DOM.timelineContainer?.addEventListener("pointermove", this._handleTimelineInput);
    this.DOM.timelineContainer?.addEventListener("pointerup", this.stopTimeScrubbing);
  }
  stopTimeScrubbing() {
    if (!this.isScrubbing) return;
    this.isScrubbing = false;
    const newPos = (this.settings.css.currentPlayedPosition = this.settings.css.currentThumbPosition = this.shouldCancelTimeScrub ? this.lastTimelineThumbPosition : this.settings.css.currentThumbPosition);
    this.DOM.currentTimeElement.textContent = this.toTimeText(newPos * this.duration, true);
    if (!this.shouldCancelTimeScrub) this.currentTime = newPos * this.duration;
    clearTimeout(this.scrubbingId);
    this.togglePlay(!this.wasPaused);
    this.videoContainer.classList.remove("tmg-video-scrubbing");
    this.DOM.scrubNotifier?.classList.remove("tmg-video-control-active");
    this.stopTimePreviewing();
    (this.allowTimeScrubbing(), (this.stallCancelTimeScrub = true));
    this.DOM.timelineContainer?.removeEventListener("pointermove", this._handleTimelineInput);
    this.DOM.timelineContainer?.removeEventListener("pointerup", this.stopTimeScrubbing);
  }
  stopTimePreviewing = () => ((this.overTimeline = false), setTimeout(() => this.videoContainer.classList.remove("tmg-video-previewing")));
  cancelTimeScrubbing() {
    if (this.stallCancelTimeScrub || this.shouldCancelTimeScrub || this.cancelScrubTimeoutId) return;
    this.shouldCancelTimeScrub = true;
    this.DOM.cancelScrubNotifier?.classList.add("tmg-video-control-active");
    this.cancelScrubTimeoutId = setTimeout(this.allowTimeScrubbing, this.settings.controlPanel.timeline.seek.cancel.timeout, false);
  }
  allowTimeScrubbing(reset = true) {
    this.stallCancelTimeScrub = this.shouldCancelTimeScrub = false;
    this.DOM.cancelScrubNotifier?.classList.remove("tmg-video-control-active");
    (clearTimeout(this.cancelScrubTimeoutId), reset && (this.cancelScrubTimeoutId = null));
  }
  _handleTimelineInput({ clientX }) {
    this.overTimeline = true;
    if (!tmg.ON_MOBILE) this.videoContainer.classList.add("tmg-video-previewing");
    this.throttle(
      "timelineInput",
      () => {
        const rect = this.DOM.timelineContainer?.getBoundingClientRect(),
          currX = tmg.clamp(0, !this.isScrubbing || this.settings.controlPanel.timeline.seek.relative ? clientX - rect.left : this.lastTimelineThumbPosition * rect.width + (clientX - this.lastTimelinePointerX), rect.width),
          p = tmg.safeNum(currX / rect.width),
          { offsetLeft: pLeft, offsetWidth: pWidth } = this.DOM.previewContainer,
          previewImgMin = pWidth / 2 / rect.width;
        this.DOM.previewContainer?.setAttribute("data-preview-time", this.toTimeText(p * this.video.duration, true));
        if (this.isScrubbing) {
          this.settings.css.currentThumbPosition = p;
          if (this.settings.time.seekSync) this.settings.css.currentPlayedPosition = p;
          if (this.settings.time.seekSync && this.DOM.currentTimeElement) this.DOM.currentTimeElement.textContent = this.toTimeText((this.currentTime = p * this.duration), true);
          Math.abs(currX - this.lastTimelineThumbPosition * rect.width) < this.settings.controlPanel.timeline.seek.cancel.delta ? this.cancelTimeScrubbing() : this.allowTimeScrubbing();
          this.showOverlay();
        }
        this.settings.css.currentPreviewPosition = p;
        this.settings.css.currentPreviewImgPosition = tmg.clamp(previewImgMin, p, 1 - previewImgMin);
        let arrowBW = tmg.parseCSSUnit(getComputedStyle(this.DOM.previewContainer, "::before").borderWidth),
          arrowPositionMin = Math.max(arrowBW / 5, tmg.parseCSSUnit(getComputedStyle(this.DOM.previewContainer).borderRadius) / 2);
        this.settings.css.currentPreviewImgArrowPosition = p < previewImgMin ? `${Math.max(p * rect.width, arrowPositionMin + arrowBW / 2 + 1)}px` : p > 1 - previewImgMin ? `${Math.min(pWidth / 2 + p * rect.width - pLeft, pWidth - arrowPositionMin - arrowBW - 1)}px` : "50%";
        if (["sprite", "image"].includes(this.videoContainer.dataset.previewType)) {
          const frameI = Math.floor((p * this.duration) / this.settings.time.previews.spf) || 1;
          if (this.videoContainer.dataset.previewType === "sprite") {
            const { cols, rows } = this.settings.time.previews,
              clampedI = Math.min(frameI, cols * rows - 1),
              xPercent = ((clampedI % cols) * 100) / (cols - 1 || 1),
              yPercent = (Math.floor(clampedI / cols) * 100) / (rows - 1 || 1);
            if (!tmg.ON_MOBILE) this.settings.css.currentPreviewPosition = `${xPercent}% ${yPercent}%`;
            if (this.isScrubbing) this.settings.css.currentThumbnailPosition = `${xPercent}% ${yPercent}%`;
          } else {
            const url = `url(${this.settings.time.previews.address.replace("$", frameI)})`;
            if (!tmg.ON_MOBILE) this.settings.css.currentPreviewUrl = url;
            if (this.isScrubbing) this.settings.css.currentThumbnailUrl = url;
          }
        } else if (this.settings.time.previews && !this.frameReadyPromise) this.pseudoVideo.currentTime = p * this.duration;
      },
      30
    );
  }
  _handleGestureTimelineInput({ percent, sign, multiplier }) {
    multiplier = multiplier.toFixed(1);
    percent = percent * multiplier;
    const time = sign === "+" ? this.currentTime + percent * this.duration : this.currentTime - percent * this.duration;
    this.gestureNextTime = tmg.clamp(0, time, this.duration);
    if (this.overTimeline) this.currentTime = this.gestureNextTime;
    this.DOM.touchTimelineNotifier.textContent = `${sign}${this.toTimeText(Math.abs(this.gestureNextTime - this.currentTime))} (${this.toTimeText(this.gestureNextTime, true)}) ${multiplier < 1 ? `x${multiplier}` : ""}`;
  }
  _handleTimelineKeyDown(e) {
    switch (e.key?.toLowerCase()) {
      case "arrowleft":
      case "arrowdown":
        e.preventDefault();
        e.stopImmediatePropagation();
        return (this.currentTime -= e.shiftKey ? 5 : 1);
      case "arrowright":
      case "arrowup":
        e.preventDefault();
        e.stopImmediatePropagation();
        return (this.currentTime += e.shiftKey ? 5 : 1);
    }
  }
  _handleTimeUpdate() {
    this.throttle(
      "timeUpdating",
      () => {
        const t = { c: this.currentTime, vc: this.video.currentTime, d: this.duration, s: this.settings };
        if (t.c < t.s.time.min || t.c > t.s.time.max) ((this.currentTime = t.s.time.loop ? t.s.time.min : t.c), !t.s.time.loop && this.togglePlay(false));
        if (!this.isScrubbing) t.s.css.currentPlayedPosition = t.s.css.currentThumbPosition = tmg.safeNum(t.vc / tmg.safeNum(this.video.duration, 60)); // progress fallback, shouldn't take more than a min for duration to be available
        this.DOM.currentTimeElement.textContent = this.toTimeText(t.vc, true);
        if (this.speedCheck && !this.video.paused) this.DOM.playbackRateNotifier?.setAttribute("data-current-time", this.toTimeText(t.vc, true));
        if (this.video.readyState && t.c && Math.floor((t.s.time.end ?? t.d) - t.c) <= t.s.auto.next) this.autonextVideo();
        if (this.video.readyState && t.c) t.s.time.start = t.c > 3 && t.c < (t.s.time.end ?? t.d) - 3 ? t.c : this.actualTimeStart;
        if (this.video.readyState && t.c && this.config.playlist) this.config.playlist[this.currentPlaylistIndex].settings.time.start = t.s.time.start;
        this.DOM.timelineContainer?.setAttribute("aria-valuenow", Math.floor(t.c));
        this.DOM.timelineContainer?.setAttribute("aria-valuetext", `${tmg.formatMediaTime({ time: t.c, format: "human-long" })} out of ${tmg.formatMediaTime({ time: t.d, format: "human-long" })}`);
        this.videoContainer.classList.remove("tmg-video-replay");
        if (!this.settings.captions.disabled) this._handleCaptionsKaraoke();
      },
      250
    );
  }
  toggleTimeMode() {
    this.settings.time.mode = this.settings.time.mode !== "elapsed" ? "elapsed" : "remaining";
    this.DOM.currentTimeElement.textContent = this.toTimeText(this.video.currentTime, true);
    this.DOM.previewContainer?.setAttribute("data-preview-time", this.toTimeText(Number(this.settings.css.currentPreviewPosition) * this.video.duration, true));
  }
  rotateTimeFormat() {
    // prettier-ignore
    const formats = [["digital", "/"], ["human", "of"], ["human-long", "out of"]],
      i = formats.findIndex(f => f[0] === this.settings.time.format),
      nextFormat = formats[(i + 1) % formats.length]
    this.settings.time.format = nextFormat[0];
    this.DOM.currentTimeElement.textContent = this.toTimeText(this.video.currentTime, true);
    this.DOM.timeBridgeElement.textContent = nextFormat[1];
    this.DOM.totalTimeElement.textContent = this.toTimeText(this.video.duration);
    this.DOM.previewContainer?.setAttribute("data-preview-time", this.toTimeText(Number(this.settings.css.currentPreviewPosition) * this.video.duration, true));
    if (this.nextVideoPreview) this.nextVideoPreview.nextElementSibling.textContent = this.toTimeText(this.nextVideoPreview.duration);
  }
  skip(duration) {
    const notifier = duration > 0 ? this.DOM.fwdNotifier : this.DOM.bwdNotifier;
    duration = duration > 0 ? (this.duration - this.currentTime > duration ? duration : this.duration - this.currentTime) : duration < 0 ? (this.currentTime > Math.abs(duration) ? duration : -this.currentTime) : 0;
    this.settings.css.currentPlayedPosition = this.settings.css.currentThumbPosition = tmg.safeNum((this.video.currentTime += duration) / this.video.duration);
    if (this.skipPersist) {
      if (this.currentSkipNotifier && notifier !== this.currentSkipNotifier) ((this.skipDuration = 0), this.currentSkipNotifier.classList.remove("tmg-video-control-persist"));
      this.showOverlay();
      this.currentSkipNotifier = notifier;
      notifier?.classList.add("tmg-video-control-persist");
      this.skipDuration += duration;
      clearTimeout(this.skipDurationId);
      this.skipDurationId = setTimeout(() => {
        this.deactivateSkipPersist();
        notifier?.classList.remove("tmg-video-control-persist");
        ((this.skipDuration = 0), (this.currentSkipNotifier = null));
        !this.video.paused ? this.removeOverlay() : this.showOverlay();
      }, tmg.parseCSSTime(this.settings.css.notifiersAnimationTime));
      return notifier?.setAttribute("data-skip", Math.trunc(this.skipDuration));
    } else this.currentSkipNotifier?.classList.remove("tmg-video-control-persist");
    notifier?.setAttribute("data-skip", Math.trunc(Math.abs(duration)));
  }
  syncCanvasPreviews() {
    if (!this.loaded || this.frameReadyPromise) return;
    this.throttle(
      "canvasPreviewSync",
      () => {
        ((this.DOM.previewCanvas.width = this.DOM.previewCanvas.offsetWidth || this.DOM.previewCanvas.width), (this.DOM.previewCanvas.height = this.DOM.previewCanvas.offsetHeight || this.DOM.previewCanvas.height));
        if (!tmg.ON_MOBILE) this.previewContext?.drawImage(this.pseudoVideo, 0, 0, this.DOM.previewCanvas.width, this.DOM.previewCanvas.height);
        if (this.isScrubbing) this.thumbnailContext?.drawImage(this.pseudoVideo, 0, 0, this.DOM.thumbnailCanvas.width, this.DOM.thumbnailCanvas.height);
      },
      30
    );
  }
  syncThumbnailSize() {
    if (!this.DOM.thumbnailCanvas || !this.DOM.thumbnailImg) return;
    const { width = this.videoContainer.offsetWidth, height = this.videoContainer.offsetHeight } = tmg.getRenderedBox(this.video);
    ((this.settings.css.currentThumbnailHeight = height + 1 + "px"), (this.settings.css.currentThumbnailWidth = width + 1 + "px"));
  }
  _handleFrameUpdate(now, m) {
    const diff = m.presentedFrames - (this.stats?.presentedFrames ?? 0),
      fps = diff > 0 ? (diff / (now - (this.stats?.now ?? now))) * 1000 : 30,
      droppedFrames = (this.stats?.droppedFrames ?? 0) + (diff > 1 ? diff - 1 : 0);
    this.stats = { ...m, now, fps, droppedFrames };
    // this.throttle("statsLogging", () => this.log(` STATS FOR NERDS: \n Now: ${now} ms\n Media Time: ${m.mediaTime} s\n Expected Display Time: ${m.expectedDisplayTime} ms\n Presented Frames: ${m.presentedFrames}\n Dropped Frames (detected): ${droppedFrames}\n FPS (real-time): ${fps}\n Processing Duration: ${m.processingDuration} ms\n Capture Time: ${m.captureTime}\n Width: ${m.width}\n Height: ${m.height}\n Painted Frames: ${m.paintedFrames}\n`), 1000, false);
    this.frameCallbackId = this.video.requestVideoFrameCallback?.(this._handleFrameUpdate);
  }
  moveVideoFrame = (dir = "forwards") => this.video.paused && this.throttle("frameStepping", () => (this.currentTime = tmg.clamp(0, Math.round(this.currentTime * this.pfps) + (dir === "backwards" ? -1 : 1), Math.floor(this.duration * this.pfps)) / this.pfps), this.pframeDelay);
  plugPlaybackRateSettings() {
    // currently, playback rate is not completely wired by batched listeners but updates directly on the browser events so watch is used below
    this.config.watch("settings.playbackRate.value", (value, { target: { object } }) => (this.video.playbackRate = this.video.defaultPlaybackRate = tmg.clamp(object.min, value, object.max)));
    this.config.watch("settings.playbackRate.min", (min, { target: { object } }) => object.value < min && (object.value = min));
    this.config.watch("settings.playbackRate.max", (max, { target: { object } }) => object.value > max && (object.value = max));
    this.settings.playbackRate = { value: this.video.playbackRate, ...this.settings.playbackRate };
    this.config.get("settings.playbackRate.value", () => this.video.playbackRate, true);
  }
  rotatePlaybackRate(dir = "forwards") {
    const rate = this.settings.playbackRate.value,
      { min, max, skip } = this.settings.playbackRate,
      steps = Array.from({ length: Math.floor((max - min) / skip) + 1 }, (_, i) => min + i * skip),
      i = steps.reduce((cIdx, s, idx) => (Math.abs(s - rate) < Math.abs(steps[cIdx] - rate) ? idx : cIdx), 0);
    this.settings.playbackRate.value = steps[dir === "backwards" ? (i - 1 + steps.length) % steps.length : (i + 1) % steps.length];
  }
  changePlaybackRate(value) {
    const sign = value >= 0 ? "+" : "-";
    value = Math.abs(value);
    const rate = this.settings.playbackRate.value;
    switch (sign) {
      case "-":
        if (rate > this.settings.playbackRate.min) this.settings.playbackRate.value -= rate % value ? rate % value : value;
        return this.notify("playbackratedown");
      default:
        if (rate < this.settings.playbackRate.max) this.settings.playbackRate.value += rate % value ? rate % value : value;
        return this.notify("playbackrateup");
    }
  }
  _handlePlaybackRateChange() {
    this.DOM.playbackRateNotifierContent.textContent = `${this.settings.playbackRate.value}x`;
    this.DOM.playbackRateNotifierText.textContent = `${this.settings.playbackRate.value}x`;
    this.setControlsState("playbackrate");
  }
  fastPlay(pos) {
    if (this.speedCheck) return;
    this.speedCheck = true;
    ((this.wasPaused = this.video.paused), (this.lastPlaybackRate = this.settings.playbackRate.value));
    this.DOM.playbackRateNotifier?.classList.add("tmg-video-control-active");
    setTimeout(pos === "backwards" && !this.settings.beta.disabled && this.settings.beta.fastPlay.rewind ? this.rewind : this.fastForward, 0);
  }
  fastForward(rate = this.settings.fastPlay.playbackRate) {
    this.settings.playbackRate.value = rate;
    this.DOM.playbackRateNotifier?.classList.remove("tmg-video-rewind");
    this.DOM.playbackRateNotifier?.setAttribute("data-current-time", this.toTimeText(this.video.currentTime, true));
    this.togglePlay(true);
  }
  rewind(rate = this.settings.fastPlay.playbackRate) {
    ((this.settings.playbackRate.value = 1), (this.rewindPlaybackRate = rate));
    this.DOM.playbackRateNotifierText.textContent = `${rate}x`;
    this.DOM.playbackRateNotifier?.classList.add("tmg-video-rewind");
    this.video.addEventListener("play", this.rewindReset);
    this.speedIntervalId = setInterval(this.rewindVideo, this.pframeDelay - 20); // minus due to browser async lag
  }
  rewindVideo() {
    !this.video.paused && this.togglePlay(false);
    this.currentTime -= this.rewindPlaybackRate / this.pfps;
    this.settings.css.currentPlayedPosition = this.settings.css.currentThumbPosition = tmg.safeNum(this.video.currentTime / this.video.duration);
    this.DOM.playbackRateNotifier?.setAttribute("data-current-time", this.toTimeText(this.video.currentTime, true));
  }
  rewindReset() {
    if (this.speedIntervalId) {
      this.notify("videopause");
      this.togglePlay(false);
      clearInterval(this.speedIntervalId);
      this.speedIntervalId = null;
    } else this.speedIntervalId = setInterval(this.rewindVideo, this.pframeDelay - 20); // minus due to browser async lag
  }
  slowDown() {
    if (!this.speedCheck) return;
    ((this.speedCheck = false), clearInterval(this.speedIntervalId));
    this.video.removeEventListener("play", this.rewindReset);
    ((this.settings.playbackRate.value = this.lastPlaybackRate), (this.rewindPlaybackRate = 0));
    this.togglePlay(this.settings.fastPlay.reset ? !this.wasPaused : true);
    this.removeOverlay();
    this.DOM.playbackRateNotifier?.classList.remove("tmg-video-control-active", "tmg-video-rewind");
  }
  setCaptionsState() {
    this.textTrackIndex = 0;
    Array.prototype.forEach.call(this.video.textTracks, (track, i) => {
      track.oncuechange = () => i === this.textTrackIndex && !(!this.isUIActive("captions") && this.isUIActive("captionsPreview")) && this._handleCueChange(track.activeCues?.[0]);
      if (track.mode === "showing" || track.default) this.textTrackIndex = i;
      track.mode = "hidden";
    });
    this.videoContainer.classList.toggle("tmg-video-captions", this.video.textTracks.length && !this.settings.captions.disabled);
    this.videoContainer.dataset.trackKind = this.video.textTracks[this.textTrackIndex]?.kind || "captions";
    this.setControlsState("captions");
    this._handleCueChange(this.video.textTracks[this.textTrackIndex]?.activeCues?.[0]);
  }
  plugCaptionsSettings() {
    Object.entries(this.settings.captions.font).forEach(([k, { value }]) => (this.settings.css[`captionsFont${tmg.capitalize(k)}`] = value));
    Object.entries(this.settings.captions.background).forEach(([k, { value }]) => (this.settings.css[`captionsBackground${tmg.capitalize(k)}`] = value));
    Object.entries(this.settings.captions.window).forEach(([k, { value }]) => (this.settings.css[`captionsWindow${tmg.capitalize(k)}`] = value));
    this.settings.css.captionsCharacterEdgeStyle = this.settings.captions.characterEdgeStyle.value;
    this.settings.css.captionsTextAlignment = this.settings.captions.textAlignment.value;
    this.config.on("settings.captions.disabled", ({ target: { value } }) => {
      ((this.settings.css.currentCaptionsX = this.CSSCache.currentCaptionsX), (this.settings.css.currentCaptionsY = this.CSSCache.currentCaptionsY));
      if (!this.video.textTracks[this.textTrackIndex]) return;
      !value ? this.videoContainer.classList.add("tmg-video-captions") : this.videoContainer.classList.remove("tmg-video-captions", "tmg-video-captions-preview");
      !value && this.previewCaptions(`${this.video.textTracks[this.textTrackIndex].label} ${this.videoContainer.dataset.trackKind} \n Click ⚙ for settings`);
    });
    ["font.family", "font.size", "font.weight", "font.variant", "background.color", "background.opacity", "window.color", "window.opacity", "characterEdgeStyle", "textAlignment"].forEach((prop) => this.config.watch(`settings.captions.${prop}.value`, (value) => ((this.settings.css[tmg.camelize(`captions.${prop}`, /\./)] = value), this.syncCaptionsSize())));
    this.config.watch("settings.captions.font.size.min", (min, { target: { object } }) => object.value < min && (object.value = min));
    this.config.watch("settings.captions.font.size.max", (max, { target: { object } }) => object.value > max && (object.value = max));
  }
  toggleCaptions = () => {
    if (!this.video.textTracks[this.textTrackIndex]) return this.previewCaptions("No captions available for this video");
    this.settings.captions.disabled = !this.settings.captions.disabled;
  };
  previewCaptions(preview = `${tmg.capitalize(this.videoContainer.dataset.trackKind)} look like this`, flush = this.DOM.captionsContainer.textContent.replace(/\s/g, "") === this.lastCaptionsPreview?.replace(/\s/g, "")) {
    const shouldPreview = flush || !this.isUIActive("captions") || !this.DOM.captionsContainer.textContent;
    shouldPreview && this.videoContainer.classList.add("tmg-video-captions-preview");
    this._handleCueChange(shouldPreview ? { text: preview } : this.lastCue);
    clearTimeout(this.previewCaptionsTimeoutId);
    this.previewCaptionsTimeoutId = setTimeout((flush = this.DOM.captionsContainer.textContent.replace(/\s/g, "") === preview.replace(/\s/g, "")) => {
      this.videoContainer.classList.remove("tmg-video-captions-preview");
      if (flush) this.DOM.captionsContainer.innerHTML = "";
    }, 1500);
    this.lastCaptionsPreview = preview;
  }
  syncCaptionsSize() {
    this.DOM.captionsContainer.style.setProperty("display", "block", "important");
    const measurer = tmg.createEl("span", { className: "tmg-video-captions-text", innerHTML: "abcdefghijklmnopqrstuvwxyz".repeat(2) }, {}, { visibility: "hidden" });
    this.DOM.captionsContainer.append(measurer);
    this.captionsCharW = measurer.offsetWidth / 52;
    const { lineHeight, fontSize } = getComputedStyle(measurer);
    this.captionsLineHPx = !tmg.safeNum(parseFloat(lineHeight), 0) ? tmg.safeNum(parseFloat(fontSize), 16) * 1.2 : parseFloat(lineHeight);
    (measurer.remove(), this.DOM.captionsContainer.style.removeProperty("display"));
  }
  _handleTextTrackChange = () => this.setCaptionsState();
  _handleCueChange(cue) {
    const existing = this.DOM.captionsContainer.querySelector(".tmg-video-captions-wrapper");
    if (!cue) return existing?.remove();
    const container = this.DOM.captionsContainer,
      wrapper = existing ?? tmg.createEl("div", { className: "tmg-video-captions-wrapper", ariaLive: "off", ariaAtomic: "true" }, { part: "cue-display" }),
      { offsetWidth: vCWidth, offsetHeight: vCHeight } = this.videoContainer;
    ["style", "data-active", "data-scroll"].forEach((attr) => container.removeAttribute(attr));
    ((wrapper.innerHTML = ""), (cue.text ||= ""), (this.lastCue = cue));
    const lines = cue.text.replace(/(<br\s*\/>)|\\N/gi, "\n").split(/\n/);
    lines.forEach((p) => tmg.formatVttLine(p, Math.floor(vCWidth / this.captionsCharW)).forEach((l) => wrapper.append(tmg.createEl("div", { className: "tmg-video-captions-line" }, { part: "cue", id: cue.id }, this.settings.captions.allowVideoOverride && cue.align && { style: { textAlign: cue.align } }).appendChild(tmg.createEl("span", { className: "tmg-video-captions-text", innerHTML: tmg.parseVttText(l) })).parentElement)));
    !existing && this.DOM.captionsContainer.append(wrapper); // the next block is for you, netflix; y'all love cue regions
    const { offsetWidth: cWidth, offsetHeight: cHeight } = container;
    ((this.settings.css.currentCaptionsContainerHeight = `${cHeight}px`), (this.settings.css.currentCaptionsContainerWidth = `${cWidth}px`));
    if (this.settings.captions.allowVideoOverride) {
      if (cue.region) {
        container.setAttribute("data-active", "");
        const { width, lines, viewportAnchorX: vpAnX, viewportAnchorY: vpAnY, scroll } = cue.region;
        if (tmg.isDef(vpAnX)) container.style.setProperty("--tmg-video-current-captions-x", `${vpAnX}%`); // css default center alignment
        if (tmg.isDef(vpAnY)) container.style.setProperty("--tmg-video-current-captions-y", `${100 - vpAnY}%`); // css default center alignment
        if (tmg.isDef(width)) container.style.maxWidth = `${width}%`;
        if (tmg.isDef(lines)) container.style.maxHeight = `${lines * ((this.captionsLineHPx / vCHeight) * 100)}%`;
        if (scroll === "up") {
          container.style.maxHeight = `${lines * ((this.captionsLineHPx / vCHeight) * 100)}%`;
          container.dataset.scroll = scroll;
          this.config.stall(() => (container.scrollTop = wrapper.scrollHeight));
        }
      } else {
        if (tmg.isDef(cue.position) && cue.position !== "auto") {
          const elemHalfWPct = ((cWidth / vCWidth) * 100) / 2,
            posOffset = cue.positionAlign === "line-left" ? 0 : cue.positionAlign === "line-right" ? -2 * elemHalfWPct : -elemHalfWPct; // center default
          container.style.setProperty("--tmg-video-current-captions-x", `calc(${cue.position}% + ${posOffset}% + ${elemHalfWPct}%)`); // css translate x -50% comeback
        }
        if (tmg.isDef(cue.line) && cue.line !== "auto") {
          const line = tmg.parseIfPercent(cue.line, 100),
            lhPct = (this.captionsLineHPx / vCHeight) * 100,
            elemHalfHPct = ((cHeight / vCHeight) * 100) / 2,
            lAlign = cue.lineAlign && cue.lineAlign !== "auto" ? cue.lineAlign : line < 0 ? "end" : "start", // spec compliant: normal -start, negative index - end
            lineOffset = lAlign === "start" ? -2 * elemHalfHPct : lAlign === "end" ? 0 : -elemHalfHPct,
            bottomVal = cue.snapToLines ? (line < 0 ? (Math.abs(line) - 1) * lhPct : 100 - line * lhPct) : 100 - line; // -1 - last line
          container.style.setProperty("--tmg-video-current-captions-y", `calc(${bottomVal}% + ${lineOffset}% + ${elemHalfHPct}%)`); // css translate y 50% comeback
        }
        if (tmg.isDef(cue.size) && cue.size !== 100) container.style.maxWidth = `${cue.size}%`;
      }
      if (cue.vertical) container.style.writingMode = cue.vertical === "lr" ? "vertical-lr" : "vertical-rl";
    } // styling done after for dimension math
    this.currentKaraokeNodes = Array.from(wrapper.querySelectorAll("[data-part='timed']") ?? [], (el) => {
      const [, m, s, ms] = el.dataset.time.match(/(\d+):(\d+)\.(\d+)/) || [];
      return { el, time: m ? +m * 60 + +s + +ms / 1000 : 0 };
    });
    this._handleCaptionsKaraoke();
  }
  _handleCaptionsKaraoke() {
    this.currentKaraokeNodes?.forEach(({ el, time }) => {
      const isPast = this.currentTime > time;
      (el.toggleAttribute("data-past", isPast), el.toggleAttribute("data-future", !isPast));
    });
  }
  changeCaptionsFontSize(value) {
    const sign = value >= 0 ? "+" : "-";
    value = Math.abs(value);
    const size = Number(this.settings.css.captionsFontSize);
    switch (sign) {
      case "-":
        if (size > this.settings.captions.font.size.min) this.settings.captions.font.size.value = size - (size % value ? size % value : value);
        break;
      default:
        if (size < this.settings.captions.font.size.max) this.settings.captions.font.size.value = size + (size % value ? size % value : value);
    }
    this.config.stall(this.previewCaptions);
  }
  rotateCaptionsProp(steps, prop, numeric = true) {
    const curr = this.settings.css[tmg.camelize(prop.replace(".value", ""), /\./)],
      i = Math.max(0, numeric ? steps.reduce((cIdx, s, idx) => (Math.abs(s - curr) < Math.abs(steps[cIdx] - curr) ? idx : cIdx), 0) : steps.indexOf(curr));
    tmg.setAny(this.settings, prop, steps[(i + 1) % steps.length]);
    this.config.stall(this.previewCaptions);
  }
  rotateCaptionsFontFamily = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).font.family.values, "captions.font.family.value", false);
  rotateCaptionsFontWeight = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).font.weight.values, "captions.font.weight.value", false);
  rotateCaptionsFontVariant = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).font.variant.values, "captions.font.variant.value", false);
  rotateCaptionsFontOpacity = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).font.opacity.values, "captions.font.opacity.value");
  rotateCaptionsBackgroundOpacity = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).background.opacity.values, "captions.background.opacity.value");
  rotateCaptionsWindowOpacity = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).window.opacity.values, "captions.window.opacity.value");
  rotateCaptionsCharacterEdgeStyle = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).characterEdgeStyle.values, "captions.characterEdgeStyle.value", false);
  rotateCaptionsTextAlignment = () => this.rotateCaptionsProp(tmg.parseUIObj(this.settings.captions).textAlignment.values, "captions.textAlignment.value", false);
  _handleCaptionsDragStart({ pointerId, clientX, clientY }) {
    this.DOM.captionsContainer?.setPointerCapture(pointerId);
    const { left, bottom } = getComputedStyle(this.DOM.captionsContainer);
    ((this.lastCaptionsXPos = parseFloat(left)), (this.lastCaptionsYPos = parseFloat(bottom)));
    ((this.lastCaptionsPointerX = clientX), (this.lastCaptionsPointerY = clientY));
    this.DOM.captionsContainer?.addEventListener("pointermove", this._handleCaptionsDragging);
    this.DOM.captionsContainer?.addEventListener("pointerup", this._handleCaptionsDragEnd);
  }
  _handleCaptionsDragging({ clientX, clientY }) {
    this.videoContainer.classList.add("tmg-video-captions-dragging");
    this.RAFLoop("captionsDragging", () => {
      const { offsetWidth: ww, offsetHeight: hh } = this.videoContainer,
        { offsetWidth: w, offsetHeight: h } = this.DOM.captionsContainer,
        posX = tmg.clamp(w / 2, this.lastCaptionsXPos + (clientX - this.lastCaptionsPointerX), ww - w / 2),
        posY = tmg.clamp(h / 2, this.lastCaptionsYPos - (clientY - this.lastCaptionsPointerY), hh - h / 2);
      ((this.settings.css.currentCaptionsX = `${(posX / ww) * 100}%`), (this.settings.css.currentCaptionsY = `${(posY / hh) * 100}%`));
    });
  }
  _handleCaptionsDragEnd() {
    this.cancelRAFLoop("captionsDragging");
    this.videoContainer.classList.remove("tmg-video-captions-dragging");
    this.DOM.captionsContainer?.removeEventListener("pointermove", this._handleCaptionsDragging);
    this.DOM.captionsContainer?.removeEventListener("pointerup", this._handleCaptionsDragEnd);
  }
  setUpAudio() {
    if (this.audioSetup) return;
    if (tmg.connectMediaToAudioManager(this.video) === "unavailable") return;
    this._mediaElementSourceNode = this.video.mediaElementSourceNode;
    this._tmgGainNode = this.video._tmgGainNode;
    const DCN = (this._tmgDynamicsCompressorNode = this.video._tmgDynamicsCompressorNode);
    ((DCN.threshold.value = -30), (DCN.knee.value = 20), (DCN.ratio.value = 12), (DCN.attack.value = 0.003), (DCN.release.value = 0.25));
    this.audioSetup = true;
  }
  cancelAudio() {
    this.video.volume = tmg.clamp(0, (this._tmgGainNode?.gain?.value ?? 2) / 2, 1);
    this._mediaElementSourceNode?.disconnect();
    this._tmgGainNode?.disconnect();
    this.audioSetup = false;
  }
  plugVolumeSettings() {
    this.setUpAudio();
    this.lastVolume = tmg.clamp(this.settings.volume.min, this.settings.volume.value ?? this.video.volume * 100, this.settings.volume.max);
    this.shouldMute = this.shouldSetLastVolume = this.video.muted;
    this.config.on("settings.volume.value", ({ target: { value } }) => {
      const v = tmg.clamp(this.shouldMute ? 0 : this.settings.volume.min, value, this.settings.volume.max);
      if (this._tmgGainNode) this._tmgGainNode.gain.setTargetAtTime((v / 100) * 2, tmg.AUDIO_CONTEXT.currentTime, 0.02);
      this.video.muted = this.video.defaultMuted = this.settings.volume.muted = v === 0;
      this._handleVolumeChange(v);
    }); // S.I.A not fully implemented ready
    this.config.on("settings.volume.muted", ({ oldValue, value: muted }) => {
      if (oldValue === muted) return;
      if (muted) {
        if (this.settings.volume.value) ((this.lastVolume = this.settings.volume.value), (this.shouldSetLastVolume = true));
        this.shouldMute = true;
        if (this.settings.volume.value) this.settings.volume.value = 0;
      } else {
        const restore = this.shouldSetLastVolume ? this.lastVolume : this.settings.volume.value;
        this.settings.volume.value = restore ? restore : this.sliderAptVolume;
        this.shouldMute = this.shouldSetLastVolume = false;
      }
    }); // runs after boolean changes, toggle
    this.config.on("settings.volume.min", ({ target: { value: min, object } }) => (object.value < min && (object.value = min), this.lastVolume < min && (this.lastVolume = min)));
    this.config.on("settings.volume.max", ({ target: { value: max, object } }) => {
      (object.value > max && (object.value = max), this.lastVolume > max && (this.lastVolume = max));
      this.videoContainer.classList.toggle("tmg-video-volume-boost", max > 100);
      this.DOM.volumeSlider.max = max;
      this.settings.css.volumeSliderPercent = Math.round((100 / max) * 100);
      this.settings.css.maxVolumeRatio = max / 100;
    });
    this.settings.volume = { ...this.settings.volume, value: this.shouldMute ? 0 : this.lastVolume };
    this.config.get("settings.volume.value", (value) => (this._tmgGainNode ? Math.round(((this._tmgGainNode.gain?.value ?? 2) / 2) * 100) : value), true);
  }
  toggleMute = (option) => {
    if (option === "auto" && this.shouldSetLastVolume && !this.lastVolume) this.lastVolume = this.settings.volume.skip;
    this.settings.volume.muted = !this.settings.volume.muted;
  };
  _handleVolumeSliderInput({ target: { value: volume } }, delay = true) {
    ((this.shouldMute = this.shouldSetLastVolume = false), (this.settings.volume.value = volume));
    if (volume > 5) this.sliderAptVolume = volume;
    delay && this.delayVolumeActive();
  }
  _handleGestureVolumeSliderInput({ percent, sign }) {
    const volume = sign === "+" ? this.settings.volume.value + percent * this.settings.volume.max : this.settings.volume.value - percent * this.settings.volume.max;
    this._handleVolumeSliderInput({ target: { value: tmg.clamp(0, Math.round(volume), this.settings.volume.max) } }, false);
  }
  _handleVolumeChange(value) {
    const v = value ?? this.settings.volume.value;
    this.DOM.volumeNotifierContent.textContent = v + "%";
    const vLevel = v == 0 ? "muted" : v < 50 ? "low" : v <= 100 ? "high" : v > 100 ? "boost" : "",
      vPercent = (v - 0) / (this.settings.volume.max - 0);
    this.videoContainer.dataset.volumeLevel = vLevel;
    this.DOM.volumeSlider.value = v;
    this.DOM.volumeSlider?.parentElement.setAttribute("data-volume", v);
    this.DOM.touchVolumeContent.textContent = v + "%";
    this.settings.css.currentVolumeTooltipPosition = `${10.5 + vPercent * 79.5}%`;
    if (this.settings.volume.max > 100) {
      if (v <= 100) {
        this.settings.css.currentVolumeSliderPosition = (v - 0) / (100 - 0);
        this.settings.css.currentVolumeSliderBoostPosition = 0;
        this.settings.css.volumeSliderBoostPercent = 0;
      } else if (v > 100) {
        this.settings.css.currentVolumeSliderPosition = 1;
        this.settings.css.currentVolumeSliderBoostPosition = (v - 100) / (this.settings.volume.max - 100);
        this.settings.css.volumeSliderBoostPercent = this.settings.css.volumeSliderPercent;
      }
    } else this.settings.css.currentVolumeSliderPosition = vPercent;
  }
  _handleNativeVolumeChange = () => ((this.video.volume = 1), this.settings.volume.muted !== this.video.muted && this.toggleMute()); // tough choice, took over; browser :)
  changeVolume(value) {
    const sign = value >= 0 ? "+" : "-";
    value = Math.abs(value);
    let volume = this.shouldSetLastVolume ? this.lastVolume : this.settings.volume.value;
    switch (sign) {
      case "-":
        if (volume > this.settings.volume.min) volume -= volume % value ? volume % value : value;
        if (volume === 0) {
          this.notify("volumemuted");
          break;
        }
        this.notify("volumedown");
        break;
      default:
        if (volume < this.settings.volume.max) volume += volume % value ? value - (volume % value) : value;
        this.notify("volumeup");
    }
    if (this.shouldSetLastVolume) {
      this.DOM.volumeNotifierContent.textContent = volume + "%";
      this.lastVolume = volume;
    } else this.settings.volume.value = volume;
  }
  _handleVolumeContainerMouseMove = () => ((this.overVolume = this.DOM.volumeSlider?.matches(":hover")), this.startVolumeActive());
  _handleVolumeContainerMouseLeave = () => ((this.overVolume = false), this.stopVolumeActive());
  startVolumeActive = () => (this.DOM.volumeSlider?.classList.add("tmg-video-control-active"), this.delayVolumeActive());
  delayVolumeActive() {
    this.delayOverlay();
    clearTimeout(this.delayVolumeActiveId);
    this.delayVolumeActiveId = setTimeout(this.stopVolumeActive, this.settings.overlay.delay);
  }
  stopVolumeActive() {
    if (this.DOM.volumeSlider?.matches(":active")) return this.delayVolumeActive();
    clearTimeout(this.delayVolumeActiveId);
    this.DOM.volumeSlider?.classList.remove("tmg-video-control-active");
  }
  plugBrightnessSettings() {
    this.lastBrightness = tmg.clamp(this.settings.brightness.min, this.settings.brightness.value ?? this.settings.css.brightness ?? 100, this.settings.brightness.max);
    this.config.on("settings.brightness.value", ({ target: { value } }) => {
      const v = tmg.clamp(this.shouldDark ? 0 : this.settings.brightness.min, value, this.settings.brightness.max);
      this.settings.css.brightness = v;
      this.settings.brightness.dark = v === 0;
      this._handleBrightnessChange(v);
    });
    this.config.on("settings.brightness.dark", ({ oldValue, value: dark }) => {
      if (oldValue === dark) return;
      if (dark) {
        if (this.settings.brightness.value) ((this.lastBrightness = this.settings.brightness.value), (this.shouldSetLastBrightness = true));
        this.shouldDark = true;
        if (this.settings.brightness.value) this.settings.brightness.value = 0;
      } else {
        const restore = this.shouldSetLastBrightness ? this.lastBrightness : this.settings.brightness.value;
        this.settings.brightness.value = restore ? restore : this.sliderAptBrightness;
        this.shouldDark = this.shouldSetLastBrightness = false;
      }
    }); // runs after boolean changes, toggle
    this.config.on("settings.brightness.min", ({ target: { value: min, object } }) => (object.value < min && (object.value = min), this.lastBrightness < min && (this.lastBrightness = min)));
    this.config.on("settings.brightness.max", ({ target: { value: max, object } }) => {
      (object.value > max && (object.value = max), this.lastBrightness > max && (this.lastBrightness = max));
      this.videoContainer.classList.toggle("tmg-video-brightness-boost", max > 100);
      this.DOM.brightnessSlider.max = max;
      this.settings.css.brightnessSliderPercent = Math.round((100 / max) * 100);
      this.settings.css.maxBrightnessRatio = max / 100;
    });
    this.settings.brightness = { ...this.settings.brightness, value: this.lastBrightness };
    this.config.get("settings.brightness.value", () => Number(this.settings.css.brightness ?? 100), true);
  }
  toggleDark = (option) => {
    if (option === "auto" && this.shouldSetLastBrightness && !this.lastBrightness) this.lastBrightness = this.settings.brightness.skip;
    this.settings.brightness.dark = !this.settings.brightness.dark;
  };
  _handleBrightnessSliderInput({ target: { value: brightness } }, delay = true) {
    ((this.shouldDark = this.shouldSetLastBrightness = false), (this.settings.brightness.value = brightness));
    if (brightness > 5) this.sliderAptBrightness = brightness;
    delay && this.delayBrightnessActive();
  }
  _handleGestureBrightnessSliderInput({ percent, sign }) {
    const brightness = sign === "+" ? this.settings.brightness.value + percent * this.settings.brightness.max : this.settings.brightness.value - percent * this.settings.brightness.max;
    this._handleBrightnessSliderInput({ target: { value: tmg.clamp(0, Math.round(brightness), this.settings.brightness.max) } }, false);
  }
  _handleBrightnessChange(value) {
    const b = value ?? this.settings.brightness.value;
    this.DOM.brightnessNotifierContent.textContent = b + "%";
    const bLevel = b == 0 ? "dark" : b < 50 ? "low" : b <= 100 ? "high" : b > 100 ? "boost" : "",
      bPercent = (b - 0) / (this.settings.brightness.max - 0);
    this.videoContainer.dataset.brightnessLevel = bLevel;
    this.DOM.brightnessSlider.value = b;
    this.DOM.brightnessSlider?.parentElement.setAttribute("data-brightness", b);
    this.DOM.touchBrightnessContent.textContent = b + "%";
    this.settings.css.currentBrightnessTooltipPosition = `${10.5 + bPercent * 79.5}%`;
    if (this.settings.brightness.max > 100) {
      if (b <= 100) {
        this.settings.css.currentBrightnessSliderPosition = (b - 0) / (100 - 0);
        this.settings.css.currentBrightnessSliderBoostPosition = 0;
        this.settings.css.brightnessSliderBoostPercent = 0;
      } else if (b > 100) {
        this.settings.css.currentBrightnessSliderPosition = 1;
        this.settings.css.currentBrightnessSliderBoostPosition = (b - 100) / (this.settings.brightness.max - 100);
        this.settings.css.brightnessSliderBoostPercent = this.settings.css.brightnessSliderPercent;
      }
    } else this.settings.css.currentBrightnessSliderPosition = bPercent;
  }
  changeBrightness(value) {
    const sign = value >= 0 ? "+" : "-";
    value = Math.abs(value);
    let brightness = this.shouldSetLastBrightness ? this.lastBrightness : this.settings.brightness.value;
    value = Math.abs(value);
    switch (sign) {
      case "-":
        if (brightness > this.settings.brightness.min) brightness -= brightness % value ? brightness % value : value;
        if (brightness === 0) {
          this.notify("brightnessdark");
          break;
        }
        this.notify("brightnessdown");
        break;
      default:
        if (brightness < this.settings.brightness.max) brightness += brightness % value ? value - (brightness % value) : value;
        this.notify("brightnessup");
    }
    if (this.shouldSetLastBrightness) {
      this.DOM.brightnessNotifierContent.textContent = brightness + "%";
      this.lastBrightness = brightness;
    } else this.settings.brightness.value = brightness;
  }
  _handleBrightnessContainerMouseMove = () => ((this.overBrightness = this.DOM.brightnessSlider?.matches(":hover")), this.startBrightnessActive());
  _handleBrightnessContainerMouseLeave = () => ((this.overBrightness = false), this.stopBrightnessActive());
  startBrightnessActive = () => (this.DOM.brightnessSlider?.classList.add("tmg-video-control-active"), this.delayBrightnessActive());
  delayBrightnessActive() {
    this.delayOverlay();
    clearTimeout(this.settings.brightness.valueActiveDelayId);
    this.settings.brightness.valueActiveDelayId = setTimeout(this.stopBrightnessActive, this.settings.overlay.delay);
  }
  stopBrightnessActive() {
    if (this.DOM.brightnessSlider?.matches(":active")) return this.delayBrightnessActive();
    clearTimeout(this.settings.brightness.valueActiveDelayId);
    this.DOM.brightnessSlider?.classList.remove("tmg-video-control-active");
  }
  rotateObjectFit() {
    // prettier-ignore
    const fits = [["contain", "Crop to Fit"], ["cover", "Fit To Screen"], ["fill", "Stretch"]],
    i = fits.findIndex((f) => f[0] === this.settings.css.objectFit),
      nextFit = fits[(i + 1) % fits.length];
    this.notify(`objectfit${nextFit[0]}`);
    this.videoContainer.dataset.objectFit = this.settings.css.objectFit = nextFit[0];
    this.DOM.objectFitNotifierContent.textContent = nextFit[1];
    this.syncThumbnailSize();
  }
  plugModesSettings() {
    this.config.on("settings.modes.fullscreen.disabled", ({ target: { value } }) => value && this.isUIActive("fullscreen") && this.toggleFullscreenMode());
    this.config.on("settings.modes.theater", ({ target: { value } }) => !value && this.isUIActive("theater") && this.toggleTheaterMode());
    this.config.on("settings.modes.pictureInPicture", ({ target: { value } }) => !value && (this.isUIActive("pictureInPicture") || this.isUIActive("floatingPlayer")) && this.togglePictureInPictureMode());
    this.config.on("settings.modes.miniplayer.disabled", ({ target: { value } }) => value && this.toggleMiniplayerMode(false));
  }
  toggleTheaterMode = () => {
    if (!this.settings.modes.theater && !this.isUIActive("theater")) return;
    this.videoContainer.classList.toggle("tmg-video-theater");
  };
  async toggleFullscreenMode() {
    if (this.settings.modes.fullscreen.disabled && !this.inFullscreen) return;
    if (!this.isUIActive("fullscreen")) {
      if (tmg._currentFullscreenController) return;
      if (this.isUIActive("floatingPlayer")) return (this.floatingWindow?.addEventListener("pagehide", this.toggleFullscreenMode), this.floatingWindow?.close());
      if (this.isUIActive("pictureInPicture")) document.exitPictureInPicture();
      this.toggleMiniplayerMode(false);
      tmg._currentFullscreenController = this;
      const vC = this.videoContainer;
      vC.requestFullscreen ? await vC.requestFullscreen() : vC.mozRequestFullscreen ? await vC.mozRequestFullscreen() : vC.msRequestFullscreen ? await vC.msRequestFullscreen() : vC.webkitRequestFullscreen ? await vC.webkitRequestFullscreen() : this.video.webkitEnterFullscreen && (await this.video.webkitEnterFullscreen());
      this.inFullscreen = true;
    } else {
      document.exitFullscreen ? document.exitFullscreen() : document.mozCancelFullscreen ? document.mozCancelFullscreen() : document.msExitFullscreen ? document.msExitFullscreen() : document.webkitCancelFullscreen && document.webkitCancelFullscreen();
      this.inFullscreen = false;
    }
  }
  async _handleFullscreenChange() {
    if (this.inFullscreen) this.videoContainer.classList.add("tmg-video-fullscreen");
    if (!this.inFullscreen || !tmg.queryFullscreen()) {
      this.videoContainer.classList.remove("tmg-video-fullscreen");
      this.unlock();
      ((tmg._currentFullscreenController = null), (this.inFullscreen = false));
      this.toggleMiniplayerMode();
    }
    this.setControlsState("fullscreenlock");
    tmg.ON_MOBILE && (await this.changeScreenOrientation(this.isUIActive("fullscreen") ? this.settings.modes.fullscreen.orientationLock : false));
    tmg.ON_MOBILE && this.setControlState(this.DOM.fullscreenOrientationBtn, { hidden: !this.isUIActive("fullscreen") });
  }
  _handleIOSFullscreenEnd = () => ((this.inFullscreen = false), this._handleFullscreenChange());
  changeScreenOrientation = async (option = true) => (option === false ? screen.orientation?.unlock?.() : await screen.orientation?.lock?.(option === "auto" ? (this.video.videoHeight > this.video.videoWidth ? "portrait" : "landscape") : option !== true ? option : screen.orientation.angle === 0 ? "landscape" : "portrait"));
  async togglePictureInPictureMode() {
    if (!this.settings.modes.pictureInPicture && !this.isUIActive("pictureInPicture") && !this.inFloatingPlayer) return;
    if (this.inFullscreen) await this.toggleFullscreenMode();
    if (!this.isUIActive("pictureInPicture") && window.documentPictureInPicture && !this.settings.beta.disabled && !this.settings.beta.pictureInPicture.floatingPlayer.disabled && !this.inFloatingPlayer) return !this.inFloatingPlayer ? this.initFloatingPlayer() : this.floatingWindow?.close();
    !this.isUIActive("pictureInPicture") ? await this.video.requestPictureInPicture() : await document.exitPictureInPicture();
  }
  _handleEnterPictureInPicture() {
    this.videoContainer.classList.add("tmg-video-picture-in-picture");
    this.showOverlay();
    this.toggleMiniplayerMode(false);
    this.syncMediaSession();
  }
  async _handleLeavePictureInPicture() {
    await tmg.mockAsync(180); // takes a while before video returns, timeout used to hide the default ui
    this.videoContainer.classList.remove("tmg-video-picture-in-picture");
    this.toggleMiniplayerMode();
    this.delayOverlay();
  }
  async initFloatingPlayer() {
    if (this.inFloatingPlayer) return;
    documentPictureInPicture.window?.close?.();
    this.toggleMiniplayerMode(false);
    this.floatingWindow = await documentPictureInPicture.requestWindow(this.settings.beta.pictureInPicture.floatingPlayer);
    this.inFloatingPlayer = true;
    this.activatePseudoMode();
    this.videoContainer.classList.add("tmg-video-floating-player", "tmg-video-progress-bar");
    let cssText = "";
    for (const sheet of document.styleSheets) {
      try {
        for (const cssRule of sheet.cssRules) if (cssRule.selectorText?.includes(":root") || cssRule.cssText.includes("tmg") || cssRule.cssText.includes("t007")) cssText += cssRule.cssText;
      } catch {
        continue;
      }
    }
    this.floatingWindow?.document.head.append(tmg.createEl("style", { textContent: cssText }));
    this.floatingWindow?.document.body.append(this.videoContainer);
    if (this.floatingWindow) this.floatingWindow.document.documentElement.id = document.documentElement.id;
    if (this.floatingWindow) this.floatingWindow.document.documentElement.className = document.documentElement.className;
    this.floatingWindow && document.documentElement.getAttributeNames().forEach((attr) => this.floatingWindow.document.documentElement.setAttribute(attr, document.documentElement.getAttribute(attr)));
    tmg.DOMMutationObserver.observe(this.floatingWindow.document.documentElement, { childList: true, subtree: true });
    this.floatingWindow?.addEventListener("pagehide", this._handleFloatingPlayerClose);
    this.floatingWindow?.addEventListener("resize", this._handleMediaParentResize);
    this.setKeyEventListeners("add");
    setTimeout(this._handleMediaParentResize);
  }
  _handleFloatingPlayerClose() {
    ((this.inFloatingPlayer = false), (this.floatingWindow = null));
    this.videoContainer.classList.toggle("tmg-video-progress-bar", this.settings.controlPanel.progressBar);
    this.videoContainer.classList.remove("tmg-video-floating-player");
    this.deactivatePseudoMode();
    this.toggleMiniplayerMode();
  }
  expandMiniplayer = () => this.toggleMiniplayerMode(false, "smooth");
  removeMiniplayer = () => (this.togglePlay(false), this.toggleMiniplayerMode(false));
  toggleMiniplayerMode(bool, behavior) {
    if (this.settings.modes.miniplayer.disabled && !this.isUIActive("miniplayer")) return;
    const active = this.isUIActive("miniplayer"); // btw this is a smart behavioral implementation rather than just a toggler
    if ((!active && !this.isUIActive("pictureInPicture") && !this.inFloatingPlayer && !this.inFullscreen && !this.parentIntersecting && window.innerWidth >= this.settings.modes.miniplayer.minWindowWidth && !this.video.paused) || (bool === true && !active)) {
      this.activatePseudoMode();
      this.videoContainer.classList.add("tmg-video-miniplayer", "tmg-video-progress-bar");
      ["mousedown", "touchstart"].forEach((e) => this.videoContainer.addEventListener(e, this._handleMiniplayerDragStart));
    } else if ((active && this.parentIntersecting) || (active && window.innerWidth < this.settings.modes.miniplayer.minWindowWidth) || (bool === false && active)) {
      if (behavior && tmg.inDocView(this.pseudoVideoContainer)) this.pseudoVideoContainer.scrollIntoView({ behavior, block: "center", inline: "center" });
      this.deactivatePseudoMode();
      this.videoContainer.classList.remove("tmg-video-miniplayer");
      this.videoContainer.classList.toggle("tmg-video-progress-bar", this.settings.controlPanel.progressBar);
      ["mousedown", "touchstart"].forEach((e) => this.videoContainer.removeEventListener(e, this._handleMiniplayerDragStart));
    }
  }
  _handleMiniplayerDragStart({ target, clientX, clientY, targetTouches }) {
    if (!this.isUIActive("miniplayer") || target.scrollWidth > target.clientWidth || [this.DOM.topControlsWrapper, tmg.inBoolArrOpt(this.settings.controlPanel.draggable, "big") ? this.DOM.bigControlsWrapper : null, this.DOM.bottomControlsWrapper, this.DOM.captionsContainer].some((w) => w?.contains?.(target)) || target.closest("[class$='toast-container']")) return;
    const { left, bottom } = getComputedStyle(this.videoContainer);
    ((this.lastMiniplayerXPos = parseFloat(left)), (this.lastMiniplayerYPos = parseFloat(bottom)));
    ((this.lastMiniplayerDragX = clientX ?? targetTouches[0].clientX), (this.lastMiniplayerDragY = clientY ?? targetTouches[0].clientY));
    document.addEventListener("mousemove", this._handleMiniplayerDragging);
    document.addEventListener("touchmove", this._handleMiniplayerDragging, { passive: false });
    ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((e) => document.addEventListener(e, this._handleMiniplayerDragEnd));
  }
  _handleMiniplayerDragging(e) {
    if (e.touches?.length > 1) return;
    e.preventDefault();
    this.removeOverlay("force");
    this.videoContainer.classList.add("tmg-video-player-dragging");
    this.RAFLoop("miniplayerDragging", () => {
      let { innerWidth: ww, innerHeight: wh } = window,
        { offsetWidth: w, offsetHeight: h } = this.videoContainer;
      const x = e.clientX ?? e.changedTouches[0].clientX,
        y = e.clientY ?? e.changedTouches[0].clientY,
        posX = tmg.clamp(w / 2, this.lastMiniplayerXPos + (x - this.lastMiniplayerDragX), ww - w / 2),
        posY = tmg.clamp(h / 2, this.lastMiniplayerYPos - (y - this.lastMiniplayerDragY), wh - h / 2);
      ((this.settings.css.currentMiniplayerX = `${(posX / ww) * 100}%`), (this.settings.css.currentMiniplayerY = `${(posY / wh) * 100}%`));
    });
  }
  _handleMiniplayerDragEnd() {
    this.cancelRAFLoop("miniplayerDragging");
    this.videoContainer.classList.remove("tmg-video-player-dragging");
    document.removeEventListener("mousemove", this._handleMiniplayerDragging);
    document.removeEventListener("touchmove", this._handleMiniplayerDragging, { passive: false });
    ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((e) => document.removeEventListener(e, this._handleMiniplayerDragEnd));
  }
  _handleAnyClick = () => (this.delayOverlay(), this.stopTimeScrubbing());
  _handleClick({ target }) {
    if (target !== this.DOM.controlsContainer) return;
    if (this.speedCheck && this.playTriggerCounter < 1) return;
    if (tmg.ON_MOBILE && !this.isUIActive("pictureInPicture") && !this.buffering && !this.video.ended && !this.currentSkipNotifier ? true : !this.isUIActive("overlay")) !this.settings.overlay.behavior.match(/hidden|persistent/) && this.videoContainer.classList.toggle("tmg-video-overlay");
    if (!this.isUIActive("miniplayer")) (this[this.settings.gesture.click]?.(), this.settings.gesture.click === "togglePlay" && (this.video.paused ? this.notify("videopause") : this.notify("videoplay")));
  }
  _handleLockScreenClick() {
    if (!this.settings.locked) return;
    this.videoContainer.classList.toggle("tmg-video-locked-overlay");
    this.DOM.screenLockedBtn.classList.remove("tmg-video-control-unlock");
    this.delayLockedOverlay();
  }
  _handleRightClick(e) {
    e.preventDefault();
  }
  _handleDblClick(e) {
    const { clientX: x, target, detail } = e; // this function triggers the forward and backward skip, they then assign the function to the click event, when the trigger is pulled, skipPersist is set to true and the skip is handled by only the click event, if the position of the click changes within the skip interval and when the 'skipPosition' prop is still available, the click event assignment is revoked
    if (target !== this.DOM.controlsContainer) return;
    const rect = this.videoContainer.getBoundingClientRect();
    let pos = x - rect.left > rect.width * 0.65 ? "right" : x - rect.left < rect.width * 0.35 ? "left" : "center";
    if (this.skipPersist && pos !== this.skipPersistPosition) {
      this.deactivateSkipPersist();
      if (detail == 1) return;
    }
    if (pos === "center") return (this[this.settings.gesture.dblClick]?.(), this.settings.gesture.dblClick === "togglePlay" && (this.video.paused ? this.notify("videopause") : this.notify("videoplay")));
    if (this.skipPersist && detail == 2) return;
    this.activateSkipPersist(pos);
    pos === "right" ? this.skip(this.settings.time.skip) : this.skip(-this.settings.time.skip);
    tmg.rippleHandler(e, this.currentSkipNotifier);
  }
  activateSkipPersist(pos) {
    if (this.skipPersist) return;
    this.videoContainer.addEventListener("click", this._handleDblClick);
    ((this.skipPersist = true), (this.skipPersistPosition = pos));
  }
  deactivateSkipPersist() {
    if (!this.skipPersist) return;
    this.videoContainer.removeEventListener("click", this._handleDblClick);
    ((this.skipPersist = false), (this.skipPersistPosition = null));
  }
  _handleHoverPointerActive({ target, pointerType }) {
    (!tmg.ON_MOBILE ? true : !pointerType) && this.showOverlay(); // no pointer activation on mobile
    pointerType && target.closest(".tmg-video-side-controls-wrapper") && clearTimeout(this.overlayDelayId); // better ux
  }
  _handleHoverPointerOut = () => setTimeout(() => !tmg.ON_MOBILE && !this.videoContainer.matches(":hover") && this.removeOverlay());
  showOverlay() {
    if (!this.shouldShowOverlay()) return;
    this.videoContainer.classList.add("tmg-video-overlay");
    this.delayOverlay();
  }
  shouldShowOverlay = () => this.settings.overlay.behavior !== "hidden" && !this.settings.locked && !this.videoContainer.classList.contains("tmg-video-player-dragging");
  delayOverlay() {
    clearTimeout(this.overlayDelayId);
    if (this.shouldRemoveOverlay()) this.overlayDelayId = setTimeout(this.removeOverlay, this.settings.overlay.delay);
  }
  removeOverlay = (manner) => this.shouldRemoveOverlay(manner) && this.videoContainer.classList.remove("tmg-video-overlay");
  shouldRemoveOverlay = (manner) => this.settings.overlay.behavior !== "persistent" && (manner === "force" || (!this.isUIActive("pictureInPicture") && !this.isUIActive("settings") && (tmg.ON_MOBILE ? !this.buffering && !this.video.paused : this.settings.overlay.behavior === "strict" ? true : !this.video.paused)));
  showLockedOverlay = () => (this.videoContainer.classList.add("tmg-video-locked-overlay"), this.delayLockedOverlay());
  removeLockedOverlay() {
    this.videoContainer.classList.remove("tmg-video-locked-overlay");
    this.DOM.screenLockedBtn.classList.remove("tmg-video-control-unlock");
  }
  delayLockedOverlay() {
    clearTimeout(this.lockOverlayDelayId);
    this.lockOverlayDelayId = setTimeout(this.removeLockedOverlay, this.settings.overlay.delay);
  }
  _handleFocusIn = ({ target: t }) => (this.focusSubjectId = !t.matches(":focus-visible") && (t?.dataset?.controlId ?? t?.parentElement?.dataset?.controlId));
  _handleKeyFocusIn = ({ target: t }) => (t?.dataset?.controlId ?? t?.parentElement?.dataset?.controlId) === this.focusSubjectId && t.blur();
  plugBetaSettings() {
    this.config.on("settings.beta.disabled", ({ target: { value } }) => value && this.slowDown(), this.floatingWindow?.close());
    this.config.on("settings.beta.fastPlay.rewind", ({ target: { value } }) => !value && this.slowDown());
    this.config.on("settings.beta.pictureInPicture.floatingPlayer.disabled", ({ target: { value } }) => value && this.floatingWindow?.close());
  }
  _handleGestureWheel(e) {
    if (!this.settings.locked && !this.disabled && (this.overVolume || this.overBrightness || this.overTimeline || (e.target === this.DOM.controlsContainer && !this.gestureTouchXCheck && !this.gestureTouchYCheck && !this.speedCheck && (this.isUIActive("fullscreen") || this.inFloatingPlayer)))) {
      e.preventDefault();
      this.gestureWheelTimeoutId ? clearTimeout(this.gestureWheelTimeoutId) : this._handleGestureWheelInit(e);
      this.gestureWheelTimeoutId = setTimeout(this._handleGestureWheelStop, this.settings.gesture.wheel.timeout);
      this._handleGestureWheelMove(e);
    }
  }
  _handleGestureWheelInit({ clientX: x, clientY: y }) {
    const rect = this.videoContainer.getBoundingClientRect();
    this.gestureWheelZone = { x: x - rect.left > rect.width * 0.5 ? "right" : "left", y: y - rect.top > rect.height * 0.5 ? "bottom" : "top" };
    ((this.gestureWheelDeltaY = this.gestureWheelTimePercent = 0), (this.gestureWheelTimeMultiplier = 1));
  }
  _handleGestureWheelMove({ clientX: x, deltaX, deltaY, shiftKey }) {
    deltaX = shiftKey || this.overTimeline ? deltaY : deltaX;
    const wc = this.settings.gesture.wheel, // wheel config
      rect = this.videoContainer.getBoundingClientRect(),
      width = shiftKey || this.overTimeline ? rect.height : rect.width,
      height = shiftKey || this.overTimeline ? rect.width : rect.height;
    let xPercent = -deltaX / (width * wc.xRatio);
    xPercent = this.overTimeline ? xPercent : (this.gestureWheelTimePercent += xPercent);
    const xSign = xPercent >= 0 ? "+" : "-";
    xPercent = Math.abs(xPercent);
    if (deltaX || shiftKey || this.overTimeline) {
      if ((!wc.timeline.slider && this.overTimeline) || (!wc.timeline.normal && !this.overTimeline) || this.gestureWheelYCheck) return this._handleGestureWheelStop();
      this.gestureWheelXCheck = true;
      !this.overTimeline && this.DOM.touchTimelineNotifier?.classList.add("tmg-video-control-active");
      if (this.overTimeline) this.delayOverlay();
      this._handleGestureTimelineInput({ percent: xPercent, sign: xSign, multiplier: this.gestureWheelTimeMultiplier });
      if (shiftKey || this.overTimeline) return;
    }
    if (deltaY) {
      if ((wc.timeline.slider && this.overTimeline) || this.gestureWheelXCheck) {
        const mY = tmg.clamp(0, Math.abs((this.gestureWheelDeltaY += deltaY)), height * wc.yRatio * 0.5);
        this.gestureWheelTimeMultiplier = 1 - mY / (height * wc.yRatio * 0.5);
        return this._handleGestureTimelineInput({ percent: xPercent, sign: xSign, multiplier: this.gestureWheelTimeMultiplier });
      }
      const cancel = (!wc.volume.slider && this.overVolume) || (this.gestureWheelZone?.x === "right" && !wc.volume.normal && !this.overVolume) || (!wc.brightness.slider && this.overBrightness) || (this.gestureWheelZone?.x === "left" && !wc.brightness.normal && !this.overBrightness),
        currentXZone = x - rect.left > width * 0.5 ? "right" : "left";
      if (cancel || currentXZone !== this.gestureWheelZone.x) return this._handleGestureWheelStop();
      this.gestureWheelYCheck = true;
      !this.overVolume && !this.overBrightness && (this.gestureWheelZone?.x === "right" ? this.DOM.touchVolumeNotifier : this.DOM.touchBrightnessNotifier)?.classList.add("tmg-video-control-active");
      if (this.overVolume) this.delayVolumeActive();
      if (this.overBrightness) this.delayBrightnessActive();
      const ySign = -deltaY >= 0 ? "+" : "-",
        yPercent = tmg.clamp(0, Math.abs(deltaY), height * wc.yRatio) / (height * wc.yRatio);
      this.gestureWheelZone?.x === "right" || this.overVolume ? this._handleGestureVolumeSliderInput({ percent: yPercent, sign: ySign }) : this._handleGestureBrightnessSliderInput({ percent: yPercent, sign: ySign });
    }
  }
  _handleGestureWheelStop() {
    this.gestureWheelTimeoutId = null;
    if (this.gestureWheelYCheck) {
      this.gestureWheelYCheck = false;
      this.removeOverlay();
      this.DOM.touchVolumeNotifier?.classList.remove("tmg-video-control-active");
      this.DOM.touchBrightnessNotifier?.classList.remove("tmg-video-control-active");
    }
    if (this.gestureWheelXCheck) {
      this.gestureWheelXCheck = false;
      this.DOM.touchTimelineNotifier?.classList.remove("tmg-video-control-active");
      this.currentTime = this.gestureNextTime;
    }
  }
  _handleGestureTouchStart(e) {
    if (this.settings.beta.disabled || e.touches?.length > 1 || e.target !== this.DOM.controlsContainer || this.isUIActive("miniplayer") || this.speedCheck) return;
    this._handleGestureTouchEnd();
    ((this.lastGestureTouchX = e.clientX ?? e.targetTouches[0].clientX), (this.lastGestureTouchY = e.clientY ?? e.targetTouches[0].clientY));
    this.videoContainer.addEventListener("touchmove", this._handleGestureTouchInit, { once: true });
    this.gestureTouchCancelTimeoutId = setTimeout(() => (this.gestureTouchCanCancel = false), this.settings.beta.gesture.touch.threshold); // tm: changing bool since timeout reached and user is not scrolling, would've been cancelled in touchend
    ["touchend", "touchcancel"].forEach((e) => this.videoContainer.addEventListener(e, this._handleGestureTouchEnd));
  }
  _handleGestureTouchInit(e) {
    if (e.touches?.length > 1 || this.isUIActive("miniplayer") || this.speedCheck) return;
    e.preventDefault();
    const tc = this.settings.beta.gesture.touch, // touch config
      rect = this.videoContainer.getBoundingClientRect(),
      x = e.clientX ?? e.targetTouches[0].clientX,
      y = e.clientY ?? e.targetTouches[0].clientY,
      deltaX = Math.abs(this.lastGestureTouchX - x),
      deltaY = Math.abs(this.lastGestureTouchY - y);
    this.gestureTouchZone = { x: x - rect.left > rect.width * 0.5 ? "right" : "left", y: y - rect.top > rect.height * 0.5 ? "bottom" : "top" };
    const rLeft = this.lastGestureTouchX - rect.left,
      rTop = this.lastGestureTouchY - rect.top; // relative
    if (deltaX > deltaY * tc.axesRatio && rLeft > tc.inset && rLeft < rect.width - tc.inset) tc.timeline && ((this.gestureTouchXCheck = true), this.videoContainer.addEventListener("touchmove", this._handleGestureTouchXMove, { passive: false }));
    else if (deltaY > deltaX * tc.axesRatio && rTop > tc.inset && rTop < rect.height - tc.inset) ((tc.volume && this.gestureTouchZone?.x === "right") || (tc.brightness && this.gestureTouchZone?.x === "left")) && ((this.gestureTouchYCheck = true), this.videoContainer.addEventListener("touchmove", this._handleGestureTouchYMove, { passive: false }));
  }
  _handleGestureTouchXMove(e) {
    if (this.gestureTouchCanCancel) return this._handleGestureTouchEnd();
    e.preventDefault();
    this.DOM.touchTimelineNotifier?.classList.add("tmg-video-control-active");
    this.throttle(
      "gestureTouchMove",
      () => {
        const tc = this.settings.beta.gesture.touch,
          { offsetWidth: width, offsetHeight: height } = this.videoContainer,
          x = e.clientX ?? e.targetTouches[0].clientX,
          y = e.clientY ?? e.targetTouches[0].clientY,
          deltaX = x - this.lastGestureTouchX,
          deltaY = y - this.lastGestureTouchY,
          sign = deltaX >= 0 ? "+" : "-",
          percent = tmg.clamp(0, Math.abs(deltaX), width * tc.xRatio) / (width * tc.xRatio),
          mY = tmg.clamp(0, Math.abs(deltaY), height * tc.yRatio * 0.5),
          multiplier = 1 - mY / (height * tc.yRatio * 0.5);
        this._handleGestureTimelineInput({ percent, sign, multiplier });
      },
      30,
      false
    );
  }
  _handleGestureTouchYMove(e) {
    if (!this.isUIActive("fullscreen") && this.gestureTouchCanCancel) return this._handleGestureTouchEnd();
    e.preventDefault();
    (this.gestureTouchZone.x === "right" ? this.DOM.touchVolumeNotifier : this.DOM.touchBrightnessNotifier)?.classList.add("tmg-video-control-active");
    this.throttle(
      "gestureTouchMove",
      () => {
        const tc = this.settings.beta.gesture.touch,
          height = this.videoContainer.offsetHeight,
          y = e.clientY ?? e.targetTouches[0].clientY,
          deltaY = y - this.lastGestureTouchY,
          sign = deltaY >= 0 ? "-" : "+",
          percent = tmg.clamp(0, Math.abs(deltaY), height * tc.yRatio) / (height * tc.yRatio);
        this.lastGestureTouchY = y;
        this.gestureTouchZone?.x === "right" ? this._handleGestureVolumeSliderInput({ percent, sign }) : this._handleGestureBrightnessSliderInput({ percent, sign });
      },
      30,
      false
    );
  }
  _handleGestureTouchEnd() {
    if (this.gestureTouchXCheck) {
      this.gestureTouchXCheck = false;
      this.videoContainer.removeEventListener("touchmove", this._handleGestureTouchXMove, { passive: false });
      this.DOM.touchTimelineNotifier?.classList.remove("tmg-video-control-active");
      if (!this.gestureTouchCanCancel) this.currentTime = this.gestureNextTime;
    }
    if (this.gestureTouchYCheck) {
      this.gestureTouchYCheck = false;
      this.videoContainer.removeEventListener("touchmove", this._handleGestureTouchYMove, { passive: false });
      clearTimeout(this.gestureTouchSliderTimeoutId);
      this.gestureTouchSliderTimeoutId = setTimeout(() => [this.DOM.touchVolumeNotifier, this.DOM.touchBrightnessNotifier].forEach((el) => el?.classList.remove("tmg-video-control-active")), this.settings.beta.gesture.touch.sliderTimeout);
      if (!this.gestureTouchCanCancel) this.removeOverlay();
    }
    (clearTimeout(this.gestureTouchCancelTimeoutId), (this.gestureTouchCanCancel = true)); // tm: changing bool since user is not scrolling
    this.videoContainer.removeEventListener("touchmove", this._handleGestureTouchInit, { once: true });
    ["touchend", "touchcancel"].forEach((e) => this.videoContainer.removeEventListener(e, this._handleGestureTouchEnd));
  }
  _handleSpeedPointerDown(e) {
    if (!this.settings.fastPlay.pointer.type.match(new RegExp(`all|${e.pointerType}`)) || e.target !== this.DOM.controlsContainer || this.isUIActive("miniplayer") || this.speedCheck) return;
    ["touchmove", "mouseup", "touchend", "touchcancel"].forEach((e) => this.videoContainer.addEventListener(e, this._handleSpeedPointerUp)); // tm: if user moves finger before speedup is called like during scrolling
    this.videoContainer.addEventListener("mouseleave", this._handleSpeedPointerOut);
    clearTimeout(this.speedTimeoutId);
    this.speedTimeoutId = setTimeout(() => {
      this.videoContainer.removeEventListener("touchmove", this._handleSpeedPointerUp); // tm: removing listener since timeout reached and user is not scrolling, would've been cancelled in pointerup
      this.speedPointerCheck = true;
      const x = e.clientX ?? e.targetTouches[0].clientX,
        rect = this.videoContainer.getBoundingClientRect(),
        rLeft = x - rect.left; // relative
      this.speedDirection = rLeft >= rect.width * 0.5 ? "forwards" : "backwards";
      if (rLeft < this.settings.fastPlay.pointer.inset || rLeft > rect.width - this.settings.fastPlay.pointer.inset) return;
      if (!this.settings.beta.disabled && this.settings.beta.fastPlay.rewind) ["mousemove", "touchmove"].forEach((e) => this.videoContainer.addEventListener(e, this._handleSpeedPointerMove));
      this.fastPlay(this.speedDirection);
    }, this.settings.fastPlay.pointer.threshold);
  }
  _handleSpeedPointerMove(e) {
    if (e.touches?.length > 1) return;
    this.throttle(
      "speedPointerMove",
      () => {
        const rect = this.videoContainer.getBoundingClientRect(),
          x = e.clientX ?? e.targetTouches[0].clientX,
          currPos = x - rect.left >= rect.width * 0.5 ? "forwards" : "backwards";
        if (currPos !== this.speedDirection) ((this.speedDirection = currPos), this.slowDown(), this.fastPlay(this.speedDirection));
      },
      200,
      false
    );
  }
  _handleSpeedPointerUp() {
    (clearTimeout(this.speedTimeoutId), (this.speedPointerCheck = false));
    if (this.speedCheck && this.playTriggerCounter < 1) setTimeout(this.slowDown);
    ["touchmove", "mouseup", "touchend", "touchcancel"].forEach((e) => this.videoContainer.removeEventListener(e, this._handleSpeedPointerUp)); // tm: removing listener since user is not scrolling
    ["mousemove", "touchmove"].forEach((e) => this.videoContainer.removeEventListener(e, this._handleSpeedPointerMove));
    this.videoContainer.removeEventListener("mouseleave", this._handleSpeedPointerOut);
  }
  _handleSpeedPointerOut = (e) => !this.videoContainer.matches(":hover") && this._handleSpeedPointerUp(e);
  plugKeysSettings = () => this.config.on("settings.keys.disabled", ({ target: { value } }) => (value ? (this.setKeyEventListeners("remove", true), this.setKeyEventListeners("remove", false)) : this.isIntersecting && this.setKeyEventListeners("add"))); // devx shortcut
  fetchKeyShortcutsForDisplay = () => Object.fromEntries(Object.keys(this.settings.keys.shortcuts).map((action) => [action, tmg.formatKeyForDisplay(this.settings.keys.shortcuts[action])]));
  getTermsForKey(combo) {
    const terms = { override: false, block: false, allowed: false, action: null },
      { overrides, shortcuts, blocks, strictMatches: s } = this.settings.keys;
    if (tmg.matchKeys(overrides, combo, s)) terms.override = true;
    if (tmg.matchKeys(blocks, combo, s)) terms.block = true;
    if (tmg.matchKeys(tmg.WHITE_LISTED_KEYS, combo)) terms.allowed = true; // Allow whitelisted system keys - w
    terms.action = Object.keys(shortcuts).find((key) => tmg.matchKeys(shortcuts[key], combo, s)) || null; // Find action name for shortcuts
    return terms;
  }
  keyEventAllowed(e) {
    if (this.settings.keys.disabled || ((e.key === " " || e.key === "Enter") && e.currentTarget.document.activeElement?.tagName === "BUTTON") || e.currentTarget.document.activeElement?.matches("input,textarea,[contenteditable='true']")) return false;
    const combo = tmg.stringifyKeyCombo(e),
      { override, block, action, allowed } = this.getTermsForKey(combo);
    if (block) return false;
    if (override) e.preventDefault();
    if (action) return action;
    if (allowed) return e.key.toLowerCase(); // inner system defaults
    return false; // Not allowed
  }
  _handleKeyDown(e) {
    const action = this.keyEventAllowed(e),
      mod = this.settings.keys.mods.disabled ? "" : e.ctrlKey ? "ctrl" : e.altKey ? "alt" : e.shiftKey ? "shift" : "";
    if (action === false) return;
    else if (action) this.showOverlay();
    this.throttle(
      "keyDown",
      () => {
        switch (action) {
          case " ": // -w
          case "playPause":
            this.playTriggerCounter++;
            if (this.playTriggerCounter === 1) e.currentTarget.addEventListener("keyup", this._handlePlayTriggerUp);
            if (this.playTriggerCounter === 2 && !this.speedPointerCheck && this.settings.fastPlay.key) e.shiftKey ? this.fastPlay("backwards") : this.fastPlay("forwards");
            break;
          case "prev":
            return (this.previousVideo(), this.notify("videoprev"));
          case "next":
            return (this.nextVideo(), this.notify("videonext"));
          case "skipFwd":
            this.deactivateSkipPersist();
            return (this.skip(this.settings.keys.mods.skip[mod] ?? this.settings.time.skip), this.notify("fwd"));
          case "skipBwd":
            this.deactivateSkipPersist();
            return (this.skip(-(this.settings.keys.mods.skip[mod] ?? this.settings.time.skip)), this.notify("bwd"));
          case "stepBwd":
            return this.moveVideoFrame("backwards");
          case "stepFwd":
            return this.moveVideoFrame("forwards");
          case "objectFit":
            return !this.isUIActive("pictureInPicture") && this.rotateObjectFit();
          case "volumeUp":
            return this.changeVolume(this.settings.keys.mods.volume[mod] ?? this.settings.volume.skip);
          case "volumeDown":
            return this.changeVolume(-(this.settings.keys.mods.volume[mod] ?? this.settings.volume.skip));
          case "brightnessUp":
            return this.changeBrightness(this.settings.keys.mods.brightness[mod] ?? this.settings.brightness.skip);
          case "brightnessDown":
            return this.changeBrightness(-(this.settings.keys.mods.brightness[mod] ?? this.settings.brightness.skip));
          case "playbackRateUp":
            return this.changePlaybackRate(this.settings.keys.mods.playbackRate[mod] ?? this.settings.playbackRate.skip);
          case "playbackRateDown":
            return this.changePlaybackRate(-(this.settings.keys.mods.playbackRate[mod] ?? this.settings.playbackRate.skip));
          case "captionsFontSizeUp":
            return this.changeCaptionsFontSize(this.settings.keys.mods.captionsFontSize[mod] ?? this.settings.captions.font.size.skip);
          case "captionsFontSizeDown":
            return this.changeCaptionsFontSize(-(this.settings.keys.mods.captionsFontSize[mod] ?? this.settings.captions.font.size.skip));
          case "captionsFontWeight":
          case "captionsFontVariant":
          case "captionsFontFamily":
          case "captionsFontOpacity":
          case "captionsBackgroundOpacity":
          case "captionsWindowOpacity":
          case "captionsCharacterEdgeStyle":
          case "captionsTextAlignment":
            return this[`rotate${tmg.capitalize(action)}`]?.();
          case "escape": // -w
            this.isUIActive("miniplayer") && this.removeMiniplayer();
            (this.isUIActive("pictureInPicture") || this.isUIActive("floatingPlayer")) && this.togglePictureInPictureMode();
            break;
          case "arrowup": // -w
            return this.changeVolume(this.settings.keys.mods.volume[mod] ?? 5);
          case "arrowdown": // -w
            return this.changeVolume(-(this.settings.keys.mods.volume[mod] ?? 5));
          case "arrowleft": // -w
            this.deactivateSkipPersist();
            return (this.skip(-(this.settings.keys.mods.skip[mod] ?? 5)), this.notify("bwd"));
          case "arrowright": // -w
            this.deactivateSkipPersist();
            return (this.skip(this.settings.keys.mods.skip[mod] ?? 5), this.notify("fwd"));
        }
      },
      30
    );
  }
  _handleKeyUp(e) {
    const action = this.keyEventAllowed(e);
    if (action === false) return;
    else if (action) this.showOverlay();
    switch (action) {
      case "capture":
        return this.captureVideoFrame(e.altKey ? "monochrome" : undefined);
      case "timeMode":
        return this.toggleTimeMode();
      case "timeFormat":
        return this.rotateTimeFormat();
      case "mute":
        return (this.toggleMute("auto"), this.config.stall(() => (this.settings.volume.value === 0 ? this.notify("volumemuted") : this.notify("volumeup"))));
      case "dark":
        return (this.toggleDark("auto"), this.config.stall(() => (this.settings.brightness.value === 0 ? this.notify("brightnessdark") : this.notify("brightnessup"))));
      case "captions":
        this.toggleCaptions();
        return this.video.textTracks[this.textTrackIndex] && this.notify("captions");
      case "pictureInPicture":
        return this.togglePictureInPictureMode();
      case "theater":
        return !this.isUIActive("fullscreen") && !this.isUIActive("miniplayer") && !this.isUIActive("floatingPlayer") && this.toggleTheaterMode();
      case "fullscreen":
        return this.toggleFullscreenMode();
      case "settings":
        return this.toggleSettingsView();
      case "home": // -w
      case "0": // -w
        return (this.currentTime = 0);
      case "1": // -w
      case "2": // -w
      case "3": // -w
      case "4": // -w
      case "5": // -w
      case "6": // -w
      case "7": // -w
      case "8": // -w
      case "9": // -w
        return (this.currentTime = (action / 10) * this.duration);
      case "end": // -w
        return (this.currentTime = this.duration);
    }
  }
  _handlePlayTriggerUp(e) {
    const action = this.keyEventAllowed(e);
    if (action) this.showOverlay();
    switch (action) {
      case " ": // -w
      case "playPause":
        e.stopImmediatePropagation();
        if (this.playTriggerCounter === 1) (this.togglePlay(), this.video.paused ? this.notify("videopause") : this.notify("videoplay"));
      default:
        if (this.speedCheck && this.playTriggerCounter > 1 && !this.speedPointerCheck) this.slowDown();
        this.playTriggerCounter = 0;
    }
    e.currentTarget.removeEventListener("keyup", this._handlePlayTriggerUp);
  }
  _handleDragStart(e) {
    const { target: t, dataTransfer } = e;
    if (t.dataset.draggableControl !== "true" || !t?.tagName) return;
    if (t.matches(":has(input:is(:hover, :active))")) return e.preventDefault();
    dataTransfer.effectAllowed = "move";
    this.dragging = t;
    requestAnimationFrame(() => t.classList.add("tmg-video-control-dragging"));
    this.dragSafeTimeoutId = setTimeout(() => t.classList.remove("tmg-video-control-dragging"), 1000); // for mobile browsers supporting the API but not living up
    if (t.dataset.dragId !== "wrapper" || t.parentElement?.dataset.dragId !== "wrapper") return;
    const { coord, zoneW } = this.getUIZoneWCoord(t, true);
    tmg.setAny(this.cZoneWs, coord, zoneW);
    this.dragReplaced = { target: t.parentElement, child: zoneW.cover };
  }
  _handleDrag = () => (this.delayOverlay(), clearTimeout(this.dragSafeTimeoutId));
  _handleDragEnd({ target: t }) {
    t.classList.remove("tmg-video-control-dragging");
    this.dragReplaced = this.dragging = null;
    if (t.dataset.dragId === "wrapper" && t.parentElement?.dataset.dragId === "wrapper") tmg.setAny(this.cZoneWs, this.getUIZoneWCoord(t), t);
    this.syncControlPanelToUI();
  }
  noDropOff = (t, drop = this.dragging) => t.dataset.dropZone !== "true" || !drop?.tagName || t.dataset.dragId !== drop.dataset.dragId;
  _handleDragEnter = ({ target: t }) => !this.noDropOff(t) && this.dragging && t.classList.add("tmg-video-dragover");
  _handleDragOver(e) {
    const { target: t, clientX: x, dataTransfer } = e;
    if (this.noDropOff(t)) return;
    e.preventDefault();
    dataTransfer.dropEffect = "move";
    this.throttle(
      "dragOver",
      () => {
        if (t.dataset.dragId === "wrapper") {
          const atWrapper = tmg.getElSiblingAt(x, "x", t.querySelectorAll('.tmg-video-side-controls-wrapper-cover:has([data-drop-zone="true"][data-drag-id=""]:empty)'), "at");
          if (!atWrapper) return;
          this.dragReplaced?.target.replaceChild(this.dragReplaced.child, this.dragging);
          this.dragReplaced = { target: t, child: atWrapper };
          return t.replaceChild(this.dragging, atWrapper);
        }
        const afterControl = tmg.getElSiblingAt(x, "x", t.querySelectorAll("[draggable=true]:not(.tmg-video-control-dragging)"));
        afterControl ? t.insertBefore(this.dragging, afterControl) : t.append(this.dragging);
        !t.dataset.dragId && Array.prototype.forEach.call(this.DOM.sideControlWrappers, this._handleControlsWrapperResize);
      },
      500,
      false
    );
  }
  _handleDrop = ({ target: t }) => !this.noDropOff(t) && t.classList.remove("tmg-video-dragover");
  _handleDragLeave = ({ target: t }) => !this.noDropOff(t) && t.classList.remove("tmg-video-dragover");
}

class tmg_Media_Player {
  #medium;
  #active = false;
  #build = structuredClone(tmg.DEFAULT_VIDEO_BUILD);
  constructor(customBuild = {}) {
    this.Controller = this.#medium = null;
    this.configure({ ...customBuild, id: customBuild.id ?? `${tmg.uid()}_Controller_${tmg.Controllers.length + 1}` });
  }
  get build() {
    return this.#build;
  }
  set build(customBuild) {
    this.configure(customBuild);
  }
  queryBuild = () => (!this.#active ? true : (console.error("TMG has already deployed the custom controls of your build configuration"), console.warn("Consider setting your build configuration before attaching your media element"), false));
  configure(customBuild) {
    if (!this.queryBuild() || !tmg.isObj(customBuild)) return;
    this.#build = tmg.mergeObjs(this.#build, tmg.parseAnyObj(customBuild));
    Object.entries(this.#build.settings.keys.shortcuts).forEach(([k, v]) => (this.#build.settings.keys.shortcuts[k] = tmg.cleanKeyCombo(v)));
    ["blocks", "overrides"].forEach((k) => (this.#build.settings.keys[k] = tmg.cleanKeyCombo(this.#build.settings.keys[k])));
  }
  async attach(medium) {
    if (tmg.isIter(medium)) (console.error("An iterable argument cannot be attached to the TMG media player"), console.warn("Consider looping the iterable argument to get a single argument and instantiate a new 'tmg.Player' for each"));
    if (this.#active) return;
    medium.tmgPlayer?.detach();
    tmg.Controllers.push(this.build.id); // dummy for sync
    ((medium.tmgPlayer = this), (this.#medium = medium));
    (await this.fetchCustomOptions(), await this.#deployController());
    return (this.Controller.fire("tmgattached", this.Controller.payload), medium);
  }
  detach() {
    if (!this.#active) return;
    const medium = (this.#medium = this.Controller?._destroy());
    tmg.Controllers.splice(tmg.Controllers.indexOf(this.Controller), 1);
    this.#medium.tmgcontrols = this.#active = false;
    this.Controller.fire("tmgdetached", this.Controller.payload);
    return ((this.#medium.tmgPlayer = this.Controller = this.#medium = null), medium);
  }
  async fetchCustomOptions() {
    let fetchedControls;
    if (this.#medium.getAttribute("tmg")?.includes(".json")) {
      fetchedControls = fetch(this.#medium.getAttribute("tmg"))
        .then((res) => {
          if (!res.ok) throw new Error(`TMG could not find provided JSON file!. Status: ${res.status}`);
          return res.json();
        })
        .catch(({ message }) => (console.error(`${message}`), console.warn("TMG requires a valid JSON file for parsing your build configuration")));
    }
    const customBuild = (await fetchedControls) ?? {},
      attributes = this.#medium.getAttributeNames().filter((attr) => attr.startsWith("tmg--"));
    attributes?.forEach((attr) => tmg.setHTMLConfig(customBuild, attr, this.#medium.getAttribute(attr)));
    if (this.#medium.poster) this.configure({ "media.artwork[0].src": customBuild.media?.artwork?.[0]?.src ?? this.#medium.poster });
    this.configure(customBuild);
  }
  async #deployController() {
    if (this.#active || !this.#medium.isConnected) return;
    if (this.#build.playlist?.[0]) this.configure(tmg.mergeObjs(tmg.DEFAULT_VIDEO_ITEM_BUILD, tmg.parseAnyObj(this.#build.playlist[0])));
    if (!(this.#medium instanceof HTMLVideoElement)) return (console.error(`TMG could not deploy custom controls on the '${this.#medium.tagName}' element as it is not supported`), console.warn("TMG only supports the 'VIDEO' element currently"));
    this.#medium.tmgcontrols = this.#active = !(this.#medium.controls = false);
    this.#medium.classList.add("tmg-video", "tmg-media");
    const s = this.#build.settings; // doing some cleanup to the settings
    this.#medium.playsInline = s.playsInline ??= this.#medium.playsInline;
    this.#medium.toggleAttribute("webkit-playsinline", s.playsInline);
    this.#medium.autoplay = "string" === typeof (s.auto.play ??= this.#medium.autoplay) ? false : s.auto.play;
    this.#medium.muted = s.volume.muted ??= this.#medium.muted;
    this.#medium.loop = s.time.loop ??= this.#medium.loop;
    this.#medium.volume = 1; // controller takes over, chill; browser :)
    Object.entries(s.modes).forEach(([k, v]) => (s.modes[k] = v && (tmg[`supports${tmg.capitalize(k)}`]?.() ?? true) ? v : false));
    await Promise.all([tmg.loadResource(TMG_VIDEO_CSS_SRC), tmg.loadResource(T007_TOAST_JS_SRC, "script", { module: true }), tmg.loadResource(T007_INPUT_JS_SRC, "script")]);
    tmg.Controllers[tmg.Controllers.indexOf(this.build.id)] = this.Controller = new tmg.Controller(this.#medium, this.#build);
  }
}

var tmg = {
  ON_MOBILE: /Mobi|Android|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent),
  ALLOWED_CONTROLS: ["removeMiniplayer", "expandMiniplayer", "bigPrev", "bigPlayPause", "bigNext", "capture", "fullscreenOrientation", "fullscreenLock", "prev", "playPause", "next", "brightness", "volume", "timeAndDuration", "spacer", "playbackRate", "captions", "settings", "objectFit", "pictureInPicture", "theater", "fullscreen"],
  NOTIFIER_EVENTS: ["videoplay", "videopause", "videoprev", "videonext", "playbackrateup", "playbackratedown", "volumeup", "volumedown", "volumemuted", "brightnessup", "brightnessdown", "brightnessdark", "objectfitcontain", "objectfitcover", "objectfitfill", "captions", "capture", "theater", "fullscreen", "fwd", "bwd"],
  WHITE_LISTED_KEYS: [" ", "Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => k.toLowerCase()),
  IS_DOC_TRANSIENT: false,
  AUDIO_CONTEXT: null,
  _mutationSet: new WeakSet(),
  _mutationId: null,
  _currentFullscreenController: null,
  flagMutation: (m, check = true) => !tmg._mutationSet.has(m) && check && tmg._mutationSet.add(m),
  freeMutation(m) {
    clearTimeout(tmg._mutationId);
    tmg._mutationId = setTimeout(() => !(tmg._mutationId = null) && tmg._mutationSet.delete(m));
  },
  mountMedia() {
    Object.defineProperty(HTMLVideoElement.prototype, "tmgcontrols", {
      get: function () {
        return this.hasAttribute("tmgcontrols");
      },
      set: async function (value) {
        if (value) {
          tmg.flagMutation(this);
          await (this.tmgPlayer || new tmg.Player()).attach(this);
          this.setAttribute("tmgcontrols", "");
          tmg.freeMutation(this);
        } else {
          tmg.flagMutation(this, this.hasAttribute("tmgcontrols"));
          this.removeAttribute("tmgcontrols");
          this.tmgPlayer?.detach();
          tmg.freeMutation(this);
        }
      },
      enumerable: true,
      configurable: true,
    });
  },
  unmountMedia: () => delete HTMLVideoElement.prototype.tmgcontrols,
  init() {
    tmg.mountMedia();
    ["click", "pointerdown", "keydown"].forEach((e) => document.addEventListener(e, () => ((tmg.IS_DOC_TRANSIENT = true), tmg.startAudioManager()), true));
    for (const medium of document.querySelectorAll("video")) {
      tmg.VIDMutationObserver.observe(medium, { attributes: true });
      medium.tmgcontrols = medium.hasAttribute("tmgcontrols");
    }
    tmg.DOMMutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", tmg._handleWindowResize);
    window.addEventListener("orientationchange", tmg._handleOrientationChange);
    ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "msfullscreenchange"].forEach((e) => document.addEventListener(e, tmg._handleFullscreenChange));
    document.addEventListener("visibilitychange", tmg._handleVisibilityChange);
  },
  intersectionObserver:
    "undefined" !== typeof window &&
    new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) target.classList.contains("tmg-media") ? target.tmgPlayer?.Controller?._handleMediaIntersectionChange(isIntersecting) : target.querySelector(".tmg-media")?.tmgPlayer?.Controller?._handleMediaParentIntersectionChange(isIntersecting);
      },
      { root: null, rootMargin: "0px", threshold: 0.3 }
    ),
  resizeObserver:
    "undefined" !== typeof window &&
    new ResizeObserver((entries) => {
      for (const { target } of entries) (target.classList.contains("tmg-media") ? target.tmgPlayer?.Controller : (target.querySelector(".tmg-media") || target.closest(".tmg-media-container")?.querySelector(".tmg-media"))?.tmgPlayer?.Controller)?._handleResize(target);
    }),
  VIDMutationObserver:
    "undefined" !== typeof window &&
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "attributes") continue;
        if (mutation.attributeName === "tmgcontrols") !tmg._mutationSet.has(mutation.target) && (mutation.target.tmgcontrols = mutation.target.hasAttribute("tmgcontrols"));
        else if (mutation.attributeName?.startsWith("tmg")) mutation.target.hasAttribute(mutation.attributeName) && mutation.target.tmgPlayer?.fetchCustomOptions();
        else if (mutation.attributeName === "controls") mutation.target.hasAttribute("tmgcontrols") && mutation.target.removeAttribute("controls");
      }
    }),
  DOMMutationObserver:
    "undefined" !== typeof window &&
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node.tagName || !(node.matches("video:not(.tmg-media") || node.querySelector("video:not(.tmg-media)"))) continue;
          for (const el of [...(node.querySelector("video:not(.tmg-media)") ? node.querySelectorAll("video:not(.tmg-media)") : [node])]) {
            tmg.VIDMutationObserver.observe(el, { attributes: true });
            el.tmgcontrols = el.hasAttribute("tmgcontrols");
          }
        }
        for (const node of mutation.removedNodes) {
          if (!node.tagName || !(node.matches("video.tmg-media") || node.querySelector("video.tmg-media")) || node.isConnected) continue;
          for (const el of [...(node.querySelector("video.tmg-media") ? node.querySelectorAll("video.tmg-media") : [node])]) if (!el.tmgPlayer?.Controller?.mutatingDOMM) el.tmgcontrols = false; // DOMM = DOM Media
        }
      }
    }),
  _handleWindowResize: () => tmg.Controllers?.forEach((c) => c._handleWindowResize()),
  _handleOrientationChange: () => tmg.Controllers?.forEach((c) => c._handleOrientationChange()),
  _handleVisibilityChange: () => tmg.Controllers?.forEach((c) => c._handleVisibilityChange()),
  _handleFullscreenChange: () => tmg._currentFullscreenController?._handleFullscreenChange(),
  startAudioManager() {
    if (!tmg.AUDIO_CONTEXT && tmg.IS_DOC_TRANSIENT) {
      tmg.AUDIO_CONTEXT = new (AudioContext || webkitAudioContext)();
      const L = (tmg._limiter = tmg.AUDIO_CONTEXT.createDynamicsCompressor());
      ((L.threshold.value = -1.0), (L.knee.value = 0.0), (L.ratio.value = 20), (L.attack.value = 0.001), (L.release.value = 0.05));
      tmg.Controllers?.forEach((c) => c.setUpAudio());
    } else if (tmg.AUDIO_CONTEXT?.state === "suspended") tmg.AUDIO_CONTEXT.resume();
  },
  connectMediaToAudioManager(medium) {
    if (!tmg.AUDIO_CONTEXT) return "unavailable";
    medium.mediaElementSourceNode ??= tmg.AUDIO_CONTEXT.createMediaElementSource(medium);
    medium._tmgGainNode ??= tmg.AUDIO_CONTEXT.createGain();
    medium._tmgDynamicsCompressorNode ??= tmg.AUDIO_CONTEXT.createDynamicsCompressor();
    medium.mediaElementSourceNode.connect(medium._tmgDynamicsCompressorNode);
    medium._tmgDynamicsCompressorNode.connect(medium._tmgGainNode);
    medium._tmgGainNode.connect(tmg._limiter);
    tmg._limiter.connect(tmg.AUDIO_CONTEXT.destination); // Routing chain: source → compressor → gain → limiter → destination
  },
  queryMediaMobile: (strict = true) => (strict ? /Mobi|Android|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent) : matchMedia("(max-width: 480px), (max-width: 940px) and (max-height: 480px) and (orientation: landscape)").matches),
  queryFullscreen: () => !!(document.fullscreenElement || document.fullscreen || document.webkitIsFullscreen || document.mozFullscreen || document.msFullscreenElement),
  supportsFullscreen: () => !!(document.fullscreenEnabled || document.mozFullscreenEnabled || document.msFullscreenEnabled || document.webkitFullscreenEnabled || document.webkitSupportsFullscreen || HTMLVideoElement.prototype.webkitEnterFullscreen),
  supportsPictureInPicture: () => !!(document.pictureInPictureEnabled || HTMLVideoElement.prototype.requestPictureInPicture || window.documentPictureInPicture),
  loadResource(src, type = "style", { module, media, crossOrigin, integrity, referrerPolicy, nonce, fetchPriority, attempts = 3, retryKey = false } = {}) {
    ((window.t007 ??= {}), (t007._resourceCache ??= {}));
    if (t007._resourceCache[src]) return t007._resourceCache[src];
    if (type === "script" ? Array.prototype.some.call(document.scripts, (s) => tmg.isSameURL(s.src, src)) : type === "style" ? Array.prototype.some.call(document.styleSheets, (s) => tmg.isSameURL(s.href, src)) : false) return Promise.resolve();
    t007._resourceCache[src] = new Promise((resolve, reject) => {
      (function tryLoad(remaining, el) {
        const onerror = () => {
          el?.remove(); // Remove failed element before retry
          if (remaining > 1) (setTimeout(tryLoad, 1000, remaining - 1), console.warn(`Retrying ${type} load (${attempts - remaining + 1}): ${src}...`));
          else (delete t007._resourceCache[src], reject(new Error(`${type} load failed after ${attempts} attempts: ${src}`))); // Final fail: clear cache so user can manually retry
        };
        const url = retryKey && remaining < attempts ? `${src}${src.includes("?") ? "&" : "?"}_${retryKey}=${Date.now()}` : src;
        if (type === "script") document.body.append((el = tmg.createEl("script", { src: url, type: module ? "module" : "text/javascript", crossOrigin, integrity, referrerPolicy, nonce, fetchPriority, onload: () => resolve(el), onerror })));
        else if (type === "style") document.head.append((el = tmg.createEl("link", { rel: "stylesheet", href: url, media, crossOrigin, integrity, referrerPolicy, nonce, fetchPriority, onload: () => resolve(el), onerror })));
        else reject(new Error(`Unsupported resource type: ${type}`));
      })(attempts);
    });
    return t007._resourceCache[src];
  },
  isSameURL(src1, src2) {
    if ("string" !== typeof src1 || "string" !== typeof src2 || !src1 || !src2) return false;
    try {
      const u1 = new URL(src1, window.location.href),
        u2 = new URL(src2, window.location.href);
      return decodeURIComponent(u1.origin + u1.pathname) === decodeURIComponent(u2.origin + u2.pathname);
    } catch {
      return src1.replace(/\\/g, "/").split("?")[0].trim() === src2.replace(/\\/g, "/").split("?")[0].trim();
    }
  },
  putSourceDetails(source, el) {
    if (source.src) el.src = source.src;
    if (source.type) el.type = source.type;
    if (source.media) el.media = source.media;
  },
  addSources(sources = [], medium) {
    const addSource = (source, med) => {
      const sourceEl = tmg.createEl("source");
      tmg.putSourceDetails(source, sourceEl);
      return med.appendChild(sourceEl);
    };
    return tmg.isIter(sources) ? Array.from(sources, (source) => addSource(source, medium)) : addSource(sources, medium);
  },
  getSources(medium) {
    const sources = medium.querySelectorAll("source"),
      _sources = [];
    sources.forEach((source) => {
      const obj = {};
      tmg.putSourceDetails(source, obj);
      _sources.push(obj);
    });
    return _sources;
  },
  removeSources: (medium) => medium?.querySelectorAll("source")?.forEach((source) => source.remove()),
  isSameSources(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((s1) => b.some((s2) => tmg.isSameURL(s1.src, s2.src) && s1.type === s2.type && s1.media === s2.media));
  },
  putTrackDetails(track, el) {
    if (track.id) el.id = track.id;
    if (track.kind) el.kind = track.kind;
    if (track.label) el.label = track.label;
    if (track.srclang) el.srclang = track.srclang;
    if (track.src) el.src = track.src;
    if (track.default) el.default = track.default;
  },
  addTracks(tracks = [], medium) {
    const addTrack = (track, med) => {
      const trackEl = tmg.createEl("track");
      tmg.putTrackDetails(track, trackEl);
      return med.appendChild(trackEl);
    };
    return tmg.isIter(tracks) ? Array.from(tracks, (track) => addTrack(track, medium)) : addTrack(tracks, medium);
  },
  getTracks(medium, captionsOnly = false) {
    const selector = !captionsOnly ? "track" : "track:is([kind='captions'], [kind='subtitles'])",
      tracks = medium.querySelectorAll(selector),
      _tracks = [];
    tracks.forEach((track) => {
      const obj = {};
      tmg.putTrackDetails(track, obj);
      _tracks.push(obj);
    });
    return _tracks;
  },
  removeTracks: (medium) => medium.querySelectorAll("track")?.forEach((track) => (track.kind === "subtitles" || track.kind === "captions") && track.remove()),
  isSameTracks(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((t1) => b.some((t2) => tmg.isSameURL(t1.src, t2.src) && t1.kind === t2.kind && t1.label === t2.label && t1.srclang === t2.srclang && t1.default === t2.default));
  },
  stripTags: (text) => text.replace(/<(\/)?([a-z0-9.:]+)([^>]*)>/gi, ""),
  srtToVtt(srt, vttLines = ["WEBVTT", ""]) {
    const input = srt.replace(/\r\n?/g, "\n").trim(); // Normalize line endings and trim
    for (const block of input.split(/\n{2,}/)) {
      const lines = block.split("\n"); // \n{2, } (blank line), \n (line break)
      let idx = /^\d+$/.test(lines[0].trim()) ? 1 : 0; // If first line is just a number (captions index), skip it
      const timing = lines[idx]?.trim().replace(/\s+/g, " "), // ← Normalize;
        m = timing?.match(/(\d{1,2}:\d{2}:\d{2})(?:[.,](\d{1,3}))?\s*-->\s*(\d{1,2}:\d{2}:\d{2})(?:[.,](\d{1,3}))?/); // Match times with optional ms, comma or dot
      if (!m) continue; // invalid timing line, skip block
      const [, startHms, startMsRaw = "0", endHms, endMsRaw = "0"] = m,
        to3 = (ms) => ms.padEnd(3, "0").slice(0, 3);
      vttLines.push(startHms + "." + to3(startMsRaw) + " --> " + endHms + "." + to3(endMsRaw)); // add timing line
      for (let i = idx + 1; i < lines.length; i++) vttLines.push(lines[i]); // subtitle text line
      vttLines.push(""); // blank line
    }
    return vttLines.join("\n");
  },
  parseVttText(text) {
    const state = { tag: /<(\/)?([a-z0-9.:]+)([^>]*)>/gi, o: "", l: 0, p: null, c: "" }, // state: o=output, l=last idx, p=pending time, c=content
      esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); // escape html
    let m;
    while ((m = state.tag.exec(text))) {
      const chunk = text.slice(state.l, m.index); // text between last match and current
      if (chunk) state.c += esc(chunk); // add to pending span content
      const [_, cls, tag_n, rest] = m, // _=full match, cls=close tag, tag_n=name, rest=attributes
        low = tag_n.toLowerCase();
      if (/^[0-9]/.test(tag_n)) {
        state.o += state.p ? `<span data-part="timed" data-time="${state.p}">${state.c}</span>` : state.c; // wrap prev, output
        state.p = tag_n; // set new timing
        state.c = ""; // reset content
      } else {
        if (cls) state.c += ["c", "v", "lang"].includes(low) ? "</span>" : `</${low}>`;
        else if (["b", "i", "u", "ruby", "rt"].includes(low)) state.c += `<${low}>`;
        else if (low === "c") state.c += `<span class="vtt-c ${rest.replace(/\.([a-z0-9_-]+)/gi, "$1 ").trim()}">`;
        else if (low === "v") state.c += `<span data-part="voice"${rest.trim() ? ` title="${esc(rest.trim())}"` : ""}>`;
        else if (low === "lang") state.c += `<span lang="${esc(rest.trim())}">`;
      }
      state.l = state.tag.lastIndex; // update position
    }
    const lChunk = text.slice(state.l); // final chunk after last tag
    if (lChunk) state.c += esc(lChunk); // add to pending
    return state.o + (state.p ? `<span data-part="timed" data-time="${state.p}">${state.c}</span>` : state.c); // output + final span
  },
  formatVttLine(p, maxChars) {
    const state = { tokens: p.match(/<[^>]+>|\S+/g) || [], stack: [], parts: [], line: "", len: 0, openStr: "", closeStr: "", timeTag: "", lastWasTag: false }, // pre-built tag strings
      updateTags = () => ((state.openStr = state.stack.map((n) => `<${n}>`).join("")), (state.closeStr = state.stack.reduceRight((a, n) => a + `</${n}>`, ""))),
      flush = () => state.line && (state.parts.push(state.line + state.closeStr), (state.line = (state.timeTag || "") + state.openStr), (state.len = 0), (state.lastWasTag = true));
    state.tokens.forEach((tok) => {
      const tag = tok[0] === "<",
        closeTag = tag && tok[1] === "/";
      if (tag) {
        if (state.line && !state.lastWasTag && !closeTag) state.line += " ";
        const m = tok.match(/^<\/?\s*([a-z0-9._:-]+)/i), // extract tag name
          n = m?.[1] || "",
          timing = /^\d/.test(n);
        if (timing) return ((state.timeTag = tok), (state.line += tok), (state.lastWasTag = true));
        if (!closeTag && !tok.endsWith("/>") && n) (state.stack.push(n), updateTags()); // update on open
        if (closeTag && state.stack.length) (state.stack.pop(), updateTags()); // update on close
        return ((state.lastWasTag = true), (state.line += tok));
      }
      const len = tmg.stripTags(tok).length,
        needSpace = state.line && !state.lastWasTag;
      if (state.len + (needSpace ? 1 : 0) + len > maxChars) flush();
      if (needSpace) ((state.line += " "), (state.len += 1));
      ((state.line += tok), (state.len += len), (state.lastWasTag = false));
    });
    return (flush(), state.parts);
  },
  uid: (prefix = "tmg-") => `${prefix}${Date.now().toString(36)}_${performance.now().toString(36).replace(".", "")}_${Math.random().toString(36).slice(2)}`,
  clamp: (min = 0, amount, max) => Math.min(Math.max(amount, min), max ?? Infinity),
  remToPx: (val) => parseFloat(getComputedStyle(document.documentElement).fontSize * val),
  isDef: (val) => val !== undefined,
  isIter: (obj) => obj != null && "function" === typeof obj[Symbol.iterator],
  isObj: (obj) => "object" === typeof obj && obj != null && !tmg.isArr(obj) && "function" !== typeof obj,
  isArr: (arr) => Array.isArray(arr),
  isValidNum: (number) => !isNaN(number ?? NaN) && number !== Infinity,
  inBoolArrOpt: (opt, str) => opt?.includes?.(str) ?? opt,
  inDocView(el, axis = "y") {
    const rect = el.getBoundingClientRect(),
      inX = rect.right >= 0 && rect.left <= (window.innerWidth || document.documentElement.clientWidth),
      inY = rect.bottom >= 0 && rect.top <= (window.innerHeight || document.documentElement.clientHeight);
    return axis === "x" ? inY : axis === "y" ? inX : inY && inX;
  },
  setHTMLConfig(target, attr, value) {
    value = value.trim();
    const path = attr.replace("tmg--", "");
    const parsedValue = (() => {
      if (value.includes(",")) return value.split(",")?.map((v) => v.trim());
      if (value === "true") return true;
      if (value === "false") return false;
      if (value === "null") return null;
      if (/^\d+$/.test(value)) return Number(value);
      return value;
    })();
    tmg.setAny(target, path, parsedValue, "--", (p) => tmg.camelize(p));
  },
  setAny(target, key, value, separator = ".", keyFunc = (p) => p) {
    if (!key.includes(separator)) return (target[keyFunc ? keyFunc(key) : key] = value);
    const keys = key.split(separator);
    let currObj = target;
    for (let i = 0; i < keys.length; i++) {
      const key = keyFunc ? keyFunc(keys[i]) : keys[i],
        match = key.includes("[") && key.match(arrRx);
      if (match) {
        const [, key, iStr] = match;
        if (!tmg.isArr(currObj[key])) currObj[key] = [];
        if (i === keys.length - 1) currObj[key][Number(iStr)] = value;
        else ((currObj[key][Number(iStr)] ||= {}), (currObj = currObj[key][Number(iStr)]));
      } else {
        if (i === keys.length - 1) currObj[key] = value;
        else ((currObj[key] ||= {}), (currObj = currObj[key]));
      }
    }
  },
  getAny(source, key, separator = ".", keyFunc = (p) => p) {
    if (!key.includes(separator)) return source[keyFunc ? keyFunc(key) : key];
    const keys = key.split(separator);
    let currObj = source;
    for (let i = 0; i < keys.length; i++) {
      const key = keyFunc ? keyFunc(keys[i]) : keys[i],
        match = key.includes("[") && key.match(arrRx);
      if (match) {
        const [, key, iStr] = match;
        if (!tmg.isArr(currObj[key]) || !(key in currObj)) return undefined;
        currObj = currObj[key][Number(iStr)];
      } else {
        if (!tmg.isObj(currObj) || !(key in currObj)) return undefined;
        currObj = currObj[key];
      }
    }
    return currObj;
  },
  deleteAny(target, key, separator = ".", keyFunc = (p) => p) {
    if (!key.includes(separator)) return delete target[keyFunc ? keyFunc(key) : key];
    const keys = key.split(separator);
    let currObj = target;
    for (let i = 0; i < keys.length; i++) {
      const key = keyFunc ? keyFunc(keys[i]) : keys[i],
        match = key.includes("[") && key.match(arrRx);
      if (match) {
        const [, key, iStr] = match;
        if (!tmg.isArr(currObj[key]) || !(key in currObj)) return;
        if (i === keys.length - 1) delete currObj[key][Number(iStr)];
        else currObj = currObj[key][Number(iStr)];
      } else {
        if (!tmg.isObj(currObj) || !(key in currObj)) return;
        if (i === keys.length - 1) delete currObj[key];
        else currObj = currObj[key];
      }
    }
  },
  inAny(source, key, separator = ".", keyFunc = (p) => p) {
    if (!key.includes(separator)) return key in source;
    const keys = key.split(separator);
    let currObj = source;
    for (let i = 0; i < keys.length; i++) {
      const key = keyFunc ? keyFunc(keys[i]) : keys[i],
        match = key.includes("[") && key.match(arrRx);
      if (match) {
        const [, key, iStr] = match;
        if (!tmg.isArr(currObj[key]) || !(key in currObj)) return false;
        if (i === keys.length - 1) return true;
        currObj = currObj[key][Number(iStr)];
      } else {
        if (!tmg.isObj(currObj) || !(key in currObj)) return false;
        if (i === keys.length - 1) return true;
        currObj = currObj[key];
      }
    }
    return true;
  },
  bindMethods(owner, callback = (method, owner) => (owner[method] = owner[method].bind(owner))) {
    let proto = owner;
    while (proto && proto !== Object.prototype) {
      for (const method of Object.getOwnPropertyNames(proto)) method !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, method)?.value === "function" && callback(method, owner);
      proto = Object.getPrototypeOf(proto);
    }
  },
  safeNum: (number, fallback = 0) => (tmg.isValidNum(number) ? number : fallback),
  parseIfPercent: (percent, amount = 100) => (percent?.endsWith?.("%") ? tmg.safeNum((parseFloat(percent) / 100) * amount) : percent),
  parseCSSTime: (time) => (time?.endsWith?.("ms") ? parseFloat(time) : parseFloat(time) * 1000),
  parseCSSUnit: (val) => (val?.endsWith?.("px") ? parseFloat(val) : tmg.remToPx(parseFloat(val))),
  parseUIObj(obj) {
    const result = {};
    for (const key of Object.keys(obj)) {
      const entry = obj[key];
      if (!tmg.isObj(entry)) continue;
      result[key] = entry.options
        ? {
            values: entry.options.map((opt) => opt.value ?? opt),
            displays: entry.options.map((opt) => opt.display ?? `${opt}`),
          }
        : tmg.parseUIObj(entry); // recurse on sub-branch
    }
    return result;
  },
  parseAnyObj(obj = {}, separator = ".", keyFunc = (p) => p, visited = new WeakSet()) {
    if (!tmg.isObj(obj) || visited.has(obj)) return obj; // no circular references
    visited.add(obj);
    const result = {};
    return (Object.entries(obj).forEach(([k, v]) => (k.includes(separator) ? tmg.setAny(result, k, tmg.parseAnyObj(v, separator, keyFunc), separator, keyFunc, visited) : (result[k] = v))), result);
  },
  parseEvOpts(options, opts, boolOpt = opts[0], result = {}) {
    for (let i = 0; i < opts.length; i++) result[opts[i]] = false;
    return (Object.assign(result, "boolean" === typeof options ? { [boolOpt]: options } : options), result);
  },
  parsePanelBottomObj(obj = [], arr = false) {
    if (!tmg.isObj(obj) && !tmg.isArr(obj)) return false;
    const [third = [], second = [], first = []] = tmg.isObj(obj) ? Object.values(obj).reverse() : tmg.isArr(obj[0]) ? obj.toReversed() : [obj];
    return !arr ? { 1: first, 2: second, 3: third } : [...third, ...second, ...first];
  },
  mergeObjs(o1 = {}, o2 = {}) {
    const merged = { ...(o1 || {}), ...(o2 || {}) };
    return (Object.keys(merged).forEach((k) => tmg.isObj(o1[k]) && tmg.isObj(o2[k]) && (merged[k] = tmg.mergeObjs(o1[k], o2[k]))), merged);
  },
  deepClone(obj, visited = new WeakMap()) {
    if ((!tmg.isObj(obj) && !tmg.isArr(obj)) || "symbol" === typeof obj || "function" === typeof obj || obj instanceof Map || obj instanceof Set || obj instanceof WeakMap || obj instanceof Promise || obj instanceof Element || obj instanceof EventTarget) return obj;
    if (visited.has(obj)) return visited.get(obj);
    const clone = tmg.isArr(obj) ? [] : {};
    visited.set(obj, clone);
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clone[key] = tmg.deepClone(obj[key], visited);
      }
    }
    return clone;
  },
  getTrailPaths(path, reverse = true) {
    const parts = path.split(".");
    const chain = ["*"];
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc += (i === 0 ? "" : ".") + parts[i];
      chain.push(acc);
    }
    return reverse ? chain.reverse() : chain;
  },
  getTrailRecords(obj, path) {
    const parts = path.split("."),
      record = [["*", obj, obj]];
    let acc = "",
      currObj = obj;
    for (let i = 0; i < parts.length; i++) {
      acc += (i === 0 ? "" : ".") + parts[i];
      record.push([acc, currObj, (currObj = currObj?.[parts[i]])]);
    }
    return record;
  },
  nuke(target) {
    let proto = target;
    while (proto && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === "constructor") continue;
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        if ("function" === typeof desc?.value) continue;
        if (desc?.get || desc?.set) continue;
        proto[key] = null;
      }
      proto = Object.getPrototypeOf(proto);
    }
  },
  inert(target) {
    target[INERTIA] = true;
    return target;
  },
  isIntent(target) {
    return !!target?.[REJECTABLE];
  },
  formatMediaTime({ time, format = "digital", elapsed = true, showMs = false, casing = "normal" } = {}) {
    const long = format.endsWith("long"),
      sx = (n = 0) => (n == 1 ? "" : "s"), //suffix
      cs = (str) => (casing === "upper" ? str.toUpperCase() : casing === "title" ? tmg.capitalize(str) : str.toLowerCase()), // casing
      wrd = (n = 0) => ({ h: cs(long ? ` hour${sx(n)} ` : "h"), m: cs(long ? ` minute${sx(n)} ` : "m"), s: cs(long ? ` second${sx(n)} ` : "s"), ms: cs(long ? ` millisecond${sx(n)} ` : "ms") }),
      pad = (v, n = 2, f) => (long && !f ? v : String(v).padStart(n, "number" === typeof +n ? "0" : "-"));
    if (!this.isValidNum(time)) return format !== "digital" ? `-${wrd().h}${pad("-")}${wrd().m}${!elapsed ? "left" : ""}`.trim() : !elapsed ? "--:--" : "-:--";
    const s = Math.floor(Math.abs(time) % 60),
      m = Math.floor(Math.abs(time) / 60) % 60,
      h = Math.floor(Math.abs(time) / 3600),
      ms = Math.floor((Math.abs(time) % 1) * 1000);
    if (format === "digital") {
      const base = h ? `${h}:${pad(m, 2, true)}:${pad(s, 2, true)}` : `${m}:${pad(s, 2, true)}`;
      return !elapsed ? `-${base}` : base;
    }
    const base = h ? `${h}${wrd(h).h}${pad(m)}${wrd(m).m}${pad(s)}${wrd(s).s}` : `${m}${wrd(m).m}${pad(s)}${wrd(s).s}`,
      msPart = showMs && ms ? `${pad(ms, 3)}${wrd(ms).ms}` : "";
    return `${base}${msPart}${!long ? " " : ""}${!elapsed ? "left" : ""}`.trim(); // showMs, long for human only
  },
  formatSize(size, decimals = 3, base = 1e3) {
    if (size < base) return `${size} byte${size == 1 ? "" : "s"}`;
    const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
      exponent = Math.min(Math.floor(Math.log(size) / Math.log(base)), units.length - 1);
    return `${(size / Math.pow(base, exponent)).toFixed(decimals).replace(/\.0+$/, "")} ${units[exponent]}`;
  },
  capitalize: (word = "") => word.replace(/^(\s*)([a-z])/i, (_, s, l) => s + l.toUpperCase()), // supports leading spaces like it should
  camelize: (str = "", { source } = /[\s_-]+/, { preserveInnerCase: pIC = true, upperFirst: uF = false } = {}) => (pIC ? str : str.toLowerCase()).replace(new RegExp(`${source}(\\w)`, "g"), (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c[uF ? "toUpperCase" : "toLowerCase"]()), // '\\w' to preserve \
  uncamelize: (str = "", separator = " ") => str.replace(/([a-z])([A-Z])/g, `$1${separator}$2`).toLowerCase(),
  mockAsync: (timeout = 250) => new Promise((resolve) => setTimeout(resolve, timeout)),
  addSafeClicks(el, onClick, onDblClick, options) {
    el && tmg.removeSafeClicks(el);
    el?.addEventListener("click", (el._clickHandler = (e) => (clearTimeout(el._clickTimeoutId), (el._clickTimeoutId = setTimeout(() => onClick?.(e), 300)))), options);
    el?.addEventListener("dblclick", (el._dblClickHandler = (e) => (clearTimeout(el._clickTimeoutId), onDblClick?.(e))), options);
  }, // all just to smoothe out browser perks with tiny logic, nothing deep :)
  removeSafeClicks: (el) => (el?.removeEventListener("click", el._clickHandler), el?.removeEventListener("dblclick", el._dblClickHandler)),
  getExtension: (fn) => fn.split(".").pop().toLowerCase(),
  noExtension: (fn) => fn.replace(/(?:\.(?:mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpg|mpeg|3gp|ogv|ts))+$/i, ""),
  getMimeTypeFromExtension: (fn) => ({ avi: "video/x-msvideo", mp4: "video/mp4", mkv: "video/x-matroska", mov: "video/quicktime", flv: "video/x-flv", webm: "video/webm", ogg: "video/ogg", wmv: "video/x-ms-wmv", "3gp": "video/3gpp", "3g2": "video/3gpp2", mpeg: "video/mpeg", ts: "video/mp2t", m4v: "video/x-m4v" })[tmg.getExtension(fn)] || "application/octet-stream", // mov- Apple MOV format, flv- Flash Video, wmv- Windows Media Video, ts- MPEG transport stream, Default to binary stream
  getRGBBri: ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b,
  getRGBSat: ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b),
  clampRGBBri([r, g, b], m = 40) {
    const br = tmg.getRGBBri([r, g, b]),
      d = br < m ? m - br : br > 255 - m ? -(br - (255 - m)) : 0;
    return [r + d, g + d, b + d].map((v) => tmg.clamp(0, Math.round(v), 255));
  },
  async getDominantColor(src, format = "hex", raw = false) {
    if (typeof src == "string")
      src = await new Promise((res, rej) => {
        const i = tmg.createEl("img", { src, crossOrigin: "anonymous", onload: () => res(i), onerror: () => rej(new Error(`Image load error: ${src}`)) });
      });
    if (src?.canvas) src = src.canvas;
    const c = document.createElement("canvas"),
      x = c.getContext("2d"),
      s = Math.min(64, src.width, src.height);
    c.width = c.height = s;
    src && x.drawImage(src, 0, 0, s, s);
    const d = src && x.getImageData(0, 0, s, s).data,
      ct = {}, // count
      pt = {}; // per totaljust
    for (let i = 0; i < d?.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i] & 0xf0,
        g = d[i + 1] & 0xf0,
        b = d[i + 2] & 0xf0; // Optimized bitwise extraction
      const k = (r << 16) | (g << 8) | b;
      ct[k] = (ct[k] || 0) + 1;
      pt[k] = pt[k] ? [pt[k][0] + d[i], pt[k][1] + d[i + 1], pt[k][2] + d[i + 2]] : [d[i], d[i + 1], d[i + 2]];
    }
    const clrs = Object.keys(ct)
      .sort((a, b) => ct[b] - ct[a]) // sort by count DESC
      .slice(0, 7) // take top buckets
      .map((k) => ({ key: k, rgb: pt[k].map((v) => Math.round(v / ct[k])) }));
    if (!clrs.length) return null;
    const [r, g, b] = tmg.clampRGBBri(clrs.reduce((sat, curr) => (tmg.getRGBSat(sat.rgb) > tmg.getRGBSat(curr.rgb) ? sat : curr), clrs[0]).rgb, 70); // vibrancy test to avoid muddy colors
    // console.log(clrs.map((c) => [c, tmg.getRGBSat(c.rgb), tmg.getRGBBri(c.rgb)]));
    return format === "hex" ? `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` : raw == false ? `rgb(${r},${g},${b})` : [r, g, b];
  },
  createEl(tag, props = {}, dataset = {}, styles = {}) {
    const el = tag ? document.createElement(tag) : null;
    for (const k of Object.keys(props)) if (el && props[k] !== undefined) el[k] = props[k];
    for (const k of Object.keys(dataset)) if (el && dataset[k] !== undefined) el.dataset[k] = dataset[k];
    for (const k of Object.keys(styles)) if (el && styles[k] !== undefined) el.style[k] = styles[k];
    return el;
  },
  cloneVideo(v) {
    const newV = v.cloneNode(true);
    newV.tmgPlayer = v.tmgPlayer;
    v.parentElement?.replaceChild(newV, v);
    if (v.currentTime) newV.currentTime = v.currentTime;
    if (v.playbackRate !== 1) newV.playbackRate = v.playbackRate;
    if (v.defaultPlaybackRate !== 1) newV.defaultPlaybackRate = v.defaultPlaybackRate;
    if (v.volume !== 1) newV.volume = v.volume;
    if (v.muted) newV.muted = true;
    if (v.defaultMuted) newV.defaultMuted = true;
    if (v.srcObject) newV.srcObject = v.srcObject; // Playback controls set
    if (v.autoplay) newV.autoplay = true;
    if (v.loop) newV.loop = true;
    if (v.controls) newV.controls = true;
    if (v.crossOrigin) newV.crossOrigin = v.crossOrigin;
    if (v.playsInline) newV.playsInline = true;
    if (v.controlsList?.length) newV.controlsList = v.controlsList;
    if (v.disablePictureInPicture) newV.disablePictureInPicture = true; // Behavior flags set
    if (!v.paused && newV.isConnected) newV.play();
    return newV;
  },
  getElSiblingAt: (p, dir, els, pos = "after") =>
    els.length &&
    Array.prototype.reduce.call(
      els,
      (closest, child) => {
        const { top: cT, left: cL, width: cW, height: cH } = child.getBoundingClientRect(),
          offset = p - (dir === "y" ? cT : cL) - (dir === "y" ? cH : cW) / 2,
          condition = pos === "after" ? offset < 0 && offset > closest.offset : pos === "before" ? offset > 0 && offset < closest.offset : pos === "at" ? Math.abs(offset) <= (dir === "y" ? cH : cW) / 2 && Math.abs(offset) < Math.abs(closest.offset) : false;
        return condition ? { offset: offset, element: child } : closest;
      },
      { offset: pos === "after" ? -Infinity : Infinity }
    ).element,
  getRenderedBox(elem) {
    const getResourceDimensions = (source) => (source.videoWidth ? { width: source.videoWidth, height: source.videoHeight } : null);
    function parsePositionAsPx(str, bboxSize, objectSize) {
      const num = parseFloat(str);
      return !str.endsWith("%") ? num : bboxSize * (num / 100) - objectSize * (num / 100);
    }
    function parseObjectPosition(position, bbox, object) {
      const [left, top] = position.split(" ");
      return { left: parsePositionAsPx(left, bbox.width, object.width), top: parsePositionAsPx(top, bbox.height, object.height) };
    }
    let { objectFit, objectPosition } = getComputedStyle(elem);
    const bbox = elem.getBoundingClientRect(),
      object = getResourceDimensions(elem);
    if (!object || !objectFit || !objectPosition) return {};
    if (objectFit === "scale-down") objectFit = bbox.width < object.width || bbox.height < object.height ? "contain" : "none";
    if (objectFit === "none") return { ...parseObjectPosition(objectPosition, bbox, object), ...object };
    else if (objectFit === "contain") {
      const objectRatio = object.height / object.width,
        bboxRatio = bbox.height / bbox.width,
        width = bboxRatio > objectRatio ? bbox.width : bbox.height / objectRatio,
        height = bboxRatio > objectRatio ? bbox.width * objectRatio : bbox.height;
      return { ...parseObjectPosition(objectPosition, bbox, { width, height }), width, height };
    } else if (objectFit === "fill") {
      const { left, top } = parseObjectPosition(objectPosition, bbox, object),
        objPosArr = objectPosition.split(" ");
      return { left: objPosArr[0].endsWith("%") ? 0 : left, top: objPosArr[1].endsWith("%") ? 0 : top, width: bbox.width, height: bbox.height }; // Relative positioning is discarded with `object-fit: fill`, so we need to check here if it's relative or not
    } else if (objectFit === "cover") {
      const minRatio = Math.min(bbox.width / object.width, bbox.height / object.height);
      let width = object.width * minRatio,
        height = object.height * minRatio,
        outRatio = 1;
      if (width < bbox.width) outRatio = bbox.width / width;
      if (Math.abs(outRatio - 1) < 1e-14 && height < bbox.height) outRatio = bbox.height / height;
      width *= outRatio;
      height *= outRatio;
      return { ...parseObjectPosition(objectPosition, bbox, { width, height }), width, height };
    }
  },
  rippleHandler(e, target, forceCenter = false) {
    const el = target || e.currentTarget;
    if ((e.target !== e.currentTarget && e.target?.matches("button,[href],input,label,select,textarea,[tabindex]:not([tabindex='-1'])")) || el?.hasAttribute("disabled") || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.stopPropagation?.();
    const { offsetWidth: rW, offsetHeight: rH } = el,
      { width: w, height: h, left: l, top: t } = el.getBoundingClientRect(),
      size = Math.max(rW, rH),
      x = forceCenter ? rW / 2 - size / 2 : (e.clientX - l) * (rW / w) - size / 2,
      y = forceCenter ? rH / 2 - size / 2 : (e.clientY - t) * (rH / h) - size / 2,
      wrapper = tmg.createEl("span", { className: "tmg-video-ripple-container" }),
      ripple = tmg.createEl("span", { className: "tmg-video-ripple tmg-video-ripple-hold" }, {}, { cssText: `width:${size}px;height:${size}px;left:${x}px;top:${y}px;` });
    let canRelease = false;
    ripple.addEventListener("animationend", () => (canRelease = true), { once: true });
    el.append(wrapper.appendChild(ripple).parentElement);
    const release = () => {
      if (!canRelease) return ripple.addEventListener("animationend", release, { once: true });
      ripple.classList.replace("tmg-video-ripple-hold", "tmg-video-ripple-fade");
      ripple.addEventListener("animationend", () => setTimeout(() => wrapper.remove()));
      ["pointerup", "pointercancel"].forEach((e) => el.ownerDocument.defaultView.removeEventListener(e, release));
    };
    ["pointerup", "pointercancel"].forEach((e) => el.ownerDocument.defaultView.addEventListener(e, release));
  },
  initVScrollerator({ baseSpeed = 3, maxSpeed = 10, stepDelay = 2000, baseRate = 16, lineHeight = 80, margin = 80, car = window }) {
    let linesPerSec = baseSpeed,
      accelId = null,
      lastTime = null;
    const drive = (clientY, brake = false, offsetY = 0) => {
      if (car !== window) clientY -= offsetY; // it's bounding client rect top
      const now = performance.now(),
        speed = linesPerSec * lineHeight * ((lastTime ? now - lastTime : baseRate) / 1000); // browser slows down but not us
      if (!brake && (clientY < margin || clientY > (car.innerHeight ?? car.offsetHeight) - margin)) {
        accelId === null ? (accelId = setTimeout(() => (linesPerSec += 1), stepDelay)) : linesPerSec > baseSpeed && (linesPerSec = Math.min(linesPerSec + 1, maxSpeed));
        car.scrollBy?.(0, clientY < margin ? -speed : speed);
      } else reset();
      return ((lastTime = !brake ? now : null), speed);
    }; // scrolls with ajustable speed during a drag
    const reset = () => (clearTimeout(accelId), (accelId = null), (linesPerSec = baseSpeed), (lastTime = null));
    return { drive, reset };
  },
  _SCROLLERS: new WeakMap(),
  _SCROLLER_R_OBSERVER: "undefined" !== typeof window && new ResizeObserver((entries) => entries.forEach(({ target }) => tmg._SCROLLERS.get(target)?.update())),
  _SCROLLER_M_OBSERVER:
    "undefined" !== typeof window &&
    new MutationObserver((entries) => {
      const els = new Set();
      for (const entry of entries) {
        let node = entry.target;
        while (node && !tmg._SCROLLERS.has(node)) node = node.parentElement;
        if (node) els.add(node);
      }
      for (const el of els) tmg._SCROLLERS.get(el)?.update();
    }),
  initScrollAssist(el, { pxPerSecond = 80, assistClassName = "tmg-video-controls-scroll-assist", vertical = true, horizontal = true } = {}) {
    const parent = el?.parentElement;
    if (!parent || tmg._SCROLLERS.has(el)) return;
    const assist = {};
    let scrollId = null,
      last = performance.now(),
      assistWidth = 20,
      assistHeight = 20;
    const update = () => {
      const hasInteractive = !!parent.querySelector('button, a[href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])');
      if (horizontal) {
        const w = assist.left?.offsetWidth || assistWidth,
          check = hasInteractive ? el.clientWidth < w * 2 : false;
        assist.left.style.display = check ? "none" : el.scrollLeft > 0 ? "block" : "none";
        assist.right.style.display = check ? "none" : el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? "block" : "none";
        assistWidth = w;
      }
      if (vertical) {
        const h = assist.up?.offsetHeight || assistHeight,
          check = hasInteractive ? el.clientHeight < h * 2 : false;
        assist.up.style.display = check ? "none" : el.scrollTop > 0 ? "block" : "none";
        assist.down.style.display = check ? "none" : el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? "block" : "none";
        assistHeight = h;
      }
    };
    const scroll = (dir) => {
      const frame = () => {
        const now = performance.now(),
          dt = now - last;
        last = now;
        const d = (pxPerSecond * dt) / 1000;
        if (dir === "left") el.scrollLeft = Math.max(0, el.scrollLeft - d);
        if (dir === "right") el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + d);
        if (dir === "up") el.scrollTop = Math.max(0, el.scrollTop - d);
        if (dir === "down") el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + d);
        scrollId = requestAnimationFrame(frame);
      };
      last = performance.now();
      frame();
    };
    const stop = () => (cancelAnimationFrame(scrollId), (scrollId = null));
    const addAssist = (dir) => {
      const div = tmg.createEl("div", { className: assistClassName }, { scrollDirection: dir }, { display: "none" });
      ["pointerenter", "dragenter"].forEach((e) => div.addEventListener(e, () => scroll(dir)));
      ["pointerleave", "pointerup", "pointercancel", "dragleave", "dragend"].forEach((e) => div.addEventListener(e, stop));
      (dir === "left" || dir === "up" ? parent.insertBefore : parent.append).call(parent, div, el);
      assist[dir] = div;
    };
    if (horizontal) ["left", "right"].forEach(addAssist);
    if (vertical) ["up", "down"].forEach(addAssist);
    el.addEventListener("scroll", update);
    tmg._SCROLLER_R_OBSERVER.observe(el);
    tmg._SCROLLER_M_OBSERVER.observe(el, { childList: true, subtree: true, characterData: true });
    tmg._SCROLLERS.set(el, {
      update,
      destroy() {
        stop();
        el.removeEventListener("scroll", update);
        tmg._SCROLLER_R_OBSERVER.unobserve(el);
        tmg._SCROLLERS.delete(el);
        Object.values(assist).forEach((a) => a.remove());
      },
    });
    update();
    return tmg._SCROLLERS.get(el);
  },
  removeScrollAssist: (el) => tmg._SCROLLERS.get(el)?.destroy(),
  parseKeyCombo(combo) {
    const parts = combo.toLowerCase().split("+");
    return { ctrlKey: parts.includes("ctrl"), shiftKey: parts.includes("shift"), altKey: parts.includes("alt"), metaKey: parts.includes("meta") || parts.includes("cmd"), key: parts.find((p) => !["ctrl", "shift", "alt", "meta", "cmd"].includes(p)) || "" };
  },
  stringifyKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    if (e.metaKey) parts.push("meta");
    parts.push(e.key?.toLowerCase());
    return parts.join("+");
  },
  cleanKeyCombo(combo) {
    const clean = (combo) => {
      const m = ["ctrl", "alt", "shift", "meta"],
        alias = { cmd: "meta" }; // allow cmd - meta
      if (combo === " " || combo === "+") return combo;
      combo = combo.replace(/\+\s*\+$/, "+plus");
      const p = combo
        .toLowerCase()
        .split("+")
        .filter((k) => k !== "")
        .map((k) => alias[k] || (k === "plus" ? "+" : k.trim() || " "));
      return [...p.filter((k) => m.includes(k)).sort((a, b) => m.indexOf(a) - m.indexOf(b)), ...(p.filter((k) => !m.includes(k)) || "")].join("+");
    };
    return tmg.isArr(combo) ? combo.map(clean) : clean(combo);
  },
  matchKeys(required, actual, strict = false) {
    const match = (required, actual) => {
      if (strict) return required === actual;
      const reqKeys = required.split("+"),
        actKeys = actual.split("+");
      return reqKeys.every((k) => actKeys.includes(k));
    };
    return tmg.isArr(required) ? required.some((req) => match(req, actual)) : match(required, actual);
  },
  formatKeyForDisplay: (combo) => ` ${(tmg.isArr(combo) ? combo : [combo]).map((c) => `(${c})`).join(" or ")}`,
  AsyncQueue: class AsyncQueue {
    constructor() {
      ((this.jobs = []), (this.running = false)); // add jobs, performs and reports sequentially; drop job: reports; cancel job: records, reports when about to perform
    }
    async _handle() {
      if (this.running) return;
      this.running = true;
      while (this.jobs.length > 0) {
        const job = this.jobs.shift();
        if (job) job.cancelled ? job.resolve({ success: false, cancelled: true, dropped: false }) : (job.preTask?.(), job.resolve(await job.task()));
      }
      this.running = false;
    }
    add = (task, id, cancelled, preTask) => new Promise((resolve) => (this.jobs.push({ task, id, preTask, cancelled, resolve }), this._handle()));
    drop(id) {
      const job = this.jobs.find((j) => j.id === id);
      job?.resolve({ success: false, cancelled: true, dropped: true });
      return (job && this.jobs.splice(this.jobs.indexOf(job), 1), !!job); // stops immediately, cant't remove a running job
    }
    cancel(id) {
      const job = this.jobs.find((j) => j.id === id);
      return (job && (job.cancelled = true), !!job?.cancelled); // stops when it should have for metrics, can't cancel a running job
    }
  },
  Controller: tmg_Video_Controller, // THE TMG MEDIA PLAYER CONTROLLER CLASS
  Player: tmg_Media_Player, // THE TMG MEDIA PLAYER BUILDER CLASS
  Controllers: [], // REFERENCES TO ALL THE DEPLOYED TMG MEDIA CONTROLLERS
};

if (typeof window !== "undefined") {
  window.tmg = tmg;
  tmg.DEFAULT_VIDEO_BUILD = {
    mediaPlayer: "TMG",
    mediaType: "video",
    media: { title: "", artist: "", profile: "", album: "", artwork: [], chapterInfo: [], links: { title: "", artist: "", profile: "" } },
    disabled: false,
    lightState: { disabled: false, controls: ["meta", "bigplaypause", "fullscreenorientation"], preview: { usePoster: true, time: 2 } },
    debug: true,
    settings: {
      auto: { next: 20 },
      beta: {
        disabled: false,
        fastPlay: { rewind: true },
        gesture: {
          touch: { volume: true, brightness: true, timeline: true, threshold: 200, axesRatio: 3, inset: 20, sliderTimeout: 1000, xRatio: 1, yRatio: 1 },
        },
        pictureInPicture: {
          floatingPlayer: {
            disabled: false,
            width: 270,
            height: 145,
            disallowReturnToOpener: false,
            preferInitialWindowPlacement: false,
          },
        },
      },
      css: { syncWithMedia: {} },
      brightness: { min: 0, max: 150, value: 100, skip: 5 },
      captions: {
        disabled: false,
        allowVideoOverride: true,
        font: {
          family: {
            value: "inherit",
            options: [
              { value: "inherit", display: "Default" },
              { value: "monospace", display: "Monospace" },
              { value: "sans-serif", display: "Sans Serif" },
              { value: "serif", display: "Serif" },
              { value: "cursive", display: "Cursive" },
              { value: "fantasy", display: "Fantasy" },
              { value: "system-ui", display: "System UI" },
              { value: "arial", display: "Arial" },
              { value: "verdana", display: "Verdana" },
              { value: "tahoma", display: "Tahoma" },
              { value: "times new roman", display: "Times New Roman" },
              { value: "georgia", display: "Georgia" },
              { value: "impact", display: "Impact" },
              { value: "comic sans ms", display: "Comic Sans MS" },
            ],
          },
          size: {
            min: 100,
            max: 400,
            value: 100,
            skip: 100,
            options: [
              { value: 25, display: "25%" },
              { value: 50, display: "50%" },
              { value: 100, display: "100%" },
              { value: 150, display: "150%" },
              { value: 200, display: "200%" },
              { value: 300, display: "300%" },
              { value: 400, display: "400%" },
            ],
          },
          color: {
            value: "white",
            options: [
              { value: "white", display: "White" },
              { value: "yellow", display: "Yellow" },
              { value: "green", display: "Green" },
              { value: "cyan", display: "Cyan" },
              { value: "blue", display: "Blue" },
              { value: "magenta", display: "Magenta" },
              { value: "red", display: "Red" },
              { value: "black", display: "Black" },
            ],
          },
          opacity: {
            value: 1,
            options: [
              { value: 0.25, display: "25%" },
              { value: 0.5, display: "50%" },
              { value: 0.75, display: "75%" },
              { value: 1, display: "100%" },
            ],
          },
          weight: {
            value: "400",
            options: [
              { value: "100", display: "Thin" },
              { value: "200", display: "Extra Light" },
              { value: "300", display: "Light" },
              { value: "400", display: "Normal" },
              { value: "500", display: "Medium" },
              { value: "600", display: "Semi Bold" },
              { value: "700", display: "Bold" },
              { value: "800", display: "Extra Bold" },
              { value: "900", display: "Black" },
            ],
          },
          variant: {
            value: "normal",
            options: [
              { value: "normal", display: "Normal" },
              { value: "small-caps", display: "Small Caps" },
              { value: "all-small-caps", display: "All Small Caps" },
            ],
          },
        },
        background: {
          color: {
            value: "black",
            options: [
              { value: "white", display: "White" },
              { value: "yellow", display: "Yellow" },
              { value: "green", display: "Green" },
              { value: "cyan", display: "Cyan" },
              { value: "blue", display: "Blue" },
              { value: "magenta", display: "Magenta" },
              { value: "red", display: "Red" },
              { value: "black", display: "Black" },
            ],
          },
          opacity: {
            value: 0.75,
            options: [
              { value: 0, display: "0%" },
              { value: 0.25, display: "25%" },
              { value: 0.5, display: "50%" },
              { value: 0.75, display: "75%" },
              { value: 1, display: "100%" },
            ],
          },
        },
        window: {
          color: {
            value: "black",
            options: [
              { value: "white", display: "White" },
              { value: "yellow", display: "Yellow" },
              { value: "green", display: "Green" },
              { value: "cyan", display: "Cyan" },
              { value: "blue", display: "Blue" },
              { value: "magenta", display: "Magenta" },
              { value: "red", display: "Red" },
              { value: "black", display: "Black" },
            ],
          },
          opacity: {
            value: 0,
            options: [
              { value: 0, display: "0%" },
              { value: 0.25, display: "25%" },
              { value: 0.5, display: "50%" },
              { value: 0.75, display: "75%" },
              { value: 1, display: "100%" },
            ],
          },
        },
        characterEdgeStyle: {
          value: "none",
          options: [
            { value: "none", display: "None" },
            { value: "drop-shadow", display: "Drop Shadow" },
            { value: "raised", display: "Raised" },
            { value: "depressed", display: "Depressed" },
            { value: "outline", display: "Outline" },
          ],
        },
        textAlignment: {
          value: "left",
          options: [
            { value: "left", display: "Left" },
            { value: "center", display: "Center" },
            { value: "right", display: "Right" },
          ],
        },
      },
      controlPanel: {
        profile: true,
        title: true,
        artist: true,
        top: ["expandminiplayer", "spacer", "meta", "spacer", "capture", "fullscreenlock", "fullscreenorientation", "removeminiplayer"],
        center: ["bigprev", "bigplaypause", "bignext"],
        bottom: { 1: [], 2: ["spacer", "timeline", "spacer"], 3: ["prev", "playpause", "next", "brightness", "volume", "timeandduration", "spacer", "captions", "settings", "objectfit", "pictureinpicture", "theater", "fullscreen"] },
        buffer: "spinner",
        timeline: { thumbIndicator: true, seek: { relative: !tmg.ON_MOBILE, cancel: { delta: 15, timeout: 2000 } } },
        progressBar: tmg.ON_MOBILE,
        draggable: ["", "wrapper"],
      },
      errorMessages: { 1: "The video playback was aborted :(", 2: "The video failed due to a network error :(", 3: "The video could not be decoded :(", 4: "The video source is not supported :(" },
      fastPlay: { playbackRate: 2, key: true, pointer: { type: "all", threshold: 800, inset: 20 }, reset: true },
      gesture: {
        click: tmg.ON_MOBILE ? "" : "togglePlay",
        dblClick: tmg.ON_MOBILE ? "togglePlay" : "toggleFullscreenMode",
        wheel: { volume: { normal: true, slider: true }, brightness: { normal: true, slider: true }, timeline: { normal: true, slider: true }, timeout: 2000, xRatio: 12, yRatio: 6 },
      },
      keys: {
        disabled: false,
        strictMatches: false,
        overrides: [" ", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"],
        shortcuts: { prev: "Shift+p", next: "Shift+n", playPause: "k", mute: "m", dark: "d", skipBwd: "j", skipFwd: "l", stepFwd: ".", stepBwd: ",", volumeUp: "ArrowUp", volumeDown: "ArrowDown", brightnessUp: "y", brightnessDown: "h", playbackRateUp: ">", playbackRateDown: "<", timeFormat: "z", timeMode: "q", capture: "s", objectFit: "a", pictureInPicture: "i", theater: "t", fullscreen: "f", captions: "c", captionsFontSizeUp: ["+", "="], captionsFontSizeDown: ["-", "_"], captionsFontFamily: "u", captionsFontWeight: "g", captionsFontVariant: "v", captionsFontOpacity: "o", captionsBackgroundOpacity: "b", captionsWindowOpacity: "w", captionsCharacterEdgeStyle: "e", captionsTextAlignment: "x", settings: "?" },
        mods: { disabled: false, skip: { ctrl: 60, shift: 10 }, volume: { ctrl: 50, shift: 10 }, brightness: { ctrl: 50, shift: 10 }, playbackRate: { ctrl: 1 }, captionsFontSize: {} },
        // prettier-ignore
        blocks: ["Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown", "Cmd+Option+ArrowRight", "Cmd+Option+ArrowLeft", "Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+7", "Ctrl+8", "Ctrl+9", "Cmd+1", "Cmd+2", "Cmd+3", "Cmd+4", "Cmd+5", "Cmd+6", "Cmd+7", "Cmd+8", "Cmd+9", "Alt+ArrowLeft", "Alt+ArrowRight", "Cmd+ArrowLeft", "Cmd+ArrowRight", "Ctrl+r", "Ctrl+Shift+r", "F5", "Shift+F5", "Cmd+r", "Cmd+Shift+r", "Ctrl+h", "Ctrl+j", "Ctrl+d", "Ctrl+f", "Cmd+y", "Cmd+Option+b", "Cmd+d", "Cmd+f", "Ctrl+Shift+i", "Ctrl+Shift+j", "Ctrl+Shift+c", "Ctrl+u", "F12", "Cmd+Option+i", "Cmd+Option+j", "Cmd+Option+c", "Cmd+Option+u", "Ctrl+=", "Ctrl+-", "Ctrl+0", "Cmd+=", "Cmd+-", "Cmd+0", "Ctrl+p", "Ctrl+s", "Ctrl+o", "Cmd+p", "Cmd+s", "Cmd+o"],
      },
      locked: false,
      modes: { fullscreen: { disabled: false, orientationLock: "auto", onRotate: 90 }, theater: !tmg.ON_MOBILE, pictureInPicture: true, miniplayer: { disabled: false, minWindowWidth: 240 } },
      notifiers: true,
      noOverride: false,
      overlay: { delay: 3000, behavior: "strict" },
      persist: true,
      playbackRate: { min: 0.25, max: 8, skip: 0.25 },
      playsInline: true,
      time: { min: 0, skip: 10, previews: false, mode: "elapsed", format: "digital", seekSync: false },
      toasts: { disabled: false, nextVideoPreview: { usePoster: true, time: 2, tease: true }, captureAutoClose: 15000, maxToasts: 7, position: "bottom-left", hideProgressBar: true, closeButton: !tmg.ON_MOBILE, animation: "slide-up", dragToCloseDir: "x||y" },
      volume: { min: 0, max: 300, skip: 5 },
    },
  };
  tmg.DEFAULT_VIDEO_ITEM_BUILD = {
    media: { title: "", chapterInfo: [], links: { title: "" } },
    src: "",
    tracks: [],
    settings: { time: { start: 0, previews: false } },
  }; // for a playlist
  window.TMG_VIDEO_ALT_IMG_SRC ??= "/TMG_MEDIA_PROTOTYPE/assets/icons/movie-tape.png";
  window.TMG_VIDEO_CSS_SRC ??= "/TMG_MEDIA_PROTOTYPE/prototype-3/prototype-3-video.css";
  window.T007_TOAST_CSS_SRC ??= "/T007_TOOLS/T007_toast_library/T007_toast.css";
  window.T007_TOAST_JS_SRC ??= "/T007_TOOLS/T007_toast_library/T007_toast.js";
  window.T007_INPUT_CSS_SRC ??= "/T007_TOOLS/T007_input_library/T007_input.css";
  window.T007_INPUT_JS_SRC ??= "/T007_TOOLS/T007_input_library/T007_input.js";
  (tmg.loadResource(TMG_VIDEO_CSS_SRC), tmg.loadResource(T007_TOAST_JS_SRC, "script", { module: true }), tmg.loadResource(T007_INPUT_JS_SRC, "script"));
  tmg.init();
  console.log("%cTMG Media Player Available", "color: darkturquoise");
} else {
  console.log("\x1b[38;2;139;69;19mTMG Media Player Unavailable\x1b[0m");
  (console.error("TMG Media Player cannot run in a terminal!"), console.warn("Consider moving to a browser environment to use the TMG Media Player"));
}
