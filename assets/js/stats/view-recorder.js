// assets/js/stats/view-recorder.js
// 真实阅读门禁：停留 >= 6 秒，或滚动 >= 30% 且停留 >= 3.5 秒才上报浏览量（24 小时冷却）

import { getStorage, safeFetch, setStorage } from "./utils.js";

const VIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function setupViewRecorder({
    rawId,
    visitorId,
    storageKeyView,
    disabled,
    onReportData,
}) {
    const cachedTs = Number(getStorage(storageKeyView));
    const inCooldown =
        Number.isFinite(cachedTs) &&
        cachedTs > 0 &&
        Date.now() - cachedTs < VIEW_COOLDOWN_MS;
    if (disabled || inCooldown) return null;

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

    function cancel() {
        reported = true;
        clearTimeout(dwellTimer);
        clearTimeout(scrollCheckTimer);
        window.removeEventListener("scroll", onScroll);
        document.removeEventListener("visibilitychange", onVisibilityChange);
    }

    function triggerReport() {
        if (reported) return;
        cancel();

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
                onReportData(data);
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

    return cancel;
}
