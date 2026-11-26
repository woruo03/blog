// lib/stats/security.js
// 边缘统计接口安全校验、CORS/响应构造、匿名哈希与边缘内存限流

const BOT_UA_REGEX =
    /bot|spider|crawl|slurp|curl|wget|python|java|httpclient|axios|scrapy|postman|insomnia|go-http|headless/i;
const DEFAULT_ORIGIN = "https://blog.woruo03.com";
const DEFAULT_SALT = "woruo03-salt";

export const VALID_ACTIONS = new Set(["view", "like", "unlike"]);

let hasWarnedMissingSecret = false;

function encodeCookieId(id) {
    return encodeURIComponent(id).replace(
        /[()]/g,
        (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
}

export function getViewCookieName(id) {
    return "__Secure-viewed_" + encodeCookieId(id);
}

export function hasViewCookieInHeader(cookieHeader, id) {
    if (!cookieHeader) return false;
    const legacyPrefix = "viewed_" + encodeCookieId(id) + "=";
    const securePrefix = "__Secure-" + legacyPrefix;
    return cookieHeader.split(";").some((c) => {
        const trimmed = c.trim();
        return (
            trimmed.startsWith(securePrefix) || trimmed.startsWith(legacyPrefix)
        );
    });
}

export function getViewCookieHeader(cookieName) {
    return `${cookieName}=1; Max-Age=86400; Path=/api/; SameSite=Lax; Secure; HttpOnly`;
}

export function isAllowedOrigin(origin, env = {}) {
    if (!origin) return true;
    try {
        const u = new URL(origin);
        const isLocal =
            u.hostname === "localhost" || u.hostname === "127.0.0.1";
        if (isLocal && (u.protocol === "http:" || u.protocol === "https:")) {
            return true;
        }
        if (
            u.protocol === "https:" &&
            (u.hostname === "blog.woruo03.com" ||
                u.hostname === "blog.pages.dev" ||
                u.hostname.endsWith(".blog.pages.dev"))
        ) {
            return true;
        }
        if (env?.ALLOWED_ORIGINS) {
            const extra = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
            if (
                extra.includes(u.origin) ||
                (u.protocol === "https:" && extra.includes(u.hostname))
            ) {
                return true;
            }
        }
    } catch (_) {}
    return false;
}

export function getCorsHeaders(request, env = {}) {
    const origin = request.headers.get("origin") || "";
    const allowOrigin =
        origin && isAllowedOrigin(origin, env) ? origin : DEFAULT_ORIGIN;
    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "X-Content-Type-Options": "nosniff",
        Vary: "Origin, Sec-Fetch-Site",
    };
}

export function jsonResponse(data, corsHeaders, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            ...extraHeaders,
        },
    });
}

export function isValidId(id) {
    if (typeof id !== "string") return false;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 200) return false;
    // 杜绝路径穿越、控制字符及非法路径分隔符
    return !/[\/\\]|\.\.|[\x00-\x1F\x7F]/.test(trimmed);
}

export function normalizeVid(raw) {
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 128) return "";
    return trimmed;
}

export function isBotRequest(request) {
    if (request.cf?.verifiedBot) return true;
    const ua = request.headers.get("user-agent") || "";
    return !ua || BOT_UA_REGEX.test(ua);
}

function getSalt(env) {
    const secret = env?.STATS_SECRET;
    if (typeof secret === "string" && secret.trim()) {
        return secret.trim();
    }
    if (!hasWarnedMissingSecret) {
        hasWarnedMissingSecret = true;
        console.warn(
            "[Stats] Warning: STATS_SECRET is not configured. Falling back to default salt.",
        );
    }
    return DEFAULT_SALT;
}

async function sha256Prefix(raw) {
    const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(raw),
    );
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
}

export function getClientHash(vid, env) {
    // 以设备端持久化匿名指纹 vid 为核心身份，切换网络或 IPv6 地址轮换时不丢点赞状态
    const cleanVid = (typeof vid === "string" && vid.trim()) || "anonymous";
    return sha256Prefix(`client:${cleanVid}:${getSalt(env)}`);
}

export function getIpHash(request, env) {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    return sha256Prefix(`ip:${ip}:${getSalt(env)}`);
}

// 边缘内存限流：拦截高频刷量脚本，0 磁盘写入，0 数据库往返
const ipRateLimits = new Map();
const RATE_LIMIT_MAX = 30; // 60 秒内最多 30 次写操作
const RATE_LIMIT_WINDOW = 60 * 1000;

export function isRateLimited(ipHash) {
    const now = Date.now();
    const entry = ipRateLimits.get(ipHash);
    if (!entry || now - entry.start >= RATE_LIMIT_WINDOW) {
        ipRateLimits.set(ipHash, { count: 1, start: now });
        if (ipRateLimits.size > 2000) {
            for (const [k, v] of ipRateLimits.entries()) {
                if (now - v.start >= RATE_LIMIT_WINDOW) {
                    ipRateLimits.delete(k);
                }
            }
            if (ipRateLimits.size > 2000) {
                ipRateLimits.clear();
            }
        }
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}
