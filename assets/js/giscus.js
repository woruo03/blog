// assets/js/giscus.js
// Giscus 评论系统：IntersectionObserver 按需懒加载 + MutationObserver / postMessage 日夜换肤同步
(function () {
    "use strict";

    function initGiscus() {
        const container = document.querySelector("div.giscus[data-repo]");
        if (!container) return;

        const getTheme = () =>
            document.documentElement.classList.contains("dark")
                ? "transparent_dark"
                : "light";

        let lastTheme = "";
        let giscusReady = false;

        function loadGiscus() {
            if (container.dataset.loaded === "true") return;
            container.dataset.loaded = "true";

            lastTheme = getTheme();
            const script = document.createElement("script");
            script.src = "https://giscus.app/client.js";
            Array.from(container.attributes).forEach((attr) => {
                if (attr.name.startsWith("data-") && attr.name !== "data-loaded") {
                    script.setAttribute(attr.name, attr.value);
                }
            });
            script.setAttribute("data-theme", lastTheme);
            script.crossOrigin = "anonymous";
            script.async = true;
            container.appendChild(script);
        }

        function syncGiscusTheme() {
            if (!giscusReady) return;
            const nextTheme = getTheme();
            if (nextTheme === lastTheme) return;
            const iframe = document.querySelector("iframe.giscus-frame");
            if (iframe?.contentWindow) {
                lastTheme = nextTheme;
                iframe.contentWindow.postMessage(
                    { giscus: { setConfig: { theme: nextTheme } } },
                    "https://giscus.app",
                );
            }
        }

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(
                (entries, obs) => {
                    if (entries.some((entry) => entry.isIntersecting)) {
                        obs.disconnect();
                        loadGiscus();
                    }
                },
                { rootMargin: "400px 0px" },
            );
            observer.observe(container);
        } else {
            loadGiscus();
        }

        new MutationObserver(syncGiscusTheme).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });
        window.addEventListener("message", (event) => {
            if (
                event.origin === "https://giscus.app" &&
                event.data &&
                typeof event.data === "object" &&
                "giscus" in event.data
            ) {
                giscusReady = true;
                syncGiscusTheme();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initGiscus, {
            once: true,
        });
    } else {
        initGiscus();
    }
})();
