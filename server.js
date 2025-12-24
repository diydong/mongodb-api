import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import fs from "fs";

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const PORT = 3000;

const client = new MongoClient(MONGO_URI);
const app = express();
app.use(cors());

// --------------------------------------------------
// 日志带时间
// --------------------------------------------------
function log(msg) {
  const t = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false
  }).replace(/\//g, "-");

  console.log(`[${t}] ${msg}`);
}

// --------------------------------------------------
// 配置
// --------------------------------------------------
const PAGE_LIMIT = 50;

const EXCLUDE_COLLECTIONS = ["old_backup", "test_merge"];

const CHINESE_COLLECTIONS = ["hd_chinese_subtitles", "domestic_original"];

const UC_COLLECTIONS = [
  "asia_codeless_originate",
  "domestic_original",
  "EU_US_no_mosaic"
];

const UHD_COLLECTIONS = ["4k_video", "hd_chinese_subtitles"];

// --------------------------------------------------
// 缓存系统
// --------------------------------------------------
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

function setCache(key, data) {
  cache.set(key, { data, expire: Date.now() + CACHE_TTL });
}

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.expire) {
    cache.delete(key);
    return null;
  }
  return v.data;
}

// --------------------------------------------------
// 时间戳（排序用）
// --------------------------------------------------
function getTimestamp(doc) {
  if (doc._raw_time) return new Date(doc._raw_time).getTime();
  return 0;
}

// --------------------------------------------------
// 集合内部去重（按 tid，保留最新）
// --------------------------------------------------
function dedupeInsideCollection(docs) {
  const map = new Map();

  for (const doc of docs) {
    const tid = doc.tid || doc.id;
    if (!tid) continue; // 没 tid 的直接丢弃（更干净）

    const key = String(tid);
    const prev = map.get(key);

    if (!prev) {
      map.set(key, doc);
    } else {
      // 保留时间最新的
      if (getTimestamp(doc) > getTimestamp(prev)) {
        map.set(key, doc);
      }
    }
  }

  return [...map.values()];
}


// --------------------------------------------------
// 文档格式转换
// --------------------------------------------------
function mapTorrent(doc, collectionName) {
  const number = doc.number || "";
  const rawTitle = doc.title || "";
  const finalTitle = number ? `[${number.toUpperCase()}] ${rawTitle}` : rawTitle;

  const chinese = CHINESE_COLLECTIONS.includes(collectionName);

  let uc = UC_COLLECTIONS.includes(collectionName);
  if (rawTitle.includes("破解")) uc = true;

  const uhd = UHD_COLLECTIONS.includes(collectionName);

  return {
    chinese,
    download_url: doc.magnet || doc.magnet_url || doc.download || "",
    free: true,
    id: Number(doc.tid || doc.id || 0),
    seeders: Number(doc.seeders || 0),
    site: "Sehuatang",
    size_mb: Number(doc.size_mb || 0),
    title: finalTitle,
    uc,
    uhd,
    _raw_time: doc.post_time || doc.date || null
  };
}

// --------------------------------------------------
// 主 API
// --------------------------------------------------
app.get("/api/bt", async (req, res) => {
  const keyword = (req.query.keyword || "").trim();
  if (!keyword) return res.json({ data: [] });

  const page = parseInt(req.query.page || "1", 10);
  const skip = (page - 1) * PAGE_LIMIT;

  const cacheKey = `kw:${keyword.toLowerCase()}`;
  const cached = getCache(cacheKey);

  if (cached) {
    log(`⚡ 缓存命中 keyword="${keyword}" total=${cached.length}`);
    return res.json({ data: cached.slice(skip, skip + PAGE_LIMIT) });
  }

  log(`\n==============================`);
  log(`🔎 keyword="${keyword}"`);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    let results = [];

    for (const col of collections) {
      const colName = col.name;

      if (EXCLUDE_COLLECTIONS.includes(colName)) {
        continue;
      }

      const docs = await db
        .collection(colName)
        .find({
          $or: [
            { number: { $regex: keyword, $options: "i" } },
            { title: { $regex: keyword, $options: "i" } }
          ]
        })
        .toArray()
        .catch(() => []);

      if (docs.length === 0) {
        continue;
      }

      // 去重前数量
      const before = docs.length;

      // 集合内去重（保留最新）
      const cleaned = dedupeInsideCollection(docs);

      // ⭐ 显示去重日志
      log(`→ ${colName}: 原始=${before} 去重后=${cleaned.length}`);

      for (const doc of cleaned) {
        results.push(mapTorrent(doc, colName));
      }
    }

    log(`✔ 合并后=${results.length} 条`);

    // 全局排序
    results.sort((a, b) => getTimestamp(b) - getTimestamp(a));
    log(`✔ 排序完成`);

    // 删除内部字段
    results = results.map(r => {
      const { _raw_time, ...clean } = r;
      return clean;
    });

    setCache(cacheKey, results);

    const paged = results.slice(skip, skip + PAGE_LIMIT);

    log(`✔ 分页 page=${page}, limit=${PAGE_LIMIT}, 返回=${paged.length}`);
    log(`==============================\n`);

    return res.json({ data: paged });

  } catch (err) {
    log(`❌ ERROR: ${err}`);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => log(`🚀 BT API running on port ${PORT}`));
