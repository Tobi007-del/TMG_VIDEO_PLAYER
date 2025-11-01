"use strict";

let _ACTIVE_TOASTS = [];
class T007_Toast {
  #autoCloseInterval;
  #progressInterval;
  #timeVisible = 0;
  #autoClose;
  #vibrate;
  #isPaused = false;
  #unpause;
  #pause;
  #visiblityChange;
  #shouldUnPause;
  #pointerType;
  #pointerStartX;
  #pointerDeltaX;
  #pointerStartY;
  #pointerDeltaY;
  #pointerRAF;
  #pointerTicker = false;

  constructor(options) {
    this.bindMethods();
    _ACTIVE_TOASTS.push(this);
    this.options = { ...t007.TOAST_DEFAULT_OPTIONS, ...options };
    this.toastElement = document.createElement("div");
    this.toastElement.classList = `t007-toast ${this.options.type} ${this.options.icon ? "has-icon" : ""}`;
    requestAnimationFrame(() => this.toastElement.classList.add("t007-toast-show"));
    this.#unpause = () => (this.#isPaused = false);
    this.#pause = () => (this.#isPaused = true);
    this.#visiblityChange = () => (this.#shouldUnPause = document.visibilityState === "visible");
    this.update(this.options);
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

  /**
   * @param {object} options
   */
  update(options) {
    Object.entries(options).forEach(([key, value]) => (this[key] = value));
  }

  /**
   * @param {boolean | string} value
   */
  set autoClose(value) {
    if (value === false) return this.toastElement.classList.remove("progress");
    if (value === true) {
      switch (this.options.type) {
        case "success":
        case "error":
        case "warning":
          value = t007.TOAST_DURATIONS[this.options.type];
          break;
        default:
          value = t007.TOAST_DURATIONS.info;
      }
    }
    this.#autoClose = value;
    this.#timeVisible = 0;

    let lastTime;
    const func = (time) => {
      if (this.#shouldUnPause) {
        lastTime = null;
        this.#shouldUnPause = false;
      }
      if (lastTime == null) {
        lastTime = time;
        return (this.#autoCloseInterval = requestAnimationFrame(func));
      }
      if (!this.#isPaused) {
        this.#timeVisible += time - lastTime;
        this.onTimeUpdate?.(this.#timeVisible);
        if (this.#timeVisible >= this.#autoClose) return this.remove("smooth", true);
      }

      lastTime = time;
      this.#autoCloseInterval = requestAnimationFrame(func);
    };
    this.#autoCloseInterval = requestAnimationFrame(func);
  }

  /**
   * @param {string} value
   */
  set position(value) {
    const currentContainer = this.toastElement.parentElement;
    const selector = `.t007-toast-container[data-position="${value}"]`;
    const container = this.options.rootElement.querySelector(selector) || this.createContainer(value);
    container.append(this.toastElement);
    if (currentContainer == null || currentContainer.hasChildNodes) return;
    currentContainer.remove();
  }

  /**
   * @param {string} value
   */
  set body(body) {
    const type = this.options.type,
      image = this.options.image,
      icon = this.options.icon;
    let defaultIcon = "";
    switch (type) {
      case "info":
        defaultIcon = `<svg class="no-css-fill" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3498db"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 10v6"/><circle cx="12" cy="7" r="1.5" fill="#fff"/></svg>`;
        break;
      case "success":
        defaultIcon = `<svg class="no-css-fill" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#27ae60"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 12l3 3l6-6"/></svg>`;
        break;
      case "error":
        defaultIcon = `<svg class="no-css-fill" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e74c3c"/><path fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 8l8 8M16 8l-8 8"/></svg>`;
        break;
      case "warning":
        defaultIcon = `<svg class="no-css-fill" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#f1c40f" stroke="#f39c12" stroke-width="2" stroke-linejoin="round" d="M12 3L2.5 20.5A2 2 0 0 0 4.5 23h15a2 2 0 0 0 2-2.5L12 3z"/><circle cx="12" cy="17" r="1.5" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 8v6"/></svg>`;
        break;
      default:
        defaultIcon = "";
    }
    this.toastElement.innerHTML = `
      <div class="t007-toast-image-wrapper">
        ${image ? `<img class="t007-toast-image" src="${image}" alt="toast-image">` : ``}
        ${icon ? `<span class="t007-toast-icon">${typeof icon === "string" ? icon : defaultIcon}</span>` : ""}
      </div>
      <span class="t007-toast-body">
        <p class="t007-toast-body-text">${body}</p>
      </span>
      <button title="Close" type="button" class="t007-toast-cancel-button">&times;</button> 
    `;
    this.toastElement.querySelector(".t007-toast-cancel-button").onclick = () => this.remove();
  }

  /**
   * @param {boolean} value
   */
  set closeButton(value) {
    this.toastElement.classList.toggle("can-close", value);
  }

  /**
   * @param {boolean} value
   */
  set closeOnClick(value) {
    this.toastElement.onclick = value ? () => this.remove() : null;
  }

  /**
   * @param {boolean} value
   */
  set showProgress(value) {
    this.toastElement.classList.toggle("progress", value && this.options.autoClose);
    this.toastElement.style.setProperty("--progress", 1);
    if (!value) return;
    const func = () => {
      if (!this.#isPaused) this.toastElement.style.setProperty("--progress", this.#timeVisible / this.#autoClose);
      this.#progressInterval = requestAnimationFrame(func);
    };
    this.#progressInterval = requestAnimationFrame(func);
  }

  /**
   * @param {boolean} value
   */
  set pauseOnHover(value) {
    if (value) {
      this.toastElement.addEventListener("mouseover", this.#pause);
      this.toastElement.addEventListener("mouseleave", this.#unpause);
    } else {
      this.toastElement.removeEventListener("mouseover", this.#pause);
      this.toastElement.removeEventListener("mouseleave", this.#unpause);
    }
  }

  /**
   * @param {boolean} value
   */
  set pauseOnFocusLoss(value) {
    value ? document.addEventListener("visibilitychange", this.#visiblityChange) : document.removeEventListener("visibilitychange", this.#visiblityChange);
  }

  /**
   * @param {boolean} value
   */
  set renotify(value) {
    if (!this.options.tag || !value) return;
    _ACTIVE_TOASTS?.filter((toast) => toast !== this && (toast.options.tag ?? 1) === (this.options.tag ?? 0))?.forEach((toast) => toast.remove("instant"));
  }

  /**
   * @param {boolean|array|number} value
   */
  set vibrate(value) {
    if (!("vibrate" in navigator)) return;
    if (value === false) return;
    if (value === true) {
      switch (this.options.type) {
        case "success":
        case "error":
        case "warning":
          value = t007.TOAST_VIBRATIONS[this.options.type];
          break;
        default:
          value = t007.TOAST_VIBRATIONS.info;
      }
    }
    this.#vibrate = value;
    navigator.vibrate(this.#vibrate);
  }

  /**
   * @param {boolean} value
   */
  set dragToClose(value) {
    this.toastElement.dataset.pointerType = this.#pointerType = value;
    if (value) {
      this.toastElement.addEventListener("pointerdown", this.handleToastPointerStart, { passive: false });
      this.toastElement.addEventListener("pointerup", this.handleToastPointerUp);
    } else {
      this.toastElement.removeEventListener("pointerdown", this.handleToastPointerStart, { passive: false });
      this.toastElement.removeEventListener("pointerup", this.handleToastPointerUp);
    }
  }

  /**
   * @param {object} options
   */
  handleToastPointerStart(e) {
    if (typeof this.#pointerType === "string" && e.pointerType !== this.#pointerType) return;
    if (e.touches?.length > 1) return;
    e.stopImmediatePropagation();
    !e.target.matches("button", "[href]", "input", "select", "textarea", '[tabindex]:not([tabindex="-1"])') && this.toastElement.setPointerCapture(e.pointerId);
    this.#pointerStartX = this.dragToCloseDir.includes("x") ? (e.clientX ?? e.targetTouches[0]?.clientX) : 0;
    this.#pointerStartY = this.dragToCloseDir.includes("x") ? (e.clientY ?? e.targetTouches[0]?.clientY) : 0;
    this.#pointerTicker = false;
    this.toastElement.addEventListener("pointermove", this.handleToastPointerMove, { passive: false });
    this.#isPaused = true;
  }

  /**
   * @param {object} options
   */
  handleToastPointerMove(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.#pointerTicker) return;
    this.#pointerRAF = requestAnimationFrame(() => {
      const x = e.clientX ?? e.targetTouches[0]?.clientX,
        y = e.clientY ?? e.targetTouches[0]?.clientY;
      this.#pointerDeltaX = this.dragToCloseDir.includes("x") ? x - this.#pointerStartX : 0;
      this.#pointerDeltaY = this.dragToCloseDir.includes("y") ? y - this.#pointerStartY : 0;
      this.toastElement.style.setProperty("transition", "none", "important");
      this.toastElement.style.setProperty("transform", `translate(${this.#pointerDeltaX}px, ${this.#pointerDeltaY}px)`, "important");
      const xR = Math.abs(this.#pointerDeltaX) / this.toastElement.offsetWidth,
        yR = Math.abs(this.#pointerDeltaY) / this.toastElement.offsetHeight;
      this.toastElement.style.setProperty("opacity", clamp(0, 1 - (yR > 0.5 ? yR : xR), 1), "important");
      this.#pointerTicker = false;
    });
    this.#pointerTicker = true;
  }

  /**
   * @param {object} options
   */
  handleToastPointerUp(e) {
    if (typeof this.#pointerType === "string" && e.pointerType !== this.#pointerType) return;
    cancelAnimationFrame(this.#pointerRAF);
    if (this.dragToCloseDir.includes("x") ? Math.abs(this.#pointerDeltaX) > this.toastElement.offsetWidth * (this.dragToClosePercent.x ?? this.dragToClosePercent / 100) : Math.abs(this.#pointerDeltaY) > this.toastElement.offsetHeight * (this.dragToClosePercent.y ?? this.dragToClosePercent / 100)) return this.remove("instant");
    this.#pointerTicker = false;
    this.toastElement.removeEventListener("pointermove", this.handleToastPointerMove, { passive: false });
    this.toastElement.style.removeProperty("transition");
    this.toastElement.style.removeProperty("transform");
    this.toastElement.style.removeProperty("opacity");
    this.#isPaused = false;
  }

  /**
   * @param {string} position
   */
  createContainer(position) {
    const container = document.createElement("div");
    container.classList.add("t007-toast-container");
    container.style.setProperty("--t007-toast-container-position", this.options.rootElement === document.body ? "fixed" : "absolute");
    container.dataset.position = position;
    this.options.rootElement.append(container);
    return container;
  }

  cleanUpToast() {
    const container = this.toastElement.parentElement;
    this.toastElement.remove();
    if (container?.hasChildNodes()) return;
    container?.remove();
  }

  remove(manner = "smooth", timeElapsed = false) {
    cancelAnimationFrame(this.#autoCloseInterval);
    cancelAnimationFrame(this.#progressInterval);
    if (manner === "instant") this.cleanUpToast();
    else this.toastElement.addEventListener("animationend", () => this.cleanUpToast());
    this.toastElement.classList.remove("t007-toast-show");
    this.onClose?.(timeElapsed);
    _ACTIVE_TOASTS = _ACTIVE_TOASTS.filter((toast) => toast !== this);
  }
}

const Toast = (() => {
  const base = (body, options = {}) => new T007_Toast({ ...options, body });
  ["info", "success", "warn", "error"].forEach(
    (action) =>
      (base[action] = (body, options = {}) =>
        base(body, {
          ...options,
          type: action === "warn" ? "warning" : action,
        }))
  );
  return base;
})();
export default Toast;

if (typeof window !== "undefined") {
  window.t007 ??= { _resourceCache: {} };
  window.Toast ??= t007.toast = Toast;
  t007.TOAST_DEFAULT_OPTIONS = {
    rootElement: t007.TOAST_DEFAULT_OPTIONS?.rootElement ?? document.body,
    body: t007.TOAST_DEFAULT_OPTIONS?.body ?? "",
    type: t007.TOAST_DEFAULT_OPTIONS?.type ?? "",
    icon: t007.TOAST_DEFAULT_OPTIONS?.icon ?? true,
    image: t007.TOAST_DEFAULT_OPTIONS?.image ?? false,
    autoClose: t007.TOAST_DEFAULT_OPTIONS?.autoClose ?? true,
    position: t007.TOAST_DEFAULT_OPTIONS?.position ?? "top-right",
    onClose: t007.TOAST_DEFAULT_OPTIONS?.onClose ?? function () {},
    onTimeUpdate: t007.TOAST_DEFAULT_OPTIONS?.onTimeUpdate ?? function () {},
    closeButton: t007.TOAST_DEFAULT_OPTIONS?.closeButton ?? true,
    closeOnClick: t007.TOAST_DEFAULT_OPTIONS?.closeOnClick ?? false,
    dragToClose: t007.TOAST_DEFAULT_OPTIONS?.dragToClose ?? true, // mouse, pen, touch
    dragToClosePercent: t007.TOAST_DEFAULT_OPTIONS?.dragToClosePercent ?? 40,
    dragToCloseDir: t007.TOAST_DEFAULT_OPTIONS?.dragToCloseDir ?? "x",
    showProgress: t007.TOAST_DEFAULT_OPTIONS?.showProgress ?? true,
    pauseOnHover: t007.TOAST_DEFAULT_OPTIONS?.pauseOnHover ?? true,
    pauseOnFocusLoss: t007.TOAST_DEFAULT_OPTIONS?.pauseOnFocusLoss ?? true,
    renotify: t007.TOAST_DEFAULT_OPTIONS?.renotify ?? true,
    // tag: t007.TOAST_DEFAULT_OPTIONS?.tag ?? unique,
    vibrate: t007.TOAST_DEFAULT_OPTIONS?.vibrate ?? false,
  };
  t007.TOAST_DURATIONS = {
    success: t007.TOAST_DURATIONS?.success ?? 2500,
    error: t007.TOAST_DURATIONS?.error ?? 4500,
    warning: t007.TOAST_DURATIONS?.warning ?? 3500,
    info: t007.TOAST_DURATIONS?.info ?? 4000, // default
  };
  t007.TOAST_VIBRATIONS = {
    success: t007.TOAST_VIBRATIONS?.success ?? [100, 50, 100], // Short double buzz
    warning: t007.TOAST_VIBRATIONS?.warning ?? [300, 100, 300], // Two long buzzes
    error: t007.TOAST_VIBRATIONS?.error ?? [500, 200, 500], // Strong long buzz
    info: t007.TOAST_VIBRATIONS?.info ?? [200], // Single short buzz
  };
  window.T007_TOAST_CSS_SRC ??= `/T007_TOOLS/T007_toast_library/T007_toast.css`;
  loadResource(T007_TOAST_CSS_SRC);
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
