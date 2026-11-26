// assets/js/mermaid-lazy.js
// Mermaid 按需懒加载：距视口 400px 内才拉取 Mermaid 打包资源并触发主题同步渲染
(function () {
    "use strict";

    const scriptEl =
        document.currentScript ||
        document.querySelector("script[data-mermaid-src]");
    const mermaidSrc = scriptEl?.dataset.mermaidSrc;
    const mermaidIntegrity = scriptEl?.dataset.mermaidIntegrity;
    if (!mermaidSrc) return;

    let loaded = false;

    function loadMermaid() {
        if (loaded) return;
        loaded = true;
        document.querySelectorAll("pre.mermaid").forEach((el) => {
            if (!el.hasAttribute("data-graph")) {
                el.setAttribute("data-graph", el.textContent);
            }
        });
        const s = document.createElement("script");
        s.src = mermaidSrc;
        if (mermaidIntegrity) s.integrity = mermaidIntegrity;
        s.async = true;
        s.onload = () => {
            if (typeof window.updateMermaidTheme === "function") {
                window.updateMermaidTheme();
            } else if (typeof window.mermaid !== "undefined") {
                window.mermaid.run();
            }
        };
        s.onerror = () => s.remove();
        document.head.appendChild(s);
    }

    function observeMermaid() {
        const targets = document.querySelectorAll("pre.mermaid");
        if (!targets.length) return;
        if (!("IntersectionObserver" in window)) {
            loadMermaid();
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    loadMermaid();
                }
            },
            { rootMargin: "400px 0px" },
        );
        targets.forEach((el) => observer.observe(el));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", observeMermaid, {
            once: true,
        });
    } else {
        observeMermaid();
    }
})();
