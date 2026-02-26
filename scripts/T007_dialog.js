"use strict";

class T007_Dialog {
  dialog;
  confirmBtn;
  cancelBtn;
  constructor(resolve) {
    bindMethods(this);
    this.resolve = resolve;
    document.body.append((this.dialog = createEl("dialog", { className: "t007-dialog", closedBy: "any" })));
    this.dialog.addEventListener("cancel", this.cancel);
  }
  show() {
    this.dialog.showModal();
    this.confirmBtn.focus();
  }
  remove() {
    this.dialog.close();
    this.dialog.remove();
  }
  confirm() {
    this.remove();
    this.resolve(true);
  }
  cancel() {
    this.remove();
    this.resolve(false);
  }
}

class T007_Alert_Dialog extends T007_Dialog {
  constructor({ message, resolve, options }) {
    super(resolve);
    this.render(message, options);
  }
  render(message, options = {}) {
    this.dialog.innerHTML = `
      <div class="t007-dialog-top-section">
        <p class="t007-dialog-question">${message}</p>
      </div>
      <div class="t007-dialog-bottom-section">
        <button class="t007-dialog-confirm-button" type="button">${options.confirmText || "OK"}</button>
      </div>
    `;
    this.confirmBtn = this.dialog.querySelector(".t007-dialog-confirm-button");
    this.confirmBtn.addEventListener("click", this.confirm);
    this.show();
  }
}

class T007_Confirm_Dialog extends T007_Dialog {
  constructor({ question, resolve, options }) {
    super(resolve);
    this.render(question, options);
  }
  render(question, options = {}) {
    this.dialog.innerHTML = `
      <div class="t007-dialog-top-section">
        <p class="t007-dialog-question">${question}</p>
      </div>
      <div class="t007-dialog-bottom-section">
        <button class="t007-dialog-confirm-button" type="button">${options.confirmText || "OK"}</button>
        <button class="t007-dialog-cancel-button" type="button">${options.cancelText || "Cancel"}</button>
      </div>
    `;
    this.confirmBtn = this.dialog.querySelector(".t007-dialog-confirm-button");
    this.cancelBtn = this.dialog.querySelector(".t007-dialog-cancel-button");
    this.confirmBtn.addEventListener("click", this.confirm);
    this.cancelBtn.addEventListener("click", this.cancel);
    this.show();
  }
}

class T007_Prompt_Dialog extends T007_Dialog {
  constructor({ question, defaultValue, resolve, options }) {
    super(resolve);
    this.render(question, defaultValue, options);
  }
  async render(question, defaultValue, options = {}) {
    await loadResource(window.T007_INPUT_JS_SRC, "script");
    options.value = defaultValue;
    this.dialog.innerHTML = `
      <form class="t007-input-form" novalidate>
        <div class="t007-dialog-top-section">
          <p class="t007-dialog-question">${question}</p>
        </div>
          ${createField?.(options)?.outerHTML}
        <div class="t007-dialog-bottom-section">
          <button class="t007-dialog-confirm-button" type="submit">${options.confirmText || "OK"}</button>
          <button class="t007-dialog-cancel-button" type="button">${options.cancelText || "Cancel"}</button>
        </div>
      </form>
    `;
    this.confirmBtn = this.dialog.querySelector(".t007-dialog-confirm-button");
    this.cancelBtn = this.dialog.querySelector(".t007-dialog-cancel-button");
    this.cancelBtn.addEventListener("click", this.cancel);
    this.form = this.dialog.querySelector("form");
    this.form.onSubmit = this.confirm;
    t007.FM?.handleFormValidation?.(this.form);
    this.show();
  }
  show() {
    this.dialog.showModal();
    this.form.elements[0]?.focus();
    this.form.elements[0]?.select?.();
  }
  confirm() {
    this.remove();
    this.resolve(this.form.elements[0]?.value);
  }
  cancel() {
    this.remove();
    this.resolve(null);
  }
}

