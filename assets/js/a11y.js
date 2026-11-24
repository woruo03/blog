// assets/js/a11y.js
// 阅读与外观设置控制面板（桌面端锚定 Popover、移动端居中 Modal，支持可组合封面与滑块同步）
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

    const anchoredPopovers = new Set();

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

        const panelW = panel.offsetWidth || 320;
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
        if (supportsAnchorPosition || anchoredPopovers.size === 0) return;
        anchoredPopovers.forEach(({ panel, toggle }) => {
            const isOpen = supportsPopover
                ? panel.matches(":popover-open")
                : panel.open;
            if (isOpen) {
                positionPopoverFallback(panel, toggle);
            }
        });
    };

    const applyRootState = (s) => {
        const root = document.documentElement;
        root.style.fontSize = s.fontSize === "default" ? "" : s.fontSize;
        root.dataset.heroBg = s.heroBg ? "on" : "off";
        root.style.setProperty(
            "--bf-hero-bg-opacity",
            String(s.heroBgOpacity / 100),
        );
        root.dataset.heroBanner = s.heroBanner;
        root.dataset.underlineLinks = s.underlineLinks ? "true" : "false";
    };

    const FEATURES = {
        heroBg: {
            default: true,
            apply: (enabled) => {
                document.documentElement.dataset.heroBg = enabled
                    ? "on"
                    : "off";
                window.dispatchEvent(new Event("bf:hero-settings-change"));
            },
        },

        heroBgOpacity: {
            default: 50,
            apply: (value) => {
                document.documentElement.style.setProperty(
                    "--bf-hero-bg-opacity",
                    String(value / 100),
                );
            },
        },

        heroBanner: {
            default: "off",
            apply: (mode) => {
                document.documentElement.dataset.heroBanner = mode;
                if (mode !== "off") {
                    const bannerImg =
                        document.getElementById("hero-banner-image");
                    if (bannerImg?.dataset.distinctHero === "true") {
                        bannerImg.loading = "eager";
                        bannerImg.removeAttribute("fetchpriority");
                    }
                }
            },
        },

        disableBlur: {
            default: false,
            apply: (enabled) => {
                if (typeof window.setBackgroundBlur !== "function") return;
                document
                    .querySelectorAll("script[data-blur-id]")
                    .forEach((script) => {
                        const targetId = script.getAttribute("data-blur-id");
                        const scrollDivisor = Number(
                            script.getAttribute("data-scroll-divisor") || 300,
                        );
                        window.setBackgroundBlur(
                            targetId,
                            scrollDivisor,
                            enabled,
                            targetId === "menu-blur",
                        );
                    });
            },
        },

        fontSize: {
            default: "default",
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
            apply: (enabled) => {
                document.documentElement.dataset.underlineLinks = enabled
                    ? "true"
                    : "false";
            },
        },

        zenMode: {
            default: false,
            apply: (enabled) => {
                if (
                    !document.getElementById("single_header") ||
                    !document.querySelector(".article-content")
                ) {
                    return;
                }
                const isActive =
                    document.body?.classList.contains("zen-mode-enable");
                if (Boolean(enabled) !== Boolean(isActive)) {
                    const zenBtn = document.getElementById("zen-mode-button");
                    if (zenBtn && typeof window._toggleZenMode === "function") {
                        window._toggleZenMode(zenBtn, {
                            scrollToHeader: false,
                        });
                    }
                }
            },
        },
    };

    let settings = null;

    const getDefaults = () =>
        Object.fromEntries(
            Object.entries(FEATURES).map(([key, config]) => [
                key,
                config.default,
            ]),
        );

    const sanitizeSettings = (raw) => {
        const defaults = getDefaults();
        const merged = { ...defaults, ...(raw || {}) };

        // 兼容旧版 disableImages 偏好迁移
        if (
            typeof raw?.heroBg !== "boolean" &&
            typeof raw?.disableImages === "boolean"
        ) {
            merged.heroBg = !raw.disableImages;
        } else {
            merged.heroBg = Boolean(merged.heroBg);
        }

        merged.heroBgOpacity = clampOpacity(merged.heroBgOpacity);
        merged.heroBanner = normalizeBanner(merged.heroBanner);
        merged.disableBlur = Boolean(merged.disableBlur);
        merged.underlineLinks = Boolean(merged.underlineLinks);
        merged.zenMode = Boolean(merged.zenMode);
        merged.fontSize = normalizeFontSize(merged.fontSize);

        return merged;
    };

    const getSettings = () => {
        if (settings) return settings;
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            settings = sanitizeSettings(JSON.parse(saved || "{}"));
        } catch {
            settings = getDefaults();
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
        const suffix = key.replace(/([A-Z])/g, "-$1").toLowerCase();

        if (key === "heroBanner") {
            document
                .querySelectorAll(`input[type="radio"][name$="${suffix}"]`)
                .forEach((radio) => {
                    radio.checked = radio.value === value;
                });
            return;
        }

        if (key === "heroBgOpacity" || key === "fontSize") {
            const isFont = key === "fontSize";
            const num = isFont ? fontSizeToNumber(value) : value;
            let text = `${value}%`;

            document.querySelectorAll(`[id$="${suffix}"]`).forEach((input) => {
                if (isFont) {
                    const defaultLabel = input.dataset.defaultLabel || "默认";
                    text =
                        value === "default" ? `${defaultLabel} (16px)` : value;
                }
                input.value = String(num);
                input.setAttribute("aria-valuetext", text);
            });

            document
                .querySelectorAll(`[id$="${suffix}-value"]`)
                .forEach((output) => {
                    output.textContent = text;
                });
            return;
        }

        document.querySelectorAll(`[id$="${suffix}"]`).forEach((el) => {
            if (el.type === "checkbox") {
                el.checked = Boolean(value);
            }
        });

        if (key === "heroBg") {
            const active = Boolean(value);
            document
                .querySelectorAll("[data-hero-bg-opacity-wrap]")
                .forEach((wrap) => {
                    wrap.classList.toggle("is-disabled", !active);
                });
            document
                .querySelectorAll('[id$="hero-bg-opacity"]')
                .forEach((input) => {
                    input.disabled = !active;
                });
        }
    };

    const syncAllControls = () => {
        const current = getSettings();
        Object.entries(current).forEach(([key, value]) => {
            syncControls(key, value);
        });
    };

    const setSetting = (key, value, { persist = true } = {}) => {
        const current = getSettings();
        current[key] = value;
        settings = sanitizeSettings(current);
        if (persist) {
            persistSettings(settings);
        }
        FEATURES[key]?.apply(settings[key]);
        syncControls(key, settings[key]);
    };

    const updateSetting = (key, value) =>
        setSetting(key, value, { persist: true });

    const applyAll = () => {
        const current = getSettings();
        Object.entries(current).forEach(([key, value]) => {
            FEATURES[key]?.apply(value);
        });
    };

    const hydrateDomFeatures = () => {
        const current = getSettings();
        FEATURES.disableBlur.apply(current.disableBlur);
        FEATURES.zenMode.apply(current.zenMode);
        if (current.heroBanner !== "off") {
            FEATURES.heroBanner.apply(current.heroBanner);
        }
    };

    const resetSettings = () => {
        settings = getDefaults();
        persistSettings(settings);
        applyAll();
        syncAllControls();
    };

    const initPanel = (panel) => {
        const prefix = panel.id.replace("a11y-panel", "");

        Object.keys(FEATURES).forEach((key) => {
            const elementId = `${prefix}${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;

            if (key === "heroBanner") {
                panel
                    .querySelectorAll(`input[type="radio"][name="${elementId}"]`)
                    .forEach((radio) => {
                        radio.addEventListener("change", (e) => {
                            if (e.target.checked) {
                                updateSetting(key, e.target.value);
                            }
                        });
                    });
                return;
            }

            const element = document.getElementById(elementId);
            if (!element) return;

            if (element.type === "range") {
                element.addEventListener("input", (e) => {
                    setSetting(key, e.target.value, { persist: false });
                });
                element.addEventListener("change", (e) => {
                    updateSetting(key, e.target.value);
                });
            } else if (element.type === "checkbox") {
                element.addEventListener("change", (e) => {
                    updateSetting(key, e.target.checked);
                });
            }
        });

        const toggle = document.getElementById(`${prefix}a11y-toggle`);
        const closeBtn = document.getElementById(`${prefix}a11y-close`);
        const resetBtn = document.getElementById(`${prefix}a11y-reset`);
        const isPopover = panel.hasAttribute("popover");

        const syncExpanded = (open) => {
            if (toggle) {
                toggle.setAttribute("aria-expanded", String(open));
            }
        };

        if (resetBtn) {
            resetBtn.addEventListener("click", resetSettings);
        }

        if (isPopover) {
            if (!supportsAnchorPosition) {
                anchoredPopovers.add({ panel, toggle });
            }

            if (supportsPopover) {
                let returnFocusOnClose = false;
                if (closeBtn) {
                    closeBtn.addEventListener("click", () => {
                        returnFocusOnClose = true;
                    });
                }
                panel.addEventListener("keydown", (e) => {
                    if (e.key === "Escape") {
                        returnFocusOnClose = true;
                    }
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
                // 不支持原生 Popover API 的极旧浏览器非模态降级
                if (toggle) {
                    toggle.addEventListener("click", () => {
                        if (panel.open) {
                            panel.close();
                        } else {
                            panel.show();
                            syncExpanded(true);
                            positionPopoverFallback(panel, toggle);
                        }
                    });
                }
                if (closeBtn) {
                    closeBtn.addEventListener("click", () => {
                        panel.close();
                        toggle?.focus();
                    });
                }
                panel.addEventListener("close", () => syncExpanded(false));
                document.addEventListener("click", (e) => {
                    if (!panel.open) return;
                    if (
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

        if (toggle) {
            toggle.addEventListener("click", () => {
                if (panel.open) {
                    panel.close();
                } else {
                    panel.showModal();
                    syncExpanded(true);
                }
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener("click", () => panel.close());
        }

        let pressedOutside = false;

        panel.addEventListener("close", () => {
            pressedOutside = false;
            syncExpanded(false);
        });

        // 防止模态弹窗开启时按 Esc 误关闭外层移动端菜单
        panel.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
            }
        });

        // 为不支持 <dialog closedby="any"> 的浏览器（如 Safari）提供外部点击轻关闭降级
        if (!("closedBy" in HTMLDialogElement.prototype)) {
            const outside = (e) => {
                const r = panel.getBoundingClientRect();
                return (
                    e.clientX < r.left ||
                    e.clientX > r.right ||
                    e.clientY < r.top ||
                    e.clientY > r.bottom
                );
            };
            panel.addEventListener("pointerdown", (e) => {
                pressedOutside = outside(e);
            });
            panel.addEventListener("pointerup", (e) => {
                const wasPressedOutside = pressedOutside;
                pressedOutside = false;
                if (wasPressedOutside && outside(e)) {
                    panel.close();
                }
            });
            panel.addEventListener("pointercancel", () => {
                pressedOutside = false;
            });
        }
    };

    const init = () => {
        hydrateDomFeatures();
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
    applyRootState(getSettings());

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    return {
        getSettings,
        updateSetting,
        resetSettings,
    };
})();