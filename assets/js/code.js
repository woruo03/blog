// assets/js/code.js
// 代码块一键复制（覆写 Blowfish 上游脚本：修复全局泄漏与 permissions.query 兼容问题，保留键盘焦点并防连点抖动）
(function () {
    "use strict";

    const timers = new WeakMap();

    function getCodeText(highlightWrapper) {
        const highlightDiv = highlightWrapper.querySelector(".highlight");
        const codeBlock = highlightDiv?.querySelector("code");
        if (!codeBlock) return "";

        const inlineLines = codeBlock.querySelectorAll(".cl");
        if (inlineLines.length > 0) {
            return Array.from(inlineLines)
                .map((line) => line.textContent.replace(/\n$/, ""))
                .join("\n");
        }

        const tableCodeCell = highlightDiv.querySelector(
            ".lntable .lntd:last-child code",
        );
        return (tableCodeCell || codeBlock).textContent.trim();
    }

    function legacyCopy(text) {
        const previousFocus = document.activeElement;
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
        document.body.append(field);
        field.select();
        try {
            return document.execCommand("copy");
        } finally {
            field.remove();
            previousFocus?.focus?.({ preventScroll: true });
        }
    }

    function initCodeCopy() {
        const wrappers = document.querySelectorAll(".highlight-wrapper");
        if (!wrappers.length) return;

        const scriptBundle = document.getElementById("script-bundle");
        const copyText = scriptBundle?.getAttribute("data-copy") || "Copy";
        const copiedText =
            scriptBundle?.getAttribute("data-copied") || "Copied";

        wrappers.forEach((highlightWrapper) => {
            const button = document.createElement("button");
            button.className = "copy-button";
            button.type = "button";
            button.textContent = copyText;
            button.addEventListener("click", async () => {
                const codeToCopy = getCodeText(highlightWrapper);
                if (!codeToCopy) return;
                let ok = false;
                try {
                    await navigator.clipboard.writeText(codeToCopy);
                    ok = true;
                } catch (_) {
                    ok = legacyCopy(codeToCopy);
                }
                if (!ok) return;

                clearTimeout(timers.get(button));
                button.textContent = copiedText;
                timers.set(
                    button,
                    window.setTimeout(() => {
                        button.textContent = copyText;
                    }, 2000),
                );
            });
            highlightWrapper.insertBefore(button, highlightWrapper.firstChild);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCodeCopy, {
            once: true,
        });
    } else {
        initCodeCopy();
    }
})();
