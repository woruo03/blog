// assets/js/a11y.js
// 阅读与无障碍设置控制面板（配合原生 <dialog> Top-Layer 弹窗，支持跨实例状态同步）
window.A11yPanel = (() => {
    "use strict";

    const FEATURES = {
        disableBlur: {
            default: false,
            apply: (enabled) => {
                document
                    .querySelectorAll("script[data-blur-id]")
                    .forEach((script) => {
                        const targetId = script.getAttribute("data-blur-id");
                        const scrollDivisor = Number(
                            script.getAttribute("data-scroll-divisor") || 300,
                        );
                        if (typeof window.setBackgroundBlur === "function") {
                            window.setBackgroundBlur(
                                targetId,
                                scrollDivisor,
                                enabled,
                                targetId === "menu-blur",
                            );
                        }
                    });
            },
        },

        disableImages: {
            default: false,
            apply: (enabled) => {
                const image = document.getElementById("background-image");
                if (image) {
                    image.style.display = enabled ? "none" : "";
                }
            },
        },

        fontSize: {
            default: "default",
            apply: (size) => {
                document.documentElement.style.fontSize =
                    size === "default" ? "" : size;
            },
        },

        underlineLinks: {
            default: false,
            apply: (enabled) => {
                const existing = document.getElementById("a11y-underline-links");
                if (enabled && !existing) {
                    const style = document.createElement("style");
                    style.id = "a11y-underline-links";
                    style.textContent = `
                        a { text-decoration: underline !important; }
                        .group-hover-card-title { text-decoration: underline !important; }
                        .group-hover-card:hover .group-hover-card-title { text-decoration: underline !important; }`;
                    document.head.appendChild(style);
                } else if (!enabled && existing) {
                    existing.remove();
                }
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

    const getSettings = () => {
        if (settings) return settings;
        const defaults = Object.fromEntries(
            Object.entries(FEATURES).map(([key, config]) => [
                key,
                config.default,
            ]),
        );
        try {
            const saved = localStorage.getItem("a11ySettings");
            settings = { ...defaults, ...JSON.parse(saved || "{}") };
        } catch {
            settings = defaults;
        }
        return settings;
    };

    const syncControls = (key, value) => {
        const suffix = key.replace(/([A-Z])/g, "-$1").toLowerCase();
        document
            .querySelectorAll(
                `[id$="${suffix}"], [id$="${suffix}-select"]`,
            )
            .forEach((el) => {
                if (el.type === "checkbox") {
                    el.checked = Boolean(value);
                } else if (el.tagName === "SELECT") {
                    el.value = value;
                }
            });
    };

    const updateSetting = (key, value) => {
        const current = getSettings();
        current[key] = value;
        try {
            localStorage.setItem("a11ySettings", JSON.stringify(current));
        } catch (e) {
            console.warn(`a11y.js: cannot store settings: ${e}`);
        }
        FEATURES[key]?.apply(value);
        syncControls(key, value);
    };

    const initPanel = (panel) => {
        const panelId = panel.id;
        const prefix = panelId.replace("a11y-panel", "");
        const current = getSettings();

        Object.keys(FEATURES).forEach((key) => {
            const elementId = `${prefix}${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
            const element =
                document.getElementById(elementId) ||
                document.getElementById(`${elementId}-select`);

            if (element) {
                if (element.type === "checkbox") {
                    element.checked = Boolean(current[key]);
                    element.addEventListener("change", (e) =>
                        updateSetting(key, e.target.checked),
                    );
                } else if (element.tagName === "SELECT") {
                    element.value = current[key];
                    element.addEventListener("change", (e) =>
                        updateSetting(key, e.target.value),
                    );
                }
            }
        });

        const toggle = document.getElementById(`${prefix}a11y-toggle`);
        const closeBtn = document.getElementById(`${prefix}a11y-close`);

        const syncExpanded = (open) => {
            if (toggle) {
                toggle.setAttribute("aria-expanded", String(open));
            }
        };

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
            closeBtn.addEventListener("click", () => {
                panel.close();
            });
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

    const applyAll = () => {
        const current = getSettings();
        Object.entries(current).forEach(([key, value]) => {
            FEATURES[key]?.apply(value);
        });
    };

    const init = () => {
        applyAll();
        document.querySelectorAll("dialog[id$='a11y-panel']").forEach((panel) => {
            initPanel(panel);
        });
    };

    // 在首帧前尽早应用字号，减少渲染抖动
    FEATURES.fontSize.apply(getSettings().fontSize);

    if (getSettings().disableImages) {
        const existingBg = document.getElementById("background-image");
        if (existingBg) {
            existingBg.style.display = "none";
        } else {
            const bgObserver = new MutationObserver(() => {
                const img = document.getElementById("background-image");
                if (img) {
                    img.style.display = "none";
                    bgObserver.disconnect();
                }
            });
            bgObserver.observe(document, { childList: true, subtree: true });
            if (document.readyState === "loading") {
                document.addEventListener(
                    "DOMContentLoaded",
                    () => bgObserver.disconnect(),
                    { once: true },
                );
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    return {
        getSettings,
        updateSetting,
        addFeature: (name, config) => {
            FEATURES[name] = config;
            FEATURES[name].apply(getSettings()[name] ?? config.default);
        },
    };
})();
