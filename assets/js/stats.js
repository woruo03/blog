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
        const timeoutSignal =
            "timeout" in AbortSignal ? AbortSignal.timeout(6000) : undefined;
        let signal = options.signal;
        if (timeoutSignal && signal) {
            signal = AbortSignal.any
                ? AbortSignal.any([signal, timeoutSignal])
                : signal;
        } else {
            signal = signal || timeoutSignal;
        }
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

        function queryStatNodes(prefix, id) {
            const selector =
                typeof CSS !== "undefined" && CSS.escape
                    ? "span[id='" + CSS.escape(prefix + id) + "']"
                    : "span[id='" + (prefix + id).replace(/['"\\]/g, "\\$&") + "']";
            return document.querySelectorAll(selector);
        }

        const viewsNodes = queryStatNodes("views_", rawId);
        const likesNodes = queryStatNodes("likes_", rawId);

        const filledHeart = likeBtn
            ? document.getElementById("button_likes_heart")
            : null;
        const emptyHeart = likeBtn
            ? document.getElementById("button_likes_empty_heart")
            : null;
        const liveRegion = document.getElementById("likes_live_" + rawId);

        const storageKeyView = "viewed_" + rawId;
        const storageKeyLike = "liked_" + rawId;
        const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

        let isLiked = getStorage(storageKeyLike) === "true";
        let initialLiked = isLiked; // 与 isLiked 全局同步，防止取消点赞去抖被误杀
        let currentLikes = 0;
        let confirmedLikes = 0; // 服务端确证基准值，保证回滚与多标签页同步零漂移
        let hasUserInteracted = false;
        let hasLikedSettled = false; // 点赞响应是否已落地确证，用于防止迟到的旧快照冲掉点赞基准
        let maxRenderedViews = -1; // 单调递增守护，消灭 GET 与 POST 竞态闪回
        let cancelViewRecorder = null;

        function updateViews(count) {
            if (typeof count !== "number") return;
            if (count >= maxRenderedViews) {
                maxRenderedViews = count;
                viewsNodes.forEach((el) => unpulse(el, formatNum(maxRenderedViews)));
            }
        }

        const titleLike = likeBtn?.getAttribute("data-title-like") || "点赞";
        const titleLiked = likeBtn?.getAttribute("data-title-liked") || "已赞 (再次点击取消)";

        function renderLikeUI(liked, liveMsg) {
            if (!likeBtn) return;
            if (filledHeart) filledHeart.classList.toggle("hidden", !liked);
            if (emptyHeart) emptyHeart.classList.toggle("hidden", liked);
            likeBtn.classList.toggle("liked", liked);
            likeBtn.classList.toggle("text-red-500", liked);
            likeBtn.classList.toggle("dark:text-red-400", liked);
            likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");
            const label = liked ? titleLiked : titleLike;
            likeBtn.setAttribute("aria-label", label);
            likeBtn.setAttribute("aria-describedby", "likes_" + rawId);
            likeBtn.setAttribute("title", label);
            if (liveRegion && liveMsg) {
                liveRegion.textContent = liveMsg;
            }
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
                updateViews(data.views);

                if (typeof data.likes === "number" && !hasLikedSettled) {
                    confirmedLikes = data.likes;
                    if (!hasUserInteracted) {
                        if (typeof data.userLiked === "boolean") {
                            initialLiked = data.userLiked;
                            isLiked = data.userLiked;
                            renderLikeUI(isLiked);
                            if (isLiked) setStorage(storageKeyLike, "true");
                            else removeStorage(storageKeyLike);
                        }
                        currentLikes = confirmedLikes;
                    } else {
                        // 首屏响应到达前用户已点击：基于真实历史基准立刻平滑校准乐观计数
                        const diff = isLiked ? (initialLiked ? 0 : 1) : (initialLiked ? -1 : 0);
                        currentLikes = Math.max(0, confirmedLikes + diff);
                    }
                    likesNodes.forEach((el) =>
                        unpulse(el, formatNum(currentLikes)),
                    );
                }
            })
            .catch(() => {
                if (maxRenderedViews < 0) {
                    viewsNodes.forEach((el) => unpulse(el, "0"));
                }
                if (!hasUserInteracted) {
                    likesNodes.forEach((el) => unpulse(el, "0"));
                }
            });

        // B. 真实阅读行为门禁：停留达到 2.5 秒且可见，或读者滚动超 150px 时才上报浏览量
        function setupViewRecorder() {
            function isViewInCooldown() {
                const val = getStorage(storageKeyView);
                if (!val) return false;
                const ts = Number(val);
                if (Number.isFinite(ts)) {
                    return Date.now() - ts < VIEW_COOLDOWN_MS;
                }
                // 兼容旧历史值 "true"，平滑判定为冷却过期
                return false;
            }

            const shouldRecord =
                !isLocal && !isBot && !isViewInCooldown();
            if (!shouldRecord) return;

            let reported = false;
            let dwellTimer = null;

            cancelViewRecorder = function () {
                reported = true;
                if (dwellTimer) clearTimeout(dwellTimer);
                window.removeEventListener("scroll", onScroll);
                document.removeEventListener(
                    "visibilitychange",
                    onVisibilityChange,
                );
            };

            function triggerReport() {
                if (reported) return;
                cancelViewRecorder();
                setStorage(storageKeyView, String(Date.now()));

                safeFetch("/api/stats", {
                    method: "POST",
                    keepalive: true,
                    priority: "low",
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
                        updateViews(data.views);
                        if (typeof data.likes === "number" && !hasUserInteracted && !hasLikedSettled) {
                            confirmedLikes = data.likes;
                            if (typeof data.userLiked === "boolean") {
                                initialLiked = data.userLiked;
                                isLiked = data.userLiked;
                                renderLikeUI(isLiked);
                                if (isLiked) setStorage(storageKeyLike, "true");
                                else removeStorage(storageKeyLike);
                            }
                            currentLikes = confirmedLikes;
                            likesNodes.forEach((el) =>
                                unpulse(el, formatNum(currentLikes)),
                            );
                        }
                    })
                    .catch(() => {});
            }

            function onScroll() {
                if (window.scrollY > 150) {
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

        // C. 点赞交互（乐观更新 + 防抖 + 服务端防刷对齐 + 异常平滑回滚）
        if (likeBtn) {
            let debounceTimer = null;
            let inflightController = null;

            likeBtn.addEventListener("click", () => {
                hasUserInteracted = true;
                const nextLiked = !isLiked;
                const delta = nextLiked ? 1 : -1;
                isLiked = nextLiked;
                currentLikes = Math.max(0, currentLikes + delta);

                renderLikeUI(isLiked, isLiked ? "已点赞" : "已取消点赞");
                likesNodes.forEach((el) =>
                    unpulse(el, formatNum(currentLikes)),
                );
                if (isLiked) setStorage(storageKeyLike, "true");
                else removeStorage(storageKeyLike);

                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (isLiked === initialLiked) return; // 快速反悔且归位，无需向网络发送请求
                    const action = isLiked ? "like" : "unlike";
                    const targetLiked = isLiked;

                    if (inflightController) {
                        inflightController.abort();
                    }
                    inflightController = new AbortController();

                    safeFetch("/api/stats", {
                        method: "POST",
                        keepalive: true,
                        signal: inflightController.signal,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            id: rawId,
                            action,
                            vid: visitorId,
                        }),
                    })
                        .then((r) => {
                            if (!r.ok) throw new Error("HTTP " + r.status);
                            return r.json();
                        })
                        .then((res) => {
                            hasLikedSettled = true;
                            if (res && typeof res.likes === "number") {
                                confirmedLikes = res.likes;
                                const serverLiked = typeof res.userLiked === "boolean" ? res.userLiked : targetLiked;
                                initialLiked = serverLiked;

                                if (isLiked === targetLiked) {
                                    // 用户在请求空中未发生新的点击：以服务端状态为准
                                    isLiked = serverLiked;
                                    renderLikeUI(isLiked);
                                    if (isLiked) setStorage(storageKeyLike, "true");
                                    else removeStorage(storageKeyLike);
                                    currentLikes = confirmedLikes;
                                } else {
                                    // 用户在请求空中已再次点击改变主意：保留用户最新状态，基于最新基准动态修正计数
                                    const diff = isLiked ? (initialLiked ? 0 : 1) : (initialLiked ? -1 : 0);
                                    currentLikes = Math.max(0, confirmedLikes + diff);
                                }
                                likesNodes.forEach((el) =>
                                    unpulse(el, formatNum(currentLikes)),
                                );
                            }
                        })
                        .catch((err) => {
                            if (err?.name === "AbortError") return; // 主动中止的旧请求不触发回滚
                            hasLikedSettled = true;
                            // 网络异常或 429 限流失败时，确定性回滚至最近一次服务端确证状态
                            isLiked = initialLiked;
                            currentLikes = confirmedLikes;
                            renderLikeUI(isLiked, "操作失败，已恢复状态");
                            if (isLiked) setStorage(storageKeyLike, "true");
                            else removeStorage(storageKeyLike);
                            likesNodes.forEach((el) =>
                                unpulse(el, formatNum(currentLikes)),
                            );
                        });
                }, 250);
            });

            // 离开页面或切入后台时，立即同步送出挂起的防抖点赞操作，防止关闭或锁屏丢失数据
            function flushPendingLike() {
                if (!debounceTimer || isLiked === initialLiked) return;
                clearTimeout(debounceTimer);
                debounceTimer = null;
                const action = isLiked ? "like" : "unlike";
                safeFetch("/api/stats", {
                    method: "POST",
                    keepalive: true,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: rawId,
                        action,
                        vid: visitorId,
                    }),
                }).catch(() => {});
            }

            window.addEventListener("pagehide", flushPendingLike);
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "hidden") {
                    flushPendingLike();
                }
            });
        }

        // D. 跨标签页状态实时同步（Storage Event 驱动，实现多窗口无缝一致）
        window.addEventListener("storage", (e) => {
            if (e.key === storageKeyLike) {
                // 当另一标签页取消点赞时，Web Storage 规范派发 e.newValue 为 null
                const remoteLiked = e.newValue === "true";
                if (remoteLiked !== isLiked) {
                    const delta = remoteLiked ? 1 : -1;
                    isLiked = remoteLiked;
                    initialLiked = remoteLiked;
                    renderLikeUI(isLiked);
                    currentLikes = Math.max(0, currentLikes + delta);
                    // 不更新 confirmedLikes：它仅由服务端响应校准，
                    // 防止叠加未确认的乐观增量导致永久性计数漂移
                    likesNodes.forEach((el) => unpulse(el, formatNum(currentLikes)));
                }
            } else if (e.key === storageKeyView && e.newValue && cancelViewRecorder) {
                // 另一标签页已上报阅读量，本标签页静默注销监听与倒计时，免除重复请求
                cancelViewRecorder();
            }
        });

        return rawId;
    }

    // 2. 列表卡片批量查询（单次复合选择器 DOM 遍历 + 自动分片请求）
    function initMultiStats(excludeId) {
        const map = new Map();

        document
            .querySelectorAll("span[id^='views_'], span[id^='likes_']")
            .forEach((node) => {
                const isView = node.id.startsWith("views_");
                const prefix = isView ? "views_" : "likes_";
                const id = node.id.slice(prefix.length);
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

        // 以 50 篇为上限安全分片，防止突破 URL 长度及数据库参数限制
        const CHUNK_SIZE = 50;
        for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
            const chunk = ids.slice(i, i + CHUNK_SIZE);
            safeFetch("/api/stats?ids=" + encodeURIComponent(chunk.join(",")), {
                priority: "low",
            })
                .then((r) => (r.ok ? r.json() : null))
                .then((res) => {
                    const data = res?.data || {};
                    chunk.forEach((id) => {
                        const nodes = map.get(id);
                        if (!nodes) return;
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
                    chunk.forEach((id) => {
                        const nodes = map.get(id);
                        if (!nodes) return;
                        nodes.views.forEach((el) => unpulse(el, "0"));
                        nodes.likes.forEach((el) => unpulse(el, "0"));
                    });
                });
        }
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
