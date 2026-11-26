// assets/js/stats/single-article.js
// 单篇文章交互：首屏拉取、统一防抖/保活并发状态机与跨标签页实时同步

import {
    formatNum,
    getStorage,
    isBot,
    isLocal,
    queryStatNodes,
    removeStorage,
    safeFetch,
    setStorage,
    unpulse,
} from "./utils.js";
import { setupViewRecorder } from "./view-recorder.js";

export function initSingleArticle({ visitorId, isAdminBypass }) {
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

    let isLiked = getStorage(storageKeyLike) === "true";
    let initialLiked = isLiked;
    let currentLikes = 0;
    let confirmedLikes = 0;
    let hasUserInteracted = false;
    let hasLikedSettled = false;
    let maxRenderedViews = -1;

    let debounceTimer = null;
    let inflightController = null;
    let inflightTargetLiked = null;
    let likeRequestSeq = 0;
    let isUnloading = false;

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
        if (inflightTargetLiked === null && isLiked === initialLiked) return;
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
                    reconcileServerLikes(res.likes, serverLiked, targetLiked);
                }
            })
            .catch((err) => {
                if (seq !== likeRequestSeq || err?.name === "AbortError") {
                    return;
                }
                inflightController = null;
                inflightTargetLiked = null;
                if (isUnloading) return;

                hasLikedSettled = true;
                isLiked = initialLiked;
                currentLikes = confirmedLikes;
                renderLikeUI(isLiked, "操作失败，已恢复状态");
                setLikeStorage(isLiked);
                renderLikesCount(currentLikes);
            });
    }

    renderLikeUI(isLiked);

    // 1. 首屏拉取真实统计并核验点赞状态
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

    // 2. 启动真实阅读门禁上报
    const cancelViewRecorder = setupViewRecorder({
        rawId,
        visitorId,
        storageKeyView,
        disabled: isLocal || isBot || isAdminBypass,
        onReportData: (data) => {
            updateViews(data.views);
            if (
                typeof data.likes === "number" &&
                !hasUserInteracted &&
                !hasLikedSettled
            ) {
                reconcileServerLikes(data.likes, data.userLiked);
            }
        },
    });

    // 3. 点赞乐观更新 + 450ms 防抖 + 离页保活同步
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
        window.addEventListener("pagehide", () => {
            isUnloading = true;
            flushPendingLike();
        });
        window.addEventListener("pageshow", () => {
            isUnloading = false;
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flushPendingLike();
        });
    }

    // 4. 跨标签页状态同步
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
                const delta = remoteLiked ? 1 : -1;
                isLiked = remoteLiked;
                initialLiked = remoteLiked;
                confirmedLikes = Math.max(0, confirmedLikes + delta);
                currentLikes = Math.max(0, currentLikes + delta);
                renderLikeUI(isLiked);
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
