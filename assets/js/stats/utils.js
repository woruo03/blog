// assets/js/stats/utils.js
// 前端统计公共基础工具：本地存储、匿名指纹、安全请求与骨架屏渲染

const numFormat = new Intl.NumberFormat();

export const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

export const isBot =
    Boolean(navigator.webdriver) ||
    /bot|crawler|spider|slurp|headless/i.test(navigator.userAgent) ||
    Boolean(document.documentElement.getAttribute("webdriver")) ||
    Boolean(window._phantom || window.__nightmare || window.callPhantom);

export function getStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (_) {
        return null;
    }
}

export function setStorage(key, val) {
    try {
        localStorage.setItem(key, val);
    } catch (_) {}
}

export function removeStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (_) {}
}

// 博主免记模式（Admin Bypass）：访问携带 ?admin=1 或 ?admin=0 切换持久化免记标记
export function resolveAdminBypass() {
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
    return getStorage("blog_admin_bypass") === "true";
}

export function getVisitorId() {
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

export function formatNum(n) {
    return numFormat.format(typeof n === "number" ? n : parseInt(n, 10) || 0);
}

export function unpulse(el, text) {
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

export function safeFetch(url, options = {}) {
    const fetchOptions = { ...options };
    // keepalive 属于页面卸载/后台保活传输，避免混合附加 AbortSignal 导致浏览器抛出 TypeError
    if (fetchOptions.keepalive) {
        delete fetchOptions.signal;
    } else {
        let signal = fetchOptions.signal;
        const timeoutSignal =
            "timeout" in AbortSignal ? AbortSignal.timeout(6000) : undefined;
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

export function queryStatNodes(prefix, id) {
    const fullId = prefix + id;
    const escaped =
        typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(fullId)
            : fullId.replace(/['"\\]/g, "\\$&");
    return document.querySelectorAll(`span[id='${escaped}']`);
}
