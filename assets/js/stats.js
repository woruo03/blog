// assets/js/stats.js
// 文章浏览量（Views）与点赞（Likes）交互引擎
// 特性：真实阅读门禁、匿名设备指纹、统一并发状态机、跨标签页同步、零重排骨架屏切换
(function () {
    "use strict";

    const numFormat = new Intl.NumberFormat();
    const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
    const isBot =
        Boolean(navigator.webdriver) ||
        /bot|crawler|spider|slurp|headless/i.test(navigator.userAgent) ||
        Boolean(document.documentElement.getAttribute("webdriver")) ||
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

    // 博主免记模式（Admin Bypass）：访问携带 ?admin=1 或 ?admin=0 切换持久化免记标记
    try {
        const adminParam = new URLSearchParams(window.location.search).get(
            "admin",
        );
        if (adminParam === "1") {
            setStorage("blog_admin_bypass", "true");
            console.info(
                "[Stats] 博主免记模式已激活：当前设备的所有浏览将不再计入统计与写入。",
            );
        } else if (adminParam === "0") {
            removeStorage("blog_admin_bypass");
            console.info("[Stats] 博主免记模式已停用。");
        }
    } catch (_) {}
    const isAdminBypass = getStorage("blog_admin_bypass") === "true";

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
        const fetchOptions = { ...options };
        // keepalive 属于页面卸载/后台保活传输，避免混合附加 AbortSignal 导致浏览器抛出 TypeError
        if (fetchOptions.keepalive) {
            delete fetchOptions.signal;
        } else {
            let signal = fetchOptions.signal;
            const timeoutSignal =
                "timeout" in AbortSignal
                    ? AbortSignal.timeout(6000)
                    : undefined;
            if (timeoutSignal && signal) {
                signal = AbortSignal.any
                    ? AbortSignal.any([signal, timeoutSignal])
                    : signal;
            } else {
                signal = signal || timeoutSignal;
            }
            if (signal) {
                fetchOptions.signal = signal;
            }
        }
        return fetch(url, fetchOptions);
    }

    function queryStatNodes(prefix, id) {
        const fullId = prefix + id;
        const escaped =
            typeof CSS !== "undefined" && CSS.escape
                ? CSS.escape(fullId)
                : fullId.replace(/['"\\]/g, "\\$&");
        return document.querySelectorAll(`span[id='${escaped}']`);
    }

    // 1. 单篇文章交互（首屏呈现 + 真实阅读门禁 + 统一防抖/保活状态机）
    function initSingleArticle() {
        const singleHeader = document.getElementById("single_header");
        if (!singleHeader) return null;

        const likeBtn = singleHeader.querySelector("#button_likes");
        const viewSpan = singleHeader.querySelector("span[id^='views_']");
        const rawId = likeBtn
            ? likeBtn.getAttribute("data-post-id")
            : viewSpan?.id.replace(/^views_/, "") || null;

        if (!rawId || rawId === "null") return null;

        const viewsNodes = queryStatNodes("views_", rawId);
        const likesNodes = queryStatNodes("likes_", rawId);
        const filledHeart = likeBtn
            ? document.getElementById("button_likes_heart")
            : null;
        const emptyHeart = likeBtn
            ? document.getElementById("button_likes_empty_heart")
            : null;
        const likeLabelEl = document.getElementById("button_likes_label");
        const liveRegion = document.getElementById("likes_live_" + rawId);

        const storageKeyView = "viewed_" + rawId;
        const storageKeyLike = "liked_" + rawId;
        const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

        let isLiked = getStorage(storageKeyLike) === "true";
        let initialLiked = isLiked;
        let currentLikes = 0;
        let confirmedLikes = 0;
        let hasUserInteracted = false;
        let hasLikedSettled = false;
        let maxRenderedViews = -1;
        let cancelViewRecorder = null;

        let debounceTimer = null;
        let inflightController = null;
        let inflightTargetLiked = null;
        let likeRequestSeq = 0;

        const titleLike = likeBtn?.getAttribute("data-title-like") || "点赞";
        const titleLiked =
            likeBtn?.getAttribute("data-title-liked") || "已赞 (再次点击取消)";

        const setLikeStorage = (liked) => {
            if (liked) setStorage(storageKeyLike, "true");
            else removeStorage(storageKeyLike);
        };

        const renderLikesCount = (count) => {
            const text = formatNum(count);
            likesNodes.forEach((el) => unpulse(el, text));
        };

        function updateViews(count) {
            if (typeof count !== "number" || count < maxRenderedViews) return;
            maxRenderedViews = count;
            const text = formatNum(maxRenderedViews);
            viewsNodes.forEach((el) => unpulse(el, text));
        }

        function renderLikeUI(liked, liveMsg) {
            if (!likeBtn) return;
            if (filledHeart) filledHeart.classList.toggle("hidden", !liked);
            if (emptyHeart) emptyHeart.classList.toggle("hidden", liked);
            likeBtn.classList.toggle("liked", liked);
            likeBtn.setAttribute("aria-pressed", String(liked));
            const label = liked ? titleLiked : titleLike;
            if (likeLabelEl) {
                likeLabelEl.textContent = label + " ";
            }
            likeBtn.setAttribute("title", label);
            if (liveRegion && liveMsg) {
                liveRegion.textContent = liveMsg;
            }
        }

        function reconcileServerLikes(serverLikes, serverLiked, expectedLiked) {
            confirmedLikes = serverLikes;
            if (typeof serverLiked === "boolean") {
                initialLiked = serverLiked;
            }

            const shouldAdoptServer =
                expectedLiked === undefined
                    ? !hasUserInteracted
                    : isLiked === expectedLiked;

            if (shouldAdoptServer) {
                isLiked = initialLiked;
                renderLikeUI(isLiked);
                setLikeStorage(isLiked);
                currentLikes = confirmedLikes;
            } else {
                const diff = Number(isLiked) - Number(initialLiked);
                currentLikes = Math.max(0, confirmedLikes + diff);
            }
            renderLikesCount(currentLikes);
        }

        function dispatchLikeSync(useKeepalive = false) {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
            }

            if (inflightTargetLiked === null && isLiked === initialLiked) {
                return;
            }
            if (inflightTargetLiked !== null && isLiked === inflightTargetLiked) {
                return;
            }

            if (inflightController) {
                inflightController.abort();
                inflightController = null;
            }

            const targetLiked = isLiked;
            const seq = ++likeRequestSeq;
            const controller = useKeepalive ? null : new AbortController();
            inflightController = controller;
            inflightTargetLiked = targetLiked;

            safeFetch("/api/stats", {
                method: "POST",
                keepalive: useKeepalive,
                signal: controller?.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: rawId,
                    action: targetLiked ? "like" : "unlike",
                    vid: visitorId,
                }),
            })
                .then((r) => {
                    if (!r.ok) throw new Error("HTTP " + r.status);
                    return r.json();
                })
                .then((res) => {
                    if (seq !== likeRequestSeq) return;
                    inflightController = null;
                    inflightTargetLiked = null;
                    hasLikedSettled = true;
                    if (res && typeof res.likes === "number") {
                        const serverLiked =
                            typeof res.userLiked === "boolean"
                                ? res.userLiked
                                : targetLiked;
                        reconcileServerLikes(
                            res.likes,
                            serverLiked,
                            targetLiked,
                        );
                    }
                })
                .catch((err) => {
                    if (seq !== likeRequestSeq || err?.name === "AbortError") {
                        return;
                    }
                    inflightController = null;
                    inflightTargetLiked = null;
                    if (useKeepalive) return;

                    hasLikedSettled = true;
                    isLiked = initialLiked;
                    currentLikes = confirmedLikes;
                    renderLikeUI(isLiked, "操作失败，已恢复状态");
                    setLikeStorage(isLiked);
                    renderLikesCount(currentLikes);
                });
        }

        renderLikeUI(isLiked);

        // A. 首屏拉取真实统计并核验点赞状态
        safeFetch(
            "/api/stats?id=" +
                encodeURIComponent(rawId) +
                "&vid=" +
                encodeURIComponent(visitorId),
        )
            .then((r) => {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .then((data) => {
                if (!data) throw new Error("Empty response");
                updateViews(data.views);
                if (typeof data.likes === "number" && !hasLikedSettled) {
                    reconcileServerLikes(data.likes, data.userLiked);
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

        // B. 真实阅读门禁：停留 >= 6 秒，或滚动 >= 30% 且停留 >= 3.5 秒才上报
        function setupViewRecorder() {
            const cachedTs = Number(getStorage(storageKeyView));
            const inCooldown =
                Number.isFinite(cachedTs) &&
                cachedTs > 0 &&
                Date.now() - cachedTs < VIEW_COOLDOWN_MS;
            if (isLocal || isBot || isAdminBypass || inCooldown) return;

            let reported = false;
            let activeDwellMs = 0;
            let lastActiveTimestamp = document.hidden ? 0 : Date.now();
            let dwellTimer = null;
            let scrollCheckTimer = null;

            const getCurrentActiveDwell = () =>
                activeDwellMs +
                (!document.hidden && lastActiveTimestamp > 0
                    ? Date.now() - lastActiveTimestamp
                    : 0);

            cancelViewRecorder = function () {
                reported = true;
                clearTimeout(dwellTimer);
                clearTimeout(scrollCheckTimer);
                window.removeEventListener("scroll", onScroll);
                document.removeEventListener(
                    "visibilitychange",
                    onVisibilityChange,
                );
            };

            function triggerReport() {
                if (reported) return;
                cancelViewRecorder();

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
                        setStorage(storageKeyView, String(Date.now()));
                        updateViews(data.views);
                        if (
                            typeof data.likes === "number" &&
                            !hasUserInteracted &&
                            !hasLikedSettled
                        ) {
                            reconcileServerLikes(data.likes, data.userLiked);
                        }
                    })
                    .catch(() => {});
            }

            function scheduleDwellTimer() {
                clearTimeout(dwellTimer);
                dwellTimer = null;
                if (document.hidden || reported) return;
                const remaining = Math.max(0, 6000 - getCurrentActiveDwell());
                if (remaining === 0) triggerReport();
                else dwellTimer = setTimeout(triggerReport, remaining);
            }

            function checkScrollEngagement() {
                if (document.hidden || reported) return;
                const scrollable =
                    document.documentElement.scrollHeight - window.innerHeight;
                if (scrollable <= 0 || window.scrollY / scrollable < 0.3) return;

                const current = getCurrentActiveDwell();
                if (current >= 3500) {
                    triggerReport();
                } else if (!scrollCheckTimer) {
                    scrollCheckTimer = setTimeout(() => {
                        scrollCheckTimer = null;
                        if (!document.hidden && !reported) triggerReport();
                    }, 3500 - current);
                }
            }

            let scrollPending = false;
            function onScroll() {
                if (scrollPending) return;
                scrollPending = true;
                requestAnimationFrame(() => {
                    scrollPending = false;
                    checkScrollEngagement();
                });
            }

            function onVisibilityChange() {
                if (document.hidden) {
                    if (lastActiveTimestamp > 0) {
                        activeDwellMs += Date.now() - lastActiveTimestamp;
                        lastActiveTimestamp = 0;
                    }
                    clearTimeout(dwellTimer);
                    clearTimeout(scrollCheckTimer);
                    dwellTimer = null;
                    scrollCheckTimer = null;
                } else {
                    lastActiveTimestamp = Date.now();
                    scheduleDwellTimer();
                    checkScrollEngagement();
                }
            }

            if (!document.hidden && document.visibilityState !== "prerender") {
                scheduleDwellTimer();
            }
            document.addEventListener("visibilitychange", onVisibilityChange);
            window.addEventListener("scroll", onScroll, { passive: true });
        }

        setupViewRecorder();

        // C. 点赞交互（乐观更新 + 450ms 防抖 + 保活同步）
        if (likeBtn) {
            likeBtn.addEventListener("click", () => {
                hasUserInteracted = true;
                isLiked = !isLiked;
                currentLikes = Math.max(0, currentLikes + (isLiked ? 1 : -1));

                renderLikeUI(isLiked, isLiked ? "已点赞" : "已取消点赞");
                renderLikesCount(currentLikes);
                setLikeStorage(isLiked);

                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => dispatchLikeSync(false), 450);
            });

            const flushPendingLike = () => {
                if (debounceTimer) dispatchLikeSync(true);
            };
            window.addEventListener("pagehide", flushPendingLike);
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "hidden") flushPendingLike();
            });
        }

        // D. 跨标签页实时同步
        window.addEventListener("storage", (e) => {
            if (e.key === storageKeyLike) {
                const remoteLiked = e.newValue === "true";
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                }
                if (inflightController) {
                    inflightController.abort();
                    inflightController = null;
                }
                inflightTargetLiked = null;
                likeRequestSeq++;

                if (remoteLiked !== isLiked) {
                    isLiked = remoteLiked;
                    initialLiked = remoteLiked;
                    renderLikeUI(isLiked);
                    currentLikes = Math.max(
                        0,
                        currentLikes + (remoteLiked ? 1 : -1),
                    );
                    renderLikesCount(currentLikes);
                }
            } else if (
                e.key === storageKeyView &&
                e.newValue &&
                cancelViewRecorder
            ) {
                cancelViewRecorder();
            }
        });

        return rawId;
    }

    // 2. 列表卡片批量查询（自动按 50 篇分片）
    function initMultiStats(excludeId) {
        const map = new Map();

        document
            .querySelectorAll(
                "span[id^='views_'], span[id^='likes_']:not([id^='likes_live_'])",
            )
            .forEach((node) => {
                const isView = node.id.startsWith("views_");
                const id = node.id.slice(6);
                if (!id || id === "null" || id === excludeId) return;
                let entry = map.get(id);
                if (!entry) {
                    entry = { views: [], likes: [] };
                    map.set(id, entry);
                }
                (isView ? entry.views : entry.likes).push(node);
            });

        const ids = Array.from(map.keys());
        if (ids.length === 0) return;

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
                        const vText = formatNum(item.views);
                        const lText = formatNum(item.likes);
                        nodes.views.forEach((el) => unpulse(el, vText));
                        nodes.likes.forEach((el) => unpulse(el, lText));
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
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
