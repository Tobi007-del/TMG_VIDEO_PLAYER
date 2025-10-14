"use strict";
/* 
TODO: 
  editable settings
  video resolution
*/

typeof window !== "undefined" ? console.log("%cTMG Media Player Available", "color: green") : console.log("\x1b[38;2;139;69;19mTMG Media Player Unavailable\x1b[0m");

class T_M_G_Media_Notifier {
  constructor(self) {
    this.self = self;
    this.init();
  }
  init() {
    this.resetNotifiers = this.resetNotifiers.bind(this);
    [...(this.self.DOM.notifiersContainer?.children ?? [])].forEach((n) => n.addEventListener("animationend", this.resetNotifiers));
    tmg.NOTIFIER_EVENTS.forEach((e) => this.self.DOM.notifiersContainer?.addEventListener(e, this));
  }
  handleEvent({ type: n }) {
    if (!this.self.settings.notifiers) return;
    this.resetNotifiers();
    setTimeout(this.resetNotifiers, 10, n);
  }
  resetNotifiers(n = "") {
    this.self.DOM.notifiersContainer?.setAttribute("data-notify", n);
  }
}

class T_M_G_Video_Controller {
  constructor(videoOptions) {
    this.initialized = false;
    // merging the video build into the Video Player Instance
    this.video = videoOptions.video;
    Object.entries(videoOptions).forEach(([k, v]) => (this[k] = v));
    // adding some info incase user had them burnt into the html
    const src = this.src,
      sources = this.sources,
      tracks = this.tracks;
    if (src) videoOptions.src = src;
    if (sources.length) videoOptions.sources = sources;
    if (tracks.length) videoOptions.tracks = tracks;
    this.log(videoOptions);
    // some general variables
    this.audioSetup = this.loaded = this.locked = this.inFullScreen = this.isScrubbing = this.buffering = this.inFloatingPlayer = this.overTimeline = this.overVolume = this.overBrightness = this.gestureTouchXCheck = this.gestureTouchYCheck = this.gestureWheelXCheck = this.gestureWheelYCheck = this.shouldSetLastVolume = this.shouldSetLastBrightness = this.speedPointerCheck = this.speedCheck = this.skipPersist = false;
    this.parentIntersecting = this.isIntersecting = this.gestureTouchCanCancel = this.canAutoMovePlaylist = true;
    this.skipDuration = this.textTrackIndex = this.playTriggerCounter = 0;
    this.lastCueText = "";
    this.isMediaMobile = tmg.queryMediaMobile();
    this.pfps = 30; // pseudo fps: just for frame stepping
    this.pframeDelay = Math.floor(1000 / this.pfps);
    this.currentPlaylistIndex = this.playlist ? 0 : null;
    this.wasPaused = !this.video.autoplay;
    this.throttleMap = new Map();
    this.rafLoopMap = new Map();
    this.rafLoopFnMap = new Map();
    this.sliderVolume = this.sliderBrightness = 5;
    this.gestureTouchThreshold = 300;
    this.gestureTouchFingerRatio = 3;
    this.gestureWheelTimeout = 2000;
    this.fastPlayThreshold = 1000;
    this.miniPlayerMinWindowWidth = 240;
    this.CSSPropsCache = {};
    this.floatingPlayerOptions = { width: 378, height: 199 };
    this.exportCanvas = tmg.createEl("canvas");
    this.exportContext = this.exportCanvas.getContext("2d", { willReadFrequently: true });
    this.bindMethods();
    this.initCSSVariablesManager();
    this.mutatingDOM = true;
    this.buildContainers();
    this.buildPlayerInterface();
    this.buildControllerStructure();
    setTimeout(() => (this.mutatingDOM = false));
    this.initSettingsManager();
    this.initPlayer();
    this.fire("tmgready", this.video, { loaded: true });
  }
  get src() {
    return this.video.src;
  }
  set src(value) {
    tmg.removeSources(this.video);
    this.video.src = value;
  }
  get sources() {
    return tmg.getSources(this.video);
  }
  set sources(value = []) {
    this.video.src = "";
    tmg.removeSources(this.video);
    value?.length && tmg.addSources(value, this.video);
  }
  get tracks() {
    return tmg.getTracks(this.video);
  }
  set tracks(value = []) {
    tmg.removeTracks(this.video);
    value?.length && tmg.addTracks(value, this.video);
  }
  log(message, type, action) {
    if (!this.debug) return;
    switch (type) {
      case "error":
        if (action === "swallow") console.warn(`TMG swallowed a rendering error:`, message);
        else throw message;
        break;
      case "warn":
        console.warn(message);
        break;
      default:
        console.log(message);
    }
  }
  bindMethods() {
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      for (const method of Object.getOwnPropertyNames(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, method);
        if (method !== "constructor" && descriptor && typeof descriptor.value === "function") {
          const fn = this[method].bind(this);
          this[method] = (...args) => {
            try {
              const result = fn(...args);
              if (result instanceof Promise) return result.catch((e) => this.log(e, "error", "swallow"));
              return result;
            } catch (e) {
              this.log(e, "error", "swallow");
            }
          };
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
  fire = (eventName, el = this.DOM.notifiersContainer, detail = null, bubbles = true, cancellable = true) => el?.dispatchEvent(new CustomEvent(eventName, { detail, bubbles, cancellable }));
  throttle(key, fn, delay = 10) {
    if (this.throttleMap.has(key)) return;
    const id = setTimeout(() => this.throttleMap.delete(key), delay);
    fn();
    this.throttleMap.set(key, id);
  }
  cancelThrottle(key) {
    const id = this.throttleMap.get(key);
    if (!id) return;
    clearTimeout(id);
    this.throttleMap.delete(key);
  }
  RAFLoop(key, fn) {
    this.rafLoopFnMap.set(key, fn);
    if (this.rafLoopMap.has(key)) return;
    let id;
    const loop = () => {
      this.rafLoopFnMap.get(key)?.();
      id = requestAnimationFrame(loop);
      this.rafLoopMap.set(key, id);
    };
    id = requestAnimationFrame(loop);
    this.rafLoopMap.set(key, id);
  }
  cancelRAFLoop(key) {
    const id = this.rafLoopMap.get(key);
    if (!id) return;
    cancelAnimationFrame(id);
    this.rafLoopFnMap.delete(key);
    this.rafLoopMap.delete(key);
  }
  cancelAllThrottles() {
    for (const key of this.throttleMap.keys()) this.cancelThrottle(key);
    for (const key of this.rafLoopMap.keys()) this.cancelRAFLoop(key);
  }
  cleanUpDOM() {
    this.mutatingDOM = true;
    this.video.classList.remove("T_M_G-video", "T_M_G-media");
    if (this.isModeActive("floatingPlayer")) {
      this.floatingPlayer?.addEventListener("pagehide", () => {
        // at this point, the video is left to fend off alone and handle it's own destruction cuz destroy can't be made asynchronous cuz of one event
        this.videoContainer.classList.remove("T_M_G-video-floating-player");
        if (tmg.isInDOM(this.video)) this.pseudoVideoContainer.parentElement?.replaceChild(this.video, this.pseudoVideoContainer);
        this.videoContainer.remove();
        this.video = tmg.cloneVideo(this.video);
        this.video.tmgcontrols = false;
        this.video.tmgPlayer = null;
      });
      this.floatingPlayer?.removeEventListener("pagehide", this._handleFloatingPlayerClose);
      return this.floatingPlayer?.close();
    } else if (tmg.isInDOM(this.pseudoVideo)) {
      if (tmg.isInDOM(this.video)) this.pseudoVideoContainer.parentElement?.replaceChild(this.video, this.pseudoVideoContainer);
      this.videoContainer.remove();
    } else if (tmg.isInDOM(this.video)) this.videoContainer.parentElement?.replaceChild(this.video, this.videoContainer);
    setTimeout(() => (this.mutatingDOM = false));
  }
  _destroy() {
    this.cancelAudio();
    this.cancelAllThrottles();
    this.leaveSettingsView();
    this.unobserveResize();
    this.unobserveIntersection();
    this.removeKeyEventListeners();
    this.removeVideoEventListeners();
    this.cleanUpDOM();
    if (!this.isModeActive("floatingPlayer")) this.video = tmg.cloneVideo(this.video); // had to do this to get rid of stateful issues and freezing
    return this.video;
  }
  initCSSVariablesManager() {
    // fetching all css varibles from the stylesheet for easy accessibility
    for (const sheet of document.styleSheets) {
      try {
        for (const cssRule of sheet.cssRules) {
          if (!cssRule.selectorText?.replace(/\s/g, "")?.includes(":root,.T_M_G-media-container")) continue;
          for (const property of cssRule.style) {
            if (!property.startsWith("--T_M_G-video-")) continue;
            const value = cssRule.style.getPropertyValue(property);
            const field = tmg.camelize(property.replace("--T_M_G-", ""));
            this.CSSPropsCache[field] = value;
            Object.defineProperty(this, field, {
              get() {
                return getComputedStyle(this.videoContainer).getPropertyValue(property);
              },
              set(value) {
                this.videoContainer.style.setProperty(property, value);
                this.pseudoVideoContainer.style.setProperty(property, value);
              },
              enumerable: true,
              configurable: true,
            });
          }
        }
      } catch {
        continue;
      }
    }
  }
  initSettingsManager() {
    // this.log("TMG Video Settings Manager started")
  }
  getPlayerHTML() {
    const { ui } = this.settings.status,
      keyShortcuts = this.fetchKeyShortcutsForDisplay();
    return {
      pictureinpicturewrapper: `
        <div class="T_M_G-video-picture-in-picture-wrapper">
          <span class="T_M_G-video-picture-in-picture-icon-wrapper">
            <svg class="T_M_G-video-picture-in-picture-icon" viewBox="0 0 73 73">
            <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
              <g transform="translate(2.000000, 2.000000)" fill-rule="nonzero" stroke-width="2" class="T_M_G-video-pip-icon-background">
                <rect x="-1" y="-1" width="71" height="71" rx="14"></rect>
              </g>
              <g transform="translate(15.000000, 15.000000)" fill-rule="nonzero">
              <g>
                <polygon class="T_M_G-video-pip-icon-content-background" points="0 0 0 36 36 36 36 0"></polygon>
                <rect class="T_M_G-video-pip-icon-content-backdrop" x="4.2890625" y="4.2890625" width="27.421875" height="13.2679687"></rect>
                <g transform="translate(4.289063, 27.492187)">
                  <rect x="0" y="0" width="3.1640625" height="2.109375" class="T_M_G-video-pip-icon-timeline-progress"></rect>
                  <rect x="7.3828125" y="0" width="20.0390625" height="2.109375" class="T_M_G-video-pip-icon-timeline-base"></rect>
                </g>
                <circle class="T_M_G-video-pip-icon-thumb-indicator" cx="9.5625" cy="28.546875" r="3.1640625"></circle>
                <polygon class="T_M_G-video-pip-icon-content" points="31.7109375 17.5569609 31.7109375 23.2734375 4.2890625 23.2734375 4.2890625 17.5569609 13.78125 8.06477344 20.109375 14.3928984 24.328125 10.1741484"></polygon>
              </g>
              <g transform="translate(21.000000, 26.000000)">
                <polygon class="T_M_G-video-pip-icon-content-background" points="0 0 0 17.7727273 23 17.7727273 23 0"></polygon>
                <rect class="T_M_G-video-pip-icon-content-backdrop" x="2.74023438" y="2.74023438" width="17.5195312" height="8.47675781"></rect>
                <polygon class="T_M_G-video-pip-icon-content"points="20.2597656 11.2169473 20.2597656 14.8691406 2.74023438 14.8691406 2.74023438 11.2169473 8.8046875 5.15249414 12.8476562 9.19546289 15.5429687 6.50015039"></polygon>
              </g>
              </g>
              </g>
            </svg>
          </span>
          <p>Playing in picture-in-picture</p>
        </div>      
      `,
      videotitle: `
        <div class="T_M_G-video-title-wrapper">
          <p class="T_M_G-video-title" tabindex="-1"></p>
        </div>    
      `,
      videobuffer: `
        <div class="T_M_G-video-buffer">
          <div class="T_M_G-video-buffer-plain"></div>
          <div class="T_M_G-video-buffer-rotator">
          <div class="T_M_G-video-buffer-left">
            <div class="T_M_G-video-buffer-circle">
            </div>
          </div>
          <div class="T_M_G-video-buffer-right">
            <div class="T_M_G-video-buffer-circle"></div>
          </div>
          </div>
        </div>
      `,
      thumbnail: `
        <img class="T_M_G-video-thumbnail" alt="Video Image" src="${tmg.VIDEO_ALT_IMG_SRC}">
        <canvas class="T_M_G-video-thumbnail"></canvas>
      `,
      cueContainer: `
      <div class="T_M_G-video-cue-container"></div>
      `,
      playpausenotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-play-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-play-notifier-icon">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-pause-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-pause-notifier-icon">
            <path d="M14,19H18V5H14M6,19H10V5H6V19Z" />
          </svg>
        </div>   
      `
        : null,
      prevnextnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-prev-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-prev-icon">
            <rect x="4" y="5.14" width="2.5" height="14" transform="translate(2.1,0)"/>
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" transform="translate(2.5,0)" />
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-next-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-next-icon">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5,0)" />
            <rect x="19" y="5.14" width="2.5" height="14" transform="translate(-2.5,0)"/>
          </svg>
        </div>   
      `
        : null,
      captionsnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-captions-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-subtitles-icon">
            <path transform="scale(0.5)" d="M44,6H4A2,2,0,0,0,2,8V40a2,2,0,0,0,2,2H44a2,2,0,0,0,2-2V8A2,2,0,0,0,44,6ZM12,26h4a2,2,0,0,1,0,4H12a2,2,0,0,1,0-4ZM26,36H12a2,2,0,0,1,0-4H26a2,2,0,0,1,0,4Zm10,0H32a2,2,0,0,1,0-4h4a2,2,0,0,1,0,4Zm0-6H22a2,2,0,0,1,0-4H36a2,2,0,0,1,0,4Z" />
          </svg>
          <svg viewBox="0 0 25 25" class="T_M_G-video-captions-icon" transform="scale(1.15)">
            <path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"></path>
          <svg>
        </div>
      `
        : null,
      capturenotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-capture-notifier">
          <svg viewBox="0 0 24 24" class="T_M_G-video-capture-icon">
            <path fill-rule="evenodd" d="M6.937 5.845c.07-.098.15-.219.25-.381l.295-.486C8.31 3.622 8.913 3 10 3h4c1.087 0 1.69.622 2.518 1.978l.295.486c.1.162.18.283.25.381q.071.098.12.155H20a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2.816q.05-.057.121-.155M4 8a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-3c-.664 0-1.112-.364-1.56-.987a8 8 0 0 1-.329-.499c-.062-.1-.27-.445-.3-.492C14.36 5.282 14.088 5 14 5h-4c-.087 0-.36.282-.812 1.022-.029.047-.237.391-.3.492a8 8 0 0 1-.327.5C8.112 7.635 7.664 8 7 8zm15 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2m-7 7a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/>
          </svg>
        </div>
      `
        : null,
      playbackratenotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-playback-rate-notifier">
          <svg viewBox="0 0 30 24">
            <path d="M22,5.14V19.14L11,12.14L22,5.14Z" />
            <path d="M11,5.14V19.14L0,12.14L11,5.14Z" />
          </svg>
          <p class="T_M_G-video-playback-rate-notifier-text"></p>
          <svg viewBox="0 0 30 24">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
            <path d="M19,5.14V19.14L30,12.14L19,5.14Z" />
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-playback-rate-notifier-content"></div>
        <div class="T_M_G-video-notifiers T_M_G-video-playback-rate-up-notifier">
          <svg viewBox="0 0 30 24">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5, 0)" />
            <path d="M19,5.14V19.14L30,12.14L19,5.14Z" transform="translate(-2.5, 0)" />
          </svg>  
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-playback-rate-down-notifier">
          <svg viewBox="0 0 30 24">
            <path d="M22,5.14V19.14L11,12.14L22,5.14Z" transform="translate(2.5, 0)" />
            <path d="M11,5.14V19.14L0,12.14L11,5.14Z" transform="translate(2.5, 0)" />
          </svg>
        </div>
      `
        : null,
      volumenotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-volume-notifier-content"></div>
        <div class="T_M_G-video-notifiers T_M_G-video-volume-up-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-volume-up-notifier-icon" >
            <path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" />
          </svg>  
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-volume-down-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-volume-down-notifier-icon">
            <path d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z" />
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-volume-muted-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-volume-muted-notifier-icon">
            <path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" />
          </svg>
        </div>
      `
        : null,
      brightnessnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-brightness-notifier-content"></div>
        <div class="T_M_G-video-notifiers T_M_G-video-brightness-up-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-up-icon">
            <path transform="scale(1.05) translate(1.5, 1.5)"  d="M10 14.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h3a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm0-15a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm-9 9h3a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm13.95 4.535l2.121 2.122a1 1 0 0 1-1.414 1.414l-2.121-2.121a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-2.12 2.12a1 1 0 1 1-1.415-1.413l2.121-2.122a1 1 0 0 1 1.414 0zM17.071 3.787a1 1 0 0 1 0 1.414L14.95 7.322a1 1 0 0 1-1.414-1.414l2.12-2.121a1 1 0 0 1 1.415 0zm-12.728 0l2.121 2.121A1 1 0 1 1 5.05 7.322L2.93 5.201a1 1 0 0 1 1.414-1.414z">
            </path>
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-brightness-down-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-down-icon">
            <path transform="scale(1.05) translate(3.25, 3.25)" d="M8 12.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm-7 7h1a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2zm11.95 4.535l.707.708a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-.707.707A1 1 0 0 1 2.343 13.1l.707-.708a1 1 0 0 1 1.414 0zm9.193-9.192a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zm-9.9 0l.707.707A1 1 0 1 1 3.05 5.322l-.707-.707a1 1 0 0 1 1.414-1.414z">
            </path>
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-brightness-dark-notifier">
          <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-dark-icon">
            <path transform="scale(1.2) translate(2, 2.5)" d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8.5 2.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 11a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5-5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm-11 0a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9.743-4.036a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm-7.779 7.779a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm7.072 0a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707zM3.757 4.464a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707z">
            </path>
          </svg>
        </div>
      `
        : null,
      objectfitnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-object-fit-notifier-content"></div>
        <div class="T_M_G-video-notifiers T_M_G-video-object-fit-contain-notifier">
          <svg viewBox="0 0 16 16" style="scale: 0.78;">
            <rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/>
            <g stroke-width="1" stroke="currentColor" transform="translate(3,3) scale(0.6)">
              <path d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/>
              <path d="M534.330152,212.999001 L532.488194,212.999001 C532.212773,212.999001 531.997715,213.222859 531.997715,213.499001 C531.997715,213.767068 532.21731,213.999001 532.488194,213.999001 L535.507237,213.999001 C535.643364,213.999001 535.764746,213.944316 535.852704,213.855661 C535.94109,213.763694 535.997715,213.642369 535.997715,213.508523 L535.997715,210.48948 C535.997715,210.214059 535.773858,209.999001 535.497715,209.999001 C535.229649,209.999001 534.997715,210.218596 534.997715,210.48948 L534.997715,212.252351 L530.217991,207.472627 C530.022487,207.277123 529.712749,207.283968 529.517487,207.47923 C529.327935,207.668781 529.319269,207.988118 529.510884,208.179734 L534.330152,212.999001 Z" transform="translate(-520 -198)"/>
              <path d="M521.667563,199 L523.509521,199 C523.784943,199 524,198.776142 524,198.5 C524,198.231934 523.780405,198 523.509521,198 L520.490479,198 C520.354351,198 520.232969,198.054685 520.145011,198.14334 C520.056625,198.235308 520,198.356632 520,198.490479 L520,201.509521 C520,201.784943 520.223858,202 520.5,202 C520.768066,202 521,201.780405 521,201.509521 L521,199.74665 L525.779724,204.526374 C525.975228,204.721878 526.284966,204.715034 526.480228,204.519772 C526.66978,204.33022 526.678447,204.010883 526.486831,203.819268 L521.667563,199 Z" transform="translate(-520 -198)"/>
              <path d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/>
            </g>
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-object-fit-cover-notifier">
          <svg viewBox="0 0 16 16" style="scale: 0.78;">
            <rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/>
            <g stroke-width="1" stroke="currentColor" transform="translate(3,3) scale(0.6)">
              <path d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/>
              <path d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/>
            </g>
          </svg>
        </div>
        <div class="T_M_G-video-notifiers T_M_G-video-object-fit-fill-notifier">
          <svg viewBox="0 0 16 16" style="scale: 0.78;">
            <rect x="4" y="4" width="8" height="8" rx="1" ry="1" fill="none" stroke-width="1.5" stroke="currentColor"/>
            <g stroke-width="1" stroke="currentColor" transform="translate(3, 3) scale(0.65)">  
              <path d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520, -198) translate(-3.25, 2.75)" />  
              <path d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520, -198) translate(2.5, -3.25)" />  
            </g> 
          </svg>  
        </div>
      `
        : null,
      fwdnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-fwd-notifier">
          <svg viewBox="0 0 25 25">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>            
        </div>
      `
        : null,
      bwdnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-bwd-notifier">
          <svg viewBox="0 0 25 25">          
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">          
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">          
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" />
          </svg>            
        </div>   
      `
        : null,
      scrubnotifier: ui.notifiers
        ? `
      <div class="T_M_G-video-notifiers T_M_G-video-scrub-notifier">
        <span>
          <svg viewBox="0 0 25 25">          
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">          
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">          
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" />
          </svg>
        </span>
        <div class="T_M_G-video-scrub-notifier-content">
          <p class="T_M_G-video-scrub-notifier-text" tabindex="-1">Double tap left or right to skip ${this.settings.time.skip} seconds</p>
        </div>
        <span>
          <svg viewBox="0 0 25 25">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>            
        </span>
      </div>
      `
        : null,
      touchtimelinenotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-touch-timeline-notifier T_M_G-video-touch-notifier"></div>
      `
        : null,
      touchvolumenotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-touch-volume-notifier T_M_G-video-touch-vb-notifier">
          <span class="T_M_G-video-touch-volume-content T_M_G-video-touch-vb-content">0</span>
          <div class="T_M_G-video-touch-volume-slider T_M_G-video-touch-vb-slider"></div>
          <span>
            <svg viewBox="0 0 25 25" class="T_M_G-video-volume-high-icon">
              <path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z">
              </path>
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-volume-low-icon">
              <path d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z"></path>
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-volume-muted-icon">
              <path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z">
              </path>
            </svg>
          </span>
        </div>
      `
        : null,
      touchbrightnessnotifier: ui.notifiers
        ? `
        <div class="T_M_G-video-notifiers T_M_G-video-touch-brightness-notifier T_M_G-video-touch-vb-notifier">
          <span class="T_M_G-video-touch-brightness-content T_M_G-video-touch-vb-content">0</span>
          <div class="T_M_G-video-touch-brightness-slider T_M_G-video-touch-vb-slider"></div>
          <span>
            <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-high-icon">
              <path transform="scale(1.05) translate(1.5, 1.5)"  d="M10 14.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h3a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm0-15a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm-9 9h3a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm13.95 4.535l2.121 2.122a1 1 0 0 1-1.414 1.414l-2.121-2.121a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-2.12 2.12a1 1 0 1 1-1.415-1.413l2.121-2.122a1 1 0 0 1 1.414 0zM17.071 3.787a1 1 0 0 1 0 1.414L14.95 7.322a1 1 0 0 1-1.414-1.414l2.12-2.121a1 1 0 0 1 1.415 0zm-12.728 0l2.121 2.121A1 1 0 1 1 5.05 7.322L2.93 5.201a1 1 0 0 1 1.414-1.414z">
              </path>
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-low-icon">
              <path transform="scale(1.05) translate(3.25, 3.25)" d="M8 12.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm-7 7h1a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2zm11.95 4.535l.707.708a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-.707.707A1 1 0 0 1 2.343 13.1l.707-.708a1 1 0 0 1 1.414 0zm9.193-9.192a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zm-9.9 0l.707.707A1 1 0 1 1 3.05 5.322l-.707-.707a1 1 0 0 1 1.414-1.414z">
              </path>
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-dark-icon">
              <path transform="scale(1.2) translate(2, 2.5)" d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8.5 2.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 11a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5-5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm-11 0a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9.743-4.036a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm-7.779 7.779a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm7.072 0a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707zM3.757 4.464a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707z">
              </path>
            </svg>
          </span>
        </div>      
      `
        : null,
      expandminiplayer: `
        <div class="T_M_G-video-mini-player-btn-wrapper T_M_G-video-mini-player-expand-btn-wrapper">
          <button type="button" class="T_M_G-video-mini-player-expand-btn">
            <svg class="T_M_G-video-mini-player-expand-icon" viewBox="0 -960 960 960" data-control-title="Expand miniplayer" style="transform: scale(0.9) rotate(90deg);">
              <path d="M120-120v-320h80v184l504-504H520v-80h320v320h-80v-184L256-200h184v80H120Z"/>
            </svg>
          </button>
        </div>   
      `,
      removeminiplayer: `
        <div class="T_M_G-video-mini-player-btn-wrapper T_M_G-video-mini-player-remove-btn-wrapper">
          <button type="button" class="T_M_G-video-mini-player-remove-btn">
            <svg class="T_M_G-video-mini-player-remove-icon" viewBox="0 -960 960 960" data-control-title="Remove miniplayer">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
            </svg>
          </button>
        </div>   
      `,
      capture: ui.capture
        ? `
          <button type="button" class="T_M_G-video-capture-btn" data-draggable-control="${ui.draggable}"> 
            <svg viewBox="0 0 24 24" class="T_M_G-video-capture-icon" data-control-title="Capture${keyShortcuts["capture"]} ↔ DblClick→B&W (+alt)">
              <path fill-rule="evenodd" d="M6.937 5.845c.07-.098.15-.219.25-.381l.295-.486C8.31 3.622 8.913 3 10 3h4c1.087 0 1.69.622 2.518 1.978l.295.486c.1.162.18.283.25.381q.071.098.12.155H20a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2.816q.05-.057.121-.155M4 8a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-3c-.664 0-1.112-.364-1.56-.987a8 8 0 0 1-.329-.499c-.062-.1-.27-.445-.3-.492C14.36 5.282 14.088 5 14 5h-4c-.087 0-.36.282-.812 1.022-.029.047-.237.391-.3.492a8 8 0 0 1-.327.5C8.112 7.635 7.664 8 7 8zm15 3a1 1 0 1 0 0-2 1 1 0 0 0 0 2m-7 7a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/>
            </svg>
          </button>`
        : null,
      fullscreenorientation: ui.fullScreenOrientation
        ? `
          <button type="button" class="T_M_G-video-full-screen-orientation-btn T_M_G-video-control-initial-show" data-draggable-control="${ui.draggable}" data-control-id="fullscreenorientation" style="transform: scale(0.925);"> 
            <svg viewBox="0 0 512 512" class="T_M_G-video-full-screen-orientation-icon" data-control-title="Change orientation" >
              <path d="M446.81,275.82H236.18V65.19c0-20.78-16.91-37.69-37.69-37.69H65.19c-20.78,0-37.69,16.91-37.69,37.69v255.32   c0,20.78,16.91,37.68,37.69,37.68h88.62v88.62c0,20.78,16.9,37.69,37.68,37.69h255.32c20.78,0,37.69-16.91,37.69-37.69v-133.3   C484.5,292.73,467.59,275.82,446.81,275.82z M65.19,326.19c-3.14,0-5.69-2.55-5.69-5.68V65.19c0-3.14,2.55-5.69,5.69-5.69h133.3   c3.14,0,5.69,2.55,5.69,5.69v210.63h-12.69c-20.78,0-37.68,16.91-37.68,37.69v12.68H65.19z M452.5,446.81   c0,3.14-2.55,5.69-5.69,5.69H191.49c-3.13,0-5.68-2.55-5.68-5.69V342.19v-28.68c0-2.94,2.24-5.37,5.1-5.66   c0.19-0.02,0.38-0.03,0.58-0.03h28.69h226.63c3.14,0,5.69,2.55,5.69,5.69V446.81z"/>
              <path d="M369.92,181.53c-6.25-6.25-16.38-6.25-22.63,0c-6.25,6.25-6.25,16.38,0,22.63l44.39,44.39   c3.12,3.13,7.22,4.69,11.31,4.69c0.21,0,0.42-0.02,0.63-0.03c0.2,0.01,0.4,0.03,0.6,0.03c6.31,0,11.74-3.66,14.35-8.96   l37.86-37.86c6.25-6.25,6.25-16.38,0-22.63c-6.25-6.25-16.38-6.25-22.63,0l-13.59,13.59v-86.58c0-8.84-7.16-16-16-16h-86.29   l15.95-15.95c6.25-6.25,6.25-16.38,0-22.63c-6.25-6.25-16.38-6.25-22.63,0l-40.33,40.33c-5.19,2.65-8.75,8.03-8.75,14.25   c0,0.19,0.02,0.37,0.03,0.56c-0.01,0.19-0.03,0.38-0.03,0.57c0,4.24,1.69,8.31,4.69,11.31l42.14,42.14   c3.12,3.12,7.22,4.69,11.31,4.69s8.19-1.56,11.31-4.69c6.25-6.25,6.25-16.38,0-22.63l-15.95-15.95h72.54v73.05L369.92,181.53z"/>
            </svg>                        
          </button>        
      `
        : null,
      fullscreenlock: ui.fullScreenLock
        ? `
          <button type="button" class="T_M_G-video-full-screen-locked-btn" data-draggable-control="${ui.draggable}" data-control-id="fullscreenlock"> 
            <svg class="T_M_G-video-full-screen-locked-icon" viewBox="0 0 512 512" data-control-title="Lock Screen" style="transform: scale(0.825);">
              <path d="M390.234 171.594v-37.375c.016-36.969-15.078-70.719-39.328-94.906A133.88 133.88 0 0 0 256 0a133.88 133.88 0 0 0-94.906 39.313c-24.25 24.188-39.344 57.938-39.313 94.906v37.375H24.906V512h462.188V171.594zm-210.343-37.375c.016-21.094 8.469-39.938 22.297-53.813C216.047 66.594 234.891 58.125 256 58.125s39.953 8.469 53.813 22.281c13.828 13.875 22.281 32.719 22.297 53.813v37.375H179.891zm-96.86 95.5h345.938v224.156H83.031z"/>
              <path d="M297.859 321.844c0-23.125-18.75-41.875-41.859-41.875-23.125 0-41.859 18.75-41.859 41.875 0 17.031 10.219 31.625 24.828 38.156l-9.25 60.094h52.562L273.016 360c14.609-6.531 24.843-21.125 24.843-38.156"/>
            </svg>                        
          </button>        
      `
        : null,
      bigprev: `
        <button type="button" class="T_M_G-video-big-prev-btn">
          <svg viewBox="0 0 25 25" class="T_M_G-video-prev-icon" data-control-title="Previous video${keyShortcuts["prev"]}">
            <rect x="4" y="5.14" width="2.5" height="14" transform="translate(2.1,0)"/>
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" transform="translate(2.5,0)" />
          </svg>
        </button>      
      `,
      bigplaypause: `
        <button type="button" class="T_M_G-video-big-play-pause-btn" tabindex="${this.initialState ? "0" : "-1"}">
          <svg viewBox="0 0 25 25" class="T_M_G-video-play-icon" data-control-title="Play${keyShortcuts["playPause"]}">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25" class="T_M_G-video-pause-icon" data-control-title="Pause${keyShortcuts["playPause"]}">
            <path d="M14,19H18V5H14M6,19H10V5H6V19Z" />
          </svg>
          <svg class="T_M_G-video-replay-icon" viewBox="0 -960 960 960" data-control-title="Replay${keyShortcuts["playPause"]}" >
            <path d="M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440h80q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l62 62-56 58-160-160 160-160 56 58-62 62h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z"/>
          </svg> 
        </button>         
      `,
      bignext: `
        <button type="button" class="T_M_G-video-big-next-btn">
          <svg viewBox="0 0 25 25" class="T_M_G-video-next-icon" data-control-title="Next video${keyShortcuts["next"]}">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5,0)" />
            <rect x="19" y="5.14" width="2.5" height="14" transform="translate(-2.5,0)"/>
          </svg>
        </button>      
      `,
      timeline: ui.timeline
        ? `
        <div class="T_M_G-video-timeline-container" tabindex="0">
          <div class="T_M_G-video-timeline">
            <div class="T_M_G-video-seek-bar T_M_G-video-base-seek-bar"></div>
            <div class="T_M_G-video-seek-bar T_M_G-video-buffered-seek-bar"></div>
            <div class="T_M_G-video-seek-bar T_M_G-video-preview-seek-bar"></div>
            <div class="T_M_G-video-seek-bar T_M_G-video-played-seek-bar"></div>
            <div class="T_M_G-video-thumb-indicator T_M_G-video-rippler"></div>
            <div class="T_M_G-video-preview-container">
              <img class="T_M_G-video-preview" alt="Preview image" src="${tmg.VIDEO_ALT_IMG_SRC}">
              <canvas class="T_M_G-video-preview"></canvas>
          </div>
          </div>
        </div>
      `
        : null,
      prev: ui.prev
        ? `
        <button type="button" class="T_M_G-video-prev-btn" data-draggable-control="${ui.draggable}" data-control-id="prev">
          <svg viewBox="0 0 25 25" class="T_M_G-video-prev-icon" data-control-title="Previous video${keyShortcuts["prev"]}">
            <rect x="4" y="5.14" width="2.5" height="14" transform="translate(2.1,0)"/>
            <path d="M17,5.14V19.14L6,12.14L17,5.14Z" transform="translate(2.5,0)" />
          </svg>
        </button>      
      `
        : null,
      playpause: ui.playPause
        ? `
        <button type="button" class="T_M_G-video-play-pause-btn" data-draggable-control="${ui.draggable}" data-control-id="playpause">
          <svg viewBox="0 0 25 25" class="T_M_G-video-play-icon" data-control-title="Play${keyShortcuts["playPause"]}" style="transform: scale(1.35);">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
          </svg>
          <svg viewBox="0 0 25 25" class="T_M_G-video-pause-icon" data-control-title="Pause${keyShortcuts["playPause"]}" style="transform: scale(1.25);">
            <path d="M14,19H18V5H14M6,19H10V5H6V19Z" />
          </svg>
          <svg class="T_M_G-video-replay-icon" viewBox="0 -960 960 960" data-control-title="Replay${keyShortcuts["playPause"]}">
            <path d="M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440h80q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l62 62-56 58-160-160 160-160 56 58-62 62h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z"/>
          </svg> 
        </button>   
      `
        : null,
      next: ui.next
        ? `
        <button type="button" class="T_M_G-video-next-btn" data-draggable-control="${ui.draggable}" data-control-id="next">
          <svg viewBox="0 0 25 25" class="T_M_G-video-next-icon" data-control-title="Next video${keyShortcuts["next"]}">
            <path d="M8,5.14V19.14L19,12.14L8,5.14Z" transform="translate(-2.5,0)" />
            <rect x="19" y="5.14" width="2.5" height="14" transform="translate(-2.5,0)"/>
          </svg>
        </button>   
      `
        : null,
      volume: ui.volume
        ? `
        <div class="T_M_G-video-volume-container T_M_G-video-vb-container" data-control-id="volume">
          <button type="button" class="T_M_G-video-mute-btn T_M_G-video-vb-btn" data-draggable-control="${ui.draggable}">
            <svg viewBox="0 0 25 25" class="T_M_G-video-volume-high-icon" data-control-title="Mute${keyShortcuts["mute"]}">
              <path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" />
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-volume-low-icon" data-control-title="Mute${keyShortcuts["mute"]}">
              <path d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z" />
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-volume-muted-icon" data-control-title="Unmute${keyShortcuts["mute"]}">
              <path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" />
            </svg>
          </button>
          <span class="T_M_G-video-volume-slider-wrapper T_M_G-video-vb-slider-wrapper"><input class="T_M_G-video-volume-slider T_M_G-video-vb-slider" type="range" min="0" max="100" step="1"></span>
        </div>
      `
        : null,
      brightness: ui.brightness
        ? `
        <div class="T_M_G-video-brightness-container T_M_G-video-vb-container" data-control-id="brightness">
          <button type="button" class="T_M_G-video-dark-btn T_M_G-video-vb-btn" data-draggable-control="${ui.draggable}">
            <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-high-icon" data-control-title="Darken${keyShortcuts["dark"]}">
              <path transform="scale(1.05) translate(1.5, 1.5)"  d="M10 14.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h3a1 1 0 0 1 0 2h-3a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm0-15a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1zm-9 9h3a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm13.95 4.535l2.121 2.122a1 1 0 0 1-1.414 1.414l-2.121-2.121a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-2.12 2.12a1 1 0 1 1-1.415-1.413l2.121-2.122a1 1 0 0 1 1.414 0zM17.071 3.787a1 1 0 0 1 0 1.414L14.95 7.322a1 1 0 0 1-1.414-1.414l2.12-2.121a1 1 0 0 1 1.415 0zm-12.728 0l2.121 2.121A1 1 0 1 1 5.05 7.322L2.93 5.201a1 1 0 0 1 1.414-1.414z">
              </path>
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-low-icon" data-control-title="Brighten${keyShortcuts["dark"]}">
              <path transform="scale(1.05) translate(3.25, 3.25)" d="M8 12.858a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6-5h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2zm-6 6a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zm-7 7h1a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2zm11.95 4.535l.707.708a1 1 0 1 1-1.414 1.414l-.707-.707a1 1 0 0 1 1.414-1.415zm-8.486 0a1 1 0 0 1 0 1.415l-.707.707A1 1 0 0 1 2.343 13.1l.707-.708a1 1 0 0 1 1.414 0zm9.193-9.192a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0zm-9.9 0l.707.707A1 1 0 1 1 3.05 5.322l-.707-.707a1 1 0 0 1 1.414-1.414z">
              </path>
            </svg>
            <svg viewBox="0 0 25 25" class="T_M_G-video-brightness-dark-icon" data-control-title="Brighten${keyShortcuts["dark"]}">
              <path transform="scale(1.2) translate(2, 2.5)" d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8.5 2.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm0 11a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zm5-5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm-11 0a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1zm9.743-4.036a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm-7.779 7.779a.5.5 0 1 1-.707-.707.5.5 0 0 1 .707.707zm7.072 0a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707zM3.757 4.464a.5.5 0 1 1 .707-.707.5.5 0 0 1-.707.707z">
              </path>
            </svg>                  
          </button>
          <span class="T_M_G-video-brightness-slider-wrapper T_M_G-video-vb-slider-wrapper"><input class="T_M_G-video-brightness-slider T_M_G-video-vb-slider" type="range" min="0" max="100" step="1"></span>
        </div>         
      `
        : null,
      timeandduration: ui.timeAndDuration
        ? `
        <button class="T_M_G-video-time-and-duration-btn" data-draggable-control="${ui.draggable}" data-control-id="timeandduration" title="Switch (format${keyShortcuts["timeFormat"]} / DblClick→mode${keyShortcuts["timeMode"]})">
          <div class="T_M_G-video-current-time">0:00</div>
          <span>/</span>
          <div class="T_M_G-video-total-time">-:--</div>
        </button>   
      `
        : null,
      playbackrate: ui.playbackRate
        ? `
        <button type="button" class="T_M_G-video-playback-rate-btn" title="Playback rate${keyShortcuts["playbackRate"]}" data-draggable-control="${ui.draggable}" data-control-id="playbackrate">${this.playbackRate}x</button>
      `
        : null,
      captions: ui.captions
        ? `
        <button type="button" class="T_M_G-video-captions-btn" data-draggable-control="${ui.draggable}" data-control-id="captions">
          <svg viewBox="0 0 25 25" data-control-title="Subtitles${keyShortcuts["captions"]}" class="T_M_G-video-subtitles-icon">
            <path transform="scale(0.5)" d="M44,6H4A2,2,0,0,0,2,8V40a2,2,0,0,0,2,2H44a2,2,0,0,0,2-2V8A2,2,0,0,0,44,6ZM12,26h4a2,2,0,0,1,0,4H12a2,2,0,0,1,0-4ZM26,36H12a2,2,0,0,1,0-4H26a2,2,0,0,1,0,4Zm10,0H32a2,2,0,0,1,0-4h4a2,2,0,0,1,0,4Zm0-6H22a2,2,0,0,1,0-4H36a2,2,0,0,1,0,4Z" />
          </svg>
          <svg viewBox="0 0 25 25" data-control-title="Closed captions${keyShortcuts["captions"]}" class="T_M_G-video-captions-icon" transform="scale(1.15)">
            <path d="M18,11H16.5V10.5H14.5V13.5H16.5V13H18V14A1,1 0 0,1 17,15H14A1,1 0 0,1 13,14V10A1,1 0 0,1 14,9H17A1,1 0 0,1 18,10M11,11H9.5V10.5H7.5V13.5H9.5V13H11V14A1,1 0 0,1 10,15H7A1,1 0 0,1 6,14V10A1,1 0 0,1 7,9H10A1,1 0 0,1 11,10M19,4H5C3.89,4 3,4.89 3,6V18A2,2 0 0,0 5,20H19A2,2 0 0,0 21,18V6C21,4.89 20.1,4 19,4Z"></path>
          <svg>
        </button>
      `
        : null,
      settings: ui.settings
        ? `
        <button type="button" class="T_M_G-video-settings-btn" data-draggable-control="${ui.draggable}" data-control-id="settings">
          <svg class="T_M_G-video-settings-icon" viewBox="0 -960 960 960" data-control-title="Settings${keyShortcuts["settings"]}">
            <path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/>
          </svg>
        </button>      
      `
        : null,
      objectfit: ui.objectFit
        ? `
        <button type="button" class="T_M_G-video-object-fit-btn " data-draggable-control="${ui.draggable}" data-control-id="objectfit">
          <svg class="T_M_G-video-object-fit-contain-icon" data-control-title="Crop to fit${keyShortcuts["objectFit"]}" viewBox="0 0 16 16" transform="scale(0.78)">
            <rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/>
            <g stroke-width="1" stroke="currentColor" transform="translate(3,3) scale(0.6)">
              <path d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/>
              <path d="M534.330152,212.999001 L532.488194,212.999001 C532.212773,212.999001 531.997715,213.222859 531.997715,213.499001 C531.997715,213.767068 532.21731,213.999001 532.488194,213.999001 L535.507237,213.999001 C535.643364,213.999001 535.764746,213.944316 535.852704,213.855661 C535.94109,213.763694 535.997715,213.642369 535.997715,213.508523 L535.997715,210.48948 C535.997715,210.214059 535.773858,209.999001 535.497715,209.999001 C535.229649,209.999001 534.997715,210.218596 534.997715,210.48948 L534.997715,212.252351 L530.217991,207.472627 C530.022487,207.277123 529.712749,207.283968 529.517487,207.47923 C529.327935,207.668781 529.319269,207.988118 529.510884,208.179734 L534.330152,212.999001 Z" transform="translate(-520 -198)"/>
              <path d="M521.667563,199 L523.509521,199 C523.784943,199 524,198.776142 524,198.5 C524,198.231934 523.780405,198 523.509521,198 L520.490479,198 C520.354351,198 520.232969,198.054685 520.145011,198.14334 C520.056625,198.235308 520,198.356632 520,198.490479 L520,201.509521 C520,201.784943 520.223858,202 520.5,202 C520.768066,202 521,201.780405 521,201.509521 L521,199.74665 L525.779724,204.526374 C525.975228,204.721878 526.284966,204.715034 526.480228,204.519772 C526.66978,204.33022 526.678447,204.010883 526.486831,203.819268 L521.667563,199 Z" transform="translate(-520 -198)"/>
              <path d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/>
            </g>
          </svg>
          <svg class="T_M_G-video-object-fit-cover-icon" data-control-title="Fit to screen${keyShortcuts["objectFit"]}" viewBox="0 0 16 16" transform="scale(0.78)">
            <rect width="16" height="16" rx="4" ry="4" fill="none" stroke-width="2.25" stroke="currentColor"/>
            <g stroke-width="1" stroke="currentColor" transform="translate(3,3) scale(0.6)">
              <path d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520 -198)"/>
              <path d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520 -198)"/>
            </g>
          </svg>
          <svg class="T_M_G-video-object-fit-fill-icon" data-control-title="Stretch${keyShortcuts["objectFit"]}" viewBox="0 0 16 16" transform="scale(0.78)">
            <rect x="4" y="4" width="8" height="8" rx="1" ry="1" fill="none" stroke-width="1.5" stroke="currentColor"/>
            <g stroke-width="1" stroke="currentColor" transform="translate(3, 3) scale(0.65)">  
              <path d="M521.667563,212.999001 L523.509521,212.999001 C523.784943,212.999001 524,213.222859 524,213.499001 C524,213.767068 523.780405,213.999001 523.509521,213.999001 L520.490479,213.999001 C520.354351,213.999001 520.232969,213.944316 520.145011,213.855661 C520.056625,213.763694 520,213.642369 520,213.508523 L520,210.48948 C520,210.214059 520.223858,209.999001 520.5,209.999001 C520.768066,209.999001 521,210.218596 521,210.48948 L521,212.252351 L525.779724,207.472627 C525.975228,207.277123 526.284966,207.283968 526.480228,207.47923 C526.66978,207.668781 526.678447,207.988118 526.486831,208.179734 L521.667563,212.999001 Z" transform="translate(-520, -198) translate(-3.25, 2.75)" />  
              <path d="M534.251065,199 L532.488194,199 C532.212773,199 531.997715,198.776142 531.997715,198.5 C531.997715,198.231934 532.21731,198 532.488194,198 L535.507237,198 C535.643364,198 535.764746,198.054685 535.852704,198.14334 C535.94109,198.235308 535.997715,198.356632 535.997715,198.490479 L535.997715,201.509521 C535.997715,201.784943 535.773858,202 535.497715,202 C535.229649,202 534.997715,201.780405 534.997715,201.509521 L534.997715,199.667563 L530.178448,204.486831 C529.982944,204.682335 529.673206,204.67549 529.477943,204.480228 C529.288392,204.290677 529.279725,203.97134 529.471341,203.779724 L534.251065,199 Z" transform="translate(-520, -198) translate(2.5, -3.25)" />  
            </g> 
          </svg>               
        </button>            
      `
        : null,
      pictureinpicture: ui.pictureInPicture
        ? `
        <button type="button" class="T_M_G-video-picture-in-picture-btn" data-draggable-control="${ui.draggable}" data-control-id="pictureinpicture">
          <svg viewBox="0 0 25 25" class="T_M_G-video-enter-picture-in-picture-icon" data-control-title="Picture-in-picture${keyShortcuts["pictureInPicture"]}">
            <path fill-rule="nonzero" d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm0 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8zM6.707 6.293l2.25 2.25L11 6.5V12H5.5l2.043-2.043-2.25-2.25 1.414-1.414z" />
          </svg>
          <svg viewBox="0 0 25 25" class="T_M_G-video-leave-picture-in-picture-icon" data-control-title="Exit picture-in-picture${keyShortcuts["pictureInPicture"]}">
            <path fill-rule="nonzero" d="M21 3a1 1 0 0 1 1 1v7h-2V5H4v14h6v2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18zm0 10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h8zm-9.5-6L9.457 9.043l2.25 2.25-1.414 1.414-2.25-2.25L6 12.5V7h5.5z">
            </path>
          </svg>
        </button>   
      `
        : null,
      theater: ui.theater
        ? `
        <button type="button" class="T_M_G-video-theater-btn" data-draggable-control="${ui.draggable}" data-control-id="theater">
          <svg viewBox="0 0 25 25" class="T_M_G-video-enter-theater-icon" data-control-title="Cinema mode${keyShortcuts["theater"]}">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M23 7C23 5.34315 21.6569 4 20 4H4C2.34315 4 1 5.34315 1 7V17C1 18.6569 2.34315 20 4 20H20C21.6569 20 23 18.6569 23 17V7ZM21 7C21 6.44772 20.5523 6 20 6H4C3.44772 6 3 6.44771 3 7V17C3 17.5523 3.44772 18 4 18H20C20.5523 18 21 17.5523 21 17V7Z"/>
          </svg>
          <svg viewBox="0 0 25 25" class="T_M_G-video-leave-theater-icon" data-control-title="Default view${keyShortcuts["theater"]}">
            <path d="M19 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H5V8h14v8z"></path>
          </svg>
        </button>
      `
        : null,
      fullscreen: ui.fullScreen
        ? `
        <button type="button" class="T_M_G-video-full-screen-btn" data-draggable-control="${ui.draggable}" data-control-id="fullscreen">
          <svg viewBox="0 0 25 25" class="T_M_G-video-enter-full-screen-icon" data-control-title="Full screen${keyShortcuts["fullScreen"]}" transform="scale(.8)">
            <path d="M4 1.5C2.61929 1.5 1.5 2.61929 1.5 4V8.5C1.5 9.05228 1.94772 9.5 2.5 9.5H3.5C4.05228 9.5 4.5 9.05228 4.5 8.5V4.5H8.5C9.05228 4.5 9.5 4.05228 9.5 3.5V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H4Z" />
            <path d="M20 1.5C21.3807 1.5 22.5 2.61929 22.5 4V8.5C22.5 9.05228 22.0523 9.5 21.5 9.5H20.5C19.9477 9.5 19.5 9.05228 19.5 8.5V4.5H15.5C14.9477 4.5 14.5 4.05228 14.5 3.5V2.5C14.5 1.94772 14.9477 1.5 15.5 1.5H20Z" />
            <path d="M20 22.5C21.3807 22.5 22.5 21.3807 22.5 20V15.5C22.5 14.9477 22.0523 14.5 21.5 14.5H20.5C19.9477 14.5 19.5 14.9477 19.5 15.5V19.5H15.5C14.9477 19.5 14.5 19.9477 14.5 20.5V21.5C14.5 22.0523 14.9477 22.5 15.5 22.5H20Z" />
            <path d="M1.5 20C1.5 21.3807 2.61929 22.5 4 22.5H8.5C9.05228 22.5 9.5 22.0523 9.5 21.5V20.5C9.5 19.9477 9.05228 19.5 8.5 19.5H4.5V15.5C4.5 14.9477 4.05228 14.5 3.5 14.5H2.5C1.94772 14.5 1.5 14.9477 1.5 15.5V20Z" />
          </svg>
          <svg viewBox="0 0 25 25" class="T_M_G-video-leave-full-screen-icon" data-control-title="Exit full screen${keyShortcuts["fullScreen"]}" transform="scale(.8)">
            <path d="M7 9.5C8.38071 9.5 9.5 8.38071 9.5 7V2.5C9.5 1.94772 9.05228 1.5 8.5 1.5H7.5C6.94772 1.5 6.5 1.94772 6.5 2.5V6.5H2.5C1.94772 6.5 1.5 6.94772 1.5 7.5V8.5C1.5 9.05228 1.94772 9.5 2.5 9.5H7Z" />
            <path d="M17 9.5C15.6193 9.5 14.5 8.38071 14.5 7V2.5C14.5 1.94772 14.9477 1.5 15.5 1.5H16.5C17.0523 1.5 17.5 1.94772 17.5 2.5V6.5H21.5C22.0523 6.5 22.5 6.94772 22.5 7.5V8.5C22.5 9.05228 22.0523 9.5 21.5 9.5H17Z" />
            <path d="M17 14.5C15.6193 14.5 14.5 15.6193 14.5 17V21.5C14.5 22.0523 14.9477 22.5 15.5 22.5H16.5C17.0523 22.5 17.5 22.0523 17.5 21.5V17.5H21.5C22.0523 17.5 22.5 17.0523 22.5 16.5V15.5C22.5 14.9477 22.0523 14.5 21.5 14.5H17Z" />
            <path d="M9.5 17C9.5 15.6193 8.38071 14.5 7 14.5H2.5C1.94772 14.5 1.5 14.9477 1.5 15.5V16.5C1.5 17.0523 1.94772 17.5 2.5 17.5H6.5V21.5C6.5 22.0523 6.94772 22.5 7.5 22.5H8.5C9.05228 22.5 9.5 22.0523 9.5 21.5V17Z" />
          </svg>
        </button>   
      `
        : null,
    };
  }
  buildContainers() {
    this.setPosterState();
    this.videoContainer = tmg.createEl("div");
    this.video.parentElement?.insertBefore(this.videoContainer, this.video);
    this.videoContainer.classList.add("T_M_G-video-container", "T_M_G-media-container");
    this.videoContainer.classList.toggle("T_M_G-video-mobile", this.isMediaMobile);
    this.videoContainer.classList.toggle("T_M_G-video-paused", this.video.paused);
    this.videoContainer.classList.toggle("T_M_G-video-progress-bar", this.settings.time.progressBar ?? this.isMediaMobile);
    this.videoContainer.setAttribute("data-object-fit", this.videoObjectFit || "contain");
    this.videoContainer.setAttribute("data-volume-level", "muted");
    this.videoContainer.setAttribute("data-brightness-level", "dark");
    // pseudo els
    this.pseudoVideo = tmg.createEl("video", { className: "T_M_G-pseudo-video T_M_G-media", tmgPlayer: this.video.tmgPlayer, muted: true, autoplay: false });
    this.pseudoVideoContainer = tmg.createEl("div", { className: "T_M_G-pseudo-video-container T_M_G-media-container" });
    this.pseudoVideoContainer.append(this.pseudoVideo);
    this.syncAspectRatio();
  }
  buildPlayerInterface() {
    this.videoContainer.insertAdjacentHTML(
      "beforeend",
      `
    <!-- Code injected by TMG -->
    <div class="T_M_G-video-container-content-wrapper">
      <div class="T_M_G-video-container-content">
        <div class="T_M_G-video-controls-container">
          <div class="T_M_G-video-curtain T_M_G-video-top-curtain"></div>
          <div class="T_M_G-video-curtain T_M_G-video-bottom-curtain"></div>
          <div class="T_M_G-video-curtain T_M_G-video-cover-curtain"></div>
        </div>
      </div>
      <div class="T_M_G-video-settings" inert>
        <div class="T_M_G-video-settings-content">
          <div class="T_M_G-video-settings-top-panel">
            <button type="button" class="T_M_G-video-settings-close-btn">
              <span>
                <svg  viewBox="0 0 25 25" class="T_M_G-video-settings-close-btn-icon">
                  <path d="M1.307,5.988 L6.616,1.343 C7.027,0.933 7.507,0.864 7.918,1.275 L7.918,4.407 C8.014,4.406 8.098,4.406 8.147,4.406 C13.163,4.406 16.885,7.969 16.885,12.816 C16.885,14.504 16.111,13.889 15.788,13.3 C14.266,10.52 11.591,8.623 8.107,8.623 C8.066,8.623 7.996,8.624 7.917,8.624 L7.917,11.689 C7.506,12.099 6.976,12.05 6.615,11.757 L1.306,7.474 C0.897,7.064 0.897,6.399 1.307,5.988 L1.307,5.988 Z"></path>
                </svg>
              </span>
              <span>Close Settings</span>
            </button>                     
          </div>
          <div class="T_M_G-video-settings-bottom-panel">
            No Settings Available Yet!
          </div>
        </div>
      </div>         
    </div>
    <div class="T_M_G-video-screen-locked-wrapper">
      <button type="button" title="Unlock Screen" class="T_M_G-video-screen-locked-btn" tabindex="-1">
        <svg class="T_M_G-video-screen-locked-icon" viewBox="0 0 512 512" data-control-title="Lock Screen" style="transform: scale(0.825);">
          <path d="M390.234 171.594v-37.375c.016-36.969-15.078-70.719-39.328-94.906A133.88 133.88 0 0 0 256 0a133.88 133.88 0 0 0-94.906 39.313c-24.25 24.188-39.344 57.938-39.313 94.906v37.375H24.906V512h462.188V171.594zm-210.343-37.375c.016-21.094 8.469-39.938 22.297-53.813C216.047 66.594 234.891 58.125 256 58.125s39.953 8.469 53.813 22.281c13.828 13.875 22.281 32.719 22.297 53.813v37.375H179.891zm-96.86 95.5h345.938v224.156H83.031z"/>
          <path d="M297.859 321.844c0-23.125-18.75-41.875-41.859-41.875-23.125 0-41.859 18.75-41.859 41.875 0 17.031 10.219 31.625 24.828 38.156l-9.25 60.094h52.562L273.016 360c14.609-6.531 24.843-21.125 24.843-38.156"/>
        </svg>  
        <svg class="T_M_G-video-screen-unlock-icon" viewBox="0 0 512 512" data-control-title="Lock Screen" style="transform: scale(0.875) translate(0, -1px);">
          <path d="M186.984 203.297v-81.578c.016-19.141 7.688-36.219 20.219-48.813C219.766 60.391 236.859 52.719 256 52.703c19.141.016 36.234 7.688 48.813 20.203 12.531 12.594 20.203 29.672 20.219 48.813v43.406h52.703v-43.406c.016-33.531-13.672-64.125-35.656-86.063C320.125 13.656 289.531-.016 256 0c-33.531-.016-64.125 13.656-86.063 35.656-22 21.938-35.672 52.531-35.656 86.063v81.578H46.438V512h419.125V203.297zM99.141 256H412.86v203.297H99.141z"/>
          <path d="M293.969 339.547c0-20.969-17-37.953-37.969-37.953s-37.953 16.984-37.953 37.953c0 15.453 9.266 28.703 22.516 34.609l-8.391 54.5h47.672l-8.406-54.5c13.25-5.906 22.531-19.156 22.531-34.609"/>
        </svg>  
        <p>Unlock controls?</p>
      </button>
      <p>Screen Locked</p>
      <p>Tap to Unlock</p>
    </div>
    <!-- Code injected by TMG ends -->
    `,
    );
    this.queryDOM(".T_M_G-video-container-content").prepend(this.video);
  }
  buildControllerStructure() {
    const HTML = this.getPlayerHTML(),
      spacerIndex = this.settings.controlPanel.bottom?.indexOf?.("spacer"),
      bLeftSideControls = spacerIndex > -1 ? this.settings.controlPanel.bottom?.slice?.(0, spacerIndex) : null,
      bRightSideControls = spacerIndex > -1 ? this.settings.controlPanel.bottom?.slice?.(spacerIndex + 1) : null,
      // breaking HTML into smaller units to use as building blocks
      controlsContainerBuild = this.queryDOM(".T_M_G-video-controls-container"),
      notifiersContainerBuild = this.settings.status.ui.notifiers ? tmg.createEl("div", { className: "T_M_G-video-notifiers-container" }) : null,
      bigControlsWrapperBuild = tmg.createEl("div", { className: "T_M_G-video-big-controls-wrapper" }),
      topControlsWrapperBuild = tmg.createEl("div", { className: "T_M_G-video-top-controls-wrapper" }),
      tRightSideControlsWrapperBuild = this.settings.status.ui.tRightSideControls ? tmg.createEl("div", { className: "T_M_G-video-side-controls-wrapper-cover T_M_G-video-right-side-controls-wrapper-cover" }) : null,
      bottomControlsWrapperBuild = tmg.createEl("div", { className: "T_M_G-video-bottom-controls-wrapper" }),
      bSubControlsWrapperBuild = tmg.createEl("div", { className: "T_M_G-video-bottom-sub-controls-wrapper" }),
      bLeftSideControlsWrapperBuild = this.settings.status.ui.bLeftSideControls ? tmg.createEl("div", { className: "T_M_G-video-side-controls-wrapper-cover T_M_G-video-left-side-controls-wrapper-cover" }) : null,
      bRightSideControlsWrapperBuild = this.settings.status.ui.bRightSideControls ? tmg.createEl("div", { className: "T_M_G-video-side-controls-wrapper-cover T_M_G-video-right-side-controls-wrapper-cover" }) : null;
    controlsContainerBuild.prepend(topControlsWrapperBuild, bigControlsWrapperBuild, bottomControlsWrapperBuild);
    topControlsWrapperBuild.innerHTML += ``.concat(HTML.videotitle ?? "");
    if (this.settings.status.ui.tRightSideControls) {
      const tRightSideControlsWrapper = tmg.createEl("div", { className: "T_M_G-video-side-controls-wrapper T_M_G-video-right-side-controls-wrapper", innerHTML: ``.concat(...Array.from(this.settings.controlPanel.top || [], (el) => HTML[el] || "")) }, { dropZone: this.settings.status.ui.draggable });
      tRightSideControlsWrapperBuild.append(tRightSideControlsWrapper);
      topControlsWrapperBuild.append(tRightSideControlsWrapperBuild);
    }
    if (this.settings.status.ui.bLeftSideControls) {
      const bLeftSideControlsWrapper = tmg.createEl("div", { className: "T_M_G-video-side-controls-wrapper T_M_G-video-left-side-controls-wrapper", innerHTML: ``.concat(...Array.from(bLeftSideControls || [], (el) => HTML[el] || "")) }, { dropZone: this.settings.status.ui.draggable });
      bLeftSideControlsWrapperBuild.append(bLeftSideControlsWrapper);
      bSubControlsWrapperBuild.append(bLeftSideControlsWrapperBuild);
    }
    if (this.settings.status.ui.bRightSideControls) {
      const bRightSideControlsWrapper = tmg.createEl("div", { className: "T_M_G-video-side-controls-wrapper T_M_G-video-right-side-controls-wrapper", innerHTML: ``.concat(...Array.from(bRightSideControls || [], (el) => HTML[el] || "")) }, { dropZone: this.settings.status.ui.draggable });
      bRightSideControlsWrapperBuild.append(bRightSideControlsWrapper);
      bSubControlsWrapperBuild.append(bRightSideControlsWrapperBuild);
    }
    bottomControlsWrapperBuild.append(bSubControlsWrapperBuild);
    bigControlsWrapperBuild.innerHTML += ``.concat(HTML.bigprev ?? "", HTML.bigplaypause ?? "", HTML.bignext ?? "");
    bSubControlsWrapperBuild.insertAdjacentHTML(this.settings.time.linePosition === "top" ? "beforebegin" : "afterend", HTML.timeline ?? "");
    controlsContainerBuild.innerHTML += ``.concat(HTML.pictureinpicturewrapper ?? "", HTML.thumbnail ?? "", HTML.videobuffer ?? "", HTML.cueContainer ?? "", HTML.expandminiplayer ?? "", HTML.removeminiplayer ?? "");
    if (this.settings.status.ui.notifiers) {
      notifiersContainerBuild.setAttribute("data-notify", "");
      notifiersContainerBuild.innerHTML += ``.concat(HTML.playpausenotifier ?? "", HTML.prevnextnotifier ?? "", HTML.captionsnotifier ?? "", HTML.capturenotifier ?? "", HTML.objectfitnotifier ?? "", HTML.playbackratenotifier ?? "", HTML.volumenotifier ?? "", HTML.brightnessnotifier ?? "", HTML.fwdnotifier ?? "", HTML.bwdnotifier ?? "", HTML.scrubnotifier ?? "", HTML.touchtimelinenotifier ?? "", HTML.touchvolumenotifier ?? "", HTML.touchbrightnessnotifier ?? "");
      controlsContainerBuild.append(notifiersContainerBuild);
    }
    // running some pseudo build
    this.pseudoVideoContainer.insertAdjacentHTML("beforeend", ``.concat(HTML.pictureinpicturewrapper ?? ""));
  }
  queryDOM(query, isPseudo = false, all = false) {
    return (isPseudo ? this.pseudoVideoContainer : this.videoContainer)[all ? "querySelectorAll" : "querySelector"](query);
  }
  retrieveDOM() {
    const { ui } = this.settings.status;
    this.DOM = {
      screenLockedWrapper: this.queryDOM(".T_M_G-video-screen-locked-wrapper"),
      screenLockedBtn: this.queryDOM(".T_M_G-video-screen-locked-btn"),
      videoSettings: this.queryDOM(".T_M_G-video-settings"),
      videoContainerContentWrapper: this.queryDOM(".T_M_G-video-container-content-wrapper"),
      videoContainerContent: this.queryDOM(".T_M_G-video-container-content"),
      controlsContainer: this.queryDOM(".T_M_G-video-controls-container"),
      bigControlsWrapper: this.queryDOM(".T_M_G-video-big-controls-wrapper"),
      topControlsWrapper: this.queryDOM(".T_M_G-video-top-controls-wrapper"),
      tRightSideControlsWrapper: ui.tRightSideControls ? this.queryDOM(".T_M_G-video-top-controls-wrapper .T_M_G-video-right-side-controls-wrapper") : null,
      bottomControlsWrapper: this.queryDOM(".T_M_G-video-bottom-controls-wrapper"),
      bSubControlsWrapper: ui.bLeftSideControls || ui.bRightSideControls ? this.queryDOM(".T_M_G-video-bottom-sub-controls-wrapper") : null,
      bLeftSideControlsWrapper: ui.bLeftSideControls ? this.queryDOM(".T_M_G-video-bottom-controls-wrapper .T_M_G-video-left-side-controls-wrapper") : null,
      bRightSideControlsWrapper: ui.bRightSideControls ? this.queryDOM(".T_M_G-video-bottom-controls-wrapper .T_M_G-video-right-side-controls-wrapper") : null,
      pictureInPictureWrapper: this.queryDOM(".T_M_G-video-picture-in-picture-wrapper"),
      pictureInPictureActiveIconWrapper: this.queryDOM(".T_M_G-video-picture-in-picture-icon-wrapper"),
      videoTitle: this.queryDOM(".T_M_G-video-title"),
      thumbnailImg: this.queryDOM("img.T_M_G-video-thumbnail"),
      thumbnailCanvas: this.queryDOM("canvas.T_M_G-video-thumbnail"),
      videoBuffer: this.queryDOM(".T_M_G-video-buffer"),
      notifiersContainer: ui.notifiers ? this.queryDOM(".T_M_G-video-notifiers-container") : null,
      playbackRateNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-playback-rate-notifier") : null,
      playbackRateNotifierText: ui.notifiers ? this.queryDOM(".T_M_G-video-playback-rate-notifier-text") : null,
      playbackRateNotifierContent: ui.notifiers ? this.queryDOM(".T_M_G-video-playback-rate-notifier-content") : null,
      volumeNotifierContent: ui.notifiers ? this.queryDOM(".T_M_G-video-volume-notifier-content") : null,
      brightnessNotifierContent: ui.notifiers ? this.queryDOM(".T_M_G-video-brightness-notifier-content") : null,
      objectFitNotifierContent: ui.notifiers ? this.queryDOM(".T_M_G-video-object-fit-notifier-content") : null,
      scrubNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-scrub-notifier") : null,
      scrubNotifierText: ui.notifiers ? this.queryDOM(".T_M_G-video-scrub-notifier-text") : null,
      fwdNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-fwd-notifier") : null,
      bwdNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-bwd-notifier") : null,
      touchTimelineNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-timeline-notifier") : null,
      touchVolumeContent: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-volume-content") : null,
      touchVolumeNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-volume-notifier") : null,
      touchVolumeSlider: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-volume-slider") : null,
      touchBrightnessContent: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-brightness-content") : null,
      touchBrightnessNotifier: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-brightness-notifier") : null,
      touchBrightnessSlider: ui.notifiers ? this.queryDOM(".T_M_G-video-touch-brightness-slider") : null,
      cueContainer: this.queryDOM(".T_M_G-video-cue-container"),
      bigPrevBtn: this.queryDOM(".T_M_G-video-big-prev-btn"),
      bigPlayPauseBtn: this.queryDOM(".T_M_G-video-big-play-pause-btn"),
      bigNextBtn: this.queryDOM(".T_M_G-video-big-next-btn"),
      miniPlayerExpandBtn: this.queryDOM(".T_M_G-video-mini-player-expand-btn"),
      miniPlayerRemoveBtn: this.queryDOM(".T_M_G-video-mini-player-remove-btn"),
      fullScreenOrientationBtn: ui.fullScreenOrientation ? this.queryDOM(".T_M_G-video-full-screen-orientation-btn") : null,
      captureBtn: ui.capture ? this.queryDOM(".T_M_G-video-capture-btn") : null,
      fullScreenLockBtn: ui.fullScreenLock ? this.queryDOM(".T_M_G-video-full-screen-locked-btn") : null,
      timelineContainer: ui.timeline ? this.queryDOM(".T_M_G-video-timeline-container") : null,
      timeline: ui.timeline ? this.queryDOM(".T_M_G-video-timeline") : null,
      previewContainer: ui.timeline ? this.queryDOM(".T_M_G-video-preview-container") : null,
      previewImg: ui.timeline ? this.queryDOM("img.T_M_G-video-preview") : null,
      previewCanvas: ui.timeline ? this.queryDOM("canvas.T_M_G-video-preview") : null,
      prevBtn: ui.prev ? this.queryDOM(".T_M_G-video-prev-btn") : null,
      playPauseBtn: ui.playPause ? this.queryDOM(".T_M_G-video-play-pause-btn") : null,
      nextBtn: ui.next ? this.queryDOM(".T_M_G-video-next-btn") : null,
      objectFitBtn: ui.objectFit ? this.queryDOM(".T_M_G-video-object-fit-btn") : null,
      volumeContainer: ui.volume ? this.queryDOM(".T_M_G-video-volume-container") : null,
      volumeSlider: ui.volume ? this.queryDOM(".T_M_G-video-volume-slider") : null,
      brightnessContainer: ui.brightness ? this.queryDOM(".T_M_G-video-brightness-container") : null,
      brightnessSlider: ui.brightness ? this.queryDOM(".T_M_G-video-brightness-slider") : null,
      timeAndDurationBtn: ui.timeAndDuration ? this.queryDOM(".T_M_G-video-time-and-duration-btn") : null,
      currentTimeElement: ui.timeAndDuration ? this.queryDOM(".T_M_G-video-current-time") : null,
      totalTimeElement: ui.timeAndDuration ? this.queryDOM(".T_M_G-video-total-time") : null,
      muteBtn: ui.volume ? this.queryDOM(".T_M_G-video-mute-btn") : null,
      darkBtn: ui.volume ? this.queryDOM(".T_M_G-video-dark-btn") : null,
      captionsBtn: ui.captions ? this.queryDOM(".T_M_G-video-captions-btn") : null,
      settingsBtn: ui.settings ? this.queryDOM(".T_M_G-video-settings-btn") : null,
      playbackRateBtn: ui.playbackRate ? this.queryDOM(".T_M_G-video-playback-rate-btn") : null,
      pictureInPictureBtn: ui.pictureInPicture ? this.queryDOM(".T_M_G-video-picture-in-picture-btn") : null,
      theaterBtn: ui.theater ? this.queryDOM(".T_M_G-video-theater-btn") : null,
      fullScreenBtn: ui.fullScreen ? this.queryDOM(".T_M_G-video-full-screen-btn") : null,
      svgs: this.videoContainer.getElementsByTagName("svg"),
      draggableControls: ui.draggable ? this.queryDOM("[data-draggable-control]", false, true) : null,
      draggableControlContainers: ui.draggable ? this.queryDOM(".T_M_G-video-side-controls-wrapper", false, true) : null,
      settingsCloseBtn: this.settings ? this.queryDOM(".T_M_G-video-settings-close-btn") : null,
    };
  }
  initPlayer() {
    this.retrieveDOM();
    this.observeResize();
    this.svgSetup();
    this.setInitialStates();
    this.setVideoEventListeners();
    this.setControlsEventListeners();
    this[`toggle${tmg.capitalize(this.initialMode)}Mode`]?.();
    if (!this.video.currentSrc) this._handleLoadedError();
    this.initialState && this.video.paused ? this.addInitialState() : this.initControls();
    if (this.disabled) this.disable();
    this.initialized = true;
  }
  addInitialState() {
    if (!this.initialState) return;
    if (this.settings.time.start && !this.video.poster) this.currentTime = this.settings.time.start;
    this.videoContainer.classList.add("T_M_G-video-initial");
    this.video.addEventListener("play", this.removeInitialState, { once: true });
    this.DOM.controlsContainer.addEventListener("click", this._handleInitialStateClick);
  }
  removeInitialState() {
    if (!this.initialState) return;
    this.initialState = false;
    this.togglePlay(true);
    this.stall();
    this.videoContainer.classList.remove("T_M_G-video-initial");
    this.initControls();
    this.DOM.controlsContainer.removeEventListener("click", this._handleInitialStateClick);
  }
  _handleInitialStateClick = ({ target }) => target === this.DOM.controlsContainer && this.removeInitialState();
  stall() {
    this.showOverlay();
    if (!this.DOM.bigPlayPauseBtn) return;
    this.videoContainer.classList.add("T_M_G-video-stall");
    this.DOM.bigPlayPauseBtn?.addEventListener("animationend", () => this.videoContainer.classList.remove("T_M_G-video-stall"), { once: true });
  }
  initControls() {
    if (this.video.currentSrc) this._handleLoadedMetadata();
    this.updateAudioSettings();
    this.updateBrightnessSettings();
    this.updatePlaybackRateSettings();
    this.updateCaptionsSettings();
    this.setContainersEventListeners();
    this.setSettingsViewEventListeners();
    this.observeIntersection();
  }
  setInitialStates() {
    this.showOverlay();
    this.setTitleState();
    this.setControlsState();
    this.setCaptionsState();
    this.setPreviewsState();
    this.pseudoVideo.src = this.video.src || this.video.currentSrc;
  }
  setTitleState(title) {
    if (this.DOM.videoTitle) this.DOM.videoTitle.textContent = this.DOM.videoTitle.dataset.videoTitle = (title ?? this.media?.title) || "";
  }
  setPosterState() {
    if (this.media?.artwork && this.media.artwork[0]?.src !== this.video.poster) this.video.poster = this.media.artwork[0].src;
  }
  setCaptionsState() {
    const able = this.video.textTracks.length;
    if (able) {
      [...this.video.textTracks].forEach((track, index) => {
        track.oncuechange = () => {
          if (!this.isModeActive("captions") && this.videoContainer.classList.contains("T_M_G-video-captions-preview")) return;
          this._handleCueChange(track.activeCues?.[0]);
        };
        if (track.mode === "showing") this.textTrackIndex = index;
        track.mode = "hidden";
      });
    } else this.textTrackIndex = 0;
    this.videoContainer.classList.toggle("T_M_G-video-captions", able && (this.settings.auto.captions || this.isModeActive("captions")));
    this.videoContainer.setAttribute("data-track-kind", this.video.textTracks[this.textTrackIndex]?.kind || "captions");
    this.setControlsState("captions");
  }
  setPreviewsState() {
    this.videoAltImgSrc = `url(${tmg.VIDEO_ALT_IMG_SRC})`;
    this.videoContainer.classList.toggle("T_M_G-video-no-previews", !this.settings.time.previews);
    this.videoContainer.setAttribute("data-preview-type", this.settings.status.ui.previews ? "image" : "canvas");
    if (this.settings.status.ui.previews || !this.settings.time.previews) return;
    this.previewContext = this.DOM.previewCanvas.getContext("2d");
    this.thumbnailContext = this.DOM.thumbnailCanvas.getContext("2d");
    let dummyImg = tmg.createEl("img", {
      src: tmg.VIDEO_ALT_IMG_SRC,
      onload: () => {
        this.previewContext?.drawImage(dummyImg, 0, 0, this.DOM.previewCanvas.width, this.DOM.previewCanvas.height);
        this.thumbnailContext?.drawImage(dummyImg, 0, 0, this.DOM.thumbnailCanvas.width, this.DOM.thumbnailCanvas.height);
        dummyImg = null;
      },
    });
  }
  setControlState(btn, { hidden = false, disabled = false }) {
    btn?.classList?.toggle("T_M_G-video-control-hidden", hidden);
    btn?.classList?.toggle("T_M_G-video-control-disabled", disabled);
  }
  setControlsState(target) {
    const atFirst = this.currentPlaylistIndex <= 0,
      atLast = !this.playlist || this.currentPlaylistIndex >= this.playlist.length - 1;
    const groups = {
      fullscreenlock: () => this.setControlState(this.DOM.fullScreenLockBtn, { hidden: !(this.isMediaMobile && this.isModeActive("fullScreen")) }),
      fullscreenorientation: () => !this.isModeActive("fullScreen") && this.setControlState(this.DOM.fullScreenOrientationBtn, { hidden: true }),
      captions: () => this.setControlState(this.DOM.captionsBtn, { disabled: !this.video.textTracks[this.textTrackIndex] }),
      playbackrate: () => {
        if (this.DOM.playbackRateBtn) this.DOM.playbackRateBtn.textContent = `${this.playbackRate}x`;
      },
      pictureinpicture: () => this.setControlState(this.DOM.pictureInPictureBtn, { hidden: !this.settings.modes.pictureInPicture }),
      theater: () => this.setControlState(this.DOM.theaterBtn, { hidden: !this.settings.modes.theater }),
      fullscreen: () => this.setControlState(this.DOM.fullScreenBtn, { hidden: !this.settings.modes.fullScreen }),
      playlist: () => {
        if (!this.DOM) return;
        this.setControlState(this.DOM.bigPrevBtn, { hidden: !(this.playlist?.length > 1), disabled: atFirst });
        this.setControlState(this.DOM.bigNextBtn, { hidden: !(this.playlist?.length > 1), disabled: atLast });
        this.setControlState(this.DOM.prevBtn, { hidden: atFirst });
        this.setControlState(this.DOM.nextBtn, { hidden: atLast });
      },
    };
    if (tmg.isArr(target)) target.forEach((g) => groups[g]?.());
    else if (target) groups[target]?.();
    else Object.values(groups).forEach((fn) => fn());
  }
  setKeyEventListeners(target) {
    if (this.disabled || this.locked) return;
    this.floatingPlayer?.addEventListener("keydown", this._handleKeyDown);
    this.floatingPlayer?.addEventListener("keyup", this._handleKeyUp);
    if (target === "floating") return;
    window.addEventListener("keydown", this._handleKeyDown);
    window.addEventListener("keyup", this._handleKeyUp);
  }
  removeKeyEventListeners(target) {
    this.floatingPlayer?.removeEventListener("keydown", this._handleKeyDown);
    this.floatingPlayer?.removeEventListener("keyup", this._handleKeyUp);
    if (target === "floating") return;
    window.removeEventListener("keydown", this._handleKeyDown);
    window.removeEventListener("keyup", this._handleKeyUp);
  }
  setContainersEventListeners() {
    this.videoContainer.addEventListener("click", this._handleLockScreenClick);
    this.videoContainer.addEventListener("wheel", this._handleGestureWheel, { passive: false });
    [this.DOM.controlsContainer, this.DOM.bottomControlsWrapper].forEach((el) => {
      el.addEventListener("contextmenu", this._handleRightClick);
      el.addEventListener("click", this._handleAnyClick, true);
      el.addEventListener("pointermove", this._handleHoverPointerActive, true);
      el.addEventListener("mouseleave", this._handleHoverPointerOut, true);
    });
    tmg.onSafeClicks(this.DOM.controlsContainer, this._handleClick, this._handleDoubleClick, true);
    this.DOM.controlsContainer.addEventListener("pointerdown", this._handleSpeedPointerDown, true);
    this.DOM.controlsContainer.addEventListener("touchstart", this._handleGestureTouchStart, { passive: false, useCapture: true });
  }
  setVideoEventListeners() {
    this.video.addEventListener("error", this._handleLoadedError);
    this.video.addEventListener("play", this._handlePlay);
    this.video.addEventListener("pause", this._handlePause);
    this.video.addEventListener("waiting", this._handleBufferStart);
    this.video.addEventListener("playing", this._handleBufferStop);
    this.video.addEventListener("durationchange", this._handleDurationChange);
    this.video.addEventListener("ratechange", this._handlePlaybackRateChange);
    this.video.addEventListener("timeupdate", this._handleTimeUpdate);
    this.video.addEventListener("progress", this._handleLoadedProgress);
    this.video.addEventListener("loadedmetadata", this._handleLoadedMetadata);
    this.video.addEventListener("loadeddata", this._handleLoadedData);
    this.video.addEventListener("ended", this._handleEnded);
    this.video.addEventListener("enterpictureinpicture", this._handleEnterPictureInPicture);
    this.video.addEventListener("leavepictureinpicture", this._handleLeavePictureInPicture);
  }
  removeVideoEventListeners() {
    if (this.initialState) this.video.removeEventListener("play", this.removeInitialState, { once: true });
    this.video.removeEventListener("error", this._handleLoadedError);
    this.video.removeEventListener("play", this._handlePlay);
    this.video.removeEventListener("pause", this._handlePause);
    this.video.removeEventListener("waiting", this._handleBufferStart);
    this.video.removeEventListener("playing", this._handleBufferStop);
    this.video.removeEventListener("durationchange", this._handleDurationChange);
    this.video.removeEventListener("ratechange", this._handlePlaybackRateChange);
    this.video.removeEventListener("timeupdate", this._handleTimeUpdate);
    this.video.removeEventListener("progress", this._handleLoadedProgress);
    this.video.removeEventListener("loadedmetadata", this._handleLoadedMetadata);
    this.video.removeEventListener("loadeddata", this._handleLoadedData);
    this.video.removeEventListener("ended", this._handleEnded);
    this.video.removeEventListener("enterpictureinpicture", this._handleEnterPictureInPicture);
    this.video.removeEventListener("leavepictureinpicture", this._handleLeavePictureInPicture);
  }
  setControlsEventListeners() {
    this.DOM.screenLockedBtn?.addEventListener("click", this._handleLockBtnClick);
    this.DOM.miniPlayerExpandBtn?.addEventListener("click", this.expandMiniPlayer);
    this.DOM.miniPlayerRemoveBtn?.addEventListener("click", this.removeMiniPlayer);
    this.DOM.fullScreenOrientationBtn?.addEventListener("click", this.changeFullScreenOrientation);
    this.DOM.fullScreenLockBtn?.addEventListener("click", this.lock);
    tmg.onSafeClicks(this.DOM.captureBtn, this.exportVideoFrame, () => this.exportVideoFrame(true));
    this.DOM.bigPrevBtn?.addEventListener("click", this.previousVideo);
    this.DOM.prevBtn?.addEventListener("click", this.previousVideo);
    this.DOM.bigNextBtn?.addEventListener("click", this.nextVideo);
    this.DOM.nextBtn?.addEventListener("click", this.nextVideo);
    this.DOM.playPauseBtn?.addEventListener("click", this.togglePlay);
    this.DOM.bigPlayPauseBtn?.addEventListener("click", this.togglePlay);
    tmg.onSafeClicks(this.DOM.timeAndDurationBtn, this.toggleTimeMode, this.toggleTimeFormat);
    this.DOM.playbackRateBtn?.addEventListener("click", this.rotatePlaybackRate);
    this.DOM.captionsBtn?.addEventListener("click", this.toggleCaptions);
    this.DOM.muteBtn?.addEventListener("click", this.toggleMute);
    this.DOM.darkBtn?.addEventListener("click", this.toggleDark);
    this.DOM.objectFitBtn?.addEventListener("click", this.rotateObjectFit);
    this.DOM.theaterBtn?.addEventListener("click", this.toggleTheaterMode);
    this.DOM.fullScreenBtn?.addEventListener("click", this.toggleFullScreenMode);
    this.DOM.pictureInPictureBtn?.addEventListener("click", this.togglePictureInPictureMode);
    this.DOM.pictureInPictureActiveIconWrapper?.addEventListener("click", this.togglePictureInPictureMode);
    this.DOM.settingsBtn?.addEventListener("click", this.toggleSettingsView);
    // timeline event listeners
    this.DOM.timelineContainer?.addEventListener("pointerdown", this._handleTimelinePointerDown);
    this.DOM.timelineContainer?.addEventListener("keydown", this._handleTimelineKeyDown);
    this.DOM.timeline?.addEventListener("mousemove", this._handleTimelineInput);
    this.DOM.timeline?.addEventListener("mouseleave", this.stopTimePreviewing);
    this.DOM.timeline?.addEventListener("touchend", this.stopTimePreviewing);
    // cue container listeners
    this.DOM.cueContainer?.addEventListener("pointerdown", this._handleCueDragStart);
    // volume event listeners
    this.DOM.volumeSlider?.addEventListener("input", this._handleVolumeSliderInput);
    this.DOM.volumeContainer?.addEventListener("mousemove", this._handleVolumeContainerMouseMove);
    this.DOM.volumeContainer?.addEventListener("mouseleave", this._handleVolumeContainerMouseLeave);
    // brightness event listeners
    this.DOM.brightnessSlider?.addEventListener("input", this._handleBrightnessSliderInput);
    this.DOM.brightnessContainer?.addEventListener("mousemove", this._handleBrightnessContainerMouseMove);
    this.DOM.brightnessContainer?.addEventListener("mouseleave", this._handleBrightnessContainerMouseLeave);
    // drag event listeners
    this.setDragEventListeners();
    // image event listeners
    if (this.settings.status.ui.previews) {
      this.DOM.previewImg?.addEventListener("error", this._handleImgBreak);
      this.DOM.thumbnailImg?.addEventListener("error", this._handleImgBreak);
    }
    // notifiers event listeners
    if (this.settings.status.ui.notifiers) new tmg.Notifier(this);
    // pseudo event listeners
    this.pseudoVideo.addEventListener("timeupdate", this.generateCanvasPreviews);
    this.queryDOM(".T_M_G-video-picture-in-picture-icon-wrapper", true).addEventListener("click", this.togglePictureInPictureMode);
  }
  setDragEventListeners() {
    if (!this.settings.status.ui.draggable) return;
    this.DOM.draggableControls?.forEach((c) => {
      c.draggable = true;
      c.addEventListener("dragstart", this._handleDragStart);
      c.addEventListener("drag", this._handleDrag);
      c.addEventListener("dragend", this._handleDragEnd);
    });
    this.DOM.draggableControlContainers?.forEach((c) => {
      c.addEventListener("dragenter", this._handleDragEnter);
      c.addEventListener("dragover", this._handleDragOver);
      c.addEventListener("drop", this._handleDrop);
      c.addEventListener("dragleave", this._handleDragLeave);
    });
  }
  removeDragEventListeners() {
    this.DOM.draggableControls?.forEach((c) => {
      c.draggable = false;
      c.removeEventListener("dragstart", this._handleDragStart);
      c.removeEventListener("drag", this._handleDrag);
      c.removeEventListener("dragend", this._handleDragEnd);
    });
    this.DOM.draggableControlContainers?.forEach((c) => {
      c.removeEventListener("dragenter", this._handleDragEnter);
      c.removeEventListener("dragover", this._handleDragOver);
      c.removeEventListener("drop", this._handleDrop);
      c.removeEventListener("dragleave", this._handleDragLeave);
    });
  }
  setSettingsViewEventListeners() {
    this.DOM.settingsCloseBtn?.addEventListener("click", this.leaveSettingsView);
  }
  toggleSettingsView = () => (!this.isModeActive("settings") ? this.enterSettingsView() : this.leaveSettingsView());
  enterSettingsView() {
    if (this.isModeActive("settings")) return;
    this.DOM.settingsCloseBtn.focus();
    this.wasPaused = this.video.paused;
    this.togglePlay(false);
    this.videoContainer.classList.add("T_M_G-video-settings-view");
    this.DOM.videoSettings.removeAttribute("inert");
    this.DOM.videoContainerContent.setAttribute("inert", "");
    window.addEventListener("keyup", this._handleSettingsKeyUp);
    this.floatingPlayer?.addEventListener("keyup", this._handleSettingsKeyUp);
    this.removeKeyEventListeners();
  }
  leaveSettingsView() {
    if (!this.isModeActive("settings")) return;
    setTimeout(this.togglePlay, tmg.parseCSSTime(this.videoSettingsViewTransitionTime), !this.wasPaused);
    this.DOM.settingsCloseBtn.blur();
    this.videoContainer.classList.remove("T_M_G-video-settings-view");
    this.DOM.videoSettings.setAttribute("inert", "");
    this.DOM.videoContainerContent.removeAttribute("inert");
    window.removeEventListener("keyup", this._handleSettingsKeyUp);
    this.floatingPlayer?.removeEventListener("keyup", this._handleSettingsKeyUp);
    this.setKeyEventListeners();
  }
  _handleSettingsKeyUp(e) {
    const action = this.keyEventAllowed(e);
    if (action === false) return;
    switch (action) {
      case "settings":
        this.leaveSettingsView();
        break;
    }
  }
  observeResize() {
    this._handleMediaParentResize();
    tmg.initScrollAssist(this.DOM.videoTitle, { pxPerSecond: 60 });
    tmg.initScrollAssist(this.DOM.scrubNotifierText, {
      pxPerSecond: 60,
    });
    [this.DOM.tRightSideControlsWrapper, this.DOM.bLeftSideControlsWrapper, this.DOM.bRightSideControlsWrapper].forEach((el) => {
      this._handleSideControlsWrapperResize(el);
      tmg.initScrollAssist(el, { pxPerSecond: 60 });
      el && tmg.resizeObserver.observe(el);
    });
    [this.videoContainer, this.pseudoVideoContainer].forEach((el) => tmg.resizeObserver.observe(el));
  }
  unobserveResize() {
    tmg.removeScrollAssist(this.DOM.videoTitle);
    tmg.removeScrollAssist(this.DOM.scrubNotifierText, {
      pxPerSecond: 60,
    });
    [this.DOM.tRightSideControlsWrapper, this.DOM.bLeftSideControlsWrapper, this.DOM.bRightSideControlsWrapper].forEach((el) => {
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
  _handleResize(target) {
    const isPseudo = target.className.includes("T_M_G-pseudo");
    if (target.classList.contains("T_M_G-media-container")) this._handleMediaParentResize(isPseudo);
    else if (target.classList.contains("T_M_G-video-side-controls-wrapper")) this._handleSideControlsWrapperResize(target);
  }
  _handleMediaParentResize(isPseudo = false) {
    const getTier = (container) => {
      const { offsetWidth: w, offsetHeight: h } = container;
      return { w, h, tier: h <= 130 ? "xxxxx" : w <= 280 ? "xxxx" : w <= 380 ? "xxx" : w <= 480 ? "xx" : w <= 630 ? "x" : "", repeat: w < 1 && h < 1 };
    };
    if (!isPseudo) {
      const { w, h, tier, repeat } = getTier(this.videoContainer);
      this.videoCurrentContainerWidth = `${w}px`;
      this.videoCurrentContainerHeight = `${h}px`;
      this.videoContainer.dataset.sizeTier = tier;
      const { width = w, height = h } = tmg.getRenderedBox(this.video);
      this.DOM.thumbnailCanvas.height = this.DOM.thumbnailImg.height = height + 1;
      this.DOM.thumbnailCanvas.width = this.DOM.thumbnailImg.width = width + 1;
      this.resetCueCharWidth();
      this.previewCaptions("");
      repeat && requestAnimationFrame(this._handleMediaParentResize);
    } else {
      const { tier } = getTier(this.pseudoVideoContainer);
      this.pseudoVideoContainer.dataset.sizeTier = tier;
    }
  }
  _handleSideControlsWrapperResize = (wrapper) => this.updateSideControls({ target: wrapper });
  _handleMediaIntersectionChange(isIntersecting) {
    this.isIntersecting = isIntersecting;
    this.isIntersecting && !this.isModeActive("settings") ? this.setKeyEventListeners() : this.removeKeyEventListeners();
  }
  _handleMediaParentIntersectionChange(isIntersecting) {
    this.parentIntersecting = isIntersecting;
    this.toggleMiniPlayerMode();
  }
  _handleWindowResize() {
    if (!this.isModeActive("fullScreen")) this.toggleMiniPlayerMode();
  }
  _handleVisibilityChange() {
    if (document.visibilityState === "visible") this.stopTimeScrubbing(); // tending to some observed glitches when visibility changes
  }
  _handleImgBreak = ({ target }) => (target.src = tmg.VIDEO_ALT_IMG_SRC);
  updateSideControls({ target: wrapper }) {
    let c = wrapper?.children?.[0],
      spacer;
    do {
      if (!c) continue;
      c.dataset.spacer = "false";
      c.dataset.controlDisplayed = getComputedStyle(c).display !== "none" ? "true" : "false";
      if (c.dataset.controlDisplayed === "true" && !spacer) spacer = c;
    } while ((c = c?.nextElementSibling));
    if (wrapper === this.DOM.bLeftSideControlsWrapper) return;
    spacer?.setAttribute("data-spacer", true);
  }
  svgSetup() {
    [...this.DOM.svgs].forEach((svg) => {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      const title = svg.getAttribute("data-control-title");
      if (!title) return;
      svg.addEventListener("mouseover", () => (svg.parentElement.title = title));
    });
  }
  async getVideoFrame(time = this.currentTime, monochrome) {
    if (Math.abs(this.pseudoVideo.currentTime - time) > 0.01) {
      this.pseudoVideo.currentTime = time;
      await new Promise((res) => this.pseudoVideo.addEventListener("timeupdate", res, { once: true })); // small tolerance for video time comparison - 10ms
    }
    this.exportCanvas.width = this.video.videoWidth;
    this.exportCanvas.height = this.video.videoHeight;
    this.exportContext.drawImage(this.pseudoVideo, 0, 0, this.exportCanvas.width, this.exportCanvas.height);
    if (monochrome) this.convertToMonoChrome(this.exportCanvas, this.exportContext);
    const blob = await new Promise((res) => this.exportCanvas.toBlob(res));
    return { blob, url: URL.createObjectURL(blob) };
  }
  async exportVideoFrame(monochrome) {
    this.fire("capture");
    const filename = `${this.media?.title ?? "Video"}${monochrome === true ? `_black&white` : ""}_at_'${tmg.formatTime(this.video.currentTime, "human", true)}'.png`.replace(/\s/g, "_"),
      { url } = await this.getVideoFrame(this.currentTime, monochrome === true);
    const link = tmg.createEl("a", { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(link.href);
  }
  convertToMonoChrome(canvas, context) {
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const l = frame.data.length / 4;
    for (let i = 0; i < l; i++) {
      const grey = (frame.data[i * 4 + 0] + frame.data[i * 4 + 1] + frame.data[i * 4 + 2]) / 3;
      frame.data[i * 4 + 0] = grey;
      frame.data[i * 4 + 1] = grey;
      frame.data[i * 4 + 2] = grey;
    }
    canvas.getContext("2d").putImageData(frame, 0, 0);
  }
  deactivate(message) {
    this.showOverlay();
    this.showUserMessage(message);
    this.videoContainer.classList.add("T_M_G-video-inactive");
  }
  reactivate() {
    if (!this.videoContainer.classList.contains("T_M_G-video-inactive") || !this.loaded) return;
    this.removeUserMessage();
    this.videoContainer.classList.remove("T_M_G-video-inactive");
  }
  disable() {
    this.videoContainer.classList.add("T_M_G-video-disabled");
    this.togglePlay(false);
    this.showOverlay();
    this.cancelAllThrottles();
    this.leaveSettingsView();
    this.videoContainer.setAttribute("inert", "");
    this.removeKeyEventListeners();
    this.disabled = true;
    this.log("You have to enable the TMG Controller to access the custom controls", "warn");
  }
  enable() {
    if (!this.disabled) return;
    this.disabled = false;
    this.videoContainer.classList.remove("T_M_G-video-disabled");
    this.videoContainer.removeAttribute("inert");
    this.setKeyEventListeners();
  }
  lock() {
    this.leaveSettingsView();
    this.videoContainer.classList.add("T_M_G-video-locked");
    setTimeout(this.showLockedOverlay);
    this.removeOverlay("force");
    this.removeKeyEventListeners();
    this.locked = true;
  }
  async unlock() {
    if (!this.locked) return;
    this.locked = false;
    this.removeLockedOverlay();
    await tmg.mockAsync(tmg.parseCSSTime(this.videoSwitchTransitionTime));
    this.videoContainer.classList.remove("T_M_G-video-locked");
    this.showOverlay();
    this.setKeyEventListeners();
  }
  _handleLockBtnClick(e) {
    e.stopPropagation();
    this.delayLockedOverlay();
    e.currentTarget.classList.contains("T_M_G-video-control-unlock") ? this.unlock() : e.currentTarget.classList.add("T_M_G-video-control-unlock");
  }
  activatePseudoMode() {
    this.mutatingDOM = true;
    this.pseudoVideo.id = this.video.id;
    this.video.id = "";
    this.pseudoVideo.className += " " + this.video.className.replace(/T_M_G-media|T_M_G-video/g, "");
    this.pseudoVideoContainer.className += " " + this.videoContainer.className.replace(/T_M_G-media-container|T_M_G-pseudo-video-container/g, "");
    this.videoContainer.parentElement?.insertBefore(this.pseudoVideoContainer, this.videoContainer);
    document.body.append(this.videoContainer);
    setTimeout(() => (this.mutatingDOM = false));
  }
  deactivatePseudoMode() {
    this.mutatingDOM = true;
    this.video.id = this.pseudoVideo.id;
    this.pseudoVideo.id = "";
    this.pseudoVideo.className = "T_M_G-pseudo-video T_M_G-media";
    this.pseudoVideoContainer.className = "T_M_G-pseudo-video-container T_M_G-media-container";
    this.pseudoVideoContainer.parentElement?.replaceChild(this.videoContainer, this.pseudoVideoContainer);
    setTimeout(() => (this.mutatingDOM = false));
  }
  get playlist() {
    return this._playlistItems;
  }
  set playlist(value) {
    if (!tmg.isArr(value)) return;
    value.forEach((val) => {
      val.settings = val.settings ?? {};
      val.settings.time = { previews: val.settings.time?.previews ?? false, start: val.settings.time?.start ?? null, end: val.settings.time?.end ?? null };
    });
    this._playlistItems = value;
    if (this.currentPlaylistIndex == null) this.currentPlaylistIndex = 0;
    else if (this.initialized) {
      const curr = this.playlist.find((v) => tmg.compareSrcs(v.src, this.src));
      this.currentPlaylistIndex = curr ? this.playlist.indexOf(curr) : 0;
      const next = this.playlist[this.currentPlaylistIndex];
      if (curr) {
        this.settings.time.start = curr.settings.time.start;
        this.settings.time.end = curr.settings.time.end;
        this.settings.time.previews = tmg.isObj(curr.settings.time.previews) && tmg.isObj(this.settings.time.previews) ? { ...this.settings.time.previews, ...curr.settings.time.previews } : curr.settings.time.previews;
        this.settings.status.ui.previews = this.settings.time.previews?.address && this.settings.time.previews?.spf;
        if (curr.tracks?.length !== this.tracks.length) this.tracks = curr.tracks;
        this.setPreviewsState();
      } else {
        this.playlistCurrentTime = next?.settings.time.start;
        this.movePlaylistTo(this.currentPlaylistIndex, !this.video.paused);
      }
    }
    this.setControlsState("playlist");
  }
  previousVideo() {
    if (this.currentTime >= 3) return this.replay();
    if (this.playlist && this.currentPlaylistIndex > 0 && this.currentTime < 3) this.movePlaylistTo(this.currentPlaylistIndex - 1);
  }
  nextVideo = () => this.playlist && this.currentPlaylistIndex < this.playlist.length - 1 && this.movePlaylistTo(this.currentPlaylistIndex + 1);
  movePlaylistTo(index, shouldPlay = true) {
    if (!this.playlist) return;
    if (this.settings.status.allowOverride.time) this.playlist[this.currentPlaylistIndex].settings.time.start = this.currentTime < this.duration - (this.settings.time.end || this.settings.auto.next || 0) ? this.playlistCurrentTime : null;
    this.playlistCurrentTime = null;
    this.loaded = false;
    this.currentPlaylistIndex = index;
    const v = this.playlist[index];
    this.media = v.media ? { ...this.media, ...v.media } : (v.media ?? null);
    this.setPosterState();
    this.settings.time.start = v.settings.time.start;
    this.settings.time.end = v.settings.time.end;
    this.settings.time.previews = tmg.isObj(v.settings.time.previews) && tmg.isObj(this.settings.time.previews) ? { ...this.settings.time.previews, ...v.settings.time.previews } : v.settings.time.previews;
    this.settings.status.ui.previews = this.settings.time.previews?.address && this.settings.time.previews?.spf;
    if (v.src) this.src = v.src;
    else if (v.sources?.length > 0) this.sources = v.sources;
    this.tracks = v.tracks ?? [];
    this.setInitialStates();
    this.togglePlay(shouldPlay);
    this.canAutoMovePlaylist = true;
  }
  autonextVideo() {
    if (!this.loaded || !this.playlist || this.settings.auto.next < 0 || !this.canAutoMovePlaylist || this.currentPlaylistIndex >= this.playlist.length - 1 || this.video.paused) return;
    this.canAutoMovePlaylist = false;
    const count = Math.floor((this.settings.time.end || this.duration) - this.currentTime);
    const {
      src,
      media: { title },
    } = this.playlist[this.currentPlaylistIndex + 1];
    const toastContainer = tmg.createEl("div", {
      className: "T_M_G-video-toast-container",
      innerHTML: `
        <span title="Play next video" class="T_M_G-video-playlist-next-video-preview-wrapper">
          <button type="button">
            <svg viewBox="0 0 25 25">
              <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
            </svg>
          </button>
          <video src="${src}" class="T_M_G-video-playlist-next-video-preview" autoplay muted loop></video>
        </span>
        <span class="T_M_G-video-playlist-next-video-info">
          <h2>Next Video in <span class="T_M_G-video-playlist-next-video-countdown">${count}</span></h2>
          ${title ? `<p class="T_M_G-video-playlist-next-video-title">${title}</p>` : ""}
        </span>
        <button title="Cancel" type="button" class="T_M_G-video-playlist-next-video-cancel-btn">&times;</button>         
      `,
    });
    this.videoContainer.append(toastContainer);
    const updateToast = (timestamp) => {
        if (shouldUnPause) {
          lastTime = null;
          shouldUnPause = false;
        }
        if (lastTime == null) {
          lastTime = timestamp;
          return (nextVideoFrameId = requestAnimationFrame(updateToast));
        }
        if (!isPaused) {
          timeVisible += timestamp - lastTime;
          constraint += timestamp - lastTime;
          this.videoCurrentPlaylistCountdownPosition = timeVisible / (count * 1000);
          if (constraint >= 1000) {
            nextVideoCountdown--;
            playlistNextVideoCountdown.textContent = nextVideoCountdown;
            constraint = 0;
          }
          if (timeVisible >= count * 1000) return autoNextVideo();
        }
        lastTime = timestamp;
        nextVideoFrameId = requestAnimationFrame(updateToast);
      },
      handleAutoPlaylistVisibilityChange = () => (shouldUnPause = document.visibilityState === "visible"),
      autoNextVideo = () => {
        cleanUpToast();
        this.nextVideo();
      },
      cleanUpToastWhenNeeded = () => !(this.currentTime === this.duration) && cleanUpToast(),
      autoCleanUpToast = () => {
        if (Math.floor((this.settings.time.end || this.duration) - this.currentTime) > this.settings.auto.next) cleanUpToast();
      },
      cleanUpToast = (permanent = false) => {
        toastContainer.remove();
        cancelAnimationFrame(nextVideoFrameId);
        document.removeEventListener("visibilitychange", handleAutoPlaylistVisibilityChange);
        this.video.removeEventListener("pause", cleanUpToastWhenNeeded);
        this.video.removeEventListener("waiting", cleanUpToastWhenNeeded);
        this.video.removeEventListener("timeupdate", autoCleanUpToast);
        this.canAutoMovePlaylist = !permanent;
      },
      handleToastPointerStart = (e) => {
        if (e.touches?.length > 1) return;
        e.stopImmediatePropagation();
        pointerStartX = e.clientX ?? e.targetTouches[0]?.clientX;
        toastContainer.addEventListener("pointermove", handleToastPointerMove, { passive: false });
        isPaused = true;
      },
      handleToastPointerMove = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.RAFLoop("toastPointerMove", () => {
          let x = e.clientX ?? e.targetTouches[0]?.clientX;
          pointerDeltaX = x - pointerStartX;
          toastContainer.style.setProperty("transition", "none", "important");
          toastContainer.style.setProperty("transform", `translateX(${pointerDeltaX}px)`, "important");
          toastContainer.style.setProperty("opacity", tmg.clamp(0, 1 - Math.abs(pointerDeltaX) / toastContainer.offsetWidth, 1), "important");
        });
      },
      handleToastPointerEnd = () => {
        this.cancelRAFLoop("toastPointerMove");
        if (Math.abs(pointerDeltaX) > toastContainer.offsetWidth * 0.4) return cleanUpToast(true);
        toastContainer.removeEventListener("pointermove", handleToastPointerMove, { passive: false });
        toastContainer.style.removeProperty("transition");
        toastContainer.style.removeProperty("transform");
        toastContainer.style.removeProperty("opacity");
        isPaused = false;
      },
      playlistNextVideoPreviewWrapper = this.queryDOM(".T_M_G-video-playlist-next-video-preview-wrapper"),
      playlistNextVideoCountdown = this.queryDOM(".T_M_G-video-playlist-next-video-countdown"),
      playlistNextVideoCancelBtn = this.queryDOM(".T_M_G-video-playlist-next-video-cancel-btn");

    let isPaused = false,
      shouldUnPause,
      lastTime,
      pointerStartX,
      pointerDeltaX,
      constraint = 0,
      timeVisible = 0,
      nextVideoCountdown = count,
      nextVideoFrameId = requestAnimationFrame(updateToast);

    document.addEventListener("visibilitychange", handleAutoPlaylistVisibilityChange);
    toastContainer.addEventListener("mouseover", () => (isPaused = true));
    toastContainer.addEventListener("mouseleave", () => !toastContainer.matches(":hover") && setTimeout(() => (isPaused = false)));
    toastContainer.addEventListener("pointerdown", handleToastPointerStart.bind(this), { passive: false });
    toastContainer.addEventListener("pointerup", handleToastPointerEnd.bind(this));
    this.video.addEventListener("pause", cleanUpToastWhenNeeded);
    this.video.addEventListener("waiting", cleanUpToastWhenNeeded);
    this.video.addEventListener("timeupdate", autoCleanUpToast);
    playlistNextVideoPreviewWrapper.addEventListener("click", autoNextVideo);
    playlistNextVideoCancelBtn.addEventListener("click", () => cleanUpToast(true));
  }
  setMediaSession() {
    if (!navigator.mediaSession || (tmg._pictureInPictureActive && !this.isModeActive("pictureInPicture"))) return;
    if (this.media) navigator.mediaSession.metadata = new MediaMetadata(this.media);
    const set = (...args) => navigator.mediaSession.setActionHandler(...args);
    set("play", () => this.togglePlay(true));
    set("pause", () => this.togglePlay(false));
    set("seekbackward", () => this.skip(-this.settings.time.skip));
    set("seekforward", () => this.skip(this.settings.time.skip));
    set("previoustrack", null);
    set("nexttrack", null);
    if (!this.playlist) return;
    if (this.currentPlaylistIndex > 0) set("previoustrack", this.previousVideo);
    if (this.currentPlaylistIndex < this.playlist?.length - 1) set("nexttrack", this.nextVideo);
  }
  syncAspectRatio() {
    this.aspectRatio = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
    this.videoAspectRatio = this.video.videoWidth && this.video.videoHeight ? `${this.video.videoWidth} / ${this.video.videoHeight}` : "16 / 9";
  }
  rotateObjectFit() {
    const fits = [
      { name: "Crop to Fit", value: "contain" },
      { name: "Fit To Screen", value: "cover" },
      { name: "Stretch", value: "fill" },
    ];
    const i = fits.findIndex((f) => f.value === this.videoObjectFit);
    const nextFit = fits[(i + 1) % fits.length];
    this.videoObjectFit = nextFit.value;
    this.videoContainer.setAttribute("data-object-fit", nextFit.value);
    if (this.DOM.objectFitNotifierContent) this.DOM.objectFitNotifierContent.textContent = nextFit.name;
    this.fire(`objectfit${nextFit.value}`);
  }
  isModeActive(mode) {
    switch (mode) {
      case "miniPlayer":
        return this.videoContainer.classList.contains("T_M_G-video-mini-player");
      case "fullScreen":
        return this.videoContainer.classList.contains("T_M_G-video-full-screen");
      case "pictureInPicture":
        return this.videoContainer.classList.contains("T_M_G-video-picture-in-picture");
      case "floatingPlayer":
        return this.videoContainer.classList.contains("T_M_G-video-floating-player");
      case "theater":
        return this.videoContainer.classList.contains("T_M_G-video-theater");
      case "settings":
        return this.videoContainer.classList.contains("T_M_G-video-settings-view");
      case "captions":
        return this.videoContainer.classList.contains("T_M_G-video-captions");
      default:
        return false;
    }
  }
  showUserMessage = (message) => message && this.DOM.videoContainerContent.setAttribute("data-message", message);
  removeUserMessage = () => this.DOM.videoContainerContent.removeAttribute("data-message");
  _handleLoadedError(error) {
    const fallbackMessage = (typeof error === "string" && error) || error?.message || this.video.error?.message || (error && "An unknown error occurred with the video :(");
    const message = this.settings.errorMessages?.[this.video.error?.code ?? (error && 5)] || fallbackMessage;
    this.loaded = false;
    this.deactivate(message);
  }
  _handleLoadedMetadata() {
    this.stats = { fps: 30 };
    if (this.settings.time.start && !this.initialState) this.currentTime = this.settings.time.start;
    this.syncAspectRatio();
    this.setCaptionsState();
    if (this.DOM.totalTimeElement) this.DOM.totalTimeElement.textContent = this.toTimeText(this.video.duration);
    this.videoCurrentPlayedPosition = this.currentTime < 1 ? (this.videoCurrentBufferedPosition = 0) : tmg.parseNumber(this.video.currentTime / this.video.duration);
    this.loaded = true;
    this.reactivate();
  }
  _handleLoadedData() {
    if (this.DOM.totalTimeElement) this.DOM.totalTimeElement.textContent = this.toTimeText(this.video.duration);
  }
  _handleDurationChange() {
    if (this.DOM.totalTimeElement) this.DOM.totalTimeElement.textContent = this.toTimeText(this.video.duration);
  }
  _handleLoadedProgress() {
    for (let i = 0; i < this.video.buffered.length; i++) {
      if (this.video.buffered.start(this.video.buffered.length - 1 - i) < this.currentTime) {
        this.videoCurrentBufferedPosition = this.video.buffered.end(this.video.buffered.length - 1 - i) / this.duration;
        break;
      }
    }
  }
  async togglePlay(bool) {
    try {
      await this.video[(typeof bool === "boolean" ? bool : this.video.paused) ? "play" : "pause"]();
    } catch (e) {
      this.video.error ? this._handleLoadedError(e) : this.log(e, "error", "swallow");
    }
  }
  replay() {
    this.moveVideoTime({ to: "start" });
    this.video.play();
  }
  _handleBufferStart() {
    this.buffering = true;
    this.showOverlay();
    this.videoContainer.classList.add("T_M_G-video-buffering");
  }
  _handleBufferStop() {
    if (!this.buffering) return;
    this.buffering = false;
    this.delayOverlay();
    this.videoContainer.classList.remove("T_M_G-video-buffering");
  }
  _handlePlay() {
    tmg.connectAudio(this.audioGainNode);
    for (const media of document.querySelectorAll("video, audio")) {
      if (media !== this.video && !media.paused) media.pause();
    }
    this.videoContainer.classList.remove("T_M_G-video-paused");
    this.delayOverlay();
    this.setMediaSession();
    this.video.requestVideoFrameCallback?.(this._handleFrameUpdate);
    if (!this.loaded || !this.video.currentSrc) return;
    this.loaded = true;
    this.reactivate();
  }
  _handlePause() {
    this.videoContainer.classList.add("T_M_G-video-paused");
    this.showOverlay();
    if (this.buffering) this._handleBufferStop();
  }
  _handleEnded = () => this.videoContainer.classList.add("T_M_G-video-replay");
  get duration() {
    return tmg.parseNumber(this.video.duration);
  }
  set currentTime(value) {
    this.video.currentTime = tmg.parseNumber(Math.max(0, value));
  }
  get currentTime() {
    return tmg.parseNumber(this.video.currentTime);
  }
  toTimeText(t = this.video.currentTime, useMode = false, showMs = false) {
    return !useMode || this.settings.time.mode !== "remaining" ? tmg.formatTime(t, this.settings.time.format, showMs) : `${tmg.formatTime(this.video.duration - t, this.settings.time.format, showMs, true)}`;
  }
  generateCanvasPreviews() {
    this.DOM.previewCanvas.width = this.DOM.previewCanvas.offsetWidth || this.DOM.previewCanvas.width;
    this.DOM.previewCanvas.height = this.DOM.previewCanvas.offsetHeight || this.DOM.previewCanvas.height;
    if (!this.isMediaMobile) this.previewContext?.drawImage(this.pseudoVideo, 0, 0, this.DOM.previewCanvas.width, this.DOM.previewCanvas.height);
    if (this.isScrubbing) this.thumbnailContext?.drawImage(this.pseudoVideo, 0, 0, this.DOM.thumbnailCanvas.width, this.DOM.thumbnailCanvas.height);
  }
  _handleTimelinePointerDown(e) {
    if (this.isScrubbing) return;
    this.DOM.timelineContainer?.setPointerCapture(e.pointerId);
    this.isScrubbing = true;
    this.wasPaused = this.video.paused;
    this.scrubbingId = setTimeout(() => {
      this.togglePlay(false);
      this.videoContainer.classList.add("T_M_G-video-scrubbing");
      this.isMediaMobile && this.DOM.scrubNotifier?.classList.add("T_M_G-video-control-active");
    }, 150);
    this._handleTimelineInput(e);
    this.DOM.timelineContainer?.addEventListener("pointermove", this._handleTimelineInput);
    this.DOM.timelineContainer?.addEventListener("pointerup", this.stopTimeScrubbing);
  }
  stopTimeScrubbing(e) {
    if (!this.isScrubbing) return;
    e && this.DOM.timelineContainer?.releasePointerCapture(e.pointerId);
    this.isScrubbing = false;
    this.currentTime = Number(this.videoCurrentPlayedPosition) * this.duration;
    clearTimeout(this.scrubbingId);
    this.togglePlay(!this.wasPaused);
    this.videoContainer.classList.remove("T_M_G-video-scrubbing");
    this.DOM.scrubNotifier?.classList.remove("T_M_G-video-control-active");
    this.stopTimePreviewing();
    this.DOM.timelineContainer?.removeEventListener("pointermove", this._handleTimelineInput);
    this.DOM.timelineContainer?.removeEventListener("pointerup", this.stopTimeScrubbing);
  }
  stopTimePreviewing() {
    this.overTimeline = false;
    setTimeout(() => this.videoContainer.classList.remove("T_M_G-video-previewing"));
  }
  _handleTimelineInput({ clientX: x }) {
    this.overTimeline = true;
    if (!this.isMediaMobile) this.videoContainer.classList.add("T_M_G-video-previewing");
    this.throttle(
      "timelineInput",
      () => {
        const rect = this.DOM.timelineContainer?.getBoundingClientRect(),
          percent = tmg.clamp(0, x - rect.left, rect.width) / rect.width,
          previewImgMin = this.DOM.previewContainer.offsetWidth / 2 / rect.width;
        this.videoCurrentPreviewPosition = percent;
        this.videoCurrentPreviewImgPosition = tmg.clamp(previewImgMin, percent, 1 - previewImgMin);
        this.DOM.previewContainer?.setAttribute("data-preview-time", this.toTimeText(percent * this.video.duration, true));
        if (this.isScrubbing) {
          this.videoCurrentPlayedPosition = percent;
          this.delayOverlay();
        }
        if (this.settings.status.ui.previews) {
          if (!this.isMediaMobile) this.DOM.previewImg.src = this.settings.time.previews.address.replace("$", Math.max(1, Math.floor((percent * this.duration) / this.settings.time.previews.spf)));
          if (this.isScrubbing) this.DOM.thumbnailImg.src = this.DOM.previewImg.src;
        } else if (this.settings.time.previews) this.pseudoVideo.currentTime = percent * this.duration;
        let arrowBW = tmg.parseCSSUnit(getComputedStyle(this.DOM.previewContainer, "::before").borderWidth),
          arrowPosition,
          arrowPositionMin = Math.max(arrowBW / 5, tmg.parseCSSUnit(getComputedStyle(this.DOM.previewContainer).borderRadius) / 2);
        if (percent < previewImgMin) arrowPosition = `${Math.max(percent * rect.width, arrowPositionMin + arrowBW / 2 + 1)}px`;
        else if (percent > 1 - previewImgMin) arrowPosition = `${Math.min(this.DOM.previewContainer.offsetWidth / 2 + percent * rect.width - this.DOM.previewContainer.offsetLeft, this.DOM.previewContainer.offsetWidth - arrowPositionMin - arrowBW - 1)}px`;
        else arrowPosition = "50%";
        this.videoCurrentPreviewImgArrowPosition = arrowPosition;
      },
      20,
    );
  }
  _handleGestureTimelineInput({ percent, sign, multiplier }) {
    multiplier = multiplier.toFixed(1);
    percent = percent * multiplier;
    const time = sign === "+" ? this.currentTime + percent * this.duration : this.currentTime - percent * this.duration;
    this.gestureNextTime = tmg.clamp(0, time, this.duration);
    if (this.overTimeline) this.currentTime = this.gestureNextTime;
    if (this.DOM.touchTimelineNotifier) this.DOM.touchTimelineNotifier.textContent = `${sign}${this.toTimeText(Math.abs(this.gestureNextTime - this.currentTime))} (${this.toTimeText(this.gestureNextTime, true)}) ${multiplier < 1 ? `x${multiplier}` : ""}`;
  }
  _handleTimelineKeyDown(e) {
    switch (e.key?.toLowerCase()) {
      case "arrowleft":
      case "arrowdown":
        e.preventDefault();
        e.stopImmediatePropagation();
        this.currentTime -= e.shiftKey ? 5 : 1;
        break;
      case "arrowright":
      case "arrowup":
        e.preventDefault();
        e.stopImmediatePropagation();
        this.currentTime += e.shiftKey ? 5 : 1;
        break;
    }
  }
  _handleTimeUpdate() {
    if (this.isScrubbing) return;
    this.video.controls = false; // youtube did this too :)
    this.video.volume = 1; // just in case
    this.videoCurrentPlayedPosition = tmg.isValidNumber(this.video.duration) ? tmg.parseNumber(this.video.currentTime / this.video.duration) : this.video.currentTime / 60; // progress fallback, shouldn't take more than a min for duration to be available
    if (this.DOM.currentTimeElement) this.DOM.currentTimeElement.textContent = this.toTimeText(this.video.currentTime, true);
    if (this.speedCheck && !this.video.paused) this.DOM.playbackRateNotifier?.setAttribute("data-current-time", this.toTimeText(this.video.currentTime, true));
    if (this.playlist && this.currentTime > 3) this.playlistCurrentTime = this.currentTime;
    if (Math.floor((this.settings.time.end || this.duration) - this.currentTime) <= this.settings.auto.next) this.autonextVideo();
    this.videoContainer.classList.remove("T_M_G-video-replay");
  }
  toggleTimeMode() {
    this.showOverlay();
    this.settings.time.mode = this.settings.time.mode !== "elapsed" ? "elapsed" : "remaining";
    if (this.DOM.currentTimeElement) this.DOM.currentTimeElement.textContent = this.toTimeText(this.video.currentTime, true);
    this.DOM.previewContainer?.setAttribute("data-preview-time", this.toTimeText(Number(this.videoCurrentPreviewPosition) * this.video.duration, true));
  }
  toggleTimeFormat() {
    this.showOverlay();
    this.settings.time.format = this.settings.time.format !== "digital" ? "digital" : "human";
    if (this.DOM.currentTimeElement) this.DOM.currentTimeElement.textContent = this.toTimeText(this.video.currentTime, true);
    if (this.DOM.totalTimeElement) this.DOM.totalTimeElement.textContent = this.toTimeText(this.video.duration);
    this.DOM.previewContainer?.setAttribute("data-preview-time", this.toTimeText(Number(this.videoCurrentPreviewPosition) * this.video.duration, true));
  }
  skip(duration) {
    const notifier = duration > 0 ? this.DOM.fwdNotifier : this.DOM.bwdNotifier;
    duration = Math.sign(duration) === 1 ? (this.duration - this.currentTime > duration ? duration : this.duration - this.currentTime) : Math.sign(duration) === -1 ? (this.currentTime > Math.abs(duration) ? duration : -this.currentTime) : 0;
    duration = Math.trunc(duration);
    this.videoCurrentPlayedPosition = tmg.parseNumber((this.video.currentTime += duration) / this.video.duration);
    if (this.skipPersist) {
      if (this.currentSkipNotifier && notifier !== this.currentSkipNotifier) {
        this.skipDuration = 0;
        this.currentSkipNotifier.classList.remove("T_M_G-video-control-persist");
      }
      this.currentSkipNotifier = notifier;
      notifier?.classList.add("T_M_G-video-control-persist");
      this.skipDuration += duration;
      clearTimeout(this.skipDurationId);
      this.skipDurationId = setTimeout(() => {
        this.deactivateSkipPersist();
        this.skipDuration = 0;
        notifier?.classList.remove("T_M_G-video-control-persist");
        this.currentSkipNotifier = null;
        this.removeOverlay();
      }, tmg.parseCSSTime(this.videoNotifiersAnimationTime));
      notifier?.setAttribute("data-skip", this.skipDuration);
      return;
    } else this.currentSkipNotifier?.classList.remove("T_M_G-video-control-persist");
    notifier?.setAttribute("data-skip", Math.abs(duration));
  }
  moveVideoTime(details) {
    switch (details.to) {
      case "start":
        this.currentTime = 0;
        break;
      case "end":
        this.currentTime = this.duration;
        break;
      default:
        this.currentTime = (Number(details.to) / Number(details.max)) * this.duration;
    }
  }
  _handleFrameUpdate(now, m) {
    const diff = m.presentedFrames - (this.stats?.presentedFrames ?? 0),
      fps = diff > 0 ? (diff / (now - (this.stats?.now ?? now))) * 1000 : 30,
      droppedFrames = (this.stats?.droppedFrames ?? 0) + (diff > 1 ? diff - 1 : 0);
    this.stats = { ...m, now, fps, droppedFrames };
    // this.throttle("statsLogging", () => this.log(` STATS FOR NERDS: \n Now: ${now} ms\n Media Time: ${m.mediaTime} s\n Expected Display Time: ${m.expectedDisplayTime} ms\n Presented Frames: ${m.presentedFrames}\n Dropped Frames (detected): ${droppedFrames}\n FPS (real-time): ${fps}\n Processing Duration: ${m.processingDuration} ms\n Capture Time: ${m.captureTime}\n Width: ${m.width}\n Height: ${m.height}\n Painted Frames: ${m.paintedFrames}\n`), 1000);
    this.video.requestVideoFrameCallback(this._handleFrameUpdate);
  }
  moveVideoFrame(dir = "forwards") {
    if (!this.video.paused) return;
    this.throttle("frameStepping", () => (this.currentTime = tmg.clamp(0, Math.round(this.currentTime * this.pfps) + (dir === "backwards" ? -1 : 1), Math.floor(this.duration * this.pfps)) / this.pfps), this.pframeDelay);
  }
  set playbackRate(value) {
    this.video.playbackRate = this.video.defaultPlaybackRate = this.settings.playbackRate.value = tmg.clamp(this.settings.playbackRate.min, value, this.settings.playbackRate.max);
  }
  get playbackRate() {
    return this.video.playbackRate ?? 1;
  }
  updatePlaybackRateSettings() {
    this.playbackRate = this.settings.playbackRate.value ?? this.video.playbackRate;
  }
  rotatePlaybackRate(dir = "forwards") {
    const rate = this.playbackRate;
    const { min, max, skip } = this.settings.playbackRate;
    const steps = Array.from({ length: Math.floor((max - min) / skip) + 1 }, (_, i) => min + i * skip);
    const i = steps.reduce((cIdx, s, idx) => (Math.abs(s - rate) < Math.abs(steps[cIdx] - rate) ? idx : cIdx), 0);
    this.playbackRate = steps[dir === "backwards" ? (i - 1 + steps.length) % steps.length : (i + 1) % steps.length];
  }
  changePlaybackRate(value) {
    const sign = Math.sign(value) === 1 ? "+" : "-";
    value = Math.abs(value);
    const rate = this.playbackRate;
    switch (sign) {
      case "-":
        if (rate > this.settings.playbackRate.min) this.playbackRate -= rate % value ? rate % value : value;
        this.fire("playbackratedown");
        break;
      default:
        if (rate < this.settings.playbackRate.max) this.playbackRate += rate % value ? rate % value : value;
        this.fire("playbackrateup");
        break;
    }
  }
  _handlePlaybackRateChange() {
    if (this.DOM.playbackRateNotifierContent) this.DOM.playbackRateNotifierContent.textContent = `${this.playbackRate}x`;
    if (this.DOM.playbackRateNotifierText) this.DOM.playbackRateNotifierText.textContent = `${this.playbackRate}x`;
    this.setControlsState("playbackRate");
  }
  fastPlay(pos) {
    if (this.speedCheck) return;
    this.speedCheck = true;
    this.wasPaused = this.video.paused;
    this.lastPlaybackRate = this.playbackRate;
    this.DOM.playbackRateNotifier?.classList.add("T_M_G-video-control-active");
    setTimeout(pos === "backwards" && this.settings.beta?.rewind ? this.rewind : this.fastForward, this.settings.playbackRate.fast);
  }
  fastForward(rate = this.settings.playbackRate.fast) {
    this.playbackRate = rate;
    this.DOM.playbackRateNotifier?.classList.remove("T_M_G-video-rewind");
    this.togglePlay(true);
  }
  rewind(rate = this.settings.playbackRate.fast) {
    this.playbackRate = 1;
    this.rewindPlaybackRate = rate;
    if (this.DOM.playbackRateNotifierText) this.DOM.playbackRateNotifierText.textContent = `${rate}x`;
    this.DOM.playbackRateNotifier?.classList.add("T_M_G-video-rewind");
    this.video.addEventListener("play", this.rewindReset);
    this.speedIntervalId = setInterval(this.rewindVideo, this.pframeDelay);
  }
  rewindVideo() {
    this.togglePlay(false);
    this.currentTime -= this.rewindPlaybackRate / this.pfps;
    this.videoCurrentPlayedPosition = tmg.parseNumber(this.video.currentTime / this.video.duration);
    this.DOM.playbackRateNotifier?.setAttribute("data-current-time", this.toTimeText(this.video.currentTime, true));
  }
  rewindReset() {
    if (this.speedIntervalId) {
      this.fire("videopause");
      this.togglePlay(false);
      clearInterval(this.speedIntervalId);
      this.speedIntervalId = null;
    } else this.speedIntervalId = setInterval(this.rewindVideo, this.pframeDelay);
  }
  slowDown() {
    if (!this.speedCheck) return;
    this.speedCheck = false;
    clearInterval(this.speedIntervalId);
    this.video.removeEventListener("play", this.rewindReset);
    this.DOM.playbackRateNotifier?.classList.remove("T_M_G-video-control-active", "T_M_G-video-rewind");
    this.playbackRate = this.lastPlaybackRate;
    this.togglePlay(!this.wasPaused);
  }
  set videoCaptionsCharacterEdgeStyle(value) {
    this.DOM.cueContainer.classList.forEach((cls) => cls.startsWith("T_M_G-video-cue-character-edge-style") && this.DOM.cueContainer.classList.remove(cls));
    this.DOM.cueContainer.classList.add(`T_M_G-video-cue-character-edge-style-${value}`);
  }
  get videoCaptionsCharacterEdgeStyle() {
    const edgeStyles = tmg.parseConfig(this.settings.captions).characterEdgeStyle.values;
    const edgeStyle = [...(this.DOM.cueContainer?.classList ?? [])].find((cls) => cls.startsWith("T_M_G-video-cue-character-edge-style"))?.replace("T_M_G-video-cue-character-edge-style-", "");
    return edgeStyles.includes(edgeStyle) ? edgeStyle : "none";
  }
  updateCaptionsSettings() {
    Object.entries(this.settings.captions.font).forEach(([k, { value }]) => (this[`videoCaptionsFont${tmg.capitalize(k)}`] = value ?? this[`videoCaptionsFont${tmg.capitalize(k)}`]));
    Object.entries(this.settings.captions.background).forEach(([k, { value }]) => (this[`videoCaptionsBackground${tmg.capitalize(k)}`] = value));
    Object.entries(this.settings.captions.window).forEach(([k, { value }]) => (this[`videoCaptionsWindow${tmg.capitalize(k)}`] = value));
    this.videoCaptionsCharacterEdgeStyle = this.settings.captions.characterEdgeStyle.value;
  }
  toggleCaptions() {
    this.videoCurrentCueX = this.CSSPropsCache.videoCurrentCueX;
    this.videoCurrentCueY = this.CSSPropsCache.videoCurrentCueY;
    if (this.video.textTracks[this.textTrackIndex]) this.videoContainer.classList.toggle("T_M_G-video-captions");
    else this.previewCaptions("No captions available for this video");
  }
  previewCaptions(preview = `${tmg.capitalize(this.videoContainer.dataset.trackKind || "captions")} look like this`) {
    const shouldPreview = !this.isModeActive("captions") || !this.DOM.cueContainer.textContent;
    if (shouldPreview) this.videoContainer.classList.add("T_M_G-video-captions-preview");
    this._handleCueChange({ text: shouldPreview ? preview : this.lastCueText });
    clearTimeout(this.previewCaptionsTimeoutId);
    this.previewCaptionsTimeoutId = setTimeout(() => {
      this.videoContainer.classList.remove("T_M_G-video-captions-preview");
      if (this.DOM.cueContainer.textContent.replace(/\s/g, "") === preview.replace(/\s/g, "")) this.DOM.cueContainer.innerHTML = "";
    }, 1500);
  }
  resetCueCharWidth() {
    this.DOM.cueContainer.style.setProperty("display", "block", "important");
    const measurer = tmg.createEl("span", { className: "T_M_G-video-cue", innerHTML: "abcdefghijklmnopqrstuvwxyz".repeat(2) }, {}, { visibility: "hidden" });
    this.DOM.cueContainer.appendChild(measurer);
    this.cueCharW = measurer.offsetWidth / (26 * 2);
    measurer.remove();
    this.DOM.cueContainer.style.removeProperty("display");
  }
  _handleCueChange(cue) {
    this.DOM.cueContainer.innerHTML = "";
    if (!cue) return;
    const cueWrapper = tmg.createEl("div", { className: "T_M_G-video-cue-wrapper" });
    const maxChars = Math.floor(this.videoContainer.offsetWidth / this.cueCharW);
    const paragraphs = cue.text.replace(/<br\s*\/?>/gi, "\n").split(/\n/);
    paragraphs.forEach((p) => {
      let line = [],
        lineLen = 0,
        parts = [];
      p.split(" ").forEach((word) => {
        if (lineLen + word.length + 1 > maxChars) {
          parts.push(line);
          line = [];
          lineLen = 0;
        }
        line.push(word);
        lineLen += word.length + 1;
      });
      if (line.length) parts.push(line);
      parts.forEach((part) => {
        const cueLine = tmg.createEl("div", { className: "T_M_G-video-cue-line" });
        const cueEl = tmg.createEl("span", { className: "T_M_G-video-cue", innerHTML: part.join(" ") });
        cueLine.appendChild(cueEl);
        cueWrapper.appendChild(cueLine);
      });
    });
    this.DOM.cueContainer.appendChild(cueWrapper);
    this.videoCurrentCueContainerHeight = `${this.DOM.cueContainer.offsetHeight}px`;
    this.videoCurrentCueContainerWidth = `${this.DOM.cueContainer.offsetWidth}px`;
    this.lastCueText = cue.text;
  }
  changeCaptionsFontSize(value) {
    const sign = Math.sign(value) === 1 ? "+" : "-";
    value = Math.abs(value);
    const size = Number(this.videoCaptionsFontSize);
    switch (sign) {
      case "-":
        if (size > this.settings.captions.font.size.min) this.videoCaptionsFontSize = size - (size % value ? size % value : value);
        break;
      default:
        if (size < this.settings.captions.font.size.max) this.videoCaptionsFontSize = size + (size % value ? size % value : value);
    }
    this.resetCueCharWidth();
    this.previewCaptions();
  }
  rotateCaptionsProp(steps, prop, numeric = true) {
    const curr = this[prop];
    const i = Math.max(0, numeric ? steps.reduce((cIdx, s, idx) => (Math.abs(s - curr) < Math.abs(steps[cIdx] - curr) ? idx : cIdx), 0) : steps.indexOf(curr));
    this[prop] = steps[(i + 1) % steps.length];
    this.resetCueCharWidth();
    this.previewCaptions();
  }
  rotateCaptionsFontFamily = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).font.family.values, "videoCaptionsFontFamily", false);
  rotateCaptionsFontWeight = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).font.weight.values, "videoCaptionsFontWeight", false);
  rotateCaptionsFontVariant = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).font.variant.values, "videoCaptionsFontVariant", false);
  rotateCaptionsFontOpacity = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).font.opacity.values, "videoCaptionsFontOpacity");
  rotateCaptionsBackgroundOpacity = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).background.opacity.values, "videoCaptionsBackgroundOpacity");
  rotateCaptionsWindowOpacity = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).window.opacity.values, "videoCaptionsWindowOpacity");
  rotateCaptionsCharacterEdgeStyle = () => this.rotateCaptionsProp(tmg.parseConfig(this.settings.captions).characterEdgeStyle.values, "videoCaptionsCharacterEdgeStyle", false);
  _handleCueDragStart(e) {
    this.DOM.cueContainer?.setPointerCapture(e.pointerId);
    this.DOM.cueContainer?.addEventListener("pointermove", this._handleCueDragging);
    this.DOM.cueContainer?.addEventListener("pointerup", this._handleCueDragEnd);
  }
  _handleCueDragging({ clientX, clientY }) {
    this.videoContainer.classList.add("T_M_G-video-cue-dragging");
    this.RAFLoop("cueDragging", () => {
      const rect = this.videoContainer.getBoundingClientRect(),
        { offsetWidth: w, offsetHeight: h } = this.DOM.cueContainer,
        posX = tmg.clamp(w / 2, clientX - rect.left, rect.width - w / 2),
        posY = tmg.clamp(h / 2, rect.height - (clientY - rect.top), rect.height - h / 2);
      this.videoCurrentCueX = `${(posX / rect.width) * 100}%`;
      this.videoCurrentCueY = `${(posY / rect.height) * 100}%`;
    });
  }
  _handleCueDragEnd(e) {
    this.DOM.cueContainer?.releasePointerCapture(e.pointerId);
    this.cancelRAFLoop("cueDragging");
    this.videoContainer.classList.remove("T_M_G-video-cue-dragging");
    this.DOM.cueContainer?.removeEventListener("pointermove", this._handleCueDragging);
    this.DOM.cueContainer?.removeEventListener("pointerup", this._handleCueDragEnd);
  }
  set volume(value) {
    const v = tmg.clamp(this.shouldMute ? 0 : this.settings.volume.min, value, this.settings.volume.max) / 100;
    if (this.audioGainNode) this.audioGainNode.gain.value = this.settings.volume.value = v;
    this.video.muted = this.video.defaultMuted = this.settings.volume.muted = v === 0;
    this._handleVolumeChange();
  }
  get volume() {
    return Math.round((this.audioGainNode?.gain?.value ?? 1) * 100);
  }
  setUpAudio() {
    if (this.audioSetup) return;
    if (tmg.connectMediaToAudioManager(this.video) === "unavailable") return;
    this.audioSourceNode = this.video.audioSourceNode;
    this.audioGainNode = this.video.audioGainNode;
    this.audioSetup = true;
  }
  cancelAudio() {
    this.audioSourceNode?.disconnect();
    this.audioGainNode?.disconnect();
    this.video.volume = tmg.clamp(0, this.audioGainNode?.gain?.value ?? 1, 1);
    this.audioSetup = false;
  }
  updateAudioSettings() {
    this.setUpAudio();
    const { min, max, value } = this.settings.volume;
    this.videoContainer.classList.toggle("T_M_G-video-volume-boost", max > 100);
    if (this.DOM.volumeSlider) this.DOM.volumeSlider.max = max;
    this.videoVolumeSliderPercent = Math.round((100 / max) * 100);
    this.videoMaxVolumeRatio = max / 100;
    this.lastVolume = tmg.clamp(min, (value ?? this.video.volume) * 100, max);
    this.shouldMute = this.shouldSetLastVolume = this.video.muted;
    this.volume = this.shouldMute ? 0 : this.lastVolume;
  }
  toggleMute(auto) {
    let volume;
    if (this.volume) {
      this.lastVolume = this.volume;
      this.shouldSetLastVolume = true;
      volume = 0;
    } else {
      volume = this.shouldSetLastVolume ? this.lastVolume : this.volume;
      if (volume === 0) volume = auto === "auto" ? this.settings.volume.skip : this.sliderVolume;
      this.shouldSetLastVolume = false;
    }
    this.shouldMute = volume === 0;
    this.volume = volume;
  }
  _handleVolumeSliderInput({ target: { value: volume } }) {
    this.shouldMute = false;
    this.volume = volume;
    if (volume > 5) this.sliderVolume = volume;
    this.shouldSetLastVolume = false;
    this.delayVolumeActive();
    this.delayOverlay();
  }
  _handleGestureVolumeSliderInput({ percent, sign }) {
    let volume = sign === "+" ? this.volume + percent * this.settings.volume.max : this.volume - percent * this.settings.volume.max;
    volume = tmg.clamp(0, Math.floor(volume), this.settings.volume.max);
    this.volume = volume;
    this.shouldSetLastVolume = false;
  }
  _handleVolumeChange() {
    let v = this.volume;
    if (this.DOM.volumeNotifierContent) this.DOM.volumeNotifierContent.textContent = v + "%";
    let vLevel = "";
    if (v == 0) vLevel = "muted";
    else if (v < 50) vLevel = "low";
    else if (v <= 100) vLevel = "high";
    else if (v > 100) vLevel = "boost";
    const vPercent = (v - 0) / (this.settings.volume.max - 0);
    this.videoContainer.setAttribute("data-volume-level", vLevel);
    if (this.DOM.volumeSlider) this.DOM.volumeSlider.value = v;
    this.DOM.volumeSlider?.parentElement.setAttribute("data-volume", v);
    if (this.DOM.touchVolumeContent) this.DOM.touchVolumeContent.textContent = v + "%";
    this.videoCurrentVolumeTooltipPosition = `${10.5 + vPercent * 79.5}%`;
    if (this.settings.volume.max > 100) {
      if (v <= 100) {
        this.videoCurrentVolumeSliderPosition = (v - 0) / (100 - 0);
        this.videoCurrentVolumeSliderBoostPosition = 0;
        this.videoVolumeSliderBoostPercent = 0;
      } else if (v > 100) {
        this.videoCurrentVolumeSliderPosition = 1;
        this.videoCurrentVolumeSliderBoostPosition = (v - 100) / (this.settings.volume.max - 100);
        this.videoVolumeSliderBoostPercent = this.videoVolumeSliderPercent;
      }
    } else this.videoCurrentVolumeSliderPosition = vPercent;
  }
  changeVolume(value) {
    const sign = Math.sign(value) === 1 ? "+" : "-";
    value = Math.abs(value);
    let volume = this.shouldSetLastVolume ? this.lastVolume : this.volume;
    switch (sign) {
      case "-":
        if (volume > this.settings.volume.min) volume -= volume % value ? volume % value : value;
        if (volume === 0) {
          this.fire("volumemuted");
          break;
        }
        this.fire("volumedown");
        break;
      default:
        if (volume < this.settings.volume.max) volume += volume % value ? value - (volume % value) : value;
        this.fire("volumeup");
        break;
    }
    if (this.shouldSetLastVolume) {
      if (this.DOM.volumeNotifierContent) this.DOM.volumeNotifierContent.textContent = volume + "%";
      this.lastVolume = volume;
    } else this.volume = volume;
  }
  _handleVolumeContainerMouseMove() {
    this.overVolume = this.DOM.volumeSlider?.matches(":hover");
    this.startVolumeActive();
  }
  _handleVolumeContainerMouseLeave() {
    this.overVolume = false;
    this.stopVolumeActive();
  }
  startVolumeActive() {
    this.DOM.volumeSlider?.classList.add("T_M_G-video-control-active");
    this.delayVolumeActive();
  }
  delayVolumeActive() {
    clearTimeout(this.delayVolumeActiveId);
    this.delayVolumeActiveId = setTimeout(this.stopVolumeActive, this.settings.overlayDelay);
  }
  stopVolumeActive() {
    if (this.DOM.volumeSlider?.matches(":active")) return this.delayVolumeActive();
    clearTimeout(this.delayVolumeActiveId);
    this.DOM.volumeSlider?.classList.remove("T_M_G-video-control-active");
  }
  updateBrightnessSettings() {
    const { min, max, value } = this.settings.brightness;
    this.videoContainer.classList.toggle("T_M_G-video-brightness-boost", max > 100);
    if (this.DOM.brightnessSlider) this.DOM.brightnessSlider.max = max;
    this.videoBrightnessSliderPercent = Math.round((100 / max) * 100);
    this.videoMaxBrightnessRatio = max / 100;
    this.lastBrightness = tmg.clamp(min, value, max);
    this.brightness = this.lastBrightness;
  }
  set brightness(value) {
    this.videoBrightness = this.settings.brightness.value = tmg.clamp(this.shouldDark ? 0 : this.settings.brightness.min, value, this.settings.brightness.max);
    this._handleBrightnessChange();
  }
  get brightness() {
    return Number(this.videoBrightness ?? 100);
  }
  toggleDark(auto) {
    let brightness;
    if (this.brightness) {
      this.lastBrightness = this.brightness;
      this.shouldSetLastBrightness = true;
      brightness = 0;
    } else {
      brightness = this.shouldSetLastBrightness ? this.lastBrightness : this.brightness;
      if (brightness === 0) brightness = auto === "auto" ? this.settings.brightness.skip : this.sliderBrightness;
      this.shouldSetLastBrightness = false;
    }
    this.shouldDark = brightness === 0;
    this.brightness = brightness;
  }
  _handleBrightnessSliderInput({ target: { value: brightness } }) {
    this.shouldDark = false;
    this.brightness = brightness;
    if (brightness > 5) this.sliderBrightness = brightness;
    this.shouldSetLastBrightness = false;
    this.delayBrightnessActive();
    this.delayOverlay();
  }
  _handleGestureBrightnessSliderInput({ percent, sign }) {
    let brightness = sign === "+" ? this.brightness + percent * this.settings.brightness.max : this.brightness - percent * this.settings.brightness.max;
    brightness = tmg.clamp(0, Math.floor(brightness), this.settings.brightness.max);
    this.brightness = brightness;
    this.shouldSetLastBrightness = false;
  }
  _handleBrightnessChange() {
    let b = this.brightness;
    if (this.DOM.brightnessNotifierContent) this.DOM.brightnessNotifierContent.textContent = b + "%";
    let bLevel = "";
    if (b == 0) bLevel = "dark";
    else if (b < 50) bLevel = "low";
    else if (b <= 100) bLevel = "high";
    else if (b > 100) bLevel = "boost";
    const bPercent = (b - 0) / (this.settings.brightness.max - 0);
    this.videoContainer.setAttribute("data-brightness-level", bLevel);
    if (this.DOM.brightnessSlider) this.DOM.brightnessSlider.value = b;
    this.DOM.brightnessSlider?.parentElement.setAttribute("data-brightness", b);
    if (this.DOM.touchBrightnessContent) this.DOM.touchBrightnessContent.textContent = b + "%";
    this.videoCurrentBrightnessTooltipPosition = `${10.5 + bPercent * 79.5}%`;
    if (this.settings.brightness.max > 100) {
      if (b <= 100) {
        this.videoCurrentBrightnessSliderPosition = (b - 0) / (100 - 0);
        this.videoCurrentBrightnessSliderBoostPosition = 0;
        this.videoBrightnessSliderBoostPercent = 0;
      } else if (b > 100) {
        this.videoCurrentBrightnessSliderPosition = 1;
        this.videoCurrentBrightnessSliderBoostPosition = (b - 100) / (this.settings.brightness.max - 100);
        this.videoBrightnessSliderBoostPercent = this.videoBrightnessSliderPercent;
      }
    } else this.videoCurrentBrightnessSliderPosition = bPercent;
  }
  changeBrightness(value) {
    const sign = Math.sign(value) === 1 ? "+" : "-";
    value = Math.abs(value);
    let brightness = this.shouldSetLastBrightness ? this.lastBrightness : this.brightness;
    value = Math.abs(value);
    switch (sign) {
      case "-":
        if (brightness > this.settings.brightness.min) brightness -= brightness % value ? brightness % value : value;
        if (brightness === 0) {
          this.fire("brightnessdark");
          break;
        }
        this.fire("brightnessdown");
        break;
      default:
        if (brightness < this.settings.brightness.max) brightness += brightness % value ? value - (brightness % value) : value;
        this.fire("brightnessup");
        break;
    }
    if (this.shouldSetLastBrightness) {
      if (this.DOM.brightnessNotifierContent) this.DOM.brightnessNotifierContent.textContent = brightness + "%";
      this.lastBrightness = brightness;
    } else this.brightness = brightness;
  }
  _handleBrightnessContainerMouseMove() {
    this.overBrightness = this.DOM.brightnessSlider?.matches(":hover");
    this.startBrightnessActive();
  }
  _handleBrightnessContainerMouseLeave() {
    this.overBrightness = false;
    this.stopBrightnessActive();
  }
  startBrightnessActive() {
    this.DOM.brightnessSlider?.classList.add("T_M_G-video-control-active");
    this.delayBrightnessActive();
  }
  delayBrightnessActive() {
    clearTimeout(this.brightnessActiveDelayId);
    this.brightnessActiveDelayId = setTimeout(this.stopBrightnessActive, this.settings.overlayDelay);
  }
  stopBrightnessActive() {
    if (this.DOM.brightnessSlider?.matches(":active")) return this.delayBrightnessActive();
    clearTimeout(this.brightnessActiveDelayId);
    this.DOM.brightnessSlider?.classList.remove("T_M_G-video-control-active");
  }
  toggleTheaterMode = () => this.settings.modes.theater && this.videoContainer.classList.toggle("T_M_G-video-theater");
  async toggleFullScreenMode() {
    if (!this.settings.modes.fullScreen) return;
    if (!this.isModeActive("fullScreen")) {
      if (tmg._currentFullScreenController) return;
      if (this.isModeActive("floatingPlayer")) {
        this.floatingPlayer?.addEventListener("pagehide", this.toggleFullScreenMode);
        return this.floatingPlayer?.close();
      }
      if (this.isModeActive("pictureInPicture")) document.exitPictureInPicture();
      this.toggleMiniPlayerMode(false);
      tmg._currentFullScreenController = this;
      if (this.videoContainer.requestFullscreen) await this.videoContainer.requestFullscreen();
      else if (this.videoContainer.mozRequestFullScreen) await this.videoContainer.mozRequestFullScreen();
      else if (this.videoContainer.msRequestFullscreen) await this.videoContainer.msRequestFullscreen();
      else if (this.videoContainer.webkitRequestFullScreen) await this.videoContainer.webkitRequestFullScreen();
      else if (this.video.webkitEnterFullScreen) {
        await this.video.webkitEnterFullScreen(); // this is for native ios fullscreen support
        this.video.addEventListener(
          "webkitendfullscreen",
          () => {
            this.inFullScreen = false;
            this._handleFullScreenChange();
          },
          { once: true },
        );
      }
      this.inFullScreen = true;
    } else {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.mozCancelFullScreen) await document.mozCancelFullScreen();
      else if (document.msExitFullscreen) await document.msExitFullscreen();
      else if (document.webkitCancelFullScreen) await document.webkitCancelFullScreen();
      this.inFullScreen = false;
    }
  }
  async _handleFullScreenChange() {
    if (this.inFullScreen) {
      this.videoContainer.classList.add("T_M_G-video-full-screen");
    }
    if (!this.inFullScreen || !tmg.queryFullScreen()) {
      this.videoContainer.classList.remove("T_M_G-video-full-screen");
      this.unlock();
      tmg._currentFullScreenController = null;
      this.inFullScreen = false;
      this.toggleMiniPlayerMode();
    }
    this.isMediaMobile && (await this.autolockFullScreenOrientation());
    this.setControlsState("fullscreenlock");
  }
  async autolockFullScreenOrientation() {
    if (this.isModeActive("fullScreen")) {
      await screen.orientation?.lock?.(this.video.videoHeight > this.video.videoWidth ? "portrait" : "landscape");
      this.setControlState(this.DOM.fullScreenOrientationBtn, { hidden: false });
    } else {
      screen.orientation?.unlock?.();
      this.setControlState(this.DOM.fullScreenOrientationBtn, { hidden: true });
    }
  }
  async changeFullScreenOrientation() {
    await screen.orientation?.lock?.(screen.orientation.angle === 0 ? "landscape" : "portrait");
  }
  async togglePictureInPictureMode() {
    if (!this.settings.modes.pictureInPicture) return;
    if (this.inFullScreen) await this.toggleFullScreenMode();
    if (this.settings.beta.floatingPlayer && window.documentPictureInPicture) return this.toggleFloatingPlayer();
    !this.isModeActive("pictureInPicture") ? this.video.requestPictureInPicture() : document.exitPictureInPicture();
  }
  _handleEnterPictureInPicture() {
    this.videoContainer.classList.add("T_M_G-video-picture-in-picture");
    this.showOverlay();
    this.toggleMiniPlayerMode(false);
    this.setMediaSession();
    tmg._pictureInPictureActive = true;
  }
  _handleLeavePictureInPicture() {
    tmg._pictureInPictureActive = false;
    // the video takes a while before it enters back into the player so a timeout is used to prevent the user from seeing the default ui
    setTimeout(() => {
      this.videoContainer.classList.remove("T_M_G-video-picture-in-picture");
      this.toggleMiniPlayerMode();
    }, 180);
    this.delayOverlay();
  }
  toggleFloatingPlayer() {
    if (!this.settings.modes.pictureInPicture || !window.documentPictureInPicture) return;
    if (!this.inFloatingPlayer) this.initFloatingPlayer();
    else this.floatingPlayer?.close();
  }
  async initFloatingPlayer() {
    if (this.inFloatingPlayer) return;
    this.inFloatingPlayer = true;
    documentPictureInPicture.window?.close?.();
    this.toggleMiniPlayerMode(false);
    this.floatingPlayer = await documentPictureInPicture.requestWindow(this.floatingPlayerOptions);
    this.activatePseudoMode();
    this.videoContainer.classList.add("T_M_G-video-progress-bar", "T_M_G-video-floating-player");
    let cssText = "";
    for (const sheet of document.styleSheets) {
      try {
        for (const cssRule of sheet.cssRules) {
          if (cssRule.selectorText?.includes(":root") || cssRule.cssText.includes("T_M_G")) cssText += cssRule.cssText;
        }
      } catch {
        continue;
      }
    }
    this.floatingPlayer?.document.head.appendChild(tmg.createEl("style", { textContent: cssText }));
    this.floatingPlayer?.document.body.append(this.videoContainer);
    if (this.floatingPlayer) {
      this.floatingPlayer.document.documentElement.id = document.documentElement.id;
      this.floatingPlayer.document.documentElement.className = document.documentElement.className;
      document.documentElement.getAttributeNames().forEach((attr) => this.floatingPlayer.document.documentElement.setAttribute(attr, document.documentElement.getAttribute(attr)));
    }
    tmg.DOMMutationObserver.observe(this.floatingPlayer.document.documentElement, { childList: true, subtree: true });
    this.floatingPlayer?.addEventListener("pagehide", this._handleFloatingPlayerClose);
    this.floatingPlayer?.addEventListener("resize", this._handleMediaParentResize);
    this.setKeyEventListeners("floating");
  }
  _handleFloatingPlayerClose() {
    if (!this.inFloatingPlayer) return;
    this.inFloatingPlayer = false;
    this.videoContainer.classList.toggle("T_M_G-video-progress-bar", this.settings.time.progressBar ?? this.isMediaMobile);
    this.videoContainer.classList.remove("T_M_G-video-floating-player");
    this.deactivatePseudoMode();
    this.toggleMiniPlayerMode();
  }
  expandMiniPlayer = () => this.toggleMiniPlayerMode(false, "auto");
  removeMiniPlayer() {
    this.togglePlay(false);
    this.toggleMiniPlayerMode(false);
  }
  toggleMiniPlayerMode(bool, behavior) {
    if (!this.settings.modes.miniPlayer) return;
    // mini player has an actual behavior :)
    const active = this.isModeActive("miniPlayer");
    if ((!active && !this.isModeActive("pictureInPicture") && !this.isModeActive("floatingPlayer") && !this.inFullScreen && !this.parentIntersecting && window.innerWidth >= this.miniPlayerMinWindowWidth && !this.video.paused) || (bool === true && !active)) {
      this.activatePseudoMode();
      this.videoContainer.classList.add("T_M_G-video-mini-player", "T_M_G-video-progress-bar");
      this.videoContainer.addEventListener("mousedown", this.moveMiniPlayer);
      this.videoContainer.addEventListener("touchstart", this.moveMiniPlayer, { passive: false });
    } else if ((active && this.parentIntersecting) || (active && window.innerWidth < this.miniPlayerMinWindowWidth) || (bool === false && active)) {
      if (behavior && tmg.isInWindowView(this.pseudoVideoContainer)) this.pseudoVideoContainer.scrollIntoView({ behavior, block: "center", inline: "center" });
      this.deactivatePseudoMode();
      this.videoContainer.classList.remove("T_M_G-video-mini-player");
      this.videoContainer.classList.toggle("T_M_G-video-progress-bar", this.settings.time.progressBar ?? this.isMediaMobile);
      this.videoContainer.removeEventListener("mousedown", this.moveMiniPlayer);
      this.videoContainer.removeEventListener("touchstart", this.moveMiniPlayer, { passive: false });
    }
  }
  moveMiniPlayer({ target }) {
    if (!this.isModeActive("miniPlayer") || this.DOM.topControlsWrapper.contains(target) || this.DOM.bottomControlsWrapper.contains(target) || this.DOM.cueContainer?.contains(target)) return;
    document.addEventListener("mousemove", this._handleMiniPlayerDragging);
    document.addEventListener("mouseup", this.emptyMiniPlayerListeners);
    document.addEventListener("mouseleave", this.emptyMiniPlayerListeners);
    document.addEventListener("touchmove", this._handleMiniPlayerDragging, { passive: false });
    document.addEventListener("touchend", this.emptyMiniPlayerListeners, { passive: false });
  }
  _handleMiniPlayerDragging(e) {
    if (e.touches?.length > 1) return;
    e.preventDefault();
    this.removeOverlay("force");
    this.videoContainer.classList.add("T_M_G-video-player-dragging");
    this.RAFLoop("miniPlayerDragging", () => {
      let { innerWidth: ww, innerHeight: wh } = window,
        { offsetWidth: w, offsetHeight: h } = this.videoContainer;
      const x = e.clientX ?? e.changedTouches[0].clientX,
        y = e.clientY ?? e.changedTouches[0].clientY,
        posX = tmg.clamp(w / 2, x, ww - w / 2),
        posY = tmg.clamp(h / 2, wh - y, wh - h / 2);
      this.videoCurrentMiniPlayerX = `${(posX / ww) * 100}%`;
      this.videoCurrentMiniPlayerY = `${(posY / wh) * 100}%`;
    });
  }
  emptyMiniPlayerListeners() {
    this.cancelRAFLoop("miniPlayerDragging");
    this.videoContainer.classList.remove("T_M_G-video-player-dragging");
    this.showOverlay();
    document.removeEventListener("mousemove", this._handleMiniPlayerDragging);
    document.removeEventListener("mouseup", this.emptyMiniPlayerListeners);
    document.removeEventListener("mouseleave", this.emptyMiniPlayerListeners);
    document.removeEventListener("touchmove", this._handleMiniPlayerDragging, { passive: false });
    document.removeEventListener("touchend", this.emptyMiniPlayerListeners, { passive: false });
  }
  _handleAnyClick() {
    this.delayOverlay();
    this.stopTimeScrubbing();
  }
  _handleClick({ target }) {
    if (target !== this.DOM.controlsContainer) return;
    if (this.speedCheck && this.playTriggerCounter < 1) return;
    if (this.isMediaMobile && !this.buffering && !this.isModeActive("pictureInPicture")) this.videoContainer.classList.toggle("T_M_G-video-overlay");
    if (this.isMediaMobile || this.isModeActive("miniPlayer")) return;
    this.togglePlay();
    this.video.paused ? this.fire("videopause") : this.fire("videoplay");
    this.showOverlay();
  }
  _handleLockScreenClick() {
    if (!this.locked) return;
    this.videoContainer.classList.toggle("T_M_G-video-locked-overlay");
    this.DOM.screenLockedBtn.classList.remove("T_M_G-video-control-unlock");
    this.delayLockedOverlay();
  }
  _handleRightClick(e) {
    e.preventDefault();
  }
  _handleDoubleClick(e) {
    const { clientX: x, target, detail } = e;
    // this function triggers the forward and backward skip, they then assign the function to the click event, when the trigger is pulled, skipPersist is set to true and the skip is handled by only the click event, if the position of the click changes within the skip interval and when the 'skipPosition' prop is still available, the click event assignment is revoked
    if (target !== this.DOM.controlsContainer) return;
    const rect = this.videoContainer.getBoundingClientRect();
    let pos = x - rect.left > rect.width * 0.65 ? "right" : x - rect.left < rect.width * 0.35 ? "left" : "center";
    if (this.skipPersist && pos !== this.skipPersistPosition) {
      this.deactivateSkipPersist();
      if (detail == 1) return;
    }
    if (pos === "center") {
      this.isMediaMobile || this.isModeActive("miniPlayer") ? this.togglePlay() : this.toggleFullScreenMode();
      return;
    } else {
      if (this.skipPersist && detail == 2) return;
      this.activateSkipPersist(pos);
      pos === "right" ? this.skip(this.settings.time.skip) : this.skip(-this.settings.time.skip);
      tmg.rippleHandler(e, this.currentSkipNotifier);
    }
  }
  activateSkipPersist(pos) {
    if (this.skipPersist) return;
    this.videoContainer.addEventListener("click", this._handleDoubleClick);
    this.skipPersist = true;
    this.skipPersistPosition = pos;
  }
  deactivateSkipPersist() {
    if (!this.skipPersist) return;
    this.videoContainer.removeEventListener("click", this._handleDoubleClick);
    this.skipPersist = false;
    this.skipPersistPosition = null;
  }
  _handleHoverPointerActive({ target }) {
    if (!(this.isMediaMobile && !this.isModeActive("miniPlayer"))) this.showOverlay();
    if (this.DOM.tRightSideControlsWrapper.contains(target) || this.DOM.bottomControlsWrapper.contains(target)) clearTimeout(this.overlayDelayId);
  }
  _handleHoverPointerOut = () => setTimeout(() => !this.isMediaMobile && !this.videoContainer.matches(":hover") && this.removeOverlay());
  showOverlay() {
    if (!this.shouldShowOverlay()) return;
    this.videoContainer.classList.add("T_M_G-video-overlay");
    this.delayOverlay();
  }
  shouldShowOverlay = () => !this.locked && !this.videoContainer.classList.contains("T_M_G-video-player-dragging");
  delayOverlay() {
    clearTimeout(this.overlayDelayId);
    if (this.shouldRemoveOverlay()) this.overlayDelayId = setTimeout(this.removeOverlay, this.settings.overlayDelay);
  }
  removeOverlay = (manner) => (manner === "force" || this.shouldRemoveOverlay()) && this.videoContainer.classList.remove("T_M_G-video-overlay");
  shouldRemoveOverlay = () => !this.video.paused && !this.buffering && !this.isModeActive("pictureInPicture");
  showLockedOverlay() {
    this.videoContainer.classList.add("T_M_G-video-locked-overlay");
    this.delayLockedOverlay();
  }
  removeLockedOverlay() {
    this.videoContainer.classList.remove("T_M_G-video-locked-overlay");
    this.DOM.screenLockedBtn.classList.remove("T_M_G-video-control-unlock");
  }
  delayLockedOverlay() {
    clearTimeout(this.lockOverlayDelayId);
    this.lockOverlayDelayId = setTimeout(this.removeLockedOverlay, this.settings.overlayDelay);
  }
  _handleGestureWheel(e) {
    if (this.overVolume || this.overBrightness || this.overTimeline || (e.target === this.DOM.controlsContainer && this.settings.beta.gestureControls && !this.gestureTouchXCheck && !this.gestureTouchYCheck && !this.speedCheck && !this.locked && !this.disabled && (this.isModeActive("fullScreen") || this.inFloatingPlayer))) {
      e.preventDefault();
      this.gestureWheelTimeoutId ? clearTimeout(this.gestureWheelTimeoutId) : this._handleGestureWheelInit(e);
      this.gestureWheelTimeoutId = setTimeout(this._handleGestureWheelStop, this.gestureWheelTimeout);
      this._handleGestureWheelMove(e);
    }
  }
  _handleGestureWheelInit({ clientX: x, clientY: y }) {
    const rect = this.videoContainer.getBoundingClientRect();
    this.gestureWheelZone = {
      x: x - rect.left > rect.width / 2 ? "right" : "left",
      y: y - rect.left > rect.height / 2 ? "bottom" : "top",
    };
    this.gestureWheelTimePercent = 0;
    this.gestureWheelTimeMultiplier = 1;
    this.gestureTimeMultiplierY = 0;
  }
  _handleGestureWheelMove({ clientX: x, deltaX, deltaY, shiftKey }) {
    deltaX = shiftKey || this.overTimeline ? deltaY : deltaX;
    const rect = this.videoContainer.getBoundingClientRect();
    const width = shiftKey || this.overTimeline ? rect.height : rect.width,
      height = shiftKey || this.overTimeline ? rect.width : rect.height;
    let xPercent = -deltaX / (width * 12);
    xPercent = this.overTimeline ? xPercent : (this.gestureWheelTimePercent += xPercent);
    const xSign = Math.sign(xPercent) === 1 ? "+" : "-";
    xPercent = Math.abs(xPercent);
    if (deltaX || shiftKey || this.overTimeline) {
      if (this.gestureWheelYCheck) return this._handleGestureWheelStop();
      this.gestureWheelXCheck = true;
      if (!this.overTimeline) this.DOM.touchTimelineNotifier.classList.add("T_M_G-video-control-active");
      this._handleGestureTimelineInput({
        percent: xPercent,
        sign: xSign,
        multiplier: this.gestureWheelTimeMultiplier,
      });
      if (shiftKey || this.overTimeline) return;
    }
    if (deltaY) {
      if (this.gestureWheelXCheck || this.overTimeline) {
        const mY = tmg.clamp(0, Math.abs((this.gestureTimeMultiplierY += deltaY)), height * 6);
        this.gestureWheelTimeMultiplier = 1 - mY / (height * 6);
        this._handleGestureTimelineInput({
          percent: xPercent,
          sign: xSign,
          multiplier: this.gestureWheelTimeMultiplier,
        });
        return;
      }
      const currentXZone = x - rect.left > width / 2 ? "right" : "left";
      if (currentXZone !== this.gestureWheelZone.x) return this._handleGestureWheelStop();
      this.gestureWheelYCheck = true;
      if (!this.overVolume && !this.overBrightness) (this.gestureWheelZone?.x === "right" ? this.DOM.touchVolumeNotifier : this.DOM.touchBrightnessNotifier)?.classList.add("T_M_G-video-control-active");
      if (this.overVolume) this.delayVolumeActive();
      if (this.overBrightness) this.delayBrightnessActive();
      const ySign = -deltaY >= 0 ? "+" : "-";
      const yPercent = tmg.clamp(0, Math.abs(deltaY), height * 6) / (height * 6);
      this.gestureWheelZone?.x === "right" || this.overVolume
        ? this._handleGestureVolumeSliderInput({
            percent: yPercent,
            sign: ySign,
          })
        : this._handleGestureBrightnessSliderInput({
            percent: yPercent,
            sign: ySign,
          });
    }
  }
  _handleGestureWheelStop() {
    this.gestureWheelTimeoutId = null;
    if (this.gestureWheelYCheck) {
      this.gestureWheelYCheck = false;
      this.removeOverlay();
      this.DOM.touchVolumeNotifier?.classList.remove("T_M_G-video-control-active");
      this.DOM.touchBrightnessNotifier?.classList.remove("T_M_G-video-control-active");
    }
    if (this.gestureWheelXCheck) {
      this.gestureWheelXCheck = false;
      this.DOM.touchTimelineNotifier?.classList.remove("T_M_G-video-control-active");
      this.currentTime = this.gestureNextTime;
    }
  }
  setGestureTouchCancel = () => (this.gestureTouchCanCancel = true);
  _handleGestureTouchStart(e) {
    if (e.touches?.length > 1) return;
    if (e.target !== this.DOM.controlsContainer) return;
    if (!this.settings.beta.gestureControls || this.isModeActive("miniPlayer") || this.speedCheck) return;
    this._handleGestureTouchEnd();
    this.lastGestureTouchX = e.clientX ?? e.targetTouches[0].clientX;
    this.lastGestureTouchY = e.clientY ?? e.targetTouches[0].clientY;
    this.videoContainer.addEventListener("touchmove", this._handleGestureTouchInit, { once: true, passive: false });
    this.videoContainer.addEventListener("touchmove", this.setGestureTouchCancel, { passive: true }); // tm: if user moves finger like during scrolling
    // tm: changing bool since timeout reached and user is not scrolling
    this.gestureTouchTimeoutId = setTimeout(() => {
      this.videoContainer.removeEventListener("touchmove", this.setGestureTouchCancel, { passive: true });
      this.gestureTouchCanCancel = false;
    }, this.gestureTouchThreshold);
    this.videoContainer.addEventListener("touchend", this._handleGestureTouchEnd);
  }
  _handleGestureTouchInit(e) {
    if (e.touches?.length > 1) return;
    if (!this.settings.beta.gestureControls || this.isModeActive("miniPlayer") || this.speedCheck) return;
    e.preventDefault();
    const rect = this.videoContainer.getBoundingClientRect(),
      x = e.clientX ?? e.targetTouches[0].clientX,
      y = e.clientY ?? e.targetTouches[0].clientY,
      deltaX = Math.abs(this.lastGestureTouchX - x),
      deltaY = Math.abs(this.lastGestureTouchY - y);
    this.gestureTouchZone = {
      x: x - rect.left > rect.width / 2 ? "right" : "left",
      y: y - rect.left > rect.height / 2 ? "bottom" : "top",
    };
    if (deltaX > deltaY * this.gestureTouchFingerRatio) {
      this.gestureTouchXCheck = true;
      this.videoContainer.addEventListener("touchmove", this._handleGestureTouchXMove, { passive: false });
    } else if (deltaY > deltaX * this.gestureTouchFingerRatio) {
      this.gestureTouchYCheck = true;
      this.videoContainer.addEventListener("touchmove", this._handleGestureTouchYMove, { passive: false });
    }
  }
  _handleGestureTouchXMove(e) {
    e.preventDefault();
    if (this.gestureTouchCanCancel) return this._handleGestureTouchEnd();
    else this.DOM.touchTimelineNotifier.classList.add("T_M_G-video-control-active");
    this.throttle(
      "gestureTouchMove",
      () => {
        const width = this.videoContainer.offsetWidth,
          height = this.videoContainer.offsetHeight,
          x = e.clientX ?? e.targetTouches[0].clientX,
          y = e.clientY ?? e.targetTouches[0].clientY,
          deltaX = x - this.lastGestureTouchX,
          deltaY = y - this.lastGestureTouchY,
          sign = deltaX >= 0 ? "+" : "-",
          percent = tmg.clamp(0, Math.abs(deltaX), width) / width,
          mY = tmg.clamp(0, Math.abs(deltaY), height * 0.5),
          multiplier = 1 - mY / (height * 0.5);
        this._handleGestureTimelineInput({ percent, sign, multiplier });
      },
      20,
    );
  }
  _handleGestureTouchYMove(e) {
    e.preventDefault();
    if (!this.isModeActive("fullScreen") && this.gestureTouchCanCancel) return this._handleGestureTouchEnd();
    else (this.gestureTouchZone.x === "right" ? this.DOM.touchVolumeNotifier : this.DOM.touchBrightnessNotifier)?.classList.add("T_M_G-video-control-active");
    this.throttle(
      "gestureTouchMove",
      () => {
        const height = this.videoContainer.offsetHeight,
          y = e.clientY ?? e.targetTouches[0].clientY,
          deltaY = y - this.lastGestureTouchY,
          sign = deltaY >= 0 ? "-" : "+",
          percent = tmg.clamp(0, Math.abs(deltaY), height) / height;
        this.lastGestureTouchY = y;
        this.gestureTouchZone?.x === "right" ? this._handleGestureVolumeSliderInput({ percent, sign }) : this._handleGestureBrightnessSliderInput({ percent, sign });
      },
      20,
    );
  }
  _handleGestureTouchEnd() {
    if (this.gestureTouchXCheck) {
      this.gestureTouchXCheck = false;
      this.videoContainer.removeEventListener("touchmove", this._handleGestureTouchXMove, { passive: false });
      this.DOM.touchTimelineNotifier?.classList.remove("T_M_G-video-control-active");
      if (!this.gestureTouchCanCancel) this.currentTime = this.gestureNextTime;
    }
    if (this.gestureTouchYCheck) {
      this.gestureTouchYCheck = false;
      this.videoContainer.removeEventListener("touchmove", this._handleGestureTouchYMove, { passive: false });
      this.DOM.touchVolumeNotifier?.classList.remove("T_M_G-video-control-active");
      this.DOM.touchBrightnessNotifier?.classList.remove("T_M_G-video-control-active");
      if (!this.gestureTouchCanCancel) this.removeOverlay();
    }
    // tm: changing bool since user is not scrolling
    if (this.gestureTouchTimeoutId) {
      clearTimeout(this.gestureTouchTimeoutId);
      this.videoContainer.removeEventListener("touchmove", this.setGestureTouchCancel, { passive: true });
      this.gestureTouchCanCancel = true;
    }
    this.videoContainer.removeEventListener("touchmove", this._handleGestureTouchInit, { once: true, passive: false });
    this.videoContainer.removeEventListener("touchend", this._handleGestureTouchEnd);
  }
  _handleSpeedPointerDown(e) {
    if (e.target !== this.DOM.controlsContainer) return;
    if (this.isModeActive("miniPlayer")) return;
    this.videoContainer.addEventListener("touchmove", this._handleSpeedPointerUp, { passive: true }); // tm: if user moves finger before speedup is called like during scrolling
    this.videoContainer.addEventListener("mouseup", this._handleSpeedPointerUp);
    this.videoContainer.addEventListener("mouseleave", this._handleSpeedPointerOut);
    this.videoContainer.addEventListener("touchend", this._handleSpeedPointerUp);
    clearTimeout(this.speedTimeoutId);
    this.speedTimeoutId = setTimeout(() => {
      this.videoContainer.removeEventListener("touchmove", this._handleSpeedPointerUp, { passive: true }); // tm: removing listener since timeout reached and user is not scrolling
      this.speedPointerCheck = true;
      const x = e.clientX ?? e.targetTouches[0].clientX;
      const rect = this.videoContainer.getBoundingClientRect();
      this.speedDirection = x - rect.left >= rect.width * 0.5 ? "forwards" : "backwards";
      if (this.settings.beta.rewind) {
        this.videoContainer.addEventListener("mousemove", this._handleSpeedPointerMove);
        this.videoContainer.addEventListener("touchmove", this._handleSpeedPointerMove, { passive: true });
      }
      this.fastPlay(this.speedDirection);
    }, this.fastPlayThreshold);
  }
  _handleSpeedPointerOut = (e) => !this.videoContainer.matches(":hover") && this._handleSpeedPointerUp(e);
  _handleSpeedPointerMove(e) {
    if (e.touches?.length > 1) return;
    this.throttle(
      "speedPointerMove",
      () => {
        const rect = this.videoContainer.getBoundingClientRect();
        const x = e.clientX ?? e.targetTouches[0].clientX;
        const currPos = x - rect.left >= rect.width * 0.5 ? "forwards" : "backwards";
        if (currPos !== this.speedDirection) {
          this.speedDirection = currPos;
          this.slowDown();
          this.fastPlay(this.speedDirection);
        }
      },
      100,
    );
  }
  _handleSpeedPointerUp() {
    this.videoContainer.removeEventListener("mouseup", this._handleSpeedPointerUp);
    this.videoContainer.removeEventListener("mouseleave", this._handleSpeedPointerOut);
    this.videoContainer.removeEventListener("touchend", this._handleSpeedPointerUp);
    if (this.settings.beta.rewind) {
      this.videoContainer.removeEventListener("mousemove", this._handleSpeedPointerMove);
      this.videoContainer.removeEventListener("touchmove", this._handleSpeedPointerMove, { passive: true });
    }
    this.speedPointerCheck = false;
    clearTimeout(this.speedTimeoutId);
    this.videoContainer.removeEventListener("touchmove", this._handleSpeedPointerUp, { passive: true }); // tm: removing listener since user is not scrolling
    if (this.speedCheck && this.playTriggerCounter < 1) setTimeout(this.slowDown);
  }
  fetchKeyShortcutsForDisplay() {
    const shortcuts = {};
    Object.keys(this.settings.keys.shortcuts).forEach((action) => (shortcuts[action] = tmg.formatKeyForDisplay(this.settings.keys.shortcuts[action])));
    return shortcuts;
  }
  getTermsForCombo(combo) {
    const terms = { override: false, block: false, allowed: false, action: null };
    const { overrides, shortcuts, blocks, strictMatches: s } = this.settings.keys;
    if (tmg.matchKeys(overrides, combo, s)) terms.override = true;
    if (tmg.matchKeys(blocks, combo, s)) terms.block = true;
    if (tmg.matchKeys(tmg.WHITE_LISTED_KEYS, combo)) terms.allowed = true; // Allow whitelisted system keys - w
    terms.action = Object.entries(shortcuts).find(([, shortcut]) => tmg.matchKeys(shortcut, combo, s))?.[0] || null; // Find action name for shortcuts
    return terms;
  }
  keyEventAllowed(e) {
    if (this.settings.keys.disabled) return;
    // UI safety checks
    if ((e.key === " " || e.key === "Enter") && e.currentTarget.document.activeElement?.tagName === "BUTTON") return false;
    if (e.currentTarget.document.activeElement?.matches("input,textarea,[contenteditable='true']")) return false;
    const combo = tmg.stringifyKeyCombo(e);
    const { override, block, action, allowed } = this.getTermsForCombo(combo);
    if (block) return false;
    if (override) e.preventDefault();
    if (action) return action;
    if (allowed) return e.key.toLowerCase(); // inner system defaults
    return false; // Not allowed
  }
  _handleKeyDown(e) {
    const action = this.keyEventAllowed(e);
    if (action === false) return;
    this.throttle(
      "keyDown",
      () => {
        switch (action) {
          case " ": // -w
          case "playPause":
            this.playTriggerCounter++;
            if (this.playTriggerCounter === 1) e.currentTarget.addEventListener("keyup", this._handlePlayTriggerUp);
            if (this.playTriggerCounter === 2 && !this.speedPointerCheck) e.shiftKey ? this.fastPlay("backwards") : this.fastPlay("forwards");
            break;
          case "prev":
            this.previousVideo();
            this.fire("videoprev");
            break;
          case "next":
            this.nextVideo();
            this.fire("videonext");
            break;
          case "skipBwd":
            this.deactivateSkipPersist();
            this.skip(-this.settings.time.skip);
            this.fire("bwd");
            break;
          case "skipFwd":
            this.deactivateSkipPersist();
            this.skip(this.settings.time.skip);
            this.fire("fwd");
            break;
          case "stepBwd":
            this.moveVideoFrame("backwards");
            break;
          case "stepFwd":
            this.moveVideoFrame("forwards");
            break;
          case "objectFit":
            if (!this.isModeActive("pictureInPicture")) this.rotateObjectFit();
            break;
          case "volumeUp":
            this.changeVolume(this.settings.volume.skip);
            break;
          case "volumeDown":
            this.changeVolume(-this.settings.volume.skip);
            break;
          case "brightnessUp":
            this.changeBrightness(this.settings.brightness.skip);
            break;
          case "brightnessDown":
            this.changeBrightness(-this.settings.brightness.skip);
            break;
          case "playbackRateUp":
            this.changePlaybackRate(this.settings.playbackRate.skip);
            break;
          case "playbackRateDown":
            this.changePlaybackRate(-this.settings.playbackRate.skip);
            break;
          case "captionsFontSizeUp":
            this.changeCaptionsFontSize(this.settings.captions.font.size.skip);
            break;
          case "captionsFontSizeDown":
            this.changeCaptionsFontSize(-this.settings.captions.font.size.skip);
            break;
          case "captionsFontWeight":
          case "captionsFontVariant":
          case "captionsFontFamily":
          case "captionsFontOpacity":
          case "captionsBackgroundOpacity":
          case "captionsWindowOpacity":
          case "captionsCharacterEdgeStyle":
            this[`rotate${tmg.capitalize(action)}`]?.();
            break;
          case "escape": // -w
            this.isModeActive("miniPlayer") && this.removeMiniPlayer();
            this.isModeActive("floatingPlayer") && this.togglePictureInPictureMode();
            break;
          case "arrowup": // -w
            e.shiftKey ? this.changeVolume(10) : this.changeVolume(5);
            break;
          case "arrowdown": // -w
            e.shiftKey ? this.changeVolume(-10) : this.changeVolume(-5);
            break;
          case "arrowleft": // -w
            this.deactivateSkipPersist();
            e.shiftKey ? this.skip(-10) : this.skip(-5);
            this.fire("bwd");
            break;
          case "arrowright": // -w
            this.deactivateSkipPersist();
            e.shiftKey ? this.skip(10) : this.skip(5);
            this.fire("fwd");
            break;
        }
      },
      10,
    );
  }
  _handleKeyUp(e) {
    const action = this.keyEventAllowed(e);
    if (action === false) return;
    switch (action) {
      case "capture":
        this.exportVideoFrame(e.altKey);
        break;
      case "timeMode":
        this.toggleTimeMode();
        break;
      case "timeFormat":
        this.toggleTimeFormat();
        break;
      case "mute":
        this.toggleMute("auto");
        this.volume === 0 ? this.fire("volumemuted") : this.fire("volumeup");
        break;
      case "dark":
        this.toggleDark("auto");
        this.brightness === 0 ? this.fire("brightnessdark") : this.fire("brightnessup");
        break;
      case "captions":
        this.toggleCaptions();
        if (this.video.textTracks[this.textTrackIndex]) this.fire("captions");
        break;
      case "pictureInPicture":
        this.togglePictureInPictureMode();
        break;
      case "theater":
        if (!this.isMediaMobile && !this.inFullScreen && !this.isModeActive("miniPlayer") && !this.isModeActive("floatingPlayer")) this.toggleTheaterMode();
        break;
      case "fullScreen":
        this.toggleFullScreenMode();
        break;
      case "settings":
        this.toggleSettingsView();
        break;
      case "home": // -w
      case "0": // -w
        this.moveVideoTime({ to: "start" });
        break;
      case "1": // -w
      case "2": // -w
      case "3": // -w
      case "4": // -w
      case "5": // -w
      case "6": // -w
      case "7": // -w
      case "8": // -w
      case "9": // -w
        this.moveVideoTime({ to: e.key, max: 10 });
        break;
      case "end": // -w
        this.moveVideoTime({ to: "end" });
        break;
    }
  }
  _handlePlayTriggerUp(e) {
    const action = this.keyEventAllowed(e);
    switch (action) {
      case " ": // -w
      case "playPause":
        e.stopImmediatePropagation();
        if (this.playTriggerCounter === 1) {
          this.togglePlay();
          this.video.paused ? this.fire("videopause") : this.fire("videoplay");
        }
      default:
        if (this.speedCheck && this.playTriggerCounter > 1 && !this.speedPointerCheck) this.slowDown();
        this.playTriggerCounter = 0;
    }
    e.currentTarget.removeEventListener("keyup", this._handlePlayTriggerUp);
  }
  _handleDragStart({ target, dataTransfer }) {
    dataTransfer.effectAllowed = "move";
    target.classList.add("T_M_G-video-control-dragging");
    this.dragging = target.classList.contains("T_M_G-video-vb-btn") ? target.parentElement : target;
  }
  _handleDrag = () => this.delayOverlay();
  _handleDragEnd({ target }) {
    this.showOverlay();
    target.classList.remove("T_M_G-video-control-dragging");
    this.dragging = null;
    this.settings.controlPanel = { top: Array.from(this.DOM.tRightSideControlsWrapper?.children ?? [], (el) => el.dataset.controlId), bottom: [...Array.from(this.DOM.bLeftSideControlsWrapper?.children ?? [], (el) => el.dataset.controlId), "spacer", ...Array.from(this.DOM.bRightSideControlsWrapper?.children ?? [], (el) => el.dataset.controlId)] };
  }
  _handleDragEnter = ({ target }) => target.dataset.dropZone && this.dragging && target.classList.add("T_M_G-video-dragover");
  _handleDragOver(e) {
    if (e.target.dataset.dropZone && this.dragging) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      this.throttle(
        "dragOver",
        () => {
          const afterControl = this.getControlAfterDragging(e.target, e.clientX);
          if (afterControl) e.target?.insertBefore(this.dragging, afterControl);
          else e.target.appendChild(this.dragging);
          this.updateSideControls(e);
        },
        20,
      );
    }
  }
  _handleDrop(e) {
    if (!e.target?.dataset.dropZone) return;
    e.preventDefault();
    e.target.classList.remove("T_M_G-video-dragover");
  }
  _handleDragLeave = ({ target }) => target?.dataset.dropZone && target.classList.remove("T_M_G-video-dragover");
  getControlAfterDragging(container, x) {
    const draggables = [...container.querySelectorAll("[draggable=true]:not(.T_M_G-video-control-dragging, .T_M_G-video-vb-btn), .T_M_G-video-vb-container:has([draggable=true])")];
    return draggables.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
      },
      { offset: -Infinity },
    ).element;
  }
}

