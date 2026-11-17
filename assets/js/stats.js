// assets/js/stats.js
// 文章浏览量（Views）与点赞（Likes）交互引擎
// 特性：防刷与真实阅读交互门禁、客户端匿名指纹、消灭强制布局重排、服务端点赞状态权威对齐
(function () {
    "use strict";

    const numFormat = new Intl.NumberFormat();
    const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
    const isBot =
        Boolean(navigator.webdriver) ||
        /bot|crawler|spider|slurp|headless/i.test(navigator.userAgent) ||
        Boolean(window.document.documentElement.getAttribute("webdriver")) ||
        Boolean(window._phantom || window.__nightmare || window.callPhantom);

    function getStorage(key) {
        try {
            return localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    }
    function setStorage(key, val) {
        try {
            localStorage.setItem(key, val);
        } catch (_) {}
    }
    function removeStorage(key) {
        try {
            localStorage.removeItem(key);
        } catch (_) {}
    }

    function getVisitorId() {
        let vid = getStorage("blog_vid");
        if (!vid) {
            vid =
                typeof crypto !== "undefined" && crypto.randomUUID
                    ? crypto.randomUUID()
                    : "v_" +
                      Math.random().toString(36).slice(2) +
                      Date.now().toString(36);
            setStorage("blog_vid", vid);
        }
        return vid;
    }
    const visitorId = getVisitorId();

    function formatNum(n) {
        return numFormat.format(
            typeof n === "number" ? n : parseInt(n, 10) || 0,
        );
    }

    function unpulse(el, text) {
        if (!el) return;
        el.textContent = text;
        el.classList.remove(
            "animate-pulse",
            "text-transparent",
            "bg-neutral-300",
            "dark:bg-neutral-600",
        );
        el.setAttribute("aria-busy", "false");
    }

    function safeFetch(url, options = {}) {
        const signal =
            options.signal ||
            ("timeout" in AbortSignal ? AbortSignal.timeout(6000) : undefined);
        return fetch(url, { ...options, signal });
    }

    // 1. 单篇文章交互（首屏极速呈现 + 真实阅读行为门禁 + 点赞状态机）
    function initSingleArticle() {
        const singleHeader = document.getElementById("single_header");
        if (!singleHeader) return null; // 首页/列表页绝不误触发单篇统计

        const likeBtn = singleHeader.querySelector("#button_likes");
        const viewSpan = singleHeader.querySelector("span[id^='views_']");
        const rawId = likeBtn
            ? likeBtn.getAttribute("data-post-id")
            : viewSpan?.id.replace(/^views_/, "") || null;

        if (!rawId || rawId === "null") return null;

        const viewsNodes = document.querySelectorAll(
            "span[id='views_" + rawId + "']",
        );
        const likesNodes = document.querySelectorAll(
            "span[id='likes_" + rawId + "']",
        );

        const filledHeart = likeBtn
            ? document.getElementById("button_likes_heart")
            : null;
        const emptyHeart = likeBtn
            ? document.getElementById("button_likes_empty_heart")
            : null;

        const storageKeyView = "viewed_" + rawId;
        const storageKeyLike = "liked_" + rawId;
        let isLiked = getStorage(storageKeyLike) === "true";
        let currentLikes = 0;
        let hasUserInteracted = false;

        function renderLikeUI(liked) {
            if (!likeBtn) return;
            if (filledHeart) filledHeart.classList.toggle("hidden", !liked);
            if (emptyHeart) emptyHeart.classList.toggle("hidden", liked);
            likeBtn.classList.toggle("liked", liked);
            likeBtn.classList.toggle("text-red-500", liked);
            likeBtn.classList.toggle("dark:text-red-400", liked);
            likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");
            const label = liked ? "已赞 (再次点击取消)" : "点赞";
            likeBtn.setAttribute("aria-label", label);
            likeBtn.setAttribute("title", label);
        }

        renderLikeUI(isLiked);

        // A. 首屏极速拉取当前真实数据（0ms 呈现，消灭骨架屏跳动并核验点赞状态）
        safeFetch(
            "/api/stats?id=" +
                encodeURIComponent(rawId) +
                "&vid=" +
                encodeURIComponent(visitorId),
        )
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data) return;
                const views = typeof data.views === "number" ? data.views : 0;
                viewsNodes.forEach((el) => unpulse(el, formatNum(views)));

                if (!hasUserInteracted) {
                    currentLikes =
                        typeof data.likes === "number" ? data.likes : 0;
                    likesNodes.forEach((el) =>
                        unpulse(el, formatNum(currentLikes)),
                    );
                    if (typeof data.userLiked === "boolean") {
                        isLiked = data.userLiked;
                        renderLikeUI(isLiked);
                        if (isLiked) setStorage(storageKeyLike, "true");
                        else removeStorage(storageKeyLike);
                    }
                }
            })
            .catch(() => {
                viewsNodes.forEach((el) => unpulse(el, "0"));
                if (!hasUserInteracted) {
                    likesNodes.forEach((el) => unpulse(el, "0"));
                }
            });

        // B. 真实阅读行为门禁：停留达到 2.5 秒且可见，或读者滚动超 150px 时才上报浏览量
        function setupViewRecorder() {
            const shouldRecord =
                !isLocal && !isBot && !getStorage(storageKeyView);
            if (!shouldRecord) return;

            let reported = false;
            let dwellTimer = null;

            function triggerReport() {
                if (reported) return;
                reported = true;
                if (dwellTimer) clearTimeout(dwellTimer);
                window.removeEventListener("scroll", onScroll);
                document.removeEventListener(
                    "visibilitychange",
                    onVisibilityChange,
                );

                safeFetch("/api/stats", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: rawId,
                        action: "view",
                        vid: visitorId,
                    }),
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((data) => {
                        if (!data) return;
                        setStorage(storageKeyView, "true");
                        if (typeof data.views === "number") {
                            viewsNodes.forEach((el) =>
                                unpulse(el, formatNum(data.views)),
                            );
                        }
                    })
                    .catch(() => {});
            }

            function onScroll() {
                if (
                    (window.scrollY ||
                        window.pageYOffset ||
                        document.documentElement.scrollTop ||
                        0) > 150
                ) {
                    triggerReport();
                }
            }

            function onVisibilityChange() {
                if (document.hidden) {
                    if (dwellTimer) clearTimeout(dwellTimer);
                } else {
                    dwellTimer = setTimeout(triggerReport, 2500);
                }
            }

            if (!document.hidden && document.visibilityState !== "prerender") {
                dwellTimer = setTimeout(triggerReport, 2500);
            }
            document.addEventListener("visibilitychange", onVisibilityChange);
            window.addEventListener("scroll", onScroll, { passive: true });
        }

        setupViewRecorder();

        // C. 点赞交互（乐观更新 + 防抖 + 服务端防刷对齐）
        if (likeBtn) {
            let debounceTimer = null;
            let initialLiked = isLiked;

            likeBtn.addEventListener("click", () => {
                hasUserInteracted = true;
                const nextLiked = !isLiked;
                const delta = nextLiked ? 1 : -1;
                isLiked = nextLiked;
                currentLikes = Math.max(0, currentLikes + delta);

                renderLikeUI(isLiked);
                likesNodes.forEach((el) =>
                    unpulse(el, formatNum(currentLikes)),
                );
                if (isLiked) setStorage(storageKeyLike, "true");
                else removeStorage(storageKeyLike);

                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (isLiked === initialLiked) return; // 快速反悔且归位，无需向网络发送请求
                    const action = isLiked ? "like" : "unlike";
                    initialLiked = isLiked;

                    safeFetch("/api/stats", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            id: rawId,
                            action,
                            vid: visitorId,
                        }),
                    })
                        .then((r) => (r.ok ? r.json() : null))
                        .then((res) => {
                            if (res && typeof res.likes === "number") {
                                currentLikes = res.likes;
                                if (typeof res.userLiked === "boolean") {
                                    isLiked = res.userLiked;
                                    initialLiked = isLiked;
                                    renderLikeUI(isLiked);
                                    if (isLiked)
                                        setStorage(storageKeyLike, "true");
                                    else removeStorage(storageKeyLike);
                                }
                                likesNodes.forEach((el) =>
                                    unpulse(el, formatNum(currentLikes)),
                                );
                            }
                        })
                        .catch(() => {});
                }, 250);
            });
        }

        return rawId;
    }

    // 2. 列表卡片批量查询（单次复合选择器 DOM 遍历）
    function initMultiStats(excludeId) {
        const map = new Map();

        document
            .querySelectorAll("span[id^='views_'], span[id^='likes_']")
            .forEach((node) => {
                const isView = node.id.startsWith("views_");
                const id = node.id.slice(6);
                if (id && id !== "null" && id !== excludeId) {
                    let entry = map.get(id);
                    if (!entry) {
                        entry = { views: [], likes: [] };
                        map.set(id, entry);
                    }
                    if (isView) entry.views.push(node);
                    else entry.likes.push(node);
                }
            });

        const ids = Array.from(map.keys());
        if (ids.length === 0) return;

        safeFetch("/api/stats?ids=" + encodeURIComponent(ids.join(",")))
            .then((r) => (r.ok ? r.json() : null))
            .then((res) => {
                const data = res?.data || {};
                map.forEach((nodes, id) => {
                    const item = data[id] || { views: 0, likes: 0 };
                    nodes.views.forEach((el) =>
                        unpulse(el, formatNum(item.views)),
                    );
                    nodes.likes.forEach((el) =>
                        unpulse(el, formatNum(item.likes)),
                    );
                });
            })
            .catch(() => {
                map.forEach((nodes) => {
                    nodes.views.forEach((el) => unpulse(el, "0"));
                    nodes.likes.forEach((el) => unpulse(el, "0"));
                });
            });
    }

    function start() {
        const singleId = initSingleArticle();
        initMultiStats(singleId);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
