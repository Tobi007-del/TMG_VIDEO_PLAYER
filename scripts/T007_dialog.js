"use strict";

class T007_Dialog {
  dialog;
  confirmBtn;
  cancelBtn;
  constructor(resolve) {
    bindMethods(this);
    this.resolve = resolve;
    this.dialog = document.createElement("dialog");
    this.dialog.closedBy = "any";
    this.dialog.classList.add("t007-dialog");
    document.body.append(this.dialog);
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
  loadResource(T007_DIALOG_CSS_SRC);
  loadResource(window.T007_INPUT_JS_SRC, "script");
  window.Alert ??= t007.alert;
  window.Confirm ??= t007.confirm;
  window.Prompt ??= t007.prompt;
  console.log("%cT007 Dialogs attached to window!", "color: darkturquoise");
}

function bindMethods(owner, callback = (method, owner) => (owner[method] = owner[method].bind(owner))) {
  let proto = owner;
  while (proto && proto !== Object.prototype) {
    for (const method of Object.getOwnPropertyNames(proto)) method !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, method)?.value === "function" && callback(method, owner);
    proto = Object.getPrototypeOf(proto);
  }
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
  if (type === "script" ? Array.prototype.some.call(document.scripts, (s) => isSameURL(s.src, src)) : type === "style" ? Array.prototype.some.call(document.styleSheets, (s) => isSameURL(s.href, src)) : false) return Promise.resolve();
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
