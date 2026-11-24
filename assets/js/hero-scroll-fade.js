// assets/js/hero-scroll-fade.js
// 优先交由 CSS Scroll-Driven Animation 在合成层驱动，仅对不支持该特性的浏览器提供 rAF 降级监听
(function () {
    "use strict";

    const script =
        document.currentScript ||
        document.querySelector("script[data-hero-id]");
    if (!script) return;

    if (
        window.CSS &&
        typeof window.CSS.supports === "function" &&
        window.CSS.supports(
            "(animation-timeline: scroll()) and (animation-range: 0% 100%)",
        )
    ) {
        return;
    }

    const target = document.getElementById(
        script.getAttribute("data-hero-id"),
    );
    if (!target) return;

    const rawDistance = Number(script.getAttribute("data-fade-distance"));
    const baseDistance =
        Number.isFinite(rawDistance) && rawDistance > 0 ? rawDistance : 500;
    const reducedMotion = Boolean(
        window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const distance = reducedMotion
        ? Math.min(baseDistance, 250)
        : baseDistance;

    let ticking = false;
    let lastOpacity = -1;

    const update = () => {
        ticking = false;
        if (document.documentElement.dataset.heroBg === "off") return;

        const scrollY =
            window.scrollY ?? document.documentElement.scrollTop ?? 0;
        const opacity = Math.max(0, 1 - scrollY / distance);
        const rounded = Math.round(opacity * 100) / 100;

        if (rounded !== lastOpacity) {
            target.style.opacity = String(rounded);
            target.style.visibility = rounded === 0 ? "hidden" : "visible";
            lastOpacity = rounded;
        }
    };

    const requestUpdate = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("bf:hero-settings-change", () => {
        lastOpacity = -1;
        update();
    });
    update();
})();