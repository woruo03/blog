// assets/js/a11y/index.js
// 阅读与外观设置控制面板入口（由 Hugo js.Build 打包为单一指纹文件 js/a11y.bundle.js）

import {
    FEATURE_KEYS,
    FEATURES,
    applyInitialRootState,
    fontSizeToNumber,
    getSettings,
    persistSettings,
    resetAllSettings,
    setFontSizeChangeHook,
} from "./settings.js";
import {
    bindPanelLifecycle,
    repositionOpenPopovers,
    setupViewportSync,
    supportsAnchorPosition,
} from "./dialog.js";

const panels = [];
const toKebab = (key) => key.replace(/([A-Z])/g, "-$1").toLowerCase();

setFontSizeChangeHook(() => {
    if (!supportsAnchorPosition) {
        window.requestAnimationFrame(repositionOpenPopovers);
    }
});

function syncControls(key, value) {
    panels.forEach((entry) => {
        const ctrl = entry.controls[key];
        if (!ctrl) return;

        if (key === "heroBanner") {
            ctrl.radios.forEach((radio) => {
                radio.checked = radio.value === value;
            });
            return;
        }

        if (key === "heroBgOpacity" || key === "fontSize") {
            const isFont = key === "fontSize";
            const num = isFont ? fontSizeToNumber(value) : value;
            const defaultLabel = ctrl.input.dataset.defaultLabel || "默认";
            const text = isFont
                ? value === "default"
                    ? `${defaultLabel} (16px)`
                    : value
                : `${value}%`;
            ctrl.input.value = String(num);
            ctrl.input.setAttribute("aria-valuetext", text);
            if (ctrl.output) ctrl.output.textContent = text;
            return;
        }

        if (ctrl.input?.type === "checkbox") {
            ctrl.input.checked = Boolean(value);
        }

        if (key === "heroBg") {
            const opacityCtrl = entry.controls.heroBgOpacity;
            if (opacityCtrl?.input) opacityCtrl.input.disabled = !value;
        }
    });
}

function syncAllControls() {
    const current = getSettings();
    FEATURE_KEYS.forEach((key) => syncControls(key, current[key]));
}

function setSetting(key, value, { persist = true } = {}) {
    const feature = FEATURES[key];
    if (!feature) return;
    const current = getSettings();
    const normalized = feature.normalize(value);
    current[key] = normalized;
    if (persist) persistSettings(current);
    feature.apply(normalized);
    syncControls(key, normalized);
}

function updateSetting(key, value) {
    setSetting(key, value, { persist: true });
}

function resetSettings() {
    resetAllSettings();
    syncAllControls();
}

function initPanel(panel) {
    const prefix = panel.id.replace("a11y-panel", "");
    const controls = {};

    FEATURE_KEYS.forEach((key) => {
        const elementId = `${prefix}${toKebab(key)}`;
        if (key === "heroBanner") {
            const radios = Array.from(
                panel.querySelectorAll(
                    `input[type="radio"][name="${elementId}"]`,
                ),
            );
            if (radios.length === 0) return;
            controls[key] = { radios };
            radios.forEach((radio) => {
                radio.addEventListener("change", (e) => {
                    if (e.target.checked) updateSetting(key, e.target.value);
                });
            });
            return;
        }

        const input = document.getElementById(elementId);
        if (!input) return;

        if (input.type === "range") {
            const output = document.getElementById(`${elementId}-value`);
            controls[key] = { input, output };
            input.addEventListener("input", (e) => {
                setSetting(key, e.target.value, { persist: false });
            });
            input.addEventListener("change", (e) => {
                updateSetting(key, e.target.value);
            });
        } else if (input.type === "checkbox") {
            controls[key] = { input };
            input.addEventListener("change", (e) => {
                updateSetting(key, e.target.checked);
            });
        }
    });

    panels.push({ panel, controls });

    bindPanelLifecycle({
        panel,
        toggle: document.getElementById(`${prefix}a11y-toggle`),
        closeBtn: document.getElementById(`${prefix}a11y-close`),
        resetBtn: document.getElementById(`${prefix}a11y-reset`),
        onReset: resetSettings,
    });
}

function init() {
    const current = getSettings();
    FEATURES.zenMode.apply(current.zenMode);
    if (current.heroBanner !== "off") {
        FEATURES.heroBanner.apply(current.heroBanner);
    }
    document.querySelectorAll("dialog[id$='a11y-panel']").forEach(initPanel);
    syncAllControls();
    setupViewportSync();
}

// 首帧前仅写入 <html> 状态属性，零 DOM 查询、零重排、零阻塞
applyInitialRootState();

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
    init();
}

window.A11yPanel = {
    getSettings,
    updateSetting,
    resetSettings,
};