class T_M_G_Media_Player {
  #active = false;
  #medium;
  #build = structuredClone(tmg.DEFAULT_VIDEO_BUILD);

  constructor(customOptions = {}) {
    this.Controller = this.#medium = null;
    this.configure(customOptions);
  }
  get build() {
    return this.#build;
  }
  set build(customOptions) {
    this.configure(customOptions);
  }
  queryBuild() {
    if (!this.#active) return true;
    console.error("TMG has already deployed the custom controls of your build configuration");
    console.warn("Consider setting your build configuration before attaching your media element");
    return false;
  }
  configure(customOptions) {
    if (!this.queryBuild() || !tmg.isObj(customOptions)) return;
    this.#build = tmg.mergeObjs(this.#build, customOptions);
    const s = this.#build.settings;
    Object.entries(s.keys.shortcuts).forEach(([k, v]) => (s.keys.shortcuts[k] = tmg.cleanKeyCombo(v)));
    s.keys.blocks = tmg.cleanKeyCombo(s.keys.blocks);
    s.keys.overrides = tmg.cleanKeyCombo(s.keys.overrides);
  }
  async attach(medium) {
    if (tmg.isIter(medium)) {
      console.error("An iterable argument cannot be attached to the TMG media player");
      console.warn("Consider looping the iterable argument to get a single argument and instantiate a new 'tmg.Player' for each");
    } else if (!this.#active) {
      medium.tmgPlayer?.detach();
      medium.tmgPlayer = this;
      this.#medium = medium;
      await this.fetchCustomOptions();
      await this.#deployController();
    }
  }
  detach() {
    if (!this.#active) return;
    this.#medium = this.Controller?._destroy();
    if (tmg.Controllers.indexOf(this.Controller) !== -1) tmg.Controllers?.splice(tmg.Controllers.indexOf(this.Controller), 1);
    this.#medium.tmgcontrols = this.#active = false;
    this.Controller = this.#medium = this.#medium.tmgPlayer = null;
  }
  async fetchCustomOptions() {
    let fetchedControls;
    if (this.#medium.getAttribute("tmg")?.includes(".json")) {
      fetchedControls = fetch(this.#medium.getAttribute("tmg"))
        .then((res) => {
          if (!res.ok) throw new Error(`TMG could not find provided JSON file!. Status: ${res.status}`);
          return res.json();
        })
        .catch(({ message }) => {
          console.error(`${message}`);
          console.warn("TMG requires a valid JSON file for parsing your build configuration");
        });
    }
    const customOptions = (await fetchedControls) ?? {};
    const attributes = this.#medium.getAttributeNames().filter((attr) => attr.startsWith("tmg--"));
    const specialProps = ["tmg--media--artwork", "tmg--playlist"];
    attributes?.forEach((attr) => !specialProps.some((sp) => attr.includes(sp)) && tmg.putHTMLOptions(attr, customOptions, this.#medium));
    if (this.#medium.poster || attributes.includes("tmg--media--artwork")) customOptions.media = { ...(customOptions.media || {}), artwork: [{ src: this.#medium.getAttribute("tmg--media--artwork") ?? this.#medium.poster }] };
    if (this.#active) {
      if (customOptions?.settings) Object.entries(customOptions.settings).forEach(([setting, value]) => (this.Controller.settings[setting] = value));
    } else this.configure(customOptions);
  }
  async #deployController() {
    if (this.#active) return;
    if (!(this.#medium instanceof HTMLVideoElement)) {
      console.error(`TMG could not deploy custom controls on the '${this.#medium.tagName}' element as it is not supported`);
      return console.warn("TMG only supports the 'VIDEO' element currently");
    }
    this.#medium.controls = false;
    this.#medium.tmgcontrols = this.#active = true;
    this.#medium.classList.add("T_M_G-video", "T_M_G-media");
    const s = this.#build.settings; // doing some cleanup to the settings
    this.#build.video = this.#medium;
    this.#build.mediaPlayer = "TMG";
    this.#build.mediaType = "video";
    this.#medium.playsInline = s.playsInline ??= this.#medium.playsInline;
    this.#medium.toggleAttribute("webkit-playsinline", s.playsInline);
    this.#medium.autoplay = s.auto.play ??= this.#medium.autoplay;
    this.#medium.muted = s.volume.muted ??= this.#medium.muted;
    this.#medium.loop = s.time.loop ??= this.#medium.loop;
    if (this.#build.playlist?.[0]) {
      const v = this.#build.playlist[0];
      tmg.assignDef(this.#build, v, "src");
      tmg.assignDef(this.#build, v, "sources");
      tmg.assignDef(this.#build, v, "tracks");
      if (v.media) this.#build.media = { ...this.#build.media, ...v.media };
      tmg.assignDef(s.time, v.settings?.time, "start");
      tmg.assignDef(s.time, v.settings?.time, "end");
      if (v.settings?.time?.previews !== undefined) s.time.previews = tmg.isObj(v.settings.time.previews) && tmg.isObj(s.time.previews) ? { ...s.time.previews, ...v.settings.time.previews } : v.settings.time.previews;
    }
    Object.entries(s.modes).forEach(([k, v]) => (s.modes[k] = v && (tmg[`supports${tmg.capitalize(k)}`]?.() ?? true)));
    s.status = { allowOverride: {} };
    Object.keys(s).forEach((k) => {
      if (k !== "allowOverride") s.status.allowOverride[k] = s.allowOverride.includes?.(k.toLowerCase()) ?? s.allowOverride;
    });
    const { controlPanel: panelO, notifers: notifiersO } = s.status.allowOverride,
      sIndex = s.controlPanel.bottom?.indexOf?.("spacer");
    s.status.ui = {
      notifiers: s.notifiers || notifiersO,
      timeline: /top|bottom/.test(s.time.linePosition),
      previews: s.time.previews?.address && s.time.previews?.spf,
      tRightSideControls: s.controlPanel.top?.length || structO,
      bLeftSideControls: (sIndex > -1 ? s.controlPanel.bottom?.slice?.(0, sIndex)?.length : false) || panelO,
      bRightSideControls: (sIndex > -1 ? s.controlPanel.bottom?.slice?.(sIndex + 1)?.length : false) || panelO,
      draggable: panelO,
    };
    tmg.ALLOWED_CONTROLS.forEach((c) => (s.status.ui[c] = Object.entries(s.controlPanel).some(([k, v]) => v.includes?.(c.toLowerCase()) ?? s.controlPanel[k])));
    this.#build.video = this.#medium;
    await tmg.loadResource(tmg.VIDEO_CSS_SRC);
    this.Controller = new T_M_G_Video_Controller(this.#build);
    tmg.Controllers.push(this.Controller);
  }
}

class T_M_G {
  static DEFAULT_VIDEO_BUILD = {
    mediaPlayer: "TMG",
    mediaType: "video",
    disabled: false,
    initialState: true,
    debug: true,
    settings: {
      allowOverride: true,
      auto: { play: null, captions: true, next: 10 },
      beta: { rewind: true, gestureControls: true, floatingPlayer: true },
      brightness: { min: 0, max: 150, value: 100, skip: 5 },
      captions: {
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
      },
      controlPanel: {
        top: ["capture", "fullscreenlock", "fullscreenorientation"],
        bottom: ["prev", "playpause", "next", "brightness", "volume", "timeandduration", "spacer", "captions", "settings", "objectfit", "pictureinpicture", "theater", "fullscreen"],
      },
      errorMessages: { 1: "The video playback was aborted :(", 2: "The video failed due to a network error :(", 3: "The video could not be decoded :(", 4: "The video source is not supported :(" },
      keys: {
        disabled: false,
        strictMatches: false,
        overrides: [" ", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"],
        shortcuts: {
          prev: "Shift+p",
          next: "Shift+n",
          playPause: "k",
          skipBwd: "j",
          skipFwd: "l",
          stepFwd: ".",
          stepBwd: ",",
          mute: "m",
          dark: "d",
          volumeUp: "ArrowUp",
          volumeDown: "ArrowDown",
          brightnessUp: "y",
          brightnessDown: "h",
          playbackRateUp: ">",
          playbackRateDown: "<",
          timeFormat: "z",
          timeMode: "q",
          capture: "s",
          objectFit: "a",
          pictureInPicture: "i",
          theater: "t",
          fullScreen: "f",
          captions: "c",
          captionsFontSizeUp: "=",
          captionsFontSizeDown: "-",
          captionsFontFamily: "u",
          captionsFontWeight: "g",
          captionsFontVariant: "v",
          captionsFontOpacity: "o",
          captionsBackgroundOpacity: "b",
          captionsWindowOpacity: "w",
          captionsCharacterEdgeStyle: "e",
          settings: "?",
        },
        blocks: [
          // Tab navigation
          "Ctrl+Tab",
          "Ctrl+Shift+Tab",
          "Ctrl+PageUp",
          "Ctrl+PageDown",
          "Cmd+Option+ArrowRight",
          "Cmd+Option+ArrowLeft",
          "Ctrl+1",
          "Ctrl+2",
          "Ctrl+3",
          "Ctrl+4",
          "Ctrl+5",
          "Ctrl+6",
          "Ctrl+7",
          "Ctrl+8",
          "Ctrl+9",
          "Cmd+1",
          "Cmd+2",
          "Cmd+3",
          "Cmd+4",
          "Cmd+5",
          "Cmd+6",
          "Cmd+7",
          "Cmd+8",
          "Cmd+9",
          // Navigation
          "Alt+ArrowLeft",
          "Alt+ArrowRight",
          "Cmd+ArrowLeft",
          "Cmd+ArrowRight",
          // Refresh
          "Ctrl+r",
          "Ctrl+Shift+r",
          "F5",
          "Shift+F5",
          "Cmd+r",
          "Cmd+Shift+r",
          // History / Bookmarks / Find
          "Ctrl+h",
          "Ctrl+j",
          "Ctrl+d",
          "Ctrl+f",
          "Cmd+y",
          "Cmd+Option+b",
          "Cmd+d",
          "Cmd+f",
          // Dev Tools / Source View
          "Ctrl+Shift+i",
          "Ctrl+Shift+j",
          "Ctrl+Shift+c",
          "Ctrl+u",
          "F12",
          "Cmd+Option+i",
          "Cmd+Option+j",
          "Cmd+Option+c",
          "Cmd+Option+u",
          // Zoom
          "Ctrl+=",
          "Ctrl+-",
          "Ctrl+0",
          "Cmd+=",
          "Cmd+-",
          "Cmd+0",
          // Print / Save / Open
          "Ctrl+p",
          "Ctrl+s",
          "Ctrl+o",
          "Cmd+p",
          "Cmd+s",
          "Cmd+o",
        ],
      },
      modes: { fullScreen: true, theater: true, pictureInPicture: true, miniPlayer: true },
      notifiers: true,
      overlayDelay: 3000,
      persist: true,
      playbackRate: { min: 0.25, max: 8, value: null, skip: 0.25, fast: 2 },
      playsInline: true,
      time: { linePosition: "top", progressBar: null, previews: false, mode: "elapsed", format: "digital", start: null, end: null, skip: 10 },
      volume: { min: 0, max: 300, value: null, skip: 5 },
    },
  };
  static ALLOWED_CONTROLS = ["capture", "fullScreenOrientation", "fullScreenLock", "prev", "playPause", "next", "brightness", "volume", "timeAndDuration", "spacer", "playbackRate", "captions", "settings", "objectFit", "pictureInPicture", "theater", "fullScreen"];
  static NOTIFIER_EVENTS = ["videoplay", "videopause", "videoprev", "videonext", "playbackrateup", "playbackratedown", "volumeup", "volumedown", "volumemuted", "brightnessup", "brightnessdown", "brightnessdark", "objectfitcontain", "objectfitcover", "objectfitfill", "captions", "capture", "theater", "fullScreen", "fwd", "bwd"];
  static WHITE_LISTED_KEYS = [" ", "Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => k.toLowerCase());
  static _resourceCache = {};
  static _isDocTransient = false;
  static _audioContext = null;
  static _internalMutationSet = new WeakSet();
  static _internalMutationId = null;
  static _currentAudioGainNode = null;
  static _currentFullScreenController = null;
  static _pictureInPictureActive = false;
  static get VIDEO_CSS_SRC() {
    return window.TMG_VIDEO_CSS_SRC || "/TMG_MEDIA_PROTOTYPE/prototype-2/prototype-2-video.css";
  }
  static get VIDEO_ALT_IMG_SRC() {
    return window.TMG_VIDEO_ALT_IMG_SRC || "/TMG_MEDIA_PROTOTYPE/assets/icons/movie-tape.png";
  }
  static get userSettings() {
    return localStorage.tmgUserVideoSettings ? JSON.parse(localStorage.tmgUserVideoSettings) : {};
  }
  static set userSettings(customSettings) {
    localStorage.tmgUserVideoSettings = JSON.stringify(customSettings);
  }
  static activateInternalMutation = (m, check = true) => !tmg._internalMutationSet.has(m) && check && tmg._internalMutationSet.add(m);
  static deactivateInternalMutation(m) {
    clearTimeout(tmg._internalMutationId);
    tmg._internalMutationId = setTimeout(() => {
      tmg._internalMutationSet.delete(m);
      tmg._internalMutationId = null;
    });
  }
  static mountMedia() {
    Object.defineProperty(HTMLVideoElement.prototype, "tmgcontrols", {
      get: () => this.hasAttribute("tmgcontrols"),
      set: async function (value) {
        const bool = Boolean(value);
        if (bool) {
          tmg.activateInternalMutation(this);
          await (this.tmgPlayer || new tmg.Player()).attach(this);
          this.setAttribute("tmgcontrols", "");
          tmg.deactivateInternalMutation(this);
        } else {
          tmg.activateInternalMutation(this, this.hasAttribute("tmgcontrols"));
          this.removeAttribute("tmgcontrols");
          this.tmgPlayer?.detach();
          tmg.deactivateInternalMutation(this);
        }
      },
      enumerable: true,
      configurable: true,
    });
  }
  static unmountMedia = () => delete HTMLVideoElement.tmgcontrols;
  static init() {
    tmg.mountMedia();
    ["pointerdown", "keydown"].forEach((e) =>
      document.addEventListener(e, () => {
        tmg._isDocTransient = true;
        tmg.startAudioManager();
      }),
    );
    for (const medium of document.querySelectorAll("video")) {
      tmg.VIDMutationObserver.observe(medium, { attributes: true, childList: true, subtree: true });
      medium.tmgcontrols = medium.hasAttribute("tmgcontrols");
    }
    tmg.DOMMutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", tmg._handleWindowResize);
    document.addEventListener("fullscreenchange", tmg._handleFullScreenChange);
    document.addEventListener("webkitfullscreenchange", tmg._handleFullScreenChange);
    document.addEventListener("mozfullscreenchange", tmg._handleFullScreenChange);
    document.addEventListener("msfullscreenchange", tmg._handleFullScreenChange);
    document.addEventListener("visibilitychange", tmg._handleVisibilityChange);
  }
  static intersectionObserver =
    typeof window !== "undefined" &&
    new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          target.classList.contains("T_M_G-media") ? target.tmgPlayer?.Controller?._handleMediaIntersectionChange(isIntersecting) : target.querySelector(".T_M_G-media")?.tmgPlayer?.Controller?._handleMediaParentIntersectionChange(isIntersecting);
        }
      },
      { root: null, rootMargin: "0px", threshold: 0.3 },
    );
  static resizeObserver =
    typeof window !== "undefined" &&
    new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const controller = target.classList.contains("T_M_G-media") ? target.tmgPlayer?.Controller : (target.querySelector(".T_M_G-media") || target.closest(".T_M_G-media-container")?.querySelector(".T_M_G-media"))?.tmgPlayer?.Controller;
        controller?._handleResize(target);
      }
    });
  static VIDMutationObserver =
    typeof window !== "undefined" &&
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          if (mutation.target.tagName === "VIDEO") {
            if (mutation.attributeName === "tmgcontrols") {
              if (!tmg._internalMutationSet.has(mutation.target)) mutation.target.tmgcontrols = mutation.target.hasAttribute("tmgcontrols");
            } else if (mutation.attributeName?.startsWith("tmg")) {
              if (mutation.target.hasAttribute(mutation.attributeName)) mutation.target.tmgPlayer?.fetchCustomOptions();
            }
          }
        } else if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node.nodeName === "TRACK") mutation.target.tmgPlayer?.Controller?.setCaptionsState?.();
          }
          for (const node of mutation.removedNodes) {
            if (node.nodeName === "TRACK") mutation.target.tmgPlayer?.Controller?.setCaptionsState?.();
          }
        }
      }
    });
  static DOMMutationObserver =
    typeof window !== "undefined" &&
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node.tagName || !(node.matches("video:not(.T_M_G-media") || node.querySelector("video:not(.T_M_G-media)"))) continue;
          const nodes = [...(node.querySelector("video:not(.T_M_G-media)") ? node.querySelectorAll("video:not(.T_M_G-media)") : [node])];
          for (const node of nodes) {
            tmg.VIDMutationObserver.observe(node, { attributes: true, childList: true, subtree: true });
            node.tmgcontrols = node.hasAttribute("tmgcontrols");
          }
        }
        for (const node of mutation.removedNodes) {
          if (!node.tagName || !(node.matches("video.T_M_G-media") || node.querySelector("video.T_M_G-media")) || tmg.isInDOM(node)) continue;
          const nodes = [...(node.querySelector("video.T_M_G-media") ? node.querySelectorAll("video.T_M_G-media") : [node])];
          for (const node of nodes) {
            if (!node.tmgPlayer?.Controller?.mutatingDOM) node.tmgcontrols = false;
          }
        }
      }
    });
  static _handleWindowResize = () => tmg.Controllers?.forEach((c) => c._handleWindowResize());
  static _handleVisibilityChange = () => tmg.Controllers?.forEach((c) => c._handleVisibilityChange());
  static _handleFullScreenChange = () => tmg._currentFullScreenController?._handleFullScreenChange();
  static startAudioManager() {
    if (!tmg._audioContext && tmg._isDocTransient) {
      tmg._audioContext = new (AudioContext || webkitAudioContext)();
      tmg.Controllers?.forEach((c) => c.setUpAudio());
    } else if (tmg._audioContext?.state === "suspended") tmg._audioContext.resume();
  }
  static connectMediaToAudioManager(medium) {
    if (!tmg._audioContext) return "unavailable";
    medium.audioSourceNode ||= tmg._audioContext.createMediaElementSource(medium);
    medium.audioGainNode ||= tmg._audioContext.createGain();
    medium.audioSourceNode.connect(medium.audioGainNode);
    if (!medium.paused) tmg.connectAudio(medium.audioGainNode);
  }
  static connectAudio(gainNode) {
    if (!gainNode || tmg._currentAudioGainNode === gainNode) return;
    tmg._currentAudioGainNode?.disconnect();
    tmg._currentAudioGainNode = gainNode;
    gainNode.connect(tmg._audioContext.destination);
  }
  static queryMediaMobile = (strict = true) => (strict ? /Mobi|Android|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent) : matchMedia("(max-width: 480px), (max-width: 940px) and (max-height: 480px) and (orientation: landscape)").matches);
  static queryFullScreen = () => !!(document.fullscreenElement || document.fullScreen || document.webkitIsFullScreen || document.mozFullScreen || document.msFullscreenElement);
  static supportsFullScreen = () => !!(document.fullscreenEnabled || document.mozFullScreenEnabled || document.msFullscreenEnabled || document.webkitSupportsFullscreen || document.webkitFullscreenEnabled || HTMLVideoElement.prototype.webkitEnterFullScreen);
  static supportsPictureInPicture = () => !!(document.pictureInPictureEnabled || HTMLVideoElement.prototype.requestPictureInPicture || window.documentPictureInPicture);
  static loadResource(src, type = "style", options = {}) {
    const { module = false, media, crossorigin, integrity } = options;
    if (tmg._resourceCache[src]) return tmg._resourceCache[src];
    const isLoaded = (() => {
      if (type === "script") {
        return [...document.scripts].some((s) => s.src?.includes(src));
      } else if (type === "style") {
        return [...document.styleSheets].some((s) => s.href?.includes(src));
      }
      return false;
    })();
    if (isLoaded) return Promise.resolve(null);
    tmg._resourceCache[src] = new Promise((resolve, reject) => {
      if (type === "script") {
        const script = tmg.createEl("script", { src, crossOrigin: crossorigin, integrity, onload: () => resolve(script), onerror: () => reject(new Error(`Script load error: ${src}`)) });
        if (module) script.type = "module";
        document.body.append(script);
      } else if (type === "style") {
        const link = tmg.createEl("link", { rel: "stylesheet", href: src, media, onload: () => resolve(link), onerror: () => reject(new Error(`Stylesheet load error: ${src}`)) });
        document.head.append(link);
      } else {
        reject(new Error(`Unsupported type: ${type}`));
      }
    });
    return tmg._resourceCache[src];
  }
  static compareSrcs(src1, src2) {
    try {
      return typeof src1 !== "string" || !src1.length || typeof src2 !== "string" || !src2.length ? false : decodeURIComponent(new URL(src1, window.location.href)?.pathname) === decodeURIComponent(new URL(src2, window.location.href)?.pathname);
    } catch {
      return false;
    }
  }
  static addSources(sources, medium) {
    const addSource = (source, medium) => {
      const sourceElement = tmg.createEl("source");
      tmg.putSourceDetails(source, sourceElement);
      medium.appendChild(sourceElement);
    };
    tmg.isIter(sources) ? sources.forEach((source) => addSource(source, medium)) : addSource(sources, medium);
  }
  static getSources(medium) {
    const sources = medium.querySelectorAll("source"),
      _sources = [];
    sources.forEach((source) => {
      const obj = {};
      tmg.putSourceDetails(source, obj);
      _sources.push(obj);
    });
    return _sources;
  }
  static putSourceDetails(source, sourceElement) {
    if (source.src) sourceElement.src = source.src;
    if (source.type) sourceElement.type = source.type;
    if (source.media) sourceElement.media = source.media;
  }
  static removeSources = (medium) => medium?.querySelectorAll("source")?.forEach((source) => source.remove());
  static addTracks(tracks, medium) {
    const addTrack = (track, medium) => {
      const trackElement = tmg.createEl("track");
      tmg.putTrackDetails(track, trackElement);
      medium.appendChild(trackElement);
    };
    tmg.isIter(tracks) ? tracks.forEach((track) => addTrack(track, medium)) : addTrack(tracks, medium);
  }
  static getTracks(medium) {
    const tracks = medium.querySelectorAll("track[kind='captions'], track[kind='subtitles']"),
      _tracks = [];
    tracks.forEach((track) => {
      const obj = {};
      tmg.putTrackDetails(track, obj);
      _tracks.push(obj);
    });
    return _tracks;
  }
  static putTrackDetails(track, trackElement) {
    if (track.kind) trackElement.kind = track.kind;
    if (track.label) trackElement.label = track.label;
    if (track.srclang) trackElement.srclang = track.srclang;
    if (track.src) trackElement.src = track.src;
    if (track.default) trackElement.default = track.default;
    if (track.id) trackElement.id = track.id;
  }
  static removeTracks = (medium) => medium.querySelectorAll("track")?.forEach((track) => (track.kind == "subtitles" || track.kind == "captions") && track.remove());
  static putHTMLOptions(attr, optionsObject, medium) {
    const parts = attr
      .replace("tmg--", "")
      .split("--")
      .map((p) => tmg.camelize(p));
    let currObj = optionsObject;
    parts.forEach((part, index) => {
      if (!currObj[part]) {
        if (index === parts.length - 1) {
          let value = medium.getAttribute(attr);
          if (value.includes(",")) value = value.split(",")?.map((val) => val.replace(/\s+/g, ""));
          else if (/^(true|false|null|\d+)$/.test(value)) value = JSON.parse(value);
          currObj[part] = value;
        } else currObj[part] = {};
      }
      currObj = currObj[part];
    });
  }
  static parseConfig(node) {
    const result = {};
    for (const key of Object.keys(node)) {
      const entry = node[key];
      if (!tmg.isObj(entry)) continue;
      result[key] = entry.options
        ? {
            values: entry.options.map((opt) => opt.value ?? opt),
            displays: entry.options.map((opt) => opt.display ?? String(opt)),
          }
        : tmg.parseConfig(entry); // recurse on sub-branch
    }
    return result;
  }
  static isIter = (obj) => obj != null && typeof obj[Symbol.iterator] === "function";
  static isObj = (obj) => typeof obj === "object" && obj != null && !tmg.isArr(obj);
  static isArr = (arr) => Array.isArray(arr);
  static isInDOM = (el) => el.ownerDocument.documentElement.contains(el);
  static isInWindowView(el, axis = "y") {
    const rect = el.getBoundingClientRect(),
      inX = rect.right >= 0 && rect.left <= (window.innerWidth || document.documentElement.clientWidth),
      inY = rect.bottom >= 0 && rect.top <= (window.innerHeight || document.documentElement.clientHeight);
    return axis === "x" ? inY : axis === "y" ? inX : inY && inX;
  }
  static isValidNumber = (number) => !isNaN(number ?? NaN) && number !== Infinity;
  static clamp = (min = 0, amount, max = Infinity) => Math.min(Math.max(amount, min), max);
  static remToPx = (val) => parseFloat(getComputedStyle(document.documentElement).fontSize * val);
  static parseNumber = (number, fallback = 0) => (tmg.isValidNumber(number) ? number : fallback);
  static parseCSSTime = (time) => (time.endsWith("ms") ? parseFloat(time) : parseFloat(time) * 1000);
  static parseCSSUnit = (val) => (val.endsWith("px") ? parseFloat(val) : tmg.remToPx(parseFloat(val)));
  static assignDef(target, source = {}, key) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  static chunkArr(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
  static mergeObjs(o1 = {}, o2 = {}) {
    const merged = { ...o1, ...o2 };
    Object.keys(merged).forEach((k) => {
      if (tmg.isObj(o1[k]) && tmg.isObj(o2[k])) merged[k] = tmg.mergeObjs(o1[k], o2[k]);
    });
    return merged;
  }
  static formatTime(time, format = "digital", showMs = false, remaining = false) {
    if (!this.isValidNumber(time)) return format === "human" ? "--" : "-:--";
    const pad = (v, n = 2) => String(v).padStart(n, "0");
    const s = Math.floor(Math.abs(time) % 60),
      m = Math.floor(Math.abs(time) / 60) % 60,
      h = Math.floor(Math.abs(time) / 3600),
      ms = Math.floor((Math.abs(time) % 1) * 1000);
    if (format === "digital") {
      const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
      return remaining ? `-${base}` : base;
    }
    const base = h ? `${h}h${pad(m)}m${pad(s)}s` : `${m}m${pad(s)}s`;
    const msPart = showMs && ms ? pad(ms, 3) + "ms" : "";
    return remaining ? `${base}${msPart} left` : `${base}${msPart}`;
  }
  static capitalize = (word = "") => word.charAt(0).toUpperCase() + word.slice(1);
  static camelize = (str = "", separatorRegex = /[\s_\-]+/) => str.toLowerCase().replace(new RegExp(`${separatorRegex.source}(\\w)?`, "g"), (_, chr) => (chr ? chr.toUpperCase() : ""));
  static uncamelize = (str = "", separator = " ") => str.replace(/([a-z])([A-Z])/g, `$1${separator}$2`).toLowerCase();
  static mockAsync = (timeout = 250) => new Promise((resolve) => setTimeout(resolve, timeout));
  static parseKeyCombo(combo) {
    const parts = combo.toLowerCase().split("+");
    return {
      ctrlKey: parts.includes("ctrl"),
      shiftKey: parts.includes("shift"),
      altKey: parts.includes("alt"),
      metaKey: parts.includes("meta") || parts.includes("cmd"),
      key: parts.find((p) => !["ctrl", "shift", "alt", "meta", "cmd"].includes(p)) || "",
    };
  }
  static stringifyKeyCombo(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    if (e.metaKey) parts.push("meta");
    parts.push(e.key?.toLowerCase());
    return parts.join("+");
  }
  static cleanKeyCombo(combo) {
    const clean = (combo) => {
      const m = ["ctrl", "alt", "shift", "meta"];
      const alias = { cmd: "meta" }; // allow cmd - meta
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
  }
  static matchKeys(required, actual, strict = false) {
    const match = (required, actual) => {
      if (strict) return required === actual;
      const reqKeys = required.split("+");
      const actKeys = actual.split("+");
      return reqKeys.every((k) => actKeys.includes(k));
    };
    return tmg.isArr(required) ? required.some((req) => match(req, actual)) : match(required, actual);
  }
  static formatKeyForDisplay = (combo) => ` ${(tmg.isArr(combo) ? combo : [combo]).map((c) => `(${c})`).join(" or ")}`;
  static createEl(tag, props = {}, dataset = {}, styles = {}) {
    const el = document.createElement(tag),
      u = undefined;
    Object.entries(props).forEach(([k, v]) => {
      if (v !== u) el[k] = v;
    });
    Object.entries(dataset).forEach(([k, v]) => {
      if (v !== u) el.dataset[k] = v;
    });
    Object.entries(styles).forEach(([k, v]) => {
      if (v !== u) el.style[k] = v;
    });
    return el;
  }
  static cloneVideo(v) {
    const newV = v.cloneNode(true);
    newV.tmgPlayer = v.tmgPlayer;
    v.parentElement?.replaceChild(newV, v);
    // Playback control
    if (v.currentTime) newV.currentTime = v.currentTime;
    if (v.playbackRate !== 1) newV.playbackRate = v.playbackRate;
    if (v.defaultPlaybackRate !== 1) newV.defaultPlaybackRate = v.defaultPlaybackRate;
    if (v.volume !== 1) newV.volume = v.volume;
    if (v.muted) newV.muted = true;
    if (v.defaultMuted) newV.defaultMuted = true;
    if (v.srcObject) newV.srcObject = v.srcObject;
    // Behavior flags
    if (v.autoplay) newV.autoplay = true;
    if (v.loop) newV.loop = true;
    if (v.controls) newV.controls = true;
    if (v.crossOrigin) newV.crossOrigin = v.crossOrigin;
    if (v.playsInline) newV.playsInline = true;
    if (v.controlsList?.length) newV.controlsList = v.controlsList;
    if (v.disablePictureInPicture) newV.disablePictureInPicture = true;
    if (!v.paused && tmg.isInDOM(newV)) newV.play();
    return newV;
  }
  static onSafeClicks(el, onClick, onDblClick, options) {
    el.addEventListener(
      "click",
      (el._clickHandler = (e) => {
        clearTimeout(el._clickTimeoutId);
        el._clickTimeoutId = setTimeout(() => onClick(e), 300);
      }),
      options,
    );
    el.addEventListener(
      "dblclick",
      (el._dblClickHandler = (e) => {
        clearTimeout(el._clickTimeoutId);
        onDblClick(e);
      }),
      options,
    ); // just to smoothe out browser perks with tiny logic, nothing special :)
  }
  static removeSafeClicks(el) {
    el.removeEventListener("click", el._clickHandler);
    el.removeEventListener("dblclick", el._dblClickHandler); // will only remove recent handlers
  }
  static getRenderedBox(elem) {
    const getResourceDimensions = (source) => (source.videoWidth ? { width: source.videoWidth, height: source.videoHeight } : null);
    function parsePositionAsPx(str, bboxSize, objectSize) {
      const num = parseFloat(str);
      if (!str.endsWith("%")) return num;
      const ratio = num / 100;
      return bboxSize * ratio - objectSize * ratio;
    }
    function parseObjectPosition(position, bbox, object) {
      const [left, top] = position.split(" ");
      return {
        left: parsePositionAsPx(left, bbox.width, object.width),
        top: parsePositionAsPx(top, bbox.height, object.height),
      };
    }
    let { objectFit, objectPosition } = getComputedStyle(elem);
    const bbox = elem.getBoundingClientRect();
    const object = getResourceDimensions(elem);
    if (!object || !objectFit || !objectPosition) return {};
    if (objectFit === "scale-down") objectFit = bbox.width < object.width || bbox.height < object.height ? "contain" : "none";
    if (objectFit === "none") {
      const { left, top } = parseObjectPosition(objectPosition, bbox, object);
      return { left, top, ...object };
    } else if (objectFit === "contain") {
      const objectRatio = object.height / object.width;
      const bboxRatio = bbox.height / bbox.width;
      const width = bboxRatio > objectRatio ? bbox.width : bbox.height / objectRatio;
      const height = bboxRatio > objectRatio ? bbox.width * objectRatio : bbox.height;
      const { left, top } = parseObjectPosition(objectPosition, bbox, { width, height });
      return { left, top, width, height };
    } else if (objectFit === "fill") {
      const { left, top } = parseObjectPosition(objectPosition, bbox, object);
      const objPosArr = objectPosition.split(" ");
      return { left: objPosArr[0].endsWith("%") ? 0 : left, top: objPosArr[1].endsWith("%") ? 0 : top, width: bbox.width, height: bbox.height }; // Relative positioning is discarded with `object-fit: fill`, so we need to check here if it's relative or not
    } else if (objectFit === "cover") {
      const minRatio = Math.min(bbox.width / object.width, bbox.height / object.height);
      let width = object.width * minRatio;
      let height = object.height * minRatio;
      let outRatio = 1;
      if (width < bbox.width) outRatio = bbox.width / width;
      if (Math.abs(outRatio - 1) < 1e-14 && height < bbox.height) outRatio = bbox.height / height;
      width *= outRatio;
      height *= outRatio;
      const { left, top } = parseObjectPosition(objectPosition, bbox, { width, height });
      return { left, top, width, height };
    }
  }
  static _SCROLLER_R_OBSERVER = typeof window !== "undefined" && new ResizeObserver((entries) => entries.forEach(({ target }) => tmg._SCROLLERS.get(target)?.update()));
  static _SCROLLER_M_OBSERVER =
    typeof window !== "undefined" &&
    new MutationObserver((entries) => {
      const els = new Set();
      for (const entry of entries) {
        let node = entry.target;
        while (node && !tmg._SCROLLERS.has(node)) node = node.parentElement;
        if (node) els.add(node);
      }
      for (const el of els) {
        tmg._SCROLLERS.get(el)?.update();
      }
    });
  static _SCROLLERS = new WeakMap();
  static initScrollAssist(el, { pxPerSecond = 80, assistClassName = "T_M_G-video-controls-scroll-assist", vertical = true, horizontal = true } = {}) {
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
        const w = assist.left?.offsetWidth || assistWidth;
        const check = hasInteractive ? el.clientWidth < w * 2 : false;
        assist.left.style.display = check ? "none" : el.scrollLeft > 0 ? "block" : "none";
        assist.right.style.display = check ? "none" : el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? "block" : "none";
        assistWidth = w;
      }
      if (vertical) {
        const h = assist.up?.offsetHeight || assistHeight;
        const check = hasInteractive ? el.clientHeight < h * 2 : false;
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
    const stop = () => {
      if (scrollId) cancelAnimationFrame(scrollId);
      scrollId = null;
    };
    const addAssist = (dir) => {
      const div = tmg.createEl("div", { className: assistClassName }, { scrollDirection: dir }, { display: "none" });
      ["pointerenter", "dragenter"].forEach((e) => div.addEventListener(e, () => scroll(dir)));
      ["pointerleave", "pointerup", "pointercancel", "dragleave", "dragend"].forEach((e) => div.addEventListener(e, stop));
      (dir === "left" || dir === "up" ? parent.insertBefore : parent.appendChild).call(parent, div, el);
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
  }
  static removeScrollAssist = (el) => tmg._SCROLLERS.get(el)?.destroy();
  static rippleHandler(e, target, forceCenter = false) {
    const currentTarget = target || e.currentTarget;
    if ((e.target !== e.currentTarget && e.target?.matches("button,[href],input,label,select,textarea,[tabindex]:not([tabindex='-1'])")) || currentTarget?.hasAttribute("disabled")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation?.();
    const el = currentTarget;
    const rW = el.offsetWidth;
    const rH = el.offsetHeight;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rW, rH);
    const x = forceCenter ? rW / 2 - size / 2 : (e.clientX - rect.left) * (rW / rect.width) - size / 2;
    const y = forceCenter ? rH / 2 - size / 2 : (e.clientY - rect.top) * (rH / rect.height) - size / 2;
    const wrapper = tmg.createEl("span", { className: "T_M_G-video-ripple-container" });
    const ripple = tmg.createEl("span", { className: "T_M_G-video-ripple T_M_G-video-ripple-hold" }, {}, { cssText: `width:${size}px;height:${size}px;left:${x}px;top:${y}px;` });
    let canRelease = false;
    ripple.addEventListener("animationend", () => (canRelease = true), { once: true });
    wrapper.appendChild(ripple);
    el.appendChild(wrapper);
    const release = () => {
      if (!canRelease) return ripple.addEventListener("animationend", release, { once: true });
      ripple.classList.replace("T_M_G-video-ripple-hold", "T_M_G-video-ripple-fade");
      ripple.addEventListener("animationend", () => (requestIdleCallback || setTimeout)(() => wrapper.remove()));
      el.ownerDocument.defaultView.removeEventListener("pointerup", release);
      el.ownerDocument.defaultView.removeEventListener("pointercancel", release);
    };
    el.ownerDocument.defaultView.addEventListener("pointerup", release);
    el.ownerDocument.defaultView.addEventListener("pointercancel", release);
  }
  static Controllers = []; // REFERENCES TO ALL THE DEPLOYED TMG MEDIA CONTROLLERS
  static Notifier = T_M_G_Media_Notifier; // THE TMG MEDIA PLAYER NOTIFIER CLASS
  static Player = T_M_G_Media_Player; // THE TMG MEDIA PLAYER BUILDER CLASS
}

if (typeof window !== "undefined") {
  window.tmg = T_M_G;
  tmg.init();
} else {
  console.error("TMG Media Player cannot run in a terminal!");
  console.warn("Consider moving to a browser environment to use the TMG Media Player");
}
