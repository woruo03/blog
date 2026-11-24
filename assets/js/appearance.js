// assets/js/appearance.js
// 主题外观与 Mermaid 配色同步（覆写主题脚本：避免 DOMContentLoaded 同步读取样式/几何属性触发首屏强制重排）
var getTargetAppearance = () =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

var updateMeta = () => {
  const body = document.body;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!body || !meta) return;
  const bg = getComputedStyle(body).backgroundColor;
  if (meta.getAttribute("content") !== bg) {
    meta.setAttribute("content", bg);
  }
};

var updateMermaidTheme = () => {
  if (typeof mermaid === "undefined") return;
  const isDark = document.documentElement.classList.contains("dark");
  const mermaids = document.querySelectorAll("pre.mermaid");
  mermaids.forEach((el) => {
    if (el.getAttribute("data-processed")) {
      el.removeAttribute("data-processed");
      el.innerHTML = el.getAttribute("data-graph") || "";
    } else if (!el.hasAttribute("data-graph")) {
      el.setAttribute("data-graph", el.textContent);
    }
  });
  if (isDark) {
    initMermaidDark();
  } else {
    initMermaidLight();
  }
  mermaid.run();
};

{{ if and (.Site.Params.Logo) (.Site.Params.SecondaryLogo) }}
{{ $primaryLogo := resources.Get .Site.Params.Logo }}
{{ $secondaryLogo := resources.Get .Site.Params.SecondaryLogo }}
{{ if and ($primaryLogo) ($secondaryLogo) }}
var updateLogo = (targetAppearance) => {
  const isPrimary = targetAppearance === "{{ .Site.Params.DefaultAppearance }}";
  const targetLogoPath = isPrimary
    ? "{{ $primaryLogo.RelPermalink }}"
    : "{{ $secondaryLogo.RelPermalink }}";
  document.querySelectorAll("img.logo").forEach((elem) => {
    elem.setAttribute("src", targetLogoPath);
  });

  {{ if eq $primaryLogo.MediaType.SubType "svg" }}
  const targetContent = isPrimary
    ? `{{ $primaryLogo.Content | safeHTML }}`
    : `{{ $secondaryLogo.Content | safeHTML }}`;
  document.querySelectorAll("span.logo").forEach((container) => {
    container.innerHTML = targetContent;
  });
  {{ end }}
};
{{ end }}
{{- end }}

(function () {
  "use strict";

  const root = document.documentElement;
  const getSavedAppearance = () => {
    try {
      return localStorage.getItem("appearance");
    } catch (_) {
      return null;
    }
  };
  const setSavedAppearance = (value) => {
    try {
      localStorage.setItem("appearance", value);
    } catch (_) {}
  };
  const removeSavedAppearance = () => {
    try {
      localStorage.removeItem("appearance");
    } catch (_) {}
  };

  const sitePreference = root.getAttribute("data-default-appearance");
  const userPreference = getSavedAppearance();
  const autoAppearance = root.getAttribute("data-auto-appearance") === "true";
  const colorSchemeMq =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  const shouldBeDark =
    (sitePreference === "dark" && userPreference === null) ||
    userPreference === "dark" ||
    (autoAppearance && Boolean(colorSchemeMq?.matches) && userPreference !== "light");

  if (shouldBeDark && !root.classList.contains("dark")) {
    root.classList.add("dark");
  }

  const afterFirstPaint = (fn) => {
    requestAnimationFrame(() => setTimeout(fn, 0));
  };

  let syncAppearanceTooltip = null;

  if (autoAppearance && colorSchemeMq?.addEventListener) {
    colorSchemeMq.addEventListener("change", (event) => {
      if (getSavedAppearance() !== null) return;
      root.classList.toggle("dark", event.matches);
      const nextAppearance = getTargetAppearance();
      updateMeta();
      updateMermaidTheme();
      syncAppearanceTooltip?.(nextAppearance);
      window.updateLogo?.(nextAppearance);
    });
  }

  window.addEventListener("DOMContentLoaded", () => {
    const switcher = document.getElementById("appearance-switcher");
    const switcherMobile = document.getElementById("appearance-switcher-mobile");
    const darkLabel = {{ i18n "footer.dark_appearance" | jsonify }};
    const lightLabel = {{ i18n "footer.light_appearance" | jsonify }};

    syncAppearanceTooltip = (targetAppearance) => {
      const label = targetAppearance === "dark" ? lightLabel : darkLabel;
      [switcher, switcherMobile].forEach((btn) => {
        if (!btn) return;
        btn.setAttribute("aria-label", label);
        btn.setAttribute("title", label);
      });
    };

    const currentAppearance = getTargetAppearance();
    window.updateLogo?.(currentAppearance);
    updateMermaidTheme();
    syncAppearanceTooltip(currentAppearance);

    afterFirstPaint(() => {
      updateMeta();
      const scroller = document.getElementById("top-scroller");
      const footer = document.getElementById("site-footer");
      if (
        scroller &&
        footer &&
        scroller.getBoundingClientRect().top > footer.getBoundingClientRect().top
      ) {
        scroller.hidden = true;
      }
    });

    const bindSwitcher = (btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        root.classList.toggle("dark");
        const targetAppearance = getTargetAppearance();
        setSavedAppearance(targetAppearance);
        updateMeta();
        updateMermaidTheme();
        syncAppearanceTooltip(targetAppearance);
        window.updateLogo?.(targetAppearance);
      });
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removeSavedAppearance();
      });
    };

    bindSwitcher(switcher);
    bindSwitcher(switcherMobile);
  });
})();
