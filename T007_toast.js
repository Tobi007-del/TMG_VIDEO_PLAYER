"use strict";

let _TOAST_ID_COUNTER = 0;
class T007_Toast {
  #autoCloseInterval;
  #progressInterval;
  #timeVisible = 0;
  #autoClose;
  #vibrate;
  #isPaused = false;
  #unpause = () => (this.#isPaused = false);
  #pause = () => (this.#isPaused = true);
  #visiblityChange = () => (this.#shouldUnPause = document.visibilityState === "visible");
  #shouldUnPause;
  constructor(options) {
    this.bindMethods();
    this.opts = { ...options };
    this.id = this.opts.id || `_t007_toast_${++_TOAST_ID_COUNTER}`;
    t007._TOASTS.set(this.id, this);
    this.toastElement = document.createElement("div");
    this.toastElement.className = `t007-toast ${this.opts.type}`;
    requestAnimationFrame(() => this.toastElement.classList.add("t007-toast-show"));
    this.update(this.opts);
  }
  bindMethods() {
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      for (const method of Object.getOwnPropertyNames(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, method);
        if (method !== "constructor" && descriptor && typeof descriptor.value === "function") this[method] = this[method].bind(this);
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
  update(options) {
    if (!options || typeof options !== "object") return;
    try {
      this.opts = { ...this.opts, ...options };
      Object.entries(options).forEach(([key, value]) => (this[key] = value));
    } catch (err) {
      console.error("Toast update failed:", err);
    }
  }
  set rootElement(value) {
    const container = value.querySelector(`.t007-toast-container[data-position="${this.opts.position}"]`);
    container?.style.setProperty("--t007-toast-container-position", value === document.body ? "fixed" : "absolute");
    container && value.append(container);
  }
  set type(value) {
    this.toastElement.classList.remove("info", "success", "error", "warning");
    value && this.toastElement.classList.add(value);
    this.updateACV();
    if (value) this.icon = this.opts.icon;
  }
  set bodyHTML(value) {
    this.toastElement.querySelectorAll(".t007-toast > *:not(.t007-toast-cancel-button)").forEach((el) => el.remove());
    this.toastElement.insertAdjacentHTML("afterbegin", `${value ? (typeof value === "function" ? value() : value) : ""}`);
  }
  set render(value) {
    const bodyText = () => this.toastElement.querySelector(".t007-toast-body-text");
    if (value) {
      this.setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-body").append(bodyText() || Object.assign(document.createElement("p"), { className: "t007-toast-body-text" }));
      bodyText().innerHTML = typeof value === "function" ? value() : value;
    } else bodyText()?.remove();
  }
  set image(value) {
    const image = () => this.toastElement.querySelector(".t007-toast-image");
    if (value) {
      this.setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-image-wrapper").prepend(image() || Object.assign(document.createElement("img"), { className: "t007-toast-image", alt: "toast-image" }));
      image().src = value;
    } else image()?.remove();
  }
  set icon(value) {
    if (this.opts.isLoading) return;
    const icon = () => this.toastElement.querySelector(".t007-toast-icon:not(.t007-toast-loader)");
    if (value) {
      this.setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-image-wrapper").appendChild(icon() || Object.assign(document.createElement("span"), { className: "t007-toast-icon" }));
      icon().innerHTML = typeof value === "string" ? value : this.getDefaultIconHTML();
    } else icon()?.remove();
  }
  set isLoading(value) {
    const loader = this.toastElement.querySelector(".t007-toast-loader"),
      loadingIconHTML = `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 16 16" fill="none" style="scale:0.8;"><g fill-rule="evenodd" clip-rule="evenodd"><path fill="grey" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8"/><path fill="whitesmoke" d="M7.25.75A.75.75 0 0 1 8 0a8 8 0 0 1 8 8 .75.75 0 0 1-1.5 0A6.5 6.5 0 0 0 8 1.5a.75.75 0 0 1-.75-.75"/></g><animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0" to="360" dur="600ms" repeatCount="indefinite"/></svg>`;
    if (value) {
      this.setUpBodyHTML();
      this.toastElement.querySelectorAll(".t007-toast-icon:not(.t007-loader)").forEach((i) => i.remove());
      this.toastElement.querySelector(".t007-toast-image-wrapper").appendChild(loader || Object.assign(document.createElement("span"), { className: "t007-toast-icon t007-toast-loader", innerHTML: loadingIconHTML }));
    } else {
      loader?.remove();
      this.icon = this.opts.icon;
    }
  }
  set closeButton(value) {
    const btn = this.toastElement.querySelector(".t007-toast-cancel-button");
    if (value) {
      this.toastElement.appendChild(btn || Object.assign(document.createElement("button"), { title: "Close", className: "t007-toast-cancel-button", innerHTML: "&times;", onclick: this.remove }));
    } else btn?.remove();
  }
  set autoClose(value) {
    if (value === false) return this.toastElement.classList.remove("progress");
    else this.hideProgressBar = this.opts.hideProgressBar;
    this.updateACV();
    this.#timeVisible = 0;
    let lastTime;
    const loop = (time) => {
      if (this.#shouldUnPause) {
        lastTime = null;
        this.#shouldUnPause = false;
      }
      if (lastTime == null) {
        lastTime = time;
        return (this.#autoCloseInterval = requestAnimationFrame(loop));
      }
      if (!this.#isPaused) {
        this.#timeVisible += time - lastTime;
        this.onTimeUpdate?.(this.#timeVisible);
        if (this.#timeVisible >= this.#autoClose) return this.remove("smooth", true);
      }
      lastTime = time;
      this.#autoCloseInterval = requestAnimationFrame(loop);
    };
    this.#autoCloseInterval = requestAnimationFrame(loop);
  }
  set position(value) {
    const currentContainer = this.toastElement.parentElement;
    const container = this.opts.rootElement.querySelector(`.t007-toast-container[data-position="${value}"]`) || this.createContainer(value);
    container.append(this.toastElement);
    if (currentContainer == null || currentContainer.hasChildNodes()) return;
    currentContainer.remove();
  }
  set closeOnClick(value) {
    this.toastElement.onclick = value ? () => this.remove() : null;
  }
  set hideProgressBar(value) {
    this.toastElement.classList.toggle("progress", !(this.opts.autoClose === false || value));
    this.toastElement.style.setProperty("--progress", 1);
    const loop = () => {
      if (!this.#isPaused) this.toastElement.style.setProperty("--progress", this.#timeVisible / this.#autoClose);
      this.#progressInterval = requestAnimationFrame(loop);
    };
    if (!value) this.#progressInterval = requestAnimationFrame(loop);
  }
  set pauseOnHover(value) {
    this.toastElement.onmouseover = value ? this.#pause : null;
    this.toastElement.onmouseleave = value ? this.#unpause : null;
  }
  set pauseOnFocusLoss(value) {
    document.removeEventListener("visibilitychange", this.#visiblityChange);
    value ? document.addEventListener("visibilitychange", this.#visiblityChange) : document.removeEventListener("visibilitychange", this.#visiblityChange);
  }
  set renotify(value) {
    if (!this.opts.tag || !value) return;
    t007._TOASTS.entries().forEach(([id, toast]) => id !== this.id && (toast.opts.tag ?? 1) === (this.opts.tag ?? 0) && toast.remove("instant"));
  }
  set vibrate(value) {
    if (!("vibrate" in navigator)) return;
    if (value === false) return;
    this.updateACV();
    navigator.vibrate(this.#vibrate);
  }
  set dragToClose(value) {
    this.toastElement.dataset.pointerType = this._pointerType = value;
    this.toastElement.onpointerdown = value ? this.handleToastPointerStart : null;
    this.toastElement.onpointerup = value ? this.handleToastPointerUp : null;
  }
  handleToastPointerStart(e) {
    if (typeof this._pointerType === "string" && e.pointerType !== this._pointerType) return;
    if (e.touches?.length > 1) return;
    e.stopImmediatePropagation();
    !e.target?.matches('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') && this.toastElement.setPointerCapture(e.pointerId);
    this._pointerStartX = this.opts.dragToCloseDir.includes("x") ? (e.clientX ?? e.targetTouches[0]?.clientX) : 0;
    this._pointerStartY = this.opts.dragToCloseDir.includes("y") ? (e.clientY ?? e.targetTouches[0]?.clientY) : 0;
    this._pointerTicker = false;
    this.toastElement.addEventListener("pointermove", this.handleToastPointerMove, { passive: false });
    this.#isPaused = true;
  }
  handleToastPointerMove(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this._pointerTicker) return;
    this._pointerRAF = requestAnimationFrame(() => {
      const x = e.clientX ?? e.targetTouches[0]?.clientX,
        y = e.clientY ?? e.targetTouches[0]?.clientY;
      this._pointerDeltaX = this.opts.dragToCloseDir.includes("x") ? x - this._pointerStartX : 0;
      this._pointerDeltaY = this.opts.dragToCloseDir.includes("y") ? y - this._pointerStartY : 0;
      this.toastElement.style.setProperty("transition", "none", "important");
      this.toastElement.style.setProperty("transform", `translate(${this._pointerDeltaX}px, ${this._pointerDeltaY}px)`, "important");
      const xR = Math.abs(this._pointerDeltaX) / this.toastElement.offsetWidth,
        yR = Math.abs(this._pointerDeltaY) / this.toastElement.offsetHeight;
      this.toastElement.style.setProperty("opacity", clamp(0, 1 - (yR > 0.5 ? yR : xR), 1), "important");
      this._pointerTicker = false;
    });
    this._pointerTicker = true;
  }
  handleToastPointerUp(e) {
    if (typeof this._pointerType === "string" && e.pointerType !== this._pointerType) return;
    cancelAnimationFrame(this._pointerRAF);
    if (this.opts.dragToCloseDir.includes("x") ? Math.abs(this._pointerDeltaX) > this.toastElement.offsetWidth * (this.opts.dragToClosePercent.x ?? this.opts.dragToClosePercent / 100) : Math.abs(this._pointerDeltaY) > this.toastElement.offsetHeight * (this.opts.dragToClosePercent.y ?? this.opts.dragToClosePercent / 100)) return this.remove("instant");
    this._pointerTicker = false;
    this.toastElement.removeEventListener("pointermove", this.handleToastPointerMove, { passive: false });
    this.toastElement.style.removeProperty("transition");
    this.toastElement.style.removeProperty("transform");
    this.toastElement.style.removeProperty("opacity");
    this.#isPaused = false;
  }
  remove(manner = "smooth", timeElapsed = false) {
    document.removeEventListener("visibilitychange", this.#visiblityChange);
    cancelAnimationFrame(this.#autoCloseInterval);
    cancelAnimationFrame(this.#progressInterval);
    if (manner === "instant") this.cleanUpToast();
    else this.toastElement.onanimationend = this.cleanUpToast;
    this.toastElement.classList.remove("t007-toast-show");
    this.onClose?.(timeElapsed);
    t007._TOASTS.delete(this.id);
  }
  updateACV() {
    const setACV = (value) => {
      this.#autoClose = this.opts.autoClose === true ? t007.TOAST_DURATIONS[value] : this.opts.autoClose;
      this.#vibrate = this.opts.vibrate === true ? TOAST_VIBRATIONS[value] : this.opts.vibrate;
    };
    switch (this.opts.type) {
      case "success":
      case "error":
      case "warning":
        setACV(this.opts.type);
        break;
      default:
        setACV("info");
    }
  }
  createContainer(position) {
    const container = document.createElement("div");
    container.classList.add("t007-toast-container");
    container.style.setProperty("--t007-toast-container-position", this.opts.rootElement === document.body ? "fixed" : "absolute");
    container.dataset.position = position;
    this.opts.rootElement.append(container);
    return container;
  }
  setUpBodyHTML() {
    this.toastElement.querySelectorAll(".t007-toast > *:not(.t007-toast-image-wrapper, .t007-toast-body, .t007-toast-cancel-button)").forEach((el) => el.remove());
    const imageWrapper = () => this.toastElement.querySelector(".t007-toast-image-wrapper");
    if (!imageWrapper()) this.toastElement.prepend(Object.assign(document.createElement("div"), { className: "t007-toast-image-wrapper" }));
    if (!this.toastElement.querySelector(".t007-toast-body")) imageWrapper().insertAdjacentElement("afterend", Object.assign(document.createElement("div"), { className: "t007-toast-body" }));
  }
  getDefaultIconHTML() {
    const type = this.opts.type;
    let defaultIconHTML = "";
    switch (type) {
      case "info":
        defaultIconHTML = `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3498db"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 10v6"/><circle cx="12" cy="7" r="1.5" fill="#fff"/></svg>`;
        break;
      case "success":
        defaultIconHTML = `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#27ae60"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 12l3 3l6-6"/></svg>`;
        break;
      case "error":
        defaultIconHTML = `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e74c3c"/><path fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 8l8 8M16 8l-8 8"/></svg>`;
        break;
      case "warning":
        defaultIconHTML = `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><path fill="#f1c40f" stroke="#f39c12" stroke-width="2" stroke-linejoin="round" d="M12 3L2.5 20.5A2 2 0 0 0 4.5 23h15a2 2 0 0 0 2-2.5L12 3z"/><circle cx="12" cy="17" r="1.5" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 8v6"/></svg>`;
        break;
    }
    return defaultIconHTML;
  }
  cleanUpToast() {
    const container = this.toastElement.parentElement;
    this.toastElement.remove();
    if (container?.hasChildNodes()) return;
    container?.remove();
  }
}

const Toaster = (defOptions = {}) => {
  const defaults = () => ({ ...t007.TOAST_DEFAULT_OPTIONS, ...defOptions });
  const base = (render, options = {}) => {
    const toast = new T007_Toast({ ...defaults(), ...options, render });
    return toast.id;
  };
  base.update = (id, options) => t007._TOASTS.get(id)?.update(options);
  ["info", "success", "warn", "error"].forEach(
    (action) =>
      (base[action] = (renderOrId, options = {}) => {
        const existingToast = t007._TOASTS.get(renderOrId);
        const { autoClose, closeButton, closeOnClick, dragToClose } = defaults();
        if (existingToast)
          return existingToast.update({
            isLoading: false,
            autoClose,
            closeButton,
            closeOnClick,
            dragToClose,
            ...options,
            type: action === "warn" ? "warning" : action,
          });
        return base(renderOrId, {
          ...options,
          type: action === "warn" ? "warning" : action,
        });
      })
  );
  base.loading = (render, options = {}) =>
    base(render, {
      ...options,
      isLoading: true,
      autoClose: false,
      closeButton: false,
      closeOnClick: false,
      dragToClose: false,
    });
  base.promise = function (promise, { pending, success, error, ...options } = {}) {
    if (!promise || typeof promise.then !== "function") return console.error("Toast.promise() requires a valid promise");
    const NFC = (input, type) => (typeof input === "string" ? { body: input, type } : typeof input === "object" ? { ...input, type } : { type });
    const pendingConfig = NFC(pending || "Loading...");
    const pendingToastId = base.loading(pendingConfig.render, { ...options, ...pendingConfig });
    promise.then(
      (response) => {
        const successConfig = NFC(success || "Completed Successfully", "success");
        const { render, bodyHTML } = successConfig;
        if (typeof render === "function") successConfig.render = (response) => render(response);
        if (typeof bodyHTML === "function") successConfig.bodyHTML = (response) => bodyHTML(response);
        base.success(pendingToastId, successConfig);
        return response;
      },
      (err) => {
        const errorConfig = NFC(error || "An error occurred", "error");
        const { render, bodyHTML } = errorConfig;
        if (typeof render === "function") errorConfig.render = (err) => render(err);
        if (typeof bodyHTML === "function") errorConfig.bodyHTML = (err) => bodyHTML(err);
        base.error(pendingToastId, errorConfig);
        return Promise.reject(err);
      }
    );
    return promise;
  };
  base.dismiss = function (id, manner) {
    return arguments.length === 0 ? t007._TOASTS.values().forEach((toast) => toast.remove()) : t007._TOASTS.get(id)?.remove(manner);
  };
  return base;
};
const Toast = Toaster();
export default Toast;
export { Toaster };

if (typeof window !== "undefined") {
  window.t007 ??= { _resourceCache: {} };
  t007.toast = Toast;
  t007.toaster = Toaster;
  t007._TOASTS = new Map();
  t007.TOAST_DEFAULT_OPTIONS ??= {};
  t007.TOAST_DURATIONS = {};
  t007.TOAST_VIBRATIONS = {};
  t007.TOAST_DEFAULT_OPTIONS.rootElement ??= document.body;
  t007.TOAST_DEFAULT_OPTIONS.render ??= "";
  t007.TOAST_DEFAULT_OPTIONS.type ??= "";
  t007.TOAST_DEFAULT_OPTIONS.icon ??= true;
  t007.TOAST_DEFAULT_OPTIONS.image ??= false;
  t007.TOAST_DEFAULT_OPTIONS.autoClose ??= true;
  t007.TOAST_DEFAULT_OPTIONS.position ??= "top-right";
  t007.TOAST_DEFAULT_OPTIONS.closeButton ??= true;
  t007.TOAST_DEFAULT_OPTIONS.closeOnClick ??= false;
  t007.TOAST_DEFAULT_OPTIONS.hideProgressBar ??= false;
  t007.TOAST_DEFAULT_OPTIONS.pauseOnHover ??= true;
  t007.TOAST_DEFAULT_OPTIONS.pauseOnFocusLoss ??= true;
  t007.TOAST_DEFAULT_OPTIONS.dragToClose ??= true; // mouse, pen, touch
  t007.TOAST_DEFAULT_OPTIONS.dragToClosePercent ??= 40;
  t007.TOAST_DEFAULT_OPTIONS.dragToCloseDir ??= "x";
  t007.TOAST_DEFAULT_OPTIONS.renotify ??= true;
  t007.TOAST_DEFAULT_OPTIONS.vibrate ??= false;
  t007.TOAST_DURATIONS.success ??= 2500;
  t007.TOAST_DURATIONS.error ??= 4500;
  t007.TOAST_DURATIONS.warning ??= 3500;
  t007.TOAST_DURATIONS.info ??= 4000; // default
  t007.TOAST_VIBRATIONS.success ??= [100, 50, 100]; // Short double buzz
  t007.TOAST_VIBRATIONS.warning ??= [300, 100, 300]; // Two long buzzes
  t007.TOAST_VIBRATIONS.error ??= [500, 200, 500]; // Strong long buzz
  t007.TOAST_VIBRATIONS.info ??= [200]; // Single short buzz
  window.T007_TOAST_CSS_SRC ??= `/T007_TOOLS/T007_toast_library/T007_toast.css`;
  loadResource(T007_TOAST_CSS_SRC);
  window.Toast ??= t007.toast;
  console.log("%cT007 Toasts attached to window!", "color: green");
}

function clamp(min, amount, max) {
  return Math.min(Math.max(amount, min), max);
}
// prettier-ignore
function isSameURL(src1, src2) {
  if (typeof src1 !== "string" || typeof src2 !== "string" || !src1 || !src2) return false;
  try {
    const u1 = new URL(src1, window.location.href);
    const u2 = new URL(src2, window.location.href);
    return decodeURIComponent(u1.origin + u1.pathname) === decodeURIComponent(u2.origin + u2.pathname);
  } catch {
    return src1.replace(/\\/g, "/").split("?")[0].trim() === src2.replace(/\\/g, "/").split("?")[0].trim();
  }
}
// prettier-ignore
function loadResource(src, type = "style", { module, media, crossOrigin, integrity } = {}) {
  if (t007._resourceCache[src]) return t007._resourceCache[src];
  if (type === "script" ? [...document.scripts].some((s) => isSameURL(s.src, src)) : type === "style" ? [...document.styleSheets].some((s) => isSameURL(s.href, src)) : false) return Promise.resolve();
  t007._resourceCache[src] = new Promise((resolve, reject) => {
    if (type === "script") {
      const script = Object.assign(document.createElement("script"), { src, type: module ? "module" : "text/javascript", onload: () => resolve(script), onerror: () => reject(new Error(`Script load error: ${src}`)) });
      if (crossOrigin) script.crossOrigin = crossOrigin;
      if (integrity) script.integrity = integrity;
      document.body.append(script);
    } else if (type === "style") {
      const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: src, onload: () => resolve(link), onerror: () => reject(new Error(`Stylesheet load error: ${src}`)) });
      if (media) link.media = media;
      document.head.append(link);
    } else reject(new Error(`Unsupported type: ${type}`));
  });
  return t007._resourceCache[src];
}
