// assets/js/typeit-runner.js
// TypeIt 短代码统一初始化器（与 typeit.umd.js 合并打包为 js/typeit.bundle.js，消除多实例内联脚本重复）
(function () {
    "use strict";

    function fillStaticFallback(el, strings) {
        if (strings.length > 0 && !el.textContent.trim()) {
            el.textContent = strings[0];
        }
    }

    function initElement(el, reducedMotion) {
        let cfg;
        try {
            cfg = JSON.parse(el.dataset.typeit || "{}");
        } catch (_) {
            return;
        }
        const strings = Array.isArray(cfg.strings) ? cfg.strings : [];
        if (strings.length === 0) return;
        if (reducedMotion || typeof window.TypeIt === "undefined") {
            fillStaticFallback(el, strings);
            return;
        }

        const textList = [...strings];
        if (cfg.randomLines) {
            for (let i = textList.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [textList[i], textList[j]] = [textList[j], textList[i]];
            }
        }

        const pause = Number(cfg.pause ?? 2500);
        const delayBetween = Number(cfg.delayBetween ?? 200);
        const breakLines = Boolean(cfg.breakLines);

        const instance = new window.TypeIt(el, {
            speed: Number(cfg.speed ?? 50),
            deleteSpeed: Number(cfg.deleteSpeed ?? 25),
            lifeLike: cfg.lifeLike !== false,
            startDelay: Number(cfg.startDelay ?? 200),
            breakLines,
            waitUntilVisible: cfg.waitUntilVisible !== false,
            loop: cfg.loop !== false,
            loopDelay: [delayBetween, pause],
        });

        textList.forEach((str, idx) => {
            instance.type(str);
            if (idx < textList.length - 1) {
                if (breakLines) {
                    instance.break();
                } else {
                    instance.pause(pause);
                    instance.delete([...str].length);
                    instance.pause(delayBetween);
                }
            }
        });

        instance.go();
    }

    function initAll() {
        const nodes = document.querySelectorAll("[data-typeit]");
        if (!nodes.length) return;
        const reducedMotion = Boolean(
            window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        );
        nodes.forEach((el) => initElement(el, reducedMotion));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll, { once: true });
    } else {
        initAll();
    }
})();
