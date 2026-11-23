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

    let rafId = null;

    function updateReadingProgress() {
        rafId = null;
        const bar = document.getElementById("reading-progress");
        if (!bar) return;

        const scrollable =
            document.documentElement.scrollHeight - window.innerHeight;
        const ratio =
            scrollable > 0
                ? Math.min(1, Math.max(0, window.scrollY / scrollable))
                : 0;
        bar.style.transform = "scaleX(" + ratio + ")";
    }

    function requestUpdate() {
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(updateReadingProgress);
    }

    function init() {
        if (!document.getElementById("reading-progress")) return;
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
