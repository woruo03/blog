// assets/js/smart-toc.js
// 智能大纲 (smartTOC)：焦点线追踪、物理触底推进、O(1) 增量高亮与未聚焦子项折叠
(function () {
    "use strict";

    // 视口阅读焦点线：紧随 60px 顶栏下方约 50px 处 (110px)，避免超前激活后续子项
    const SCROLL_FOCUS_THRESHOLD = 110;
    const ACTIVE_CLASS = "active";

    let isJumpingToAnchor = false;
    let targetAnchorId = null;
    let jumpTimeout = null;
    let currentActiveId = null;
    let prevActiveLink = null;
    let openUls = new Set();
    let scrollFollowRafId = null;

    function safeDecode(str) {
        if (!str) return "";
        try {
            return decodeURIComponent(str);
        } catch (_) {
            return str;
        }
    }

    function getActiveAnchorId(validAnchors) {
        if (isJumpingToAnchor && targetAnchorId) return targetAnchorId;
        if (validAnchors.length === 0) return "";

        const canScroll =
            document.documentElement.scrollHeight > window.innerHeight + 1;
        if (!canScroll) {
            const fromHash = safeDecode(window.location.hash.substring(1));
            if (fromHash && validAnchors.some((a) => a.id === fromHash)) {
                return fromHash;
            }
        }

        let candidateIndex = -1;
        for (let i = validAnchors.length - 1; i >= 0; i--) {
            if (
                validAnchors[i].el.getBoundingClientRect().top <=
                SCROLL_FOCUS_THRESHOLD
            ) {
                candidateIndex = i;
                break;
            }
        }
        if (candidateIndex === -1) candidateIndex = 0;

        // 物理触底推进：仅当当前标题已滚出顶栏且下一标题进入视口时自然推进
        const isAtBottom =
            window.innerHeight + window.scrollY >=
            document.documentElement.scrollHeight - 20;
        if (isAtBottom) {
            while (candidateIndex < validAnchors.length - 1) {
                if (
                    validAnchors[candidateIndex].el.getBoundingClientRect()
                        .top > 0
                ) {
                    break;
                }
                if (
                    validAnchors[candidateIndex + 1].el.getBoundingClientRect()
                        .top < window.innerHeight
                ) {
                    candidateIndex++;
                } else {
                    break;
                }
            }
        }

        return validAnchors[candidateIndex].id;
    }

    function updateTOC({
        toc,
        tocView,
        validAnchors,
        linkMap,
        collapseInactive,
    }) {
        if (tocView && tocView.offsetParent === null) return;

        const activeId = getActiveAnchorId(validAnchors);
        if (!activeId || activeId === currentActiveId) return;
        currentActiveId = activeId;

        const nextActiveLink = linkMap.get(activeId);

        if (prevActiveLink && prevActiveLink !== nextActiveLink) {
            prevActiveLink.classList.remove(ACTIVE_CLASS);
            prevActiveLink.removeAttribute("aria-current");
        }

        if (nextActiveLink) {
            nextActiveLink.classList.add(ACTIVE_CLASS);
            nextActiveLink.setAttribute("aria-current", "location");

            if (collapseInactive) {
                const nextOpenUls = new Set();
                let el = nextActiveLink;
                while (el && el !== toc) {
                    if (
                        el.tagName === "UL" &&
                        el.parentElement?.tagName === "LI"
                    ) {
                        nextOpenUls.add(el);
                    }
                    el = el.parentElement;
                }
                const directChildUl = nextActiveLink
                    .closest("li")
                    ?.querySelector(":scope > ul");
                if (directChildUl) nextOpenUls.add(directChildUl);

                openUls.forEach((ul) => {
                    if (!nextOpenUls.has(ul)) ul.classList.remove("toc-open");
                });
                nextOpenUls.forEach((ul) => {
                    if (!openUls.has(ul)) ul.classList.add("toc-open");
                });
                openUls = nextOpenUls;
            }

            // 大纲容器自身内部滚动跟随，延后至下一帧避免读写交错重排
            if (!isJumpingToAnchor && tocView && window.scrollY > 0) {
                if (scrollFollowRafId) cancelAnimationFrame(scrollFollowRafId);
                const followTarget = nextActiveLink;
                scrollFollowRafId = requestAnimationFrame(() => {
                    scrollFollowRafId = null;
                    const viewRect = tocView.getBoundingClientRect();
                    const linkRect = followTarget.getBoundingClientRect();
                    if (
                        linkRect.top < viewRect.top + 16 ||
                        linkRect.bottom > viewRect.bottom - 16
                    ) {
                        tocView.scrollTop +=
                            linkRect.top - viewRect.top - viewRect.height / 3;
                    }
                });
            }

            prevActiveLink = nextActiveLink;
        }
    }

    function initTOC() {
        const toc = document.getElementById("TableOfContents");
        if (!toc) return;
        const tocView = document.getElementById("TOCView");
        const collapseInactive = tocView?.dataset.collapseUnfocused === "true";

        const linkMap = new Map();
        const links = [...toc.querySelectorAll('a[href^="#"]')];
        links.forEach((link) => {
            const targetId = safeDecode(
                (link.getAttribute("href") || "").replace(/^#/, ""),
            );
            if (targetId) linkMap.set(targetId, link);
        });

        const validAnchors = [...document.querySelectorAll(".anchor")]
            .map((anchor) => ({
                el: anchor.parentElement || anchor,
                id: safeDecode(anchor.id),
            }))
            .filter((item) => linkMap.has(item.id));

        const config = {
            toc,
            tocView,
            validAnchors,
            linkMap,
            collapseInactive,
        };

        links.forEach((link) => {
            link.addEventListener("click", () => {
                const href = link.getAttribute("href");
                if (href && href.startsWith("#")) {
                    targetAnchorId = safeDecode(href.substring(1));
                    isJumpingToAnchor = true;
                    updateTOC(config);

                    clearTimeout(jumpTimeout);
                    jumpTimeout = setTimeout(() => {
                        isJumpingToAnchor = false;
                        targetAnchorId = null;
                    }, 1000);
                }
            });
        });

        const releaseJumpLock = () => {
            if (!isJumpingToAnchor) return;
            isJumpingToAnchor = false;
            targetAnchorId = null;
            clearTimeout(jumpTimeout);
        };
        window.addEventListener("wheel", releaseJumpLock, { passive: true });
        window.addEventListener("touchmove", releaseJumpLock, {
            passive: true,
        });

        let rafId = null;
        const onScroll = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                updateTOC(config);
            });
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("hashchange", () => {
            const hashId = safeDecode(window.location.hash.substring(1));
            if (isJumpingToAnchor && hashId === targetAnchorId) return;
            currentActiveId = null;
            updateTOC(config);
        });

        if (document.body) {
            new MutationObserver(() => {
                if (!document.body.classList.contains("zen-mode-enable")) {
                    onScroll();
                }
            }).observe(document.body, {
                attributes: true,
                attributeFilter: ["class"],
            });
        }

        const desktopMq = window.matchMedia("(min-width: 1024px)");
        const onMediaChange = (e) => {
            if (e.matches) onScroll();
        };
        if (desktopMq.addEventListener) {
            desktopMq.addEventListener("change", onMediaChange);
        } else if (desktopMq.addListener) {
            desktopMq.addListener(onMediaChange);
        }

        requestAnimationFrame(() => {
            setTimeout(() => {
                updateTOC(config);
                tocView?.classList.add("smart-toc-ready");
            }, 0);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initTOC, { once: true });
    } else {
        initTOC();
    }
})();
