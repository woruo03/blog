// assets/js/reading-progress.js
// 零重排阅读进度条：优先交由 CSS Scroll-Driven Animations 驱动；仅在不支持的旧浏览器中降级为 rAF + scaleX
(function () {
    "use strict";

    if (
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("animation-timeline", "scroll()")
    ) {
        return;
    }

    if (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
        return;
    }

    function init() {
        const bar = document.getElementById("reading-progress");
        if (!bar) return;

        let rafId = null;
        let lastRatio = -1;

        function updateReadingProgress() {
            rafId = null;
            const scrollable =
                document.documentElement.scrollHeight - window.innerHeight;
            const ratio =
                scrollable > 0
                    ? Math.min(1, Math.max(0, window.scrollY / scrollable))
                    : 0;
            const rounded = Math.round(ratio * 1000) / 1000;
            if (rounded !== lastRatio) {
                lastRatio = rounded;
                bar.style.transform = `scaleX(${rounded})`;
            }
        }

        function requestUpdate() {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(updateReadingProgress);
        }

        window.addEventListener("scroll", requestUpdate, { passive: true });
        window.addEventListener("resize", requestUpdate, { passive: true });
        if (document.readyState !== "complete") {
            window.addEventListener("load", updateReadingProgress, {
                once: true,
            });
        }
        updateReadingProgress();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
