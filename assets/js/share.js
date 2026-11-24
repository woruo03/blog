// assets/js/share.js
// 文章底部分享栏交互：复制链接（Async Clipboard API）与系统原生分享（Web Share API），
// 优先通过 Invoker Commands (command/commandfor) 分派，低版本浏览器自动降级为单条 click 委托。
(function () {
    "use strict";

    const timers = new WeakMap();
    let lastMessage = "";

    function report(button, ok, rawMessage) {
        const tip = button.nextElementSibling;
        clearTimeout(timers.get(button));
        button.removeAttribute("data-copied");
        button.removeAttribute("data-failed");

        let message = rawMessage;
        if (message === lastMessage) {
            message += "\u00A0";
        }
        lastMessage = message;

        if (tip) {
            tip.textContent = "";
            void tip.offsetWidth;
        }
        button.setAttribute(ok ? "data-copied" : "data-failed", "");

        if (tip) {
            window.requestAnimationFrame(function () {
                tip.textContent = message;
            });
        }

        timers.set(
            button,
            window.setTimeout(function () {
                button.removeAttribute("data-copied");
                button.removeAttribute("data-failed");
                if (tip) {
                    tip.textContent = "";
                }
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
            function (event) {
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
        document.addEventListener("click", function (event) {
            if (event.defaultPrevented) return;
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
