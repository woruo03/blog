// assets/js/a11y.js
// 阅读与外观设置控制面板（桌面端锚定 Popover、移动端顶部下拉 Modal，支持可组合封面与滑块同步）
window.A11yPanel = (() => {
    "use strict";

    const STORAGE_KEY = "a11ySettings";
    const ALLOWED_BANNERS = new Set(["off", "basic", "big"]);
    const supportsPopover = Object.hasOwn(HTMLElement.prototype, "popover");
    const supportsAnchorPosition = Boolean(
        window.CSS &&
            typeof window.CSS.supports === "function" &&
            window.CSS.supports("position-area: block-end"),
    );

    const panels = [];
    const anchoredPopovers = [];

    const toKebab = (key) => key.replace(/([A-Z])/g, "-$1").toLowerCase();

    const clampOpacity = (value) => {
        const num = Number(value);
        return Number.isFinite(num)
            ? Math.min(90, Math.max(15, Math.round(num)))
            : 50;
    };

    const normalizeBanner = (value) =>
        ALLOWED_BANNERS.has(value) ? value : "off";

    const normalizeFontSize = (value) => {
        if (value === "default" || value === "" || value == null) {
            return "default";
        }
        const parsed = parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) return "default";
        const clamped = Math.min(24, Math.max(12, parsed));
        const snapped = 12 + Math.round((clamped - 12) / 2) * 2;
        return snapped === 16 ? "default" : `${snapped}px`;
    };

    const fontSizeToNumber = (size) =>
        size === "default" || !size ? 16 : parseInt(String(size), 10) || 16;

    const closePopover = (panel) => {
        if (supportsPopover) {
            if (panel.matches(":popover-open")) panel.hidePopover();
        } else if (panel.open) {
            panel.close();
        }
    };

    const positionPopoverFallback = (panel, toggle) => {
        if (supportsAnchorPosition || !toggle) return;

        const rect = toggle.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            closePopover(panel);
            return;
        }

        const panelW = panel.offsetWidth || 352;
        const panelH = panel.offsetHeight || 400;
        const gap = 12;
        const pad = 12;

        const maxLeft = Math.max(pad, window.innerWidth - panelW - pad);
        const left = Math.min(maxLeft, Math.max(pad, rect.right - panelW));

        let top = rect.bottom + gap;
        if (
            top + panelH > window.innerHeight - pad &&
            rect.top - gap - panelH >= pad
        ) {
            top = rect.top - gap - panelH;
        } else {
            const maxTop = Math.max(pad, window.innerHeight - panelH - pad);
            top = Math.min(maxTop, Math.max(pad, top));
        }

        panel.style.position = "fixed";
        panel.style.margin = "0";
        panel.style.inset = "auto";
        panel.style.top = `${Math.round(top)}px`;
        panel.style.left = `${Math.round(left)}px`;
    };

    const repositionOpenPopovers = () => {
        if (supportsAnchorPosition || anchoredPopovers.length === 0) return;
        anchoredPopovers.forEach(({ panel, toggle }) => {
            const isOpen = supportsPopover
                ? panel.matches(":popover-open")
                : panel.open;
            if (isOpen) positionPopoverFallback(panel, toggle);
        });
    };

    const setRootDataset = (key, value) => {
        if (document.documentElement.dataset[key] !== value) {
            document.documentElement.dataset[key] = value;
        }
    };

    const FEATURES = {
        heroBg: {
            default: true,
            normalize: Boolean,
            applyRoot: (enabled) =>
                setRootDataset("heroBg", enabled ? "on" : "off"),
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
                    const bannerImg =
                        document.getElementById("hero-banner-image");
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
                if (!supportsAnchorPosition) {
                    window.requestAnimationFrame(repositionOpenPopovers);
                }
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

    const FEATURE_KEYS = Object.keys(FEATURES);
    const DEFAULTS = Object.freeze(
        Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURES[k].default])),
    );

    let settings = null;

    const sanitizeSettings = (raw) => {
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
    };

    const getSettings = () => {
        if (settings) return settings;
        try {
            settings = sanitizeSettings(
                JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
            );
        } catch {
            settings = { ...DEFAULTS };
        }
        return settings;
    };

    const persistSettings = (next) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
            console.warn(`a11y.js: cannot store settings: ${e}`);
        }
    };

    const syncControls = (key, value) => {
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
                const active = Boolean(value);
                if (entry.opacityWrap) {
                    entry.opacityWrap.classList.toggle("is-disabled", !active);
                }
                const opacityCtrl = entry.controls.heroBgOpacity;
                if (opacityCtrl?.input) {
                    opacityCtrl.input.disabled = !active;
                }
            }
        });
    };

    const syncAllControls = () => {
        const current = getSettings();
        FEATURE_KEYS.forEach((key) => syncControls(key, current[key]));
    };

    const setSetting = (key, value, { persist = true } = {}) => {
        const feature = FEATURES[key];
        if (!feature) return;
        const current = getSettings();
        const normalized = feature.normalize(value);
        current[key] = normalized;
        if (persist) persistSettings(current);
        feature.apply(normalized);
        syncControls(key, normalized);
    };

    const updateSetting = (key, value) =>
        setSetting(key, value, { persist: true });

    const resetSettings = () => {
        settings = { ...DEFAULTS };
        persistSettings(settings);
        FEATURE_KEYS.forEach((key) => FEATURES[key].apply(settings[key]));
        syncAllControls();
    };

    const initPanel = (panel) => {
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

        panels.push({
            panel,
            controls,
            opacityWrap: panel.querySelector("[data-hero-bg-opacity-wrap]"),
        });

        const toggle = document.getElementById(`${prefix}a11y-toggle`);
        const closeBtn = document.getElementById(`${prefix}a11y-close`);
        const resetBtn = document.getElementById(`${prefix}a11y-reset`);
        const isPopover = panel.hasAttribute("popover");

        const syncExpanded = (open) => {
            toggle?.setAttribute("aria-expanded", String(open));
        };

        resetBtn?.addEventListener("click", resetSettings);

        if (isPopover) {
            if (!supportsAnchorPosition) {
                anchoredPopovers.push({ panel, toggle });
            }

            if (supportsPopover) {
                let returnFocusOnClose = false;
                closeBtn?.addEventListener("click", () => {
                    returnFocusOnClose = true;
                });
                panel.addEventListener("keydown", (e) => {
                    if (e.key === "Escape") returnFocusOnClose = true;
                });
                panel.addEventListener("toggle", (e) => {
                    const open = e.newState === "open";
                    syncExpanded(open);
                    if (open) {
                        returnFocusOnClose = false;
                        positionPopoverFallback(panel, toggle);
                    } else if (returnFocusOnClose) {
                        returnFocusOnClose = false;
                        toggle?.focus();
                    }
                });
            } else {
                // 不支持原生 Popover API 的旧浏览器非模态降级
                toggle?.addEventListener("click", () => {
                    if (panel.open) {
                        panel.close();
                    } else {
                        panel.show();
                        syncExpanded(true);
                        positionPopoverFallback(panel, toggle);
                    }
                });
                closeBtn?.addEventListener("click", () => {
                    panel.close();
                    toggle?.focus();
                });
                panel.addEventListener("close", () => syncExpanded(false));
                document.addEventListener("keydown", (e) => {
                    if (e.key === "Escape" && panel.open) {
                        panel.close();
                        toggle?.focus();
                    }
                });
                document.addEventListener("click", (e) => {
                    if (
                        !panel.open ||
                        panel.contains(e.target) ||
                        toggle?.contains(e.target)
                    ) {
                        return;
                    }
                    panel.close();
                });
            }
            return;
        }

        toggle?.addEventListener("click", () => {
            if (panel.open) {
                panel.close();
                return;
            }
            const menuToggle = document.getElementById("mobile-menu-toggle");
            if (menuToggle?.checked) {
                menuToggle.checked = false;
                document
                    .querySelectorAll(
                        'label[role="button"][for="mobile-menu-toggle"]',
                    )
                    .forEach((label) => {
                        label.setAttribute("aria-expanded", "false");
                    });
            }
            panel.showModal();
            syncExpanded(true);
        });

        closeBtn?.addEventListener("click", () => panel.close());

        let pressedOutside = false;

        panel.addEventListener("close", () => {
            pressedOutside = false;
            syncExpanded(false);
            const isToggleHidden =
                !toggle ||
                !toggle.offsetParent ||
                window.getComputedStyle(toggle).visibility === "hidden";
            if (isToggleHidden) {
                document
                    .querySelector(
                        'label[role="button"][for="mobile-menu-toggle"]',
                    )
                    ?.focus();
            }
        });

        // 为不支持 <dialog closedby="any"> 的浏览器（如 Safari）提供外部点击轻关闭降级
        if (!("closedBy" in HTMLDialogElement.prototype)) {
            const isOutside = (e) => {
                const r = panel.getBoundingClientRect();
                return (
                    e.clientX < r.left ||
                    e.clientX > r.right ||
                    e.clientY < r.top ||
                    e.clientY > r.bottom
                );
            };
            panel.addEventListener("pointerdown", (e) => {
                pressedOutside =
                    e.isPrimary &&
                    (e.pointerType !== "mouse" || e.button === 0) &&
                    e.target === panel &&
                    isOutside(e);
            });
            panel.addEventListener("pointerup", (e) => {
                const wasPressedOutside = pressedOutside;
                pressedOutside = false;
                if (
                    wasPressedOutside &&
                    e.isPrimary &&
                    (e.pointerType !== "mouse" || e.button === 0) &&
                    e.target === panel &&
                    isOutside(e)
                ) {
                    panel.close();
                }
            });
            panel.addEventListener("pointercancel", () => {
                pressedOutside = false;
            });
        }
    };

    const init = () => {
        const current = getSettings();
        FEATURES.zenMode.apply(current.zenMode);
        if (current.heroBanner !== "off") {
            FEATURES.heroBanner.apply(current.heroBanner);
        }
        document
            .querySelectorAll("dialog[id$='a11y-panel']")
            .forEach(initPanel);
        syncAllControls();

        if (!supportsAnchorPosition) {
            let resizeFrame = false;
            window.addEventListener(
                "resize",
                () => {
                    if (resizeFrame) return;
                    resizeFrame = true;
                    window.requestAnimationFrame(() => {
                        resizeFrame = false;
                        repositionOpenPopovers();
                    });
                },
                { passive: true },
            );
        }
    };

    // 首帧前仅写入 <html> 状态属性，零 DOM 查询、零重排、零阻塞
    const initial = getSettings();
    FEATURE_KEYS.forEach((key) => FEATURES[key].applyRoot?.(initial[key]));

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

    return {
        getSettings,
        updateSetting,
        resetSettings,
    };
})();