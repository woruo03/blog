// assets/js/a11y/settings.js
// 阅读与外观设置状态管理、字段规范化与特性副作用应用

export const STORAGE_KEY = "a11ySettings";
const ALLOWED_BANNERS = new Set(["off", "basic", "big"]);
const SCHEME_ALIASES = { ocean: "blowfish" };

const bootScript = document.getElementById("bf-boot-script");
export const DEFAULT_COLOR_SCHEME =
    bootScript?.dataset.defaultScheme || "blowfish";
const ALLOWED_SCHEMES = new Set(
    (bootScript?.dataset.schemes || DEFAULT_COLOR_SCHEME)
        .split(",")
        .filter(Boolean),
);

let onFontSizeChange = null;
let settings = null;

export function setFontSizeChangeHook(fn) {
    onFontSizeChange = fn;
}

export const normalizeColorScheme = (value) => {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    const mapped = SCHEME_ALIASES[raw] || raw;
    return ALLOWED_SCHEMES.has(mapped) ? mapped : DEFAULT_COLOR_SCHEME;
};

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

const applyColorSchemeRoot = (scheme) => {
    const root = document.documentElement;
    if (!scheme || scheme === DEFAULT_COLOR_SCHEME) {
        if ("colorScheme" in root.dataset) {
            delete root.dataset.colorScheme;
        }
    } else if (root.dataset.colorScheme !== scheme) {
        root.dataset.colorScheme = scheme;
    }
};
const applyHeroBgRoot = (enabled) =>
    setRootDataset("heroBg", enabled ? "on" : "off");
const applyHeroOpacityRoot = (value) => {
    const next = String(value / 100);
    if (
        document.documentElement.style.getPropertyValue(
            "--bf-hero-bg-opacity",
        ) !== next
    ) {
        document.documentElement.style.setProperty("--bf-hero-bg-opacity", next);
    }
};
const applyHeroBannerRoot = (mode) => setRootDataset("heroBanner", mode);
const applyDisableBlurRoot = (enabled) =>
    setRootDataset("disableBlur", enabled ? "true" : "false");
const applyFontSizeRoot = (size) => {
    const next = size === "default" ? "" : size;
    if (document.documentElement.style.fontSize !== next) {
        document.documentElement.style.fontSize = next;
    }
};
const applyUnderlineRoot = (enabled) =>
    setRootDataset("underlineLinks", enabled ? "true" : "false");

export const FEATURES = {
    colorScheme: {
        default: DEFAULT_COLOR_SCHEME,
        normalize: normalizeColorScheme,
        applyRoot: applyColorSchemeRoot,
        apply: (scheme) => {
            applyColorSchemeRoot(scheme);
            window.dispatchEvent(
                new CustomEvent("bf:color-scheme-change", {
                    detail: { scheme },
                }),
            );
        },
    },
    heroBg: {
        default: true,
        normalize: Boolean,
        applyRoot: applyHeroBgRoot,
        apply: (enabled) => {
            applyHeroBgRoot(enabled);
            window.dispatchEvent(new Event("bf:hero-settings-change"));
        },
    },
    heroBgOpacity: {
        default: 50,
        normalize: clampOpacity,
        applyRoot: applyHeroOpacityRoot,
        apply: applyHeroOpacityRoot,
    },
    heroBanner: {
        default: "off",
        normalize: normalizeBanner,
        applyRoot: applyHeroBannerRoot,
        apply: (mode) => {
            applyHeroBannerRoot(mode);
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
        applyRoot: applyDisableBlurRoot,
        apply: (enabled) => {
            applyDisableBlurRoot(enabled);
            if (typeof window.setBackgroundBlurDisabled === "function") {
                window.setBackgroundBlurDisabled(enabled);
            }
        },
    },
    fontSize: {
        default: "default",
        normalize: normalizeFontSize,
        applyRoot: applyFontSizeRoot,
        apply: (size) => {
            applyFontSizeRoot(size);
            onFontSizeChange?.();
        },
    },
    underlineLinks: {
        default: false,
        normalize: Boolean,
        applyRoot: applyUnderlineRoot,
        apply: applyUnderlineRoot,
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

export function reloadSettingsFromStorage() {
    let next;
    try {
        next = sanitizeSettings(
            JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
        );
    } catch {
        next = { ...DEFAULTS };
    }
    const prev = settings;
    settings = next;
    FEATURE_KEYS.forEach((key) => {
        if (!prev || prev[key] !== next[key]) {
            FEATURES[key].apply(next[key]);
        }
    });
    return settings;
}
