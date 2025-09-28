window.T007_TOAST_DEFAULT_OPTIONS = {
  body: window.T007_TOAST_DEFAULT_OPTIONS?.body ?? "",
  type: window.T007_TOAST_DEFAULT_OPTIONS?.type ?? "",
  icon: window.T007_TOAST_DEFAULT_OPTIONS?.icon ?? true,
  image: window.T007_TOAST_DEFAULT_OPTIONS?.image ?? false,
  autoClose: window.T007_TOAST_DEFAULT_OPTIONS?.autoClose ?? true,
  position: window.T007_TOAST_DEFAULT_OPTIONS?.position ?? "top-right",
  onClose: window.T007_TOAST_DEFAULT_OPTIONS?.onClose ?? function () {},
  closeButton: window.T007_TOAST_DEFAULT_OPTIONS?.closeButton ?? true,
  closeOnClick: window.T007_TOAST_DEFAULT_OPTIONS?.closeOnClick ?? false,
  dragToClose: window.T007_TOAST_DEFAULT_OPTIONS?.dragToClose ?? true,
  dragToClosePercent: window.T007_TOAST_DEFAULT_OPTIONS?.dragToClosePercent ?? 40,
  dragToCloseDir: window.T007_TOAST_DEFAULT_OPTIONS?.dragToCloseDir ?? "x",
  showProgress: window.T007_TOAST_DEFAULT_OPTIONS?.showProgress ?? true,
  pauseOnHover: window.T007_TOAST_DEFAULT_OPTIONS?.pauseOnHover ?? true,
  pauseOnFocusLoss: window.T007_TOAST_DEFAULT_OPTIONS?.pauseOnFocusLoss ?? true,
  renotify: window.T007_TOAST_DEFAULT_OPTIONS?.renotify ?? true,
  vibrate: window.T007_TOAST_DEFAULT_OPTIONS?.vibrate ?? false,
};
window.T007_TOAST_DURATIONS = {
  success: window.T007_TOAST_DURATIONS?.success ?? 2500,
  error: window.T007_TOAST_DURATIONS?.error ?? 4500,
  warning: window.T007_TOAST_DURATIONS?.warning ?? 3500,
  info: window.T007_TOAST_DURATIONS?.info ?? 4000, // default
};
window.T007_TOAST_VIBRATIONS = {
  success: window.T007_TOAST_VIBRATIONS?.success ?? [100, 50, 100], // Short double buzz
  warning: window.T007_TOAST_VIBRATIONS?.warning ?? [300, 100, 300], // Two long buzzes
  error: window.T007_TOAST_VIBRATIONS?.error ?? [500, 200, 500], // Strong long buzz
  info: window.T007_TOAST_VIBRATIONS?.info ?? [200], // Single short buzz
};

let _ACTIVE_TOASTS = [];
const _RESOURCE_CACHE = {};
function loadResource(src, type = "style", options = {}) {
  const { module = false, media = null, crossorigin = null, integrity = null } = options;
  if (_RESOURCE_CACHE[src]) return _RESOURCE_CACHE[src];
  const isLoaded = (() => {
    if (type === "script") {
      return Array.from(...document.scripts)?.some((s) => s.src?.includes(src));
    } else if (type === "style") {
      return Array.from(document.styleSheets)?.some((s) => s.href?.includes(src));
    }
    return false;
  })();
  if (isLoaded) return Promise.resolve(null);
  _RESOURCE_CACHE[src] = new Promise((resolve, reject) => {
    if (type === "script") {
      const script = document.createElement("script");
      script.src = src;
      if (module) script.type = "module";
      if (crossorigin) script.crossOrigin = crossorigin;
      if (integrity) script.integrity = integrity;
      script.onload = () => resolve(script);
      script.onerror = () => reject(new Error(`Script load error: ${src}`));
      document.body.append(script);
    } else if (type === "style") {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = src;
      if (media) link.media = media;
      link.onload = () => resolve(link);
      link.onerror = () => reject(new Error(`Stylesheet load error: ${src}`));
      document.head.append(link);
    } else {
      reject(new Error(`Unsupported type: ${type}`));
    }
  });
  return _RESOURCE_CACHE[src];
}
loadResource(window.T007_TOAST_CSS_SRC || `/T007_TOOLS/T007_toast_library/T007_toast.css`);

