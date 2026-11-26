// assets/js/a11y/dialog.js
// 桌面端锚定 Popover 定位降级、移动端 <dialog> 模态交互与 Safari 轻关闭降级

const supportsPopover = Object.hasOwn(HTMLElement.prototype, "popover");
export const supportsAnchorPosition = Boolean(
    window.CSS &&
        typeof window.CSS.supports === "function" &&
        window.CSS.supports("position-area: block-end"),
);

const trackedPanels = [];

function closePopover(panel) {
    if (supportsPopover) {
        if (panel.matches(":popover-open")) panel.hidePopover();
    } else if (panel.open) {
        panel.close();
    }
}

function positionPopoverFallback(panel, toggle, { preOpen = false } = {}) {
    if (supportsAnchorPosition || !toggle) return;

    const rect = toggle.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        closePopover(panel);
        return;
    }

    const gap = 8;
    const pad = 12;

    if (preOpen) {
        const right = Math.max(pad, Math.round(window.innerWidth - rect.right));
        panel.style.position = "fixed";
        panel.style.margin = "0";
        panel.style.inset = "auto";
        panel.style.top = `${Math.round(rect.bottom + gap)}px`;
        panel.style.right = `${right}px`;
        return;
    }

    const panelW = panel.offsetWidth || 352;
    const panelH = panel.offsetHeight || 400;

    const maxLeft = Math.max(pad, window.innerWidth - panelW - pad);
    const left = Math.min(maxLeft, Math.max(pad, rect.right - panelW));

    let top = rect.bottom + gap;
    if (
        top + panelH > window.innerHeight - pad &&
        rect.top - gap - panelH >= pad
    ) {
        top = rect.top - gap - panelH;
    } else {
        const maxTop = Math.max(pad, window.innerHeight - panelH - pad);
        top = Math.min(maxTop, Math.max(pad, top));
    }

    panel.style.position = "fixed";
    panel.style.margin = "0";
    panel.style.inset = "auto";
    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
}

export function repositionOpenPopovers() {
    if (supportsAnchorPosition) return;
    trackedPanels.forEach(({ panel, toggle, isPopover }) => {
        if (!isPopover) return;
        const isOpen = supportsPopover
            ? panel.matches(":popover-open")
            : panel.open;
        if (isOpen) positionPopoverFallback(panel, toggle);
    });
}

export function setupViewportSync() {
    const desktopMq = window.matchMedia?.("(min-width: 768px)");
    desktopMq?.addEventListener?.("change", (e) => {
        trackedPanels.forEach(({ panel, isPopover }) => {
            if (isPopover && !e.matches) {
                closePopover(panel);
            } else if (!isPopover && e.matches && panel.open) {
                panel.close();
            }
        });
    });

    if (supportsAnchorPosition) return;
    let resizeFrame = false;
    window.addEventListener(
        "resize",
        () => {
            if (resizeFrame) return;
            resizeFrame = true;
            window.requestAnimationFrame(() => {
                resizeFrame = false;
                repositionOpenPopovers();
            });
        },
        { passive: true },
    );
}

const isOpenSelect = (el) => {
    if (!(el instanceof HTMLSelectElement)) return false;
    try {
        return el.matches(":open");
    } catch {
        return false;
    }
};

export function bindPanelLifecycle({ panel, toggle, closeBtn, resetBtn, onReset }) {
    const syncExpanded = (open) => {
        toggle?.setAttribute("aria-expanded", String(open));
    };

    resetBtn?.addEventListener("click", onReset);

    const isPopover = panel.hasAttribute("popover");
    trackedPanels.push({ panel, toggle, isPopover });

    if (isPopover) {
        if (supportsPopover) {
            let returnFocusOnClose = false;
            closeBtn?.addEventListener("click", () => {
                returnFocusOnClose = true;
            });
            panel.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && !isOpenSelect(e.target)) {
                    returnFocusOnClose = true;
                }
            });
            if (!supportsAnchorPosition) {
                panel.addEventListener("beforetoggle", (e) => {
                    if (e.newState === "open") {
                        positionPopoverFallback(panel, toggle, { preOpen: true });
                    }
                });
            }
            panel.addEventListener("toggle", (e) => {
                const open = e.newState === "open";
                syncExpanded(open);
                if (open) {
                    returnFocusOnClose = false;
                    positionPopoverFallback(panel, toggle);
                } else if (returnFocusOnClose) {
                    returnFocusOnClose = false;
                    toggle?.focus();
                }
            });
        } else {
            toggle?.addEventListener("click", () => {
                if (panel.open) {
                    panel.close();
                } else {
                    panel.show();
                    syncExpanded(true);
                    positionPopoverFallback(panel, toggle);
                }
            });
            closeBtn?.addEventListener("click", () => {
                panel.close();
                toggle?.focus();
            });
            panel.addEventListener("close", () => syncExpanded(false));
            document.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && panel.open) {
                    panel.close();
                    toggle?.focus();
                }
            });
            document.addEventListener("click", (e) => {
                if (
                    !panel.open ||
                    panel.contains(e.target) ||
                    toggle?.contains(e.target)
                ) {
                    return;
                }
                panel.close();
            });
        }
        return;
    }

    toggle?.addEventListener("click", () => {
        if (panel.open) {
            panel.close();
            return;
        }
        const menuToggle = document.getElementById("mobile-menu-toggle");
        if (menuToggle?.checked) {
            menuToggle.checked = false;
            document
                .querySelectorAll(
                    'label[role="button"][for="mobile-menu-toggle"]',
                )
                .forEach((label) => {
                    label.setAttribute("aria-expanded", "false");
                });
        }
        panel.showModal();
        syncExpanded(true);
    });

    closeBtn?.addEventListener("click", () => panel.close());

    let pressedOutside = false;

    panel.addEventListener("close", () => {
        pressedOutside = false;
        syncExpanded(false);
        const isToggleHidden =
            !toggle ||
            !toggle.offsetParent ||
            window.getComputedStyle(toggle).visibility === "hidden";
        if (isToggleHidden) {
            document
                .querySelector('label[role="button"][for="mobile-menu-toggle"]')
                ?.focus();
        }
    });

    // 为不支持 <dialog closedby="any"> 的浏览器（如 Safari）提供外部点击轻关闭降级
    if (!("closedBy" in HTMLDialogElement.prototype)) {
        const isOutside = (e) => {
            const r = panel.getBoundingClientRect();
            return (
                e.clientX < r.left ||
                e.clientX > r.right ||
                e.clientY < r.top ||
                e.clientY > r.bottom
            );
        };
        panel.addEventListener("pointerdown", (e) => {
            pressedOutside =
                e.isPrimary &&
                (e.pointerType !== "mouse" || e.button === 0) &&
                e.target === panel &&
                isOutside(e);
        });
        panel.addEventListener("pointerup", (e) => {
            const wasPressedOutside = pressedOutside;
            pressedOutside = false;
            if (
                wasPressedOutside &&
                e.isPrimary &&
                (e.pointerType !== "mouse" || e.button === 0) &&
                e.target === panel &&
                isOutside(e)
            ) {
                panel.close();
            }
        });
        panel.addEventListener("pointercancel", () => {
            pressedOutside = false;
        });
    }
}
