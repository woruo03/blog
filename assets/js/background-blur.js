// assets/js/background-blur.js
// 顶栏与背景模糊的高性能平滑透明度控制（单例状态管理，避免多实例引入时重复绑定或泄漏滚动监听）
(function () {
    "use strict";

    function readInitialDisableBlur() {
        const attr = document.documentElement.dataset.disableBlur;
        if (attr === "true" || attr === "false") {
            return attr === "true";
        }
        try {
            const settings = JSON.parse(
                localStorage.getItem("a11ySettings") || "{}",
            );
            return Boolean(settings.disableBlur);
        } catch (_) {
            return false;
        }
    }

    if (!window.__bfBlurManager) {
        const activeHandlers = new Map();
        const registeredConfigs = new Map();
        const supportsScrollTimeline = Boolean(
            window.CSS &&
                typeof window.CSS.supports === "function" &&
                window.CSS.supports(
                    "(animation-timeline: scroll()) and (animation-range: 0% 100%)",
                ),
        );

        function setBackgroundBlur(
            targetId,
            scrollDivisor = 300,
            disableBlur = false,
            isMenuBlur = false,
        ) {
            if (!targetId) return;

            const blurElement = document.getElementById(targetId);
            if (!blurElement) return;

            const safeDivisor =
                Number.isFinite(scrollDivisor) && scrollDivisor > 0
                    ? scrollDivisor
                    : 300;
            registeredConfigs.set(targetId, {
                scrollDivisor: safeDivisor,
                isMenuBlur: Boolean(isMenuBlur),
            });

            const stateKey = `${safeDivisor}|${Boolean(disableBlur)}|${Boolean(isMenuBlur)}`;
            const prev = activeHandlers.get(targetId);
            if (prev && prev.key === stateKey) return;

            if (prev?.handler) {
                window.removeEventListener("scroll", prev.handler);
            }
            activeHandlers.delete(targetId);

            if (disableBlur && !isMenuBlur) {
                blurElement.style.display = "none";
                blurElement.style.opacity = "0";
                activeHandlers.set(targetId, { handler: null, key: stateKey });
                return;
            }

            if (blurElement.style.display !== "") {
                blurElement.style.display = "";
            }
            blurElement.setAttribute("role", "presentation");

            if (isMenuBlur && supportsScrollTimeline) {
                if (blurElement.style.opacity !== "") {
                    blurElement.style.opacity = "";
                }
                activeHandlers.set(targetId, { handler: null, key: stateKey });
                return;
            }

            let lastOpacity = -1;
            const updateBlur = () => {
                const scroll =
                    window.scrollY ?? document.documentElement.scrollTop ?? 0;
                const opacity = Math.min(1, Math.max(0, scroll / safeDivisor));
                const rounded = Math.round(opacity * 100) / 100;
                if (rounded !== lastOpacity) {
                    blurElement.style.opacity = String(rounded);
                    lastOpacity = rounded;
                }
            };

            let framePending = false;
            const requestBlurUpdate = () => {
                if (framePending) return;
                framePending = true;
                window.requestAnimationFrame(() => {
                    framePending = false;
                    updateBlur();
                });
            };

            activeHandlers.set(targetId, {
                handler: requestBlurUpdate,
                key: stateKey,
            });
            window.addEventListener("scroll", requestBlurUpdate, {
                passive: true,
            });
            requestBlurUpdate();
        }

        function setBackgroundBlurDisabled(disabled) {
            registeredConfigs.forEach((cfg, targetId) => {
                setBackgroundBlur(
                    targetId,
                    cfg.scrollDivisor,
                    disabled,
                    cfg.isMenuBlur,
                );
            });
        }

        function bindScriptTag(script) {
            if (!script || script.dataset.bfBlurBound === "true") return;
            const targetId = script.getAttribute("data-blur-id");
            if (!targetId) return;
            script.dataset.bfBlurBound = "true";
            const scrollDivisor = Number(
                script.getAttribute("data-scroll-divisor") || 300,
            );
            setBackgroundBlur(
                targetId,
                scrollDivisor,
                readInitialDisableBlur(),
                targetId === "menu-blur",
            );
        }

        window.setBackgroundBlur = setBackgroundBlur;
        window.setBackgroundBlurDisabled = setBackgroundBlurDisabled;
        window.__bfBlurManager = { bindScriptTag };
    }

    if (document.currentScript?.hasAttribute("data-blur-id")) {
        window.__bfBlurManager.bindScriptTag(document.currentScript);
    } else {
        document
            .querySelectorAll("script[data-blur-id]")
            .forEach(window.__bfBlurManager.bindScriptTag);
    }
})();