function clamp(min, amount, max) {
  return Math.min(Math.max(amount, min), max);
}

class T007_Toast {
  #toastElem;
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
    this.options = { ...window.T007_TOAST_DEFAULT_OPTIONS, ...options };
    this.#toastElem = document.createElement("div");
    this.#toastElem.classList = `t007-toast ${this.options.type} ${this.options.icon ? "has-icon" : ""}`;
    requestAnimationFrame(() => this.#toastElem.classList.add("t007-toast-show"));
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
   * @param {boolean | string} value
   */
  set autoClose(value) {
    if (value === false) return this.#toastElem.classList.remove("progress");
    if (value === true) {
      switch (this.options.type) {
        case "success":
        case "error":
        case "warning":
          value = window.T007_TOAST_DURATIONS[this.options.type];
          break;
        default:
          value = window.T007_TOAST_DURATIONS.info;
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
        this.#autoCloseInterval = requestAnimationFrame(func);
        return;
      }
      if (!this.#isPaused) {
        this.#timeVisible += time - lastTime;
        if (this.#timeVisible >= this.#autoClose) return this.remove();
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
    const currentContainer = this.#toastElem.parentElement;
    const selector = `.t007-toast-container[data-position="${value}"]`;
    const container = document.querySelector(selector) || this.createContainer(value);
    container.append(this.#toastElem);
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
        defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3498db"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 10v6"/><circle cx="12" cy="7" r="1.5" fill="#fff"/></svg>`;
        break;
      case "success":
        defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#27ae60"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 12l3 3l6-6"/></svg>`;
        break;
      case "error":
        defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e74c3c"/><path fill="#fff" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 8l8 8M16 8l-8 8"/></svg>`;
        break;
      case "warning":
        defaultIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#f1c40f" stroke="#f39c12" stroke-width="2" stroke-linejoin="round" d="M12 3L2.5 20.5A2 2 0 0 0 4.5 23h15a2 2 0 0 0 2-2.5L12 3z"/><circle cx="12" cy="17" r="1.5" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 8v6"/></svg>`;
        break;
      default:
        defaultIcon = "";
    }
    this.#toastElem.innerHTML = `
      <div class="t007-toast-image-wrapper">
        ${image ? `<img class="t007-toast-image" src="${image}" alt="toast-image">` : ``}
        ${icon ? `<span class="t007-toast-icon">${typeof icon === "string" ? icon : defaultIcon}</span>` : ""}
      </div>
      <span class="t007-toast-body">
        <p class="t007-toast-body-text">${body}</p>
      </span>
      <button title="Close" type="button" class="t007-toast-cancel-button">&times;</button> 
    `;
    this.#toastElem.querySelector(".t007-toast-cancel-button").addEventListener("click", this.remove);
  }

  /**
   * @param {boolean} value
   */
  set closeButton(value) {
    this.#toastElem.classList.toggle("can-close", value);
  }

  /**
   * @param {boolean} value
   */
  set closeOnClick(value) {
    value ? this.#toastElem.addEventListener("click", this.remove) : this.#toastElem.removeEventListener("click", this.remove);
  }

  /**
   * @param {boolean} value
   */
  set dragToClose(value) {
    if (value) {
      this.#pointerType = value;
      this.#toastElem.addEventListener("pointerdown", this.handleToastPointerStart, { passive: false });
      this.#toastElem.addEventListener("pointerup", this.handleToastPointerUp);
    } else {
      this.#toastElem.removeEventListener("pointerdown", this.handleToastPointerStart, { passive: false });
      this.#toastElem.removeEventListener("pointerup", this.handleToastPointerUp);
    }
  }

  /**
   * @param {object} options
   */
  handleToastPointerStart(e) {
    if (typeof this.#pointerType === "string" && e.pointerType !== this.#pointerType) return;
    if (e.touches?.length > 1) return;
    e.stopImmediatePropagation();
    this.#pointerStartX = this.dragToCloseDir.includes("x") ? (e.clientX ?? e.targetTouches[0]?.clientX) : 0;
    this.#pointerStartY = this.dragToCloseDir.includes("x") ? (e.clientY ?? e.targetTouches[0]?.clientY) : 0;
    this.#pointerTicker = false;
    this.#toastElem.addEventListener("pointermove", this.handleToastPointerMove, { passive: false });
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
      this.#toastElem.style.setProperty("transition", "none", "important");
      this.#toastElem.style.setProperty("transform", `translate(${this.#pointerDeltaX}px, ${this.#pointerDeltaY}px)`, "important");
      const xR = Math.abs(this.#pointerDeltaX) / this.#toastElem.offsetWidth,
        yR = Math.abs(this.#pointerDeltaY) / this.#toastElem.offsetHeight;
      this.#toastElem.style.setProperty("opacity", clamp(0, 1 - (yR > 0.5 ? yR : xR), 1), "important");
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
    if (this.dragToCloseDir.includes("x") ? Math.abs(this.#pointerDeltaX) > this.#toastElem.offsetWidth * (this.dragToClosePercent.x ?? this.dragToClosePercent / 100) : Math.abs(this.#pointerDeltaY) > this.#toastElem.offsetHeight * (this.dragToClosePercent.y ?? this.dragToClosePercent / 100)) return this.remove("instant");
    this.#pointerTicker = false;
    this.#toastElem.removeEventListener("pointermove", this.handleToastPointerMove, { passive: false });
    this.#toastElem.style.removeProperty("transition");
    this.#toastElem.style.removeProperty("transform");
    this.#toastElem.style.removeProperty("opacity");
    this.#isPaused = false;
  }

  /**
   * @param {boolean} value
   */
  set showProgress(value) {
    this.#toastElem.classList.toggle("progress", value && this.options.autoClose);
    this.#toastElem.style.setProperty("--progress", 1);

    if (value) {
      const func = () => {
        if (!this.#isPaused) this.#toastElem.style.setProperty("--progress", this.#timeVisible / this.#autoClose);
        this.#progressInterval = requestAnimationFrame(func);
      };

      this.#progressInterval = requestAnimationFrame(func);
    }
  }

  /**
   * @param {boolean} value
   */
  set pauseOnHover(value) {
    if (value) {
      this.#toastElem.addEventListener("mouseover", this.#pause);
      this.#toastElem.addEventListener("mouseleave", this.#unpause);
    } else {
      this.#toastElem.removeEventListener("mouseover", this.#pause);
      this.#toastElem.removeEventListener("mouseleave", this.#unpause);
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
    if (!this.options.tag) return;
    if (value) {
      _ACTIVE_TOASTS?.filter((toast) => toast !== this && (toast.options.tag ?? 1) === (this.options.tag ?? 0))?.forEach((toast) => toast.remove("instant"));
    }
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
          value = window.T007_TOAST_VIBRATIONS[this.options.type];
          break;
        default:
          value = window.T007_TOAST_VIBRATIONS.info;
      }
    }
    this.#vibrate = value;
    navigator.vibrate(this.#vibrate);
  }

  /**
   * @param {string} position
   */
  createContainer(position) {
    const container = document.createElement("div");
    container.classList.add("t007-toast-container");
    container.dataset.position = position;
    document.body.append(container);
    return container;
  }

  /**
   * @param {object} options
   */
  update(options) {
    Object.entries(options).forEach(([key, value]) => (this[key] = value));
  }

  cleanUpToast() {
    const container = this.#toastElem.parentElement;
    this.#toastElem.remove();
    if (container?.hasChildNodes()) return;
    container?.remove();
  }

  remove(manner = "smooth") {
    cancelAnimationFrame(this.#autoCloseInterval);
    cancelAnimationFrame(this.#progressInterval);
    if (manner === "instant") this.cleanUpToast();
    else this.#toastElem.addEventListener("animationend", () => this.cleanUpToast());
    this.#toastElem.classList.remove("t007-toast-show");
    this.onClose();
    _ACTIVE_TOASTS = _ACTIVE_TOASTS.filter((toast) => toast !== this);
  }
}

export default (function t007Toast() {
  const base = (body, options = {}) => new T007_Toast({ ...options, body });
  base.info = (body, options = {}) => base(body, { ...options, type: "info" });
  base.error = (body, options = {}) => base(body, { ...options, type: "error" });
  base.success = (body, options = {}) => base(body, { ...options, type: "success" });
  base.warn = (body, options = {}) => base(body, { ...options, type: "warning" });
  return base;
})();
