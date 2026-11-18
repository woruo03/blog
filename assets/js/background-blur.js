// assets/js/background-blur.js
// 针对顶栏与背景模糊的高性能平滑透明度控制（带边界守卫，消除 >300px 无效重排）
(function () {
    "use strict";

    function setBackgroundBlur(
        targetId,
        scrollDivisor = 300,
        disableBlur = false,
        isMenuBlur = false,
    ) {
        if (!targetId) return;

        const blurElement = document.getElementById(targetId);
        if (!blurElement) return;

        blurElement.setAttribute("aria-hidden", "true");
        if (disableBlur) {
            if (!isMenuBlur) {
                blurElement.style.display = "none";
                blurElement.style.opacity = "0";
            } else {
                blurElement.style.display = "";
            }
        } else {
            blurElement.style.display = "";
        }

        let lastOpacity = -1;
        const updateBlur = () => {
            if (!disableBlur || isMenuBlur) {
                const scroll =
                    window.scrollY ||
                    window.pageYOffset ||
                    document.documentElement.scrollTop ||
                    0;
                // 限制在 [0, 1] 范围，采用 2 位精度规避浮点微差，一旦超过 300px 锁定为 1 杜绝无效更新
                const opacity = Math.min(
                    1,
                    Math.max(0, scroll / scrollDivisor),
                );
                const roundedOpacity = Math.round(opacity * 100) / 100;
                if (roundedOpacity !== lastOpacity) {
                    blurElement.style.opacity = roundedOpacity.toString();
                    lastOpacity = roundedOpacity;
                }
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

        blurElement.setAttribute("role", "presentation");
        window.addEventListener("scroll", requestBlurUpdate, { passive: true });
        updateBlur();
    }

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
