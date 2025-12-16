import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const PORT = 3000;

const client = new MongoClient(MONGO_URI);
const app = express();
app.use(cors());

// --------------------------------------------------
// 配置
// --------------------------------------------------
const EXCLUDE_COLLECTIONS = ["old_backup", "test_merge"];

const CHINESE_COLLECTIONS = ["hd_chinese_subtitles", "domestic_original"];

const UC_COLLECTIONS = [
  "asia_codeless_originate",
  "domestic_original",
  "EU_US_no_mosaic"
];

const UHD_COLLECTIONS = ["4k_video", "hd_chinese_subtitles"];

// --------------------------------------------------
// 缓存系统（TTL：1 小时）
// --------------------------------------------------
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

// --------------------------------------------------
// 时间戳解析（用于排序）
// --------------------------------------------------
function getTimestamp(doc) {
  if (doc._raw_time) return new Date(doc._raw_time).getTime();
  return 0;
}

// --------------------------------------------------
// 集合内部去重：同 number 或 title 只保留最新
// --------------------------------------------------
function dedupeInsideCollection(docs) {
  const map = new Map();

  for (const doc of docs) {
    const key = doc.number || doc.title;
    if (!key) continue;

    const old = map.get(key);
    if (!old || getTimestamp(doc) > getTimestamp(old)) {
      map.set(key, doc);
    }
  }

  return [...map.values()];
}

// --------------------------------------------------
// 统一格式转换
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
  if (!keyword) {
    console.log("⚠️ 空 keyword 请求");
    return res.json({ data: [] });
  }

  const page = parseInt(req.query.page || "1", 10);
  const limit = 50; // ⭐ 分页固定 50
  const skip = (page - 1) * limit;

  const cacheKey = `kw:${keyword.toLowerCase()}`;

  // 读取缓存
  const cached = getCache(cacheKey);
  if (cached) {
    console.log(`⚡ 缓存命中 → keyword=${keyword}, total=${cached.length}`);
    const paged = cached.slice(skip, skip + limit);
    return res.json({ page, limit, total: cached.length, data: paged });
  }

  console.log(`\n==============================`);
  console.log(`🔎 新查询 -> keyword="${keyword}"`);
  console.log(`==============================`);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    let results = [];

    for (const col of collections) {
      const colName = col.name;

      // 排除集合
      if (EXCLUDE_COLLECTIONS.includes(colName)) {
        console.log(`⏭️ 跳过集合：${colName}`);
        continue;
      }

      console.log(`➡️ 查询集合：${colName}`);

      const docs = await db
        .collection(colName)
        .find({
          $or: [
            { number: { $regex: keyword, $options: "i" } },
            { title: { $regex: keyword, $options: "i" } }
          ]
        })
        .toArray()
        .catch((err) => {
          console.log(`❌ 查询失败：${colName}`, err);
          return [];
        });

      console.log(`   ↪ 原始 ${docs.length} 条`);

      // 集合内部去重
      const cleaned = dedupeInsideCollection(docs);
      console.log(`   ↪ 去重后：${cleaned.length} 条`);

      // 标准化
      for (const doc of cleaned) {
        results.push(mapTorrent(doc, colName));
      }
    }

    console.log(`📦 所有集合合并后共：${results.length} 条`);

    // 全局按时间排序
    results.sort((a, b) => getTimestamp(b) - getTimestamp(a));
    console.log(`📌 已按时间排序`);

    // 删除内部字段
    results = results.map((r) => {
      delete r._raw_time;
      return r;
    });

    // 写入缓存
    setCache(cacheKey, results);

    // 分页
    const paged = results.slice(skip, skip + limit);

    console.log(`📄 分页：page=${page}, limit=${limit}, 返回=${paged.length}`);
    console.log(`==============================\n`);

    return res.json({
      data: paged
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 BT API running on port ${PORT}`)
);
