"use strict";

var T007_Form_Manager = {
  forms: document.getElementsByClassName("t007-input-form"),
  violationKeys: ["valueMissing", "typeMismatch", "patternMismatch", "stepMismatch", "tooShort", "tooLong", "rangeUnderflow", "rangeOverflow", "badInput", "customError"],
  init() {
    t007.FM.observeDOMForFields();
    Array.from(t007.FM.forms).forEach(t007.FM.handleFormValidation);
  },
  _SCROLLER_R_OBSERVER: typeof window !== "undefined" && new ResizeObserver((entries) => entries.forEach(({ target }) => t007.FM._SCROLLERS.get(target)?.update())),
  _SCROLLER_M_OBSERVER:
    typeof window !== "undefined" &&
    new MutationObserver((entries) => {
      const els = new Set();
      for (const entry of entries) {
        let node = entry.target;
        while (node && !t007.FM._SCROLLERS.has(node)) node = node.parentElement;
        if (node) els.add(node);
      }
      for (const el of els) t007.FM._SCROLLERS.get(el)?.update();
    }),
  _SCROLLERS: new WeakMap(),
  initScrollAssist(el, { pxPerSecond = 80, assistClassName = "t007-input-scroll-assist", vertical = true, horizontal = true } = {}) {
    const parent = el?.parentElement;
    if (!parent || t007.FM._SCROLLERS.has(el)) return;
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
    const stop = () => (cancelAnimationFrame(scrollId), (scrollId = null));
    const addAssist = (dir) => {
      const div = Object.assign(document.createElement("div"), { className: assistClassName, style: "display:none" });
      div.dataset.scrollDirection = dir;
      ["pointerenter", "dragenter"].forEach((e) => div.addEventListener(e, () => scroll(dir)));
      ["pointerleave", "pointerup", "pointercancel", "dragleave", "dragend"].forEach((e) => div.addEventListener(e, stop));
      (dir === "left" || dir === "up" ? parent.insertBefore : parent.append).call(parent, div, el);
      assist[dir] = div;
    };
    if (horizontal) ["left", "right"].forEach(addAssist);
    if (vertical) ["up", "down"].forEach(addAssist);
    el.addEventListener("scroll", update);
    t007.FM._SCROLLER_R_OBSERVER.observe(el);
    t007.FM._SCROLLER_M_OBSERVER.observe(el, { childList: true, subtree: true, characterData: true });
    t007.FM._SCROLLERS.set(el, {
      update,
      destroy() {
        stop();
        el.removeEventListener("scroll", update);
        t007.FM._SCROLLER_R_OBSERVER.unobserve(el);
        t007.FM._SCROLLERS.delete(el);
        Object.values(assist).forEach((a) => a.remove());
      },
    });
    update();
    return t007.FM._SCROLLERS.get(el);
  },
  removeScrollAssist: (el) => t007.FM._SCROLLERS.get(el)?.destroy(),
  observeDOMForFields() {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node.tagName || !(node?.classList?.contains("t007-input-field") || node?.querySelector?.(".t007-input-field"))) continue;
          for (const field of [...(node.querySelector(".t007-input-field") ? node.querySelectorAll(".t007-input-field") : [node])]) t007.FM.setUpField(field);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  },
  getFilesHelper(files, opts) {
    if (!files || !files.length) return { violation: null, message: "" };
    const totalFiles = files.length;
    let totalSize = 0;
    let currFiles = 0;
    const setMaxError = (size, max, n = 0) => ({ violation: "rangeOverflow", message: n ? `File ${files.length > 1 ? n : ""} size of ${t007.FM.formatSize(size)} exceeds the per file maximum of ${t007.FM.formatSize(max)}` : `Total files size of ${t007.FM.formatSize(size)} exceeds the total maximum of ${t007.FM.formatSize(max)}` });
    const setMinError = (size, min, n = 0) => ({ violation: "rangeUnderflow", message: n ? `File ${files.length > 1 ? n : ""} size of ${t007.FM.formatSize(size)} is less than the per file minimum of ${t007.FM.formatSize(min)}` : `Total files size of ${t007.FM.formatSize(size)} is less than the total minimum of ${t007.FM.formatSize(min)}` });
    for (const file of files) {
      currFiles++;
      totalSize += file.size;
      // Type check
      if (opts.accept) {
        const acceptedTypes =
          opts.accept
            .split(",")
            .map((type) => type.trim().replace(/^[*\.]+|[*\.]+$/g, ""))
            .filter(Boolean) || [];
        if (!acceptedTypes.some((type) => file.type.includes(type))) return { violation: "typeMismatch", message: `File${currFiles > 1 ? currFiles : ""} type of '${file.type}' is not accepted.` };
      }
      // Per file size limits
      if (opts.maxSize && file.size > opts.maxSize) return setMaxError(file.size, opts.maxSize, currFiles);
      if (opts.minSize && file.size < opts.minSize) return setMinError(file.size, opts.minSize, currFiles);
      // Multi-file checks
      if (opts.multiple) {
        if (opts.maxTotalSize && totalSize > opts.maxTotalSize) return setMaxError(totalSize, opts.maxTotalSize);
        if (opts.minTotalSize && totalSize < opts.minTotalSize) return setMinError(totalSize, opts.minTotalSize);
        if (opts.maxLength && totalFiles > opts.maxLength) return { violation: "tooLong", message: `Selected ${totalFiles} files exceeds the maximum of ${opts.maxLength} allowed file${opts.maxLength == 1 ? "" : "s"}` };
        if (opts.minLength && totalFiles < opts.minLength) return { violation: "tooShort", message: `Selected ${totalFiles} files is less than the minimum of ${opts.minLength} allowed file${opts.minLength == 1 ? "" : "s"}` };
      }
    }
    return { violation: null, message: "" }; // No errors
  },
  formatSize(size, decimals = 3, base = 1e3) {
    if (size < base) return `${size} byte${size == 1 ? "" : "s"}`;
    const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
      exponent = Math.min(Math.floor(Math.log(size) / Math.log(base)), units.length - 1);
    return `${(size / Math.pow(base, exponent)).toFixed(decimals).replace(/\.0+$/, "")} ${units[exponent]}`;
  },
  togglePasswordType: (input) => (input.type = input.type === "password" ? "text" : "password"),
  toggleFilled: (input) => input?.toggleAttribute("data-filled", input.type === "checkbox" || input.type === "radio" ? input.checked : input.value !== "" || input.files?.length > 0),
  setFallbackHelper(field) {
    const helperTextWrapper = field?.querySelector(".t007-input-helper-text-wrapper");
    if (!helperTextWrapper || helperTextWrapper.querySelector(".t007-input-helper-text[data-violation='auto']")) return;
    const el = document.createElement("p");
    el.className = "t007-input-helper-text";
    el.setAttribute("data-violation", "auto");
    helperTextWrapper.append(el);
  },
  setFieldListeners(field) {
    if (!field) return;
    const input = field.querySelector(".t007-input"),
      floatingLabel = field.querySelector(".t007-input-floating-label"),
      eyeOpen = field.querySelector(".t007-input-password-visible-icon"),
      eyeClosed = field.querySelector(".t007-input-password-hidden-icon");
    if (input.type === "file")
      input.addEventListener("input", async () => {
        const file = input.files?.[0],
          img = new Image();
        img.onload = () => {
          input.style.setProperty("--t007-input-image-src", `url(${src})`);
          input.classList.add("t007-input-image-selected");
          setTimeout(() => URL.revokeObjectURL(src), 1000);
        };
        img.onerror = () => {
          input.style.removeProperty("--t007-input-image-src");
          input.classList.remove("t007-input-image-selected");
          URL.revokeObjectURL(src);
        };
        let src;
        if (file?.type?.startsWith("image")) src = URL.createObjectURL(file);
        else if (file?.type?.startsWith("video")) {
          src = await new Promise((resolve) => {
            let video = document.createElement("video"),
              canvas = document.createElement("canvas"),
              context = canvas.getContext("2d");
            video.ontimeupdate = () => {
              context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
              canvas.toBlob((blob) => resolve(URL.createObjectURL(blob)));
              URL.revokeObjectURL(video.src);
              video = video.src = video.onloadedmetadata = video.ontimeupdate = null;
            };
            video.onloadeddata = () => (video.currentTime = 3);
            video.src = URL.createObjectURL(file);
          });
        }
        if (!src) {
          input.style.removeProperty("--t007-input-image-src");
          input.classList.remove("t007-input-image-selected");
          return;
        }
        img.src = src;
      });
    if (floatingLabel) floatingLabel.ontransitionend = () => floatingLabel.classList.remove("t007-input-shake");
    if (eyeOpen && eyeClosed) eyeOpen.onclick = eyeClosed.onclick = () => t007.FM.togglePasswordType(input);
    t007.FM.initScrollAssist(field.querySelector(".t007-input-helper-text-wrapper"));
  },
  setUpField(field) {
    if (field.dataset.setUp) return;
    t007.FM.toggleFilled(field.querySelector(".t007-input"));
    t007.FM.setFallbackHelper(field);
    t007.FM.setFieldListeners(field);
    field.dataset.setUp = "true";
  },
  createField({ isWrapper = false, label = "", type = "text", placeholder = "", custom = "", minSize, maxSize, minTotalSize, maxTotalSize, options = [], indeterminate = false, eyeToggler = true, passwordMeter = true, helperText = {}, className = "", fieldClassName = "", children, startIcon = "", endIcon = "", nativeIcon = "", passwordVisibleIcon = "", passwordHiddenIcon = "", ...otherProps }) {
    const isSelect = type === "select";
    const isTextArea = type === "textarea";
    const isCheckboxOrRadio = type === "checkbox" || type === "radio";
    const field = document.createElement("div");
    field.className = `t007-input-field${isWrapper ? " t007-input-is-wrapper" : ""}${indeterminate ? " t007-input-indeterminate" : ""}${!!nativeIcon ? " t007-input-icon-override" : ""}${helperText === false ? " t007-input-no-helper" : ""}${fieldClassName ? ` ${fieldClassName}` : ""}`;
    const labelEl = document.createElement("label");
    labelEl.className = isCheckboxOrRadio ? `t007-input-${type}-wrapper` : "t007-input-wrapper";
    field.append(labelEl);
    if (isCheckboxOrRadio) {
      labelEl.innerHTML = `
        <span class="t007-input-${type}-box">
          <span class="t007-input-${type}-tag"></span>
        </span>
        <span class="t007-input-${type}-label">${label}</span>
      `;
    } else {
      const outline = document.createElement("span");
      outline.className = "t007-input-outline";
      outline.innerHTML = `
        <span class="t007-input-outline-leading"></span>
        <span class="t007-input-outline-notch">
          <span class="t007-input-floating-label">${label}</span>
        </span>
        <span class="t007-input-outline-trailing"></span>
      `;
      labelEl.append(outline);
    }
    const inputEl = document.createElement(isTextArea ? "textarea" : isSelect ? "select" : "input");
    // Insert options if select
    if (isSelect && Array.isArray(options)) inputEl.innerHTML = options.map((opt) => (typeof opt === "string" ? `<option value="${opt}">${opt}</option>` : `<option value="${opt.value}">${opt.option}</option>`)).join("");
    inputEl.className = `t007-input${className ? ` ${className}` : ""}`;
    if (!isSelect && !isTextArea) inputEl.type = type;
    inputEl.placeholder = placeholder;
    if (custom) inputEl.setAttribute("custom", custom);
    if (minSize) inputEl.setAttribute("minsize", minSize);
    if (maxSize) inputEl.setAttribute("maxsize", maxSize);
    if (minTotalSize) inputEl.setAttribute("mintotalsize", minTotalSize);
    if (maxTotalSize) inputEl.setAttribute("maxtotalsize", maxTotalSize);
    // Drill other props into input, quite reckless though but necessary
    Object.entries(otherProps).forEach(([key, val]) => (inputEl[key] = val));
    // Append main input/textarea/select
    labelEl.append(!isWrapper ? inputEl : children);
    // Native or end icon for date/time/month/datetime-local
    const nativeTypes = ["date", "time", "month", "datetime-local"];
    if (nativeTypes.includes(type) && nativeIcon) {
      const icon = document.createElement("i");
      icon.className = "t007-input-icon";
      icon.innerHTML = nativeIcon;
      labelEl.append(icon);
    } else if (endIcon) {
      const icon = document.createElement("i");
      icon.className = "t007-input-icon";
      icon.innerHTML = endIcon;
      labelEl.append(icon);
    }
    // Password toggle eye icons
    if (type === "password" && eyeToggler) {
      const visibleIcon = document.createElement("i");
      visibleIcon.className = "t007-input-icon t007-input-password-visible-icon";
      visibleIcon.setAttribute("aria-label", "Show password");
      visibleIcon.setAttribute("role", "button");
      visibleIcon.innerHTML =
        passwordVisibleIcon ||
        /* Default open eye SVG */
        `<svg width="24" height="24"><path fill="rgba(0,0,0,.54)" d="M12 16q1.875 0 3.188-1.312Q16.5 13.375 16.5 11.5q0-1.875-1.312-3.188Q13.875 7 12 7q-1.875 0-3.188 1.312Q7.5 9.625 7.5 11.5q0 1.875 1.312 3.188Q10.125 16 12 16Zm0-1.8q-1.125 0-1.912-.788Q9.3 12.625 9.3 11.5t.788-1.913Q10.875 8.8 12 8.8t1.913.787q.787.788.787 1.913t-.787 1.912q-.788.788-1.913.788Zm0 4.8q-3.65 0-6.65-2.038-3-2.037-4.35-5.462 1.35-3.425 4.35-5.463Q8.35 4 12 4q3.65 0 6.65 2.037 3 2.038 4.35 5.463-1.35 3.425-4.35 5.462Q15.65 19 12 19Z"/></svg>`;
      labelEl.append(visibleIcon);
      const hiddenIcon = document.createElement("i");
      hiddenIcon.className = "t007-input-icon t007-input-password-hidden-icon";
      hiddenIcon.setAttribute("aria-label", "Hide password");
      hiddenIcon.setAttribute("role", "button");
      hiddenIcon.innerHTML =
        passwordHiddenIcon ||
        /* Default closed eye SVG */
        `<svg width="24" height="24"><path fill="rgba(0,0,0,.54)" d="m19.8 22.6-4.2-4.15q-.875.275-1.762.413Q12.95 19 12 19q-3.775 0-6.725-2.087Q2.325 14.825 1 11.5q.525-1.325 1.325-2.463Q3.125 7.9 4.15 7L1.4 4.2l1.4-1.4 18.4 18.4ZM12 16q.275 0 .512-.025.238-.025.513-.1l-5.4-5.4q-.075.275-.1.513-.025.237-.025.512 0 1.875 1.312 3.188Q10.125 16 12 16Zm7.3.45-3.175-3.15q.175-.425.275-.862.1-.438.1-.938 0-1.875-1.312-3.188Q13.875 7 12 7q-.5 0-.938.1-.437.1-.862.3L7.65 4.85q1.025-.425 2.1-.638Q10.825 4 12 4q3.775 0 6.725 2.087Q21.675 8.175 23 11.5q-.575 1.475-1.512 2.738Q20.55 15.5 19.3 16.45Zm-4.625-4.6-3-3q.7-.125 1.288.112.587.238 1.012.688.425.45.613 1.038.187.587.087 1.162Z"/></svg>`;
      labelEl.append(hiddenIcon);
    }
    // Helper line
    if (helperText !== false) {
      const helperLine = document.createElement("div");
      helperLine.className = "t007-input-helper-line";
      const helperWrapper = document.createElement("div");
      helperWrapper.className = "t007-input-helper-text-wrapper";
      // Info text
      if (helperText.info) {
        const info = document.createElement("p");
        info.className = "t007-input-helper-text";
        info.setAttribute("data-violation", "none");
        info.textContent = helperText.info;
        helperWrapper.append(info);
      }
      // Violation texts
      if (typeof window !== "undefined" && t007.FM?.violationKeys) {
        t007.FM.violationKeys.forEach((key) => {
          if (!helperText[key]) return;
          const el = document.createElement("p");
          el.className = "t007-input-helper-text";
          el.setAttribute("data-violation", "t007-input-error");
          el.setAttribute("data-violation", key);
          el.textContent = helperText[key];
          helperWrapper.append(el);
        });
      }
      helperLine.append(helperWrapper);
      field.append(helperLine);
    }
    // Password strength meter
    if (passwordMeter && type === "password") {
      const meter = document.createElement("div");
      meter.className = "t007-input-password-meter";
      meter.dataset.strengthLevel = "1";
      meter.innerHTML = `
        <div class="t007-input-password-strength-meter">
          <div class="t007-input-p-weak"></div>
          <div class="t007-input-p-fair"></div>
          <div class="t007-input-p-strong"></div>
          <div class="t007-input-p-very-strong"></div>
        </div>
      `;
      field.append(meter);
    }
    return field;
  },
  handleFormValidation(form) {
    if (!form?.classList.contains("t007-input-form") || form.dataset?.isValidating) return;
    form.dataset.isValidating = "true";
    form.validateOnClient = validateFormOnClient;
    form.toggleGlobalError = toggleFormGlobalError;
    const fields = form.getElementsByClassName("t007-input-field"),
      inputs = form.getElementsByClassName("t007-input");
    Array.from(fields).forEach(t007.FM.setUpField);
    form.addEventListener("input", ({ target }) => {
      t007.FM.toggleFilled(target);
      validateInput(target);
    });
    form.addEventListener("focusout", ({ target }) => validateInput(target, true));
    form.addEventListener("submit", async (e) => {
      toggleSubmitLoader(true);
      try {
        e.preventDefault();
        if (!validateFormOnClient()) return;
        if (form.validateOnServer && !(await form.validateOnServer())) {
          toggleFormGlobalError(true);
          form.addEventListener("input", () => toggleFormGlobalError(false), { once: true, useCapture: true });
          return;
        }
        form.onSubmit ? form.onSubmit() : form.submit();
      } catch (error) {
        console.error(error);
      }
      toggleSubmitLoader(false);
    });
    function toggleSubmitLoader(bool) {
      form.classList.toggle("t007-input-submit-loading", bool);
    }
    function toggleError(input, bool, flag = false) {
      const field = input.closest(".t007-input-field"),
        floatingLabel = field.querySelector(".t007-input-floating-label");
      if (bool && flag) {
        input.setAttribute("data-error", "");
        floatingLabel?.classList.add("t007-input-shake");
      } else if (!bool) input.removeAttribute("data-error");
      toggleHelper(input, input.hasAttribute("data-error"));
    }
    function toggleHelper(input, bool) {
      const field = input.closest(".t007-input-field"),
        violation = t007.FM.violationKeys.find((violation) => input.Validity?.[violation] || input.validity[violation]) ?? "",
        helper = field.querySelector(`.t007-input-helper-text[data-violation="${violation}"]`),
        fallbackHelper = field.querySelector(`.t007-input-helper-text[data-violation="auto"]`);
      input
        .closest(".t007-input-field")
        .querySelectorAll(`.t007-input-helper-text:not([data-violation="${violation}"])`)
        .forEach((helper) => helper?.classList.remove("t007-input-show"));
      if (helper) helper.classList.toggle("t007-input-show", bool);
      else if (fallbackHelper) {
        fallbackHelper.textContent = input.validationMessage;
        fallbackHelper.classList.toggle("t007-input-show", bool);
      }
    }
    function forceRevalidate(input) {
      input.checkValidity();
      input.dispatchEvent(new Event("input"));
    }
    function updatePasswordMeter(input) {
      const passwordMeter = input.closest(".t007-input-field").querySelector(".t007-input-password-meter");
      if (!passwordMeter) return;
      const value = input.value?.trim();
      let strengthLevel = 0;
      if (value.length < Number(input.minLength ?? 0)) strengthLevel = 1;
      else {
        if (/[a-z]/.test(value)) strengthLevel++;
        if (/[A-Z]/.test(value)) strengthLevel++;
        if (/[0-9]/.test(value)) strengthLevel++;
        if (/[\W_]/.test(value)) strengthLevel++;
      }
      passwordMeter.dataset.strengthLevel = strengthLevel;
    }
    function validateInput(input, flag = false) {
      if (form.dataset.globalError || !input?.classList.contains("t007-input")) return;
      updatePasswordMeter(input);
      let value, errorBool;
      switch (input.custom ?? input.getAttribute("custom")) {
        case "password":
          value = input.value?.trim();
          if (value === "") break;
          const confirmPasswordInput = Array.from(inputs).find((input) => (input.custom ?? input.getAttribute("custom")) === "confirm-password");
          if (!confirmPasswordInput) break;
          const confirmPasswordValue = confirmPasswordInput.value?.trim();
          confirmPasswordInput.setCustomValidity(value !== confirmPasswordValue ? "Both passwords do not match" : "");
          toggleError(confirmPasswordInput, value !== confirmPasswordValue, flag);
          break;
        case "confirm_password":
          value = input.value?.trim();
          if (value === "") break;
          const passwordInput = Array.from(inputs).find((input) => (input.custom ?? input.getAttribute("custom")) === "password");
          if (!passwordInput) break;
          const passwordValue = passwordInput.value?.trim();
          errorBool = value !== passwordValue;
          input.setCustomValidity(errorBool ? "Both passwords do not match" : "");
          break;
        case "onward_date":
          if (input.min) break;
          input.min = new Date().toISOString().split("T")[0];
          forceRevalidate(input);
          break;
      }
      if (input.type === "file") {
        input.Validity = {};
        const { violation, message } = t007.FM.getFilesHelper(input.files ?? [], {
          accept: input.accept,
          multiple: input.multiple,
          maxSize: input.maxSize ?? Number(input.getAttribute("maxsize")),
          minSize: input.minSize ?? Number(input.getAttribute("minsize")),
          maxTotalSize: input.maxTotalSize ?? Number(input.getAttribute("maxtotalsize")),
          minTotalSize: input.minTotalSize ?? Number(input.getAttribute("mintotalsize")),
          maxLength: input.maxLength ?? Number(input.getAttribute("maxlength")),
          minLength: input.minLength ?? Number(input.getAttribute("minLength")),
        });
        errorBool = !!message;
        input.setCustomValidity(message);
        if (violation) input.Validity[violation] = true;
      }
      errorBool = errorBool ?? !input.validity?.valid;
      toggleError(input, errorBool, flag);
      if (errorBool) return;
      if (input.type === "radio")
        Array.from(inputs)
          ?.filter((i) => i.name == input.name)
          ?.forEach((radio) => toggleError(radio, errorBool, flag));
    }
    function validateFormOnClient() {
      Array.from(inputs).forEach((input) => validateInput(input, true));
      form.querySelector("input:invalid")?.focus();
      return Array.from(inputs).every((input) => input.checkValidity());
    }
    function toggleFormGlobalError(bool) {
      form.toggleAttribute("data-global-error", bool);
      form.querySelectorAll(".t007-input-field").forEach((field) => {
        field.querySelector(".t007-input")?.toggleAttribute("data-error", bool);
        if (bool) field.querySelector(".t007-input-floating-label")?.classList.add("t007-input-shake");
      });
    }
  },
};

if (typeof window !== "undefined") {
  window.t007 ??= { _resourceCache: {} };
  t007.FM = T007_Form_Manager;
  window.T007_INPUT_CSS_SRC ??= `/T007_TOOLS/T007_input_library/T007_input.css`;
  window.createField ??= t007.FM.createField;
  window.handleFormValidation ??= t007.FM.handleFormValidation;
  console.log("%cT007 Input helpers attached to window!", "color: darkturquoise");
  loadResource(T007_INPUT_CSS_SRC);
  t007.FM.init();
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
