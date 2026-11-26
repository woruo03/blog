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
  document.querySelectorAll("pre.mermaid").forEach((el) => {
    if (el.getAttribute("data-processed")) {
      el.removeAttribute("data-processed");
      el.textContent = el.getAttribute("data-graph") || "";
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
  const autoAppearance = root.getAttribute("data-auto-appearance") === "true";
  const colorSchemeMq =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");

  const computePreferredDark = (userPreference) =>
    userPreference === "dark" ||
    (userPreference !== "light" &&
      (autoAppearance && colorSchemeMq
        ? colorSchemeMq.matches
        : sitePreference === "dark"));

  const syncColorSchemeMeta = (savedPreference = getSavedAppearance()) => {
    const csMeta = document.querySelector('meta[name="color-scheme"]');
    if (!csMeta) return;
    const next =
      savedPreference === "dark" || savedPreference === "light"
        ? savedPreference
        : "dark light";
    if (csMeta.getAttribute("content") !== next) {
      csMeta.setAttribute("content", next);
    }
  };

  const initialSaved = getSavedAppearance();
  root.classList.toggle("dark", computePreferredDark(initialSaved));
  syncColorSchemeMeta(initialSaved);

  const afterFirstPaint = (fn) => {
    requestAnimationFrame(() => setTimeout(fn, 0));
  };

  let syncAppearanceTooltip = null;

  const syncAppearanceUI = (includeMeta = true) => {
    const current = getTargetAppearance();
    if (includeMeta) updateMeta();
    updateMermaidTheme();
    syncAppearanceTooltip?.(current);
    window.updateLogo?.(current);
  };

  if (autoAppearance && colorSchemeMq?.addEventListener) {
    colorSchemeMq.addEventListener("change", (event) => {
      if (getSavedAppearance() !== null) return;
      root.classList.toggle("dark", event.matches);
      syncAppearanceUI();
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== "appearance" && event.key !== null) return;
    const saved = event.key === "appearance" ? event.newValue : null;
    root.classList.toggle("dark", computePreferredDark(saved));
    syncColorSchemeMeta(saved);
    syncAppearanceUI();
  });

  window.addEventListener("bf:color-scheme-change", () => {
    updateMeta();
    updateMermaidTheme();
  });

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

    syncAppearanceUI(false);
    afterFirstPaint(updateMeta);

    const bindSwitcher = (btn) => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        const nextIsDark = !root.classList.contains("dark");
        const target = nextIsDark ? "dark" : "light";
        root.classList.toggle("dark", nextIsDark);
        if (
          autoAppearance &&
          colorSchemeMq &&
          nextIsDark === colorSchemeMq.matches
        ) {
          removeSavedAppearance();
          syncColorSchemeMeta(null);
        } else {
          setSavedAppearance(target);
          syncColorSchemeMeta(target);
        }
        syncAppearanceUI();
      });
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removeSavedAppearance();
        root.classList.toggle("dark", computePreferredDark(null));
        syncColorSchemeMeta(null);
        syncAppearanceUI();
      });
    };

    bindSwitcher(switcher);
    bindSwitcher(switcherMobile);
  });
})();
