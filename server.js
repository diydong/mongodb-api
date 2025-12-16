import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const PORT = 3000;

const client = new MongoClient(MONGO_URI);
const app = express();
app.use(cors());

// 排除集合
const EXCLUDE_COLLECTIONS = ["old_backup", "test_merge"];

// 中文集合
const CHINESE_COLLECTIONS = ["hd_chinese_subtitles", "domestic_original"];

// 无码集合
const UC_COLLECTIONS = [
  "asia_codeless_originate",
  "domestic_original",
  "EU_US_no_mosaic"
];

// UHD 集合
const UHD_COLLECTIONS = ["4k_video", "hd_chinese_subtitles"];

// -------------------------
// 缓存
// -------------------------
const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

function setCache(key, data) {
  cache.set(key, { data, expire: Date.now() + CACHE_TTL });
}

function getCache(key) {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() > c.expire) {
    cache.delete(key);
    return null;
  }
  return c.data;
}

// -------------------------
// 提取时间戳
// -------------------------
function getTimestamp(doc) {
  if (doc._raw_time) return new Date(doc._raw_time).getTime();
  return 0;
}

// -------------------------
// 集合内部去重（保留最新）
// -------------------------
function dedupeInsideCollection(docs) {
  const map = new Map();

  for (const doc of docs) {
    const key = doc.number || doc.title;
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, doc);
    } else {
      // 有重复 → 保留最新
      const old = map.get(key);
      if (getTimestamp(doc) > getTimestamp(old)) {
        map.set(key, doc);
      }
    }
  }

  return [...map.values()];
}

// -------------------------
// 格式转换
// -------------------------
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

// -------------------------
// 主 API
// -------------------------
app.get("/api/bt", async (req, res) => {
  const keyword = (req.query.keyword || "").trim();
  if (!keyword) return res.json({ data: [] });

  const page = parseInt(req.query.page || "1", 10);
  const limit = 20; // 固定分页大小
  const skip = (page - 1) * limit;

  const cacheKey = keyword.toLowerCase();
  const cached = getCache(cacheKey);

  if (cached) {
    console.log(`⚡ 缓存命中 keyword=${keyword}`);
    const paged = cached.slice(skip, skip + limit);
    return res.json({ page, limit, total: cached.length, data: paged });
  }

  console.log(`🆕 查询 keyword=${keyword}`);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    let results = [];

    for (const col of collections) {
      if (EXCLUDE_COLLECTIONS.includes(col.name)) continue;

      const docs = await db
        .collection(col.name)
        .find({
          $or: [
            { number: { $regex: keyword, $options: "i" } },
            { title: { $regex: keyword, $options: "i" } }
          ]
        })
        .toArray()
        .catch(() => []);

      // 集合内部去重（只保留最新）
      const cleaned = dedupeInsideCollection(docs);

      // 转换并添加
      for (const doc of cleaned) {
        results.push(mapTorrent(doc, col.name));
      }
    }

    // 全局按时间排序
    results.sort((a, b) => getTimestamp(b) - getTimestamp(a));

    // 缓存
    setCache(cacheKey, results);

    // 分页
    const paged = results.slice(skip, skip + limit);

    res.json({
      page,
      limit,
      total: results.length,
      data: paged
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () => console.log(`🚀 BT API running on port ${PORT}`));
