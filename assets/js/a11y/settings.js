// assets/js/a11y/settings.js
// 阅读与外观设置状态管理、字段规范化与特性副作用应用

const STORAGE_KEY = "a11ySettings";
const ALLOWED_BANNERS = new Set(["off", "basic", "big"]);

let onFontSizeChange = null;
let settings = null;

export function setFontSizeChangeHook(fn) {
    onFontSizeChange = fn;
}

export const clampOpacity = (value) => {
    const num = Number(value);
    return Number.isFinite(num)
        ? Math.min(90, Math.max(15, Math.round(num)))
        : 50;
};

export const normalizeBanner = (value) =>
    ALLOWED_BANNERS.has(value) ? value : "off";

export const normalizeFontSize = (value) => {
    if (value === "default" || value === "" || value == null) {
        return "default";
    }
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return "default";
    const clamped = Math.min(24, Math.max(12, parsed));
    const snapped = 12 + Math.round((clamped - 12) / 2) * 2;
    return snapped === 16 ? "default" : `${snapped}px`;
};

export const fontSizeToNumber = (size) =>
    size === "default" || !size ? 16 : parseInt(String(size), 10) || 16;

const setRootDataset = (key, value) => {
    if (document.documentElement.dataset[key] !== value) {
        document.documentElement.dataset[key] = value;
    }
};

export const FEATURES = {
    heroBg: {
        default: true,
        normalize: Boolean,
        applyRoot: (enabled) => setRootDataset("heroBg", enabled ? "on" : "off"),
        apply: (enabled) => {
            setRootDataset("heroBg", enabled ? "on" : "off");
            window.dispatchEvent(new Event("bf:hero-settings-change"));
        },
    },
    heroBgOpacity: {
        default: 50,
        normalize: clampOpacity,
        applyRoot: (value) => {
            const next = String(value / 100);
            if (
                document.documentElement.style.getPropertyValue(
                    "--bf-hero-bg-opacity",
                ) !== next
            ) {
                document.documentElement.style.setProperty(
                    "--bf-hero-bg-opacity",
                    next,
                );
            }
        },
        apply: (value) => {
            document.documentElement.style.setProperty(
                "--bf-hero-bg-opacity",
                String(value / 100),
            );
        },
    },
    heroBanner: {
        default: "off",
        normalize: normalizeBanner,
        applyRoot: (mode) => setRootDataset("heroBanner", mode),
        apply: (mode) => {
            setRootDataset("heroBanner", mode);
            if (mode !== "off") {
                const bannerImg = document.getElementById("hero-banner-image");
                if (bannerImg) {
                    bannerImg.loading = "eager";
                    bannerImg.removeAttribute("fetchpriority");
                }
            }
        },
    },
    disableBlur: {
        default: false,
        normalize: Boolean,
        applyRoot: (enabled) =>
            setRootDataset("disableBlur", enabled ? "true" : "false"),
        apply: (enabled) => {
            setRootDataset("disableBlur", enabled ? "true" : "false");
            if (typeof window.setBackgroundBlurDisabled === "function") {
                window.setBackgroundBlurDisabled(enabled);
            }
        },
    },
    fontSize: {
        default: "default",
        normalize: normalizeFontSize,
        applyRoot: (size) => {
            const next = size === "default" ? "" : size;
            if (document.documentElement.style.fontSize !== next) {
                document.documentElement.style.fontSize = next;
            }
        },
        apply: (size) => {
            document.documentElement.style.fontSize =
                size === "default" ? "" : size;
            onFontSizeChange?.();
        },
    },
    underlineLinks: {
        default: false,
        normalize: Boolean,
        applyRoot: (enabled) =>
            setRootDataset("underlineLinks", enabled ? "true" : "false"),
        apply: (enabled) =>
            setRootDataset("underlineLinks", enabled ? "true" : "false"),
    },
    zenMode: {
        default: false,
        normalize: Boolean,
        apply: (enabled) => {
            if (
                !document.getElementById("single_header") ||
                !document.querySelector(".article-content")
            ) {
                return;
            }
            const target = Boolean(enabled);
            const isActive = Boolean(
                document.body?.classList.contains("zen-mode-enable"),
            );
            if (target === isActive) return;

            const zenBtn = document.getElementById("zen-mode-button");
            if (zenBtn && typeof window._toggleZenMode === "function") {
                window._toggleZenMode(zenBtn, { scrollToHeader: false });
            } else {
                document.body?.classList.toggle("zen-mode-enable", target);
            }
        },
    },
};

export const FEATURE_KEYS = Object.keys(FEATURES);
const DEFAULTS = Object.freeze(
    Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURES[k].default])),
);

export function sanitizeSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const next = { ...DEFAULTS };
    FEATURE_KEYS.forEach((key) => {
        if (key in src) {
            next[key] = FEATURES[key].normalize(src[key]);
        }
    });
    // 兼容旧版 disableImages 偏好迁移
    if (
        typeof src.heroBg !== "boolean" &&
        typeof src.disableImages === "boolean"
    ) {
        next.heroBg = !src.disableImages;
    }
    return next;
}

export function getSettings() {
    if (settings) return settings;
    try {
        settings = sanitizeSettings(
            JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
        );
    } catch {
        settings = { ...DEFAULTS };
    }
    return settings;
}

export function persistSettings(next) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
        console.warn(`a11y: cannot store settings: ${e}`);
    }
}

export function applyInitialRootState() {
    const initial = getSettings();
    FEATURE_KEYS.forEach((key) => FEATURES[key].applyRoot?.(initial[key]));
}

export function resetAllSettings() {
    settings = { ...DEFAULTS };
    persistSettings(settings);
    FEATURE_KEYS.forEach((key) => FEATURES[key].apply(settings[key]));
    return settings;
}