export function Alert(message, options) {
  return new Promise((resolve) => new T007_Alert_Dialog({ message, resolve, options }));
}

export function Confirm(question, options) {
  return new Promise((resolve) => new T007_Confirm_Dialog({ question, resolve, options }));
}

export function Prompt(question, defaultValue, options) {
  return new Promise((resolve) => new T007_Prompt_Dialog({ question, defaultValue, resolve, options }));
}

if (typeof window !== "undefined") {
  window.t007 ??= { _resourceCache: {} };
  window.T007_DIALOG_CSS_SRC ??= `/T007_TOOLS/T007_dialog_library/T007_dialog.css`;
  window.T007_INPUT_JS_SRC ??= `/T007_TOOLS/T007_input_library/T007_input.js`;
  t007.alert = Alert;
  t007.confirm = Confirm;
  t007.prompt = Prompt;
  (loadResource(T007_DIALOG_CSS_SRC), loadResource(window.T007_INPUT_JS_SRC, "script"));
  window.Alert ??= t007.alert;
  window.Confirm ??= t007.confirm;
  window.Prompt ??= t007.prompt;
  console.log("%cT007 Dialogs attached to window!", "color: darkturquoise");
}

// UTILS
function bindMethods(owner, callback = (method, owner) => (owner[method] = owner[method].bind(owner))) {
  let proto = owner;
  while (proto && proto !== Object.prototype) {
    for (const method of Object.getOwnPropertyNames(proto)) method !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, method)?.value === "function" && callback(method, owner);
    proto = Object.getPrototypeOf(proto);
  }
}
function createEl(tag, props = {}, dataset = {}, styles = {}) {
  const el = tag ? document.createElement(tag) : null;
  for (const k of Object.keys(props)) if (el && props[k] !== undefined) el[k] = props[k];
  for (const k of Object.keys(dataset)) if (el && dataset[k] !== undefined) el.dataset[k] = dataset[k];
  for (const k of Object.keys(styles)) if (el && styles[k] !== undefined) el.style[k] = styles[k];
  return el;
}
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
function loadResource(src, type = "style", { module, media, crossOrigin, integrity, referrerPolicy, nonce, fetchPriority, attempts = 3, retryKey = false } = {}) {
  ((window.t007 ??= {}), (t007._resourceCache ??= {}));
  if (t007._resourceCache[src]) return t007._resourceCache[src];
  if (type === "script" ? Array.prototype.some.call(document.scripts, (s) => isSameURL(s.src, src)) : type === "style" ? Array.prototype.some.call(document.styleSheets, (s) => isSameURL(s.href, src)) : false) return Promise.resolve();
  t007._resourceCache[src] = new Promise((resolve, reject) => {
    (function tryLoad(remaining, el) {
      const onerror = () => {
        el?.remove(); // Remove failed element before retry
        if (remaining > 1) (setTimeout(tryLoad, 1000, remaining - 1), console.warn(`Retrying ${type} load (${attempts - remaining + 1}): ${src}...`));
        else (delete t007._resourceCache[src], reject(new Error(`${type} load failed after ${attempts} attempts: ${src}`))); // Final fail: clear cache so user can manually retry
      };
      const url = retryKey && remaining < attempts ? `${src}${src.includes("?") ? "&" : "?"}_${retryKey}=${Date.now()}` : src;
      if (type === "script") document.body.append((el = createEl("script", { src: url, type: module ? "module" : "text/javascript", crossOrigin, integrity, referrerPolicy, nonce, fetchPriority, onload: () => resolve(el), onerror })));
      else if (type === "style") document.head.append((el = createEl("link", { rel: "stylesheet", href: url, media, crossOrigin, integrity, referrerPolicy, nonce, fetchPriority, onload: () => resolve(el), onerror })));
      else reject(new Error(`Unsupported resource type: ${type}`));
    })(attempts);
  });
  return t007._resourceCache[src];
}
