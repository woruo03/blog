// assets/js/share.js
// 文章底部分享栏交互：复制链接（Async Clipboard API）与系统原生分享（Web Share API），
// 优先通过 Invoker Commands (command/commandfor) 分派，低版本浏览器自动降级为单条 click 委托。
(function () {
    "use strict";

    const timers = new WeakMap();
    const rafIds = new WeakMap();
    let lastMessage = "";

    function report(button, ok, rawMessage) {
        const tip = button.nextElementSibling;
        clearTimeout(timers.get(button));
        const pendingRaf = rafIds.get(button);
        if (pendingRaf) {
            window.cancelAnimationFrame(pendingRaf.outer);
            window.cancelAnimationFrame(pendingRaf.inner);
        }

        button.removeAttribute("data-copied");
        button.removeAttribute("data-failed");
        if (tip) tip.textContent = "";

        let message = rawMessage;
        if (message === lastMessage) {
            message += "\u00A0";
        }
        lastMessage = message;

        // 双 rAF 确保属性清除先提交一帧再重新触发状态过渡，无同步强制重排且连点可稳定重播动画与读屏播报
        const handle = { outer: 0, inner: 0 };
        handle.outer = window.requestAnimationFrame(() => {
            handle.inner = window.requestAnimationFrame(() => {
                rafIds.delete(button);
                button.setAttribute(ok ? "data-copied" : "data-failed", "");
                if (tip) tip.textContent = message;
            });
        });
        rafIds.set(button, handle);

        timers.set(
            button,
            window.setTimeout(() => {
                button.removeAttribute("data-copied");
                button.removeAttribute("data-failed");
                if (tip) tip.textContent = "";
            }, 2000),
        );
    }

    async function copyLink(button, container) {
        const url = container.dataset.shareUrl || window.location.href;
        const okLabel = container.dataset.copiedLabel || "Copied";
        const failLabel = container.dataset.copyFailedLabel || "Copy failed";
        if (!url) return;

        try {
            await navigator.clipboard.writeText(url);
            report(button, true, okLabel);
        } catch (_) {
            report(button, false, failLabel);
        }
    }

    function getShareData(container) {
        return {
            title: container.dataset.shareTitle || document.title,
            url: container.dataset.shareUrl || window.location.href,
        };
    }

    async function nativeShare(button, container) {
        const shareData = getShareData(container);
        const failLabel = container.dataset.shareFailedLabel || "Share failed";

        try {
            await navigator.share(shareData);
        } catch (err) {
            if (err && err.name === "AbortError") return;
            report(button, false, failLabel);
        }
    }

    function handleCommand(button, target, command) {
        if (!button || !target) return;
        if (command === "--copy-link") {
            copyLink(button, target);
        } else if (command === "--native-share") {
            nativeShare(button, target);
        }
    }

    // Invoker Commands 优先（command 事件不冒泡，需在捕获阶段监听）；仅注册一条路径，避免双触发
    if ("CommandEvent" in window) {
        document.addEventListener(
            "command",
            (event) => {
                if (
                    event.command === "--copy-link" ||
                    event.command === "--native-share"
                ) {
                    handleCommand(event.source, event.target, event.command);
                }
            },
            true,
        );
    } else {
        document.addEventListener("click", (event) => {
            if (event.defaultPrevented || !(event.target instanceof Element)) {
                return;
            }
            const button = event.target.closest(
                'button[command="--copy-link"], button[command="--native-share"]',
            );
            if (!button) return;
            const targetId = button.getAttribute("commandfor");
            const target = targetId ? document.getElementById(targetId) : null;
            if (target) {
                handleCommand(button, target, button.getAttribute("command"));
            }
        });
    }

    function initNativeShare() {
        const container = document.getElementById("article-sharing");
        if (!container) return;
        const nativeWrap = container.querySelector("[data-native-share-wrap]");
        if (!nativeWrap || typeof navigator.share !== "function") return;

        const shareData = getShareData(container);
        if (
            typeof navigator.canShare !== "function" ||
            navigator.canShare(shareData)
        ) {
            nativeWrap.hidden = false;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initNativeShare, {
            once: true,
        });
    } else {
        initNativeShare();
    }
})();
