// assets/js/zen-mode-sync.js
// 专注阅读按钮无障碍状态与设置面板持久化双向同步（与主题 zen-mode.js 合并为单一 zen-mode.bundle.js）
(function () {
    "use strict";

    function initZenModeSync() {
        const btn = document.getElementById("zen-mode-button");
        if (!btn || !document.body) return;

        new MutationObserver(() => {
            const isZen = document.body.classList.contains("zen-mode-enable");
            btn.setAttribute("aria-pressed", String(isZen));
            const title = btn.getAttribute(
                isZen ? "data-title-i18n-enable" : "data-title-i18n-disable",
            );
            if (title) {
                btn.setAttribute("aria-label", title);
                btn.setAttribute("title", title);
            }
            if (
                window.A11yPanel &&
                typeof window.A11yPanel.getSettings === "function" &&
                typeof window.A11yPanel.updateSetting === "function"
            ) {
                if (Boolean(window.A11yPanel.getSettings().zenMode) !== isZen) {
                    window.A11yPanel.updateSetting("zenMode", isZen);
                }
            } else {
                document.querySelectorAll('[id$="zen-mode"]').forEach((cb) => {
                    if (cb.type === "checkbox") cb.checked = isZen;
                });
            }
        }).observe(document.body, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initZenModeSync, {
            once: true,
        });
    } else {
        initZenModeSync();
    }
})();
