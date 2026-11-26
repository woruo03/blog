// assets/js/breadcrumbs.js
// 动态来源面包屑：根据同源 Referrer 或 sessionStorage 还原访客进入文章时的分类/标签/专栏路径
(function () {
    "use strict";

    function safeDecode(str) {
        if (!str) return "";
        try {
            return decodeURIComponent(str);
        } catch (_) {
            return str;
        }
    }

    function initBreadcrumbs() {
        const trail = document.getElementById("breadcrumbs-trail");
        if (!trail || !trail.dataset.taxonomies) return;

        let referrerPath = "";
        if (document.referrer) {
            try {
                const refUrl = new URL(document.referrer);
                if (refUrl.origin === window.location.origin) {
                    referrerPath = safeDecode(refUrl.pathname);
                    try {
                        sessionStorage.setItem(
                            "blog_breadcrumb_ref",
                            referrerPath,
                        );
                    } catch (_) {}
                } else {
                    try {
                        sessionStorage.removeItem("blog_breadcrumb_ref");
                    } catch (_) {}
                }
            } catch (_) {}
        } else {
            try {
                referrerPath =
                    sessionStorage.getItem("blog_breadcrumb_ref") || "";
            } catch (_) {}
        }
        if (!referrerPath) return;

        let taxData;
        try {
            taxData = JSON.parse(trail.dataset.taxonomies || "{}");
        } catch (_) {
            return;
        }

        const cleanPath = referrerPath.replace(/\/+$/, "") + "/";
        const match = cleanPath.match(/^\/(tags|categories|series)\/([^/]+)\//);
        if (!match) return;

        const [, tax] = match;
        const normalizedRef = cleanPath.slice(0, -1).toLowerCase();
        const target = (taxData[tax] || []).find(
            (t) =>
                safeDecode(t.url).replace(/\/+$/, "").toLowerCase() ===
                normalizedRef,
        );
        if (!target) return;

        const li = document.createElement("li");
        li.className = "inline-flex items-center";

        const a = document.createElement("a");
        a.className = "hover:underline decoration-neutral-300";
        a.href = target.url;
        a.textContent = target.title;

        const span = document.createElement("span");
        span.className = "px-1.5 text-primary-500 select-none";
        span.setAttribute("aria-hidden", "true");
        span.textContent = "/";

        li.append(a, span);
        trail.replaceChildren(li);
        trail.closest("nav")?.removeAttribute("hidden");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initBreadcrumbs, {
            once: true,
        });
    } else {
        initBreadcrumbs();
    }
})();
