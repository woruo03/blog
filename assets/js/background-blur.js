// assets/js/background-blur.js
// 针对顶栏与背景模糊的高性能平滑透明度控制（带边界守卫与去重清理，消除 >300px 无效重排）
(function () {
    "use strict";

    const activeHandlers = new Map();

    function setBackgroundBlur(
        targetId,
        scrollDivisor = 300,
        disableBlur = false,
        isMenuBlur = false,
    ) {
        if (!targetId) return;

        const blurElement = document.getElementById(targetId);
        if (!blurElement) return;

        const safeDivisor =
            Number.isFinite(scrollDivisor) && scrollDivisor > 0
                ? scrollDivisor
                : 300;
        const stateKey = `${safeDivisor}|${Boolean(disableBlur)}|${Boolean(isMenuBlur)}`;
        const prev = activeHandlers.get(targetId);
        if (prev && prev.key === stateKey) return;

        if (prev?.handler) {
            window.removeEventListener("scroll", prev.handler);
        }
        activeHandlers.delete(targetId);

        if (disableBlur && !isMenuBlur) {
            blurElement.style.display = "none";
            blurElement.style.opacity = "0";
            activeHandlers.set(targetId, { handler: null, key: stateKey });
            return;
        }

        blurElement.style.display = "";
        blurElement.setAttribute("role", "presentation");
        if (isMenuBlur) {
            blurElement.classList.toggle(
                "bf-menu-blur-disabled",
                Boolean(disableBlur),
            );
        }

        let lastOpacity = -1;
        const updateBlur = () => {
            const scroll =
                window.scrollY ?? document.documentElement.scrollTop ?? 0;
            // 限制在 [0, 1] 范围，采用 2 位精度规避浮点微差，一旦超过阈值锁定为 1 杜绝无效更新
            const opacity = Math.min(1, Math.max(0, scroll / safeDivisor));
            const roundedOpacity = Math.round(opacity * 100) / 100;
            if (roundedOpacity !== lastOpacity) {
                blurElement.style.opacity = roundedOpacity.toString();
                lastOpacity = roundedOpacity;
            }
        };

        let framePending = false;
        const requestBlurUpdate = () => {
            if (framePending) return;
            framePending = true;
            window.requestAnimationFrame(() => {
                framePending = false;
                updateBlur();
            });
        };

        activeHandlers.set(targetId, {
            handler: requestBlurUpdate,
            key: stateKey,
        });
        window.addEventListener("scroll", requestBlurUpdate, { passive: true });
        updateBlur();
    }

    window.setBackgroundBlur = setBackgroundBlur;

    document.querySelectorAll("script[data-blur-id]").forEach((script) => {
        const targetId = script.getAttribute("data-blur-id");
        const scrollDivisor = Number(
            script.getAttribute("data-scroll-divisor") || 300,
        );
        const isMenuBlur = targetId === "menu-blur";
        let settings = {};
        try {
            settings = JSON.parse(localStorage.getItem("a11ySettings") || "{}");
        } catch (_) {
            settings = {};
        }
        const disableBlur = settings.disableBlur || false;
        setBackgroundBlur(targetId, scrollDivisor, disableBlur, isMenuBlur);
    });
})();
