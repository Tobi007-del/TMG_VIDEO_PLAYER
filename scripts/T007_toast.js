"use strict";

class T007_Toast {
  #autoCloseInterval;
  #progressInterval;
  #timeVisible = 0;
  #isPaused = false;
  #shouldUnPause;
  queue = [];
  destroyed = true;
  #visiblityChange = () => (this.#shouldUnPause = document.visibilityState === "visible");
  constructor(options) {
    this.bindMethods();
    this.opts = { id: uid(), ...options };
    this.id = this.opts.id;
    t007.toasts.set(this.id, this);
    "number" !== typeof this.opts.delay ? this.init() : this.queue.push(setTimeout(this.init, this.opts.delay));
    this.update(this.opts);
  }
  bindMethods() {
    let proto = this;
    while (proto && proto !== Object.prototype) {
      for (const method of Object.getOwnPropertyNames(proto)) {
        if (method !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, method)?.value === "function") this[method] = this[method].bind(this);
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
  init() {
    this.toastElement = Object.assign(document.createElement("div"), { className: "t007-toast", id: this.id });
    requestAnimationFrame(() => this.toastElement.classList.add("t007-toast-show"));
    this.destroyed = false;
  }
  update(options) {
    if (!options || typeof options !== "object") return this.opts.id;
    try {
      this.opts = { ...this.opts, ...options };
      const run = () => Object.entries(options).forEach(([key, value]) => (this[key] = value));
      "number" !== typeof this.opts.delay ? run() : this.queue.push(setTimeout(run, this.opts.delay));
      this.opts.delay = null;
    } catch (err) {
      console.error("Toast update failed:", err);
    }
    return this.opts.id;
  }
  play = () => setTimeout(() => (this.#isPaused = false));
  pause = () => (this.#isPaused = true);
  set rootElement(value) {
    const container = value?.querySelector(`.t007-toast-container[data-position="${this.opts.position}"]`);
    container?.style.setProperty("--t007-toast-container-position", value === document.body ? "fixed" : "absolute");
    container && !value.contains(container) && value.append(container);
  }
  set type(value) {
    this.toastElement.classList.remove("info", "success", "error", "warning");
    value && this.toastElement.classList.add(value);
    if (value) this.icon = this.opts.icon;
  }
  set bodyHTML(value) {
    this.toastElement.querySelectorAll(".t007-toast > *:not(.t007-toast-cancel-button)").forEach((el) => el.remove());
    this.toastElement.insertAdjacentHTML("afterbegin", `${value ? (typeof value === "function" ? value() : value) : ""}`);
  }
  set render(value) {
    const bodyText = () => this.toastElement.querySelector(".t007-toast-body-text");
    if (value) {
      this._setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-body").prepend(bodyText() || Object.assign(document.createElement("p"), { className: "t007-toast-body-text" }));
      bodyText().innerHTML = typeof value === "function" ? value() : value;
    } else bodyText()?.remove();
  }
  set actions(value) {
    const actionsWrapper = () => this.toastElement.querySelector(".t007-toast-actions-wrapper"),
      values = value ? Object.entries(value) : [];
    if (values.length) {
      this._setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-body").insertAdjacentElement("afterend", actionsWrapper() || Object.assign(document.createElement("div"), { className: "t007-toast-actions-wrapper" }));
      actionsWrapper().innerHTML = values.map(([label]) => (label ? `<button class="t007-toast-action-button">${label}</button>` : "")).join("");
      actionsWrapper()
        .querySelectorAll(".t007-toast-action-button")
        .forEach((btn, i) => (btn.onclick = (e) => values[i][1]?.(e, this)));
    } else actionsWrapper()?.remove();
  }
  set image(value) {
    const image = () => this.toastElement.querySelector(".t007-toast-image");
    if (value) {
      this._setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-image-wrapper").prepend(image() || Object.assign(document.createElement("img"), { className: "t007-toast-image", alt: "toast-image" }));
      image().src = value;
    } else image()?.remove();
  }
  get icon() {
    return this.opts.icon === true ? t007.TOAST_ICONS[this.opts.type] || "" : this.opts.icon || "";
  }
  set icon(value) {
    if (this.opts.isLoading) return;
    const icon = () => this.toastElement.querySelector(".t007-toast-icon:not(.t007-toast-loader)");
    if (value) {
      this._setUpBodyHTML();
      this.toastElement.querySelector(".t007-toast-image-wrapper").appendChild(icon() || Object.assign(document.createElement("span"), { className: "t007-toast-icon" }));
      icon().innerHTML = this.icon;
    } else icon()?.remove();
  }
  set isLoading(value) {
    const loader = () => this.toastElement.querySelector(".t007-toast-loader");
    if (value) {
      this._setUpBodyHTML();
      this.toastElement.querySelectorAll(".t007-toast-icon:not(.t007-toast-loader)").forEach((i) => i.remove());
      this.toastElement.querySelector(".t007-toast-image-wrapper").appendChild(loader() || Object.assign(document.createElement("span"), { className: "t007-toast-icon t007-toast-loader" }));
      loader().innerHTML = typeof value === "string" ? value : t007.TOAST_ICONS.loading;
    } else {
      loader()?.remove();
      this.icon = this.opts.icon;
    }
  }
  set closeButton(value) {
    const btn = this.toastElement.querySelector(".t007-toast-cancel-button");
    if (value) {
      this.toastElement.appendChild(btn || Object.assign(document.createElement("button"), { title: "Close", className: "t007-toast-cancel-button", innerHTML: "&times;", onclick: this._remove }));
    } else btn?.remove();
  }
  get animation() {
    if (this.opts.animation === true || this.opts.animation === "slide")
      switch (this.opts.position) {
        case "top-right":
        case "center-right":
        case "bottom-right":
          return "slide-left";
        case "top-center":
        case "center-center":
        case "bottom-center":
          return this.opts.position === "top-center" ? "slide-down" : "slide-up";
        case "top-left":
        case "center-left":
        case "bottom-left":
        default:
          return "slide-right";
      }
    return this.opts.animation;
  }
  set animation(value) {
    this.toastElement.dataset.animation = this.animation;
  }
  get autoClose() {
    return this.opts.autoClose === true ? t007.TOAST_DURATIONS[this.opts.type] || t007.TOAST_DURATIONS.info : this.opts.autoClose;
  }
  set autoClose(value) {
    cancelAnimationFrame(this.#autoCloseInterval);
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
        if ("number" == typeof this.autoClose && this.#timeVisible >= this.autoClose) return this._remove("smooth", true);
      }
      lastTime = time;
      this.#autoCloseInterval = requestAnimationFrame(loop);
    };
    if (value) this.#autoCloseInterval = requestAnimationFrame(loop);
  }
  set position(value) {
    const currentContainer = this.toastElement.parentElement;
    const container = this.opts.rootElement?.querySelector(`.t007-toast-container[data-position="${value}"]`) || this._createContainer(value);
    container[this.opts.newestOnTop ? "prepend" : "append"](this.toastElement);
    if (!(currentContainer == null || currentContainer.hasChildNodes())) currentContainer.remove();
  }
  set closeOnClick(value) {
    this.toastElement.onclick = value ? () => this._remove() : null;
  }
  set hideProgressBar(value) {
    this.toastElement.classList.toggle("progress", !value);
    this.nprogress = 0;
    cancelAnimationFrame(this.#progressInterval);
    const loop = () => {
      if ("number" == typeof this.autoClose && !this.#isPaused) this.nprogress = 1 - this.#timeVisible / this.autoClose;
      this.#progressInterval = requestAnimationFrame(loop);
    };
    if (!value) this.#progressInterval = requestAnimationFrame(loop);
  }
  get nprogress() {
    return Number(this.toastElement.style.getProperty("--progress"));
  }
  set nprogress(value) {
    this.toastElement.style.setProperty("--progress", value);
  }
  set pauseOnHover(value) {
    this.toastElement.onmouseover = value ? this.pause : null;
    this.toastElement.onmouseleave = value ? this.play : null;
    this.toastElement[value ? "addEventListener" : "removeEventListener"]("touchend", this.play);
  }
  set pauseOnFocusLoss(value) {
    value ? document.addEventListener("visibilitychange", this.#visiblityChange) : document.removeEventListener("visibilitychange", this.#visiblityChange);
  }
  set renotify(value) {
    value && this.opts.tag && t007.toasts.entries().forEach(([id, toast]) => id !== this.id && (toast.opts.tag ?? 1) === (this.opts.tag ?? 0) && toast._remove("instant"));
  }
  get vibrate() {
    return this.opts.vibrate === true ? t007.TOAST_VIBRATIONS[this.opts.type] || t007.TOAST_VIBRATIONS.info : this.opts.vibrate;
  }
  set vibrate(value) {
    value && navigator?.vibrate?.(this.vibrate);
  }
  set maxToasts(value) {
    const toastsInContainer = [...(this.toastElement?.parentElement?.children || [])];
    if (!toastsInContainer.length) return;
    for (let i = 0; i < toastsInContainer.length - value; i++) {
      [...t007.toasts.values()].find((t) => t.toastElement === (this.opts.newestOnTop ? toastsInContainer[toastsInContainer.length - 1 - i] : toastsInContainer[i]))?._remove("instant");
    }
  }
  set newestOnTop(value) {
    this.toastElement?.parentElement?.[value ? "prepend" : "append"](this.toastElement);
  }
  set dragToClose(value) {
    this.toastElement.dataset.pointerType = this._ptrType = value;
    this.toastElement.onpointerdown = value ? this._handleToastPointerStart : null;
    this.toastElement.onpointerup = value ? this._handleToastPointerUp : null;
  }
  _handleToastPointerStart(e) {
    if (typeof this._ptrType === "string" && e.pointerType !== this._ptrType) return;
    if (e.touches?.length > 1) return;
    !e.target?.matches('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') && this.toastElement.setPointerCapture(e.pointerId);
    this.#isPaused = true;
    this._ptrTicker = false;
    this._ptrStartX = e.clientX ?? e.targetTouches[0]?.clientX;
    this._ptrStartY = e.clientY ?? e.targetTouches[0]?.clientY;
    this.toastElement.addEventListener("pointermove", this._handleToastPointerMove, { passive: false });
  }
  _handleToastPointerMove(e) {
    e.preventDefault();
    if (this._ptrTicker) return;
    this._ptrRAF = requestAnimationFrame(() => {
      const x = e.clientX ?? e.targetTouches[0]?.clientX,
        y = e.clientY ?? e.targetTouches[0]?.clientY;
      this._ptrDir ||= Math.abs(x - this._ptrStartX) >= Math.abs(y - this._ptrStartY) ? "x" : "y";
      this._ptrDeltaX = (this.opts.dragToCloseDir.includes("|") ? this._ptrDir == "x" : this.opts.dragToCloseDir.includes("x")) ? x - this._ptrStartX : 0;
      this._ptrDeltaY = (this.opts.dragToCloseDir.includes("|") ? this._ptrDir == "y" : this.opts.dragToCloseDir.includes("y")) ? y - this._ptrStartY : 0;
      this.toastElement.style.setProperty("transition", "none", "important");
      this.toastElement.style.setProperty("transform", `translate(${this._ptrDeltaX}px, ${this._ptrDeltaY}px)`, "important");
      const xR = Math.abs(this._ptrDeltaX) / this.toastElement.offsetWidth,
        yR = Math.abs(this._ptrDeltaY) / this.toastElement.offsetHeight;
      this.toastElement.style.setProperty("opacity", clamp(0, 1 - (yR > 0.5 ? yR : xR), 1), "important");
      this._ptrDir = yR || xR ? this._ptrDir : false;
      this._ptrTicker = false;
    });
    this._ptrTicker = true;
  }
  _handleToastPointerUp(e) {
    if (typeof this._ptrType === "string" && e.pointerType !== this._ptrType) return;
    cancelAnimationFrame(this._ptrRAF);
    if (Math.abs(this._ptrDeltaX) > this.toastElement.offsetWidth * (this.opts.dragToClosePercent.x ?? this.opts.dragToClosePercent / 100) || Math.abs(this._ptrDeltaY) > this.toastElement.offsetHeight * (this.opts.dragToClosePercent.y ?? this.opts.dragToClosePercent / 100)) return this._remove("instant");
    this.#isPaused = this._ptrTicker = this._ptrDir = false;
    this.toastElement.removeEventListener("pointermove", this._handleToastPointerMove, { passive: false });
    this.toastElement.style.removeProperty("transition");
    this.toastElement.style.removeProperty("transform");
    this.toastElement.style.removeProperty("opacity");
  }
  _remove(manner = "smooth", timeElapsed = false) {
    if (!this.opts.isLoading) t007.toasts.delete(this.id);
    this.queue.forEach(clearTimeout);
    document.removeEventListener("visibilitychange", this.#visiblityChange);
    cancelAnimationFrame(this.#autoCloseInterval);
    cancelAnimationFrame(this.#progressInterval);
    if (this.destroyed || manner === "instant" || !this.animation) this._cleanUpToast();
    else this.toastElement.onanimationend = this._cleanUpToast;
    this.toastElement.classList.remove("t007-toast-show");
    this.onClose?.(timeElapsed);
  }
  _createContainer(position) {
    const container = document.createElement("div");
    container.classList.add("t007-toast-container");
    container.style.setProperty("--t007-toast-container-position", this.opts.rootElement === document.body ? "fixed" : "absolute");
    container.dataset.position = position;
    this.opts.rootElement?.append(container);
    return container;
  }
  _setUpBodyHTML() {
    this.toastElement.querySelectorAll(".t007-toast > *:not(.t007-toast-image-wrapper, .t007-toast-body, .t007-toast-actions-wrapper, .t007-toast-cancel-button)").forEach((el) => el.remove());
    const imageWrapper = () => this.toastElement.querySelector(".t007-toast-image-wrapper");
    if (!imageWrapper()) this.toastElement.prepend(Object.assign(document.createElement("div"), { className: "t007-toast-image-wrapper" }));
    if (!this.toastElement.querySelector(".t007-toast-body")) imageWrapper().insertAdjacentElement("afterend", Object.assign(document.createElement("div"), { className: "t007-toast-body" }));
  }
  _cleanUpToast() {
    const container = this.toastElement.parentElement;
    this.toastElement.remove();
    if (!container?.hasChildNodes()) container?.remove();
    this.destroyed = true;
  }
}

export const Toasting = {
  update(base, id, options) {
    const toast = t007.toasts.get(id);
    toast.queue.forEach(clearTimeout); // remove all delays and maybe make a new toast
    return !!toast && (toast.destroyed ? base(options.render, { ...toast.opts, id, ...options }) : toast.update(options));
  },
  message: (base, defaults, action) =>
    (base[action] = (renderOrId, options = {}) => {
      options = { ...options, type: action === "warn" ? "warning" : action };
      if (!t007.toasts.get(renderOrId)) return base(renderOrId, options);
      const { autoClose, closeButton, closeOnClick, dragToClose } = defaults();
      return base.update(renderOrId, { ...(t007.toasts.get(renderOrId)?.opts.isLoading ? { autoClose, closeButton, closeOnClick, dragToClose } : {}), ...options, isLoading: false });
    }),
  loading: (base, renderOrId, options = {}) => (t007.toasts.get(renderOrId) ? base.update : base)(renderOrId, { autoClose: false, closeButton: false, closeOnClick: false, dragToClose: false, ...options, isLoading: options.isLoading || true, type: "" }),
  promise(base, promise = new Promise((res, rej) => setTimeout(Math.round(Math.random()) ? res : rej, 3000)), { pending, success, error } = {}) {
    if (!promise || typeof promise.then !== "function") return console.error("Toast.promise() requires a valid promise");
    const NFC = (input, type) => (typeof input === "string" ? { render: input, type } : typeof input === "object" ? { ...input, type } : { type });
    const pendingConfig = NFC(pending);
    const pendingToastId = base.loading(pendingConfig.render || "Promise pending...", { ...pendingConfig });
    promise.then(
      (response) => {
        const successConfig = NFC(success || "Promise resolved", "success");
        const { render, bodyHTML } = successConfig;
        if (typeof render === "function") successConfig.render = (response) => render(response); // preserving as functions that receive the response
        if (typeof bodyHTML === "function") successConfig.bodyHTML = (response) => bodyHTML(response);
        base.success(pendingToastId, successConfig);
        return response;
      },
      (err) => {
        const errorConfig = NFC(error || "Promise rejected", "error");
        const { render, bodyHTML } = errorConfig;
        if (typeof render === "function") errorConfig.render = (err) => render(err);
        if (typeof bodyHTML === "function") errorConfig.bodyHTML = (err) => bodyHTML(err);
        base.error(pendingToastId, errorConfig);
        return Promise.reject(err);
      }
    );
    return promise;
  },
  dismiss(id, manner, timeElapsed) {
    return !arguments.length ? t007.toasts.values().forEach((toast) => toast._remove()) : t007.toasts.get(id)?._remove(manner, timeElapsed);
  },
};
export const Toaster = (defOptions = {}) => {
  const defaults = () => ({ ...t007.TOAST_DEFAULT_OPTIONS, ...defOptions });
  const base = (render, options = {}) => new T007_Toast({ ...defaults(), ...options, id: render.startsWith("t007_toast_") ? render : options.id, render: render.startsWith("t007_toast_") ? options.render : render }).id;
  base.update = (id, options) => Toasting.update(base, id, options);
  ["info", "success", "warn", "error"].forEach((action) => Toasting.message(base, defaults, action));
  base.loading = (render, options) => Toasting.loading(base, render, options);
  base.promise = (promise, options) => Toasting.promise(base, promise, options);
  base.dismiss = Toasting.dismiss;
  return base;
};
const Toast = Toaster();
export default Toast;

if (typeof window !== "undefined") {
  window.t007 ??= { _resourceCache: {} };
  t007.toast = Toast;
  t007.toasting = Toasting;
  t007.toaster = Toaster;
  t007.toasts = new Map();
  t007.TOAST_DEFAULT_OPTIONS ??= {};
  t007.TOAST_DURATIONS ??= {};
  t007.TOAST_VIBRATIONS ??= {};
  t007.TOAST_ICONS ??= {};
  t007.TOAST_DEFAULT_OPTIONS.rootElement ??= document.body;
  t007.TOAST_DEFAULT_OPTIONS.render ??= "";
  t007.TOAST_DEFAULT_OPTIONS.type ??= "";
  t007.TOAST_DEFAULT_OPTIONS.icon ??= true;
  t007.TOAST_DEFAULT_OPTIONS.image ??= false;
  t007.TOAST_DEFAULT_OPTIONS.autoClose ??= true;
  t007.TOAST_DEFAULT_OPTIONS.position ??= "top-right"; // "top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"
  t007.TOAST_DEFAULT_OPTIONS.isLoading ??= false;
  t007.TOAST_DEFAULT_OPTIONS.closeButton ??= true;
  t007.TOAST_DEFAULT_OPTIONS.closeOnClick ??= false;
  t007.TOAST_DEFAULT_OPTIONS.hideProgressBar ??= false;
  t007.TOAST_DEFAULT_OPTIONS.pauseOnHover ??= true;
  t007.TOAST_DEFAULT_OPTIONS.pauseOnFocusLoss ??= true;
  t007.TOAST_DEFAULT_OPTIONS.dragToClose ??= true; // mouse, pen, touch, boolean
  t007.TOAST_DEFAULT_OPTIONS.dragToClosePercent ??= 40;
  t007.TOAST_DEFAULT_OPTIONS.dragToCloseDir ??= "x"; // x, y, xy, x|y
  t007.TOAST_DEFAULT_OPTIONS.renotify ??= true;
  t007.TOAST_DEFAULT_OPTIONS.vibrate ??= false;
  t007.TOAST_DEFAULT_OPTIONS.animation ??= true; // "fade", "zoom", "slide"|"slide-left"|"slide-right"|"slide-up"|"slide-down"
  t007.TOAST_DEFAULT_OPTIONS.newestOnTop ??= false; // #Toaster
  t007.TOAST_DEFAULT_OPTIONS.maxToasts ??= 1000; // #Toaster
  t007.TOAST_DURATIONS.success ??= 2500;
  t007.TOAST_DURATIONS.error ??= 4500;
  t007.TOAST_DURATIONS.warning ??= 3500;
  t007.TOAST_DURATIONS.info ??= 4000; // default
  t007.TOAST_VIBRATIONS.success ??= [100, 50, 100]; // Short double buzz
  t007.TOAST_VIBRATIONS.warning ??= [300, 100, 300]; // Two long buzzes
  t007.TOAST_VIBRATIONS.error ??= [500, 200, 500]; // Strong long buzz
  t007.TOAST_VIBRATIONS.info ??= [200]; // Single short buzz
  t007.TOAST_ICONS.success ??= `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#27ae60"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 12l3 3l6-6"/></svg>`;
  t007.TOAST_ICONS.error ??= `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e74c3c"/><path fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 8l8 8M16 8l-8 8"/></svg>`;
  t007.TOAST_ICONS.warning ??= `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><path fill="#f1c40f" stroke="#f39c12" stroke-width="2" stroke-linejoin="round" d="M12 3L2.5 20.5A2 2 0 0 0 4.5 23h15a2 2 0 0 0 2-2.5L12 3z"/><circle cx="12" cy="17" r="1.5" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 8v6"/></svg>`;
  t007.TOAST_ICONS.info ??= `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3498db"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 10v6"/><circle cx="12" cy="7" r="1.5" fill="#fff"/></svg>`;
  t007.TOAST_ICONS.loading ??= `<svg class="no-css-fill" width="24" height="24" viewBox="0 0 16 16" fill="none" style="scale:0.75;"><g fill-rule="evenodd" clip-rule="evenodd"><path fill="whitesmoke" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8"/><path fill="gray" d="M7.25.75A.75.75 0 0 1 8 0a8 8 0 0 1 8 8 .75.75 0 0 1-1.5 0A6.5 6.5 0 0 0 8 1.5a.75.75 0 0 1-.75-.75"/></g><animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0" to="360" dur="600ms" repeatCount="indefinite"/></svg>`;
  window.T007_TOAST_CSS_SRC ??= `/T007_TOOLS/T007_toast_library/T007_toast.css`;
  loadResource(T007_TOAST_CSS_SRC);
  window.Toast ??= t007.toast;
  console.log("%cT007 Toasts attached to window!", "color: green");
}

function clamp(min, amount, max) {
  return Math.min(Math.max(amount, min), max);
}
function uid(prefix = "t007_toast_") {
  return `${prefix}${Date.now().toString(36)}_${performance.now().toString(36).replace(".", "")}_${Math.random().toString(36).slice(2)}`;
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
