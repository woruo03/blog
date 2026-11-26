// assets/js/stats/multi-stats.js
// 列表卡片批量统计查询（单次 DOM 遍历 + 50 篇安全分片）

import { formatNum, safeFetch, unpulse } from "./utils.js";

const CHUNK_SIZE = 50;

export function initMultiStats(excludeId) {
    const map = new Map();

    document
        .querySelectorAll(
            "span[id^='views_'], span[id^='likes_']:not([id^='likes_live_'])",
        )
        .forEach((node) => {
            const isView = node.id.startsWith("views_");
            const id = node.id.slice(6);
            if (!id || id === "null" || id === excludeId) return;
            let entry = map.get(id);
            if (!entry) {
                entry = { views: [], likes: [] };
                map.set(id, entry);
            }
            (isView ? entry.views : entry.likes).push(node);
        });

    const ids = Array.from(map.keys());
    if (ids.length === 0) return;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        safeFetch("/api/stats?ids=" + encodeURIComponent(chunk.join(",")), {
            priority: "low",
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((res) => {
                const data = res?.data || {};
                chunk.forEach((id) => {
                    const nodes = map.get(id);
                    if (!nodes) return;
                    const item = data[id] || { views: 0, likes: 0 };
                    const vText = formatNum(item.views);
                    const lText = formatNum(item.likes);
                    nodes.views.forEach((el) => unpulse(el, vText));
                    nodes.likes.forEach((el) => unpulse(el, lText));
                });
            })
            .catch(() => {
                chunk.forEach((id) => {
                    const nodes = map.get(id);
                    if (!nodes) return;
                    nodes.views.forEach((el) => unpulse(el, "0"));
                    nodes.likes.forEach((el) => unpulse(el, "0"));
                });
            });
    }
}
