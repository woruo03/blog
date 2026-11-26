// assets/js/stats/index.js
// 文章统计引擎入口（由 Hugo js.Build 打包为单一指纹文件 js/stats.bundle.js）

import { getVisitorId, resolveAdminBypass } from "./utils.js";
import { initSingleArticle } from "./single-article.js";
import { initMultiStats } from "./multi-stats.js";

const isAdminBypass = resolveAdminBypass();
const visitorId = getVisitorId();

function start() {
    const singleId = initSingleArticle({ visitorId, isAdminBypass });
    initMultiStats(singleId);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
    start();
}
