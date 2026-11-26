// lib/stats/db.js
// Cloudflare D1 持久化访问层：惰性建表回退、批量读取、单篇读写与原子点赞切换

let schemaInitPromise = null;

async function ensureDbSchema(db) {
    if (!schemaInitPromise) {
        schemaInitPromise = (async () => {
            // D1 的 exec() 以换行作为语句边界，单条 DDL 必须完整写在一行内
            await db.exec(
                "CREATE TABLE IF NOT EXISTS stats (id TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            );
            await db.exec(
                "CREATE TABLE IF NOT EXISTS stats_likes_log (post_id TEXT NOT NULL, client_hash TEXT NOT NULL, liked_at INTEGER NOT NULL, PRIMARY KEY (post_id, client_hash));",
            );
        })().finally(() => {
            schemaInitPromise = null;
        });
    }
    return schemaInitPromise;
}

// 仅在初次部署命中缺表异常时惰性建表，并发请求共享同一条单飞 Promise 避免重复 DDL 写锁
export async function executeWithSchemaFallback(db, queryFn) {
    try {
        return await queryFn();
    } catch (err) {
        const msg = `${err?.message || ""} ${err?.cause?.message || ""}`;
        if (/no such table/i.test(msg)) {
            await ensureDbSchema(db);
            return await queryFn();
        }
        throw err;
    }
}

export async function queryBatchStats(db, idList) {
    const placeholders = idList.map(() => "?").join(",");
    const res = await db
        .prepare(
            `SELECT id, views, likes FROM stats WHERE id IN (${placeholders})`,
        )
        .bind(...idList)
        .all();
    const data = {};
    for (const row of res?.results || []) {
        data[row.id] = { views: row.views || 0, likes: row.likes || 0 };
    }
    return data;
}

export async function readPostStats(db, id, clientHash = null) {
    if (clientHash) {
        const batchRes = await db.batch([
            db.prepare("SELECT views, likes FROM stats WHERE id = ?").bind(id),
            db
                .prepare(
                    "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
                )
                .bind(id, clientHash),
        ]);
        const row = batchRes[0]?.results?.[0];
        return {
            views: row?.views || 0,
            likes: row?.likes || 0,
            userLiked: Boolean(batchRes[1]?.results?.[0]),
        };
    }
    const row = await db
        .prepare("SELECT views, likes FROM stats WHERE id = ?")
        .bind(id)
        .first();
    return {
        views: row?.views || 0,
        likes: row?.likes || 0,
        userLiked: false,
    };
}

export async function incrementViewAndReadLiked(db, id, clientHash = null) {
    const upsertStmt = db
        .prepare(
            "INSERT INTO stats (id, views, likes) VALUES (?1, 1, 0) ON CONFLICT(id) DO UPDATE SET views = views + 1, updated_at = CURRENT_TIMESTAMP RETURNING views, likes;",
        )
        .bind(id);
    if (!clientHash) {
        const row = await upsertStmt.first();
        return {
            views: row?.views || 1,
            likes: row?.likes || 0,
            userLiked: false,
        };
    }
    const batchRes = await db.batch([
        upsertStmt,
        db
            .prepare(
                "SELECT 1 FROM stats_likes_log WHERE post_id = ? AND client_hash = ?",
            )
            .bind(id, clientHash),
    ]);
    const row = batchRes[0]?.results?.[0];
    return {
        views: row?.views || 1,
        likes: row?.likes || 0,
        userLiked: Boolean(batchRes[1]?.results?.[0]),
    };
}

export async function toggleLikeInDb(db, { id, isLike, clientHash }) {
    const logRes = isLike
        ? await db
              .prepare(
                  "INSERT OR IGNORE INTO stats_likes_log (post_id, client_hash, liked_at) VALUES (?1, ?2, ?3)",
              )
              .bind(id, clientHash, Math.floor(Date.now() / 1000))
              .run()
        : await db
              .prepare(
                  "DELETE FROM stats_likes_log WHERE post_id = ?1 AND client_hash = ?2",
              )
              .bind(id, clientHash)
              .run();

    const changed = (logRes?.meta?.changes || 0) > 0;
    let row;
    if (changed) {
        const sql = isLike
            ? "INSERT INTO stats (id, views, likes) VALUES (?1, 0, 1) ON CONFLICT(id) DO UPDATE SET likes = likes + 1, updated_at = CURRENT_TIMESTAMP RETURNING views, likes;"
            : "UPDATE stats SET likes = MAX(likes - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?1 RETURNING views, likes;";
        row = await db.prepare(sql).bind(id).first();
    } else {
        // 幂等重复请求：0 写入，直接只读返回
        row = await db
            .prepare("SELECT views, likes FROM stats WHERE id = ?")
            .bind(id)
            .first();
    }

    const payload = {
        id,
        views: row?.views || 0,
        likes: row?.likes ?? (isLike && changed ? 1 : 0),
        userLiked: isLike,
    };
    if (isLike) {
        payload.duplicate = !changed;
    }
    return payload;
}
