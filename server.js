import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const PORT = 3000;

const client = new MongoClient(MONGO_URI);
const app = express();
app.use(cors());

// -------------------------
// 分类规则
// -------------------------

// 中文资源
const CHINESE_COLLECTIONS = [
  "hd_chinese_subtitles",
  "domestic_original"
];

// 无码资源
const UC_COLLECTIONS = [
  "asia_codeless_originate",
  "domestic_original",
  "EU_US_no_mosaic"
];

// 超高清资源 (UHD)
const UHD_COLLECTIONS = [
  "4k_video",
  "hd_chinese_subtitles"
];

// -------------------------
// 统一格式转换
// -------------------------
function mapTorrent(doc, collectionName) {
  const number = doc.number || "";
  const rawTitle = doc.title || doc.name || "";
  const finalTitle = number ? `[${number.toUpperCase()}] ${rawTitle}` : rawTitle;

  // Chinese flag
  const chinese = CHINESE_COLLECTIONS.includes(collectionName);

  // UC flag (有码/无码)
  let uc = UC_COLLECTIONS.includes(collectionName);

  // 若标题包含 “破解” → 自动标记为无码
  if (rawTitle.includes("破解")) {
    uc = true;
  }

  // UHD flag
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
    uhd
  };
}

// -------------------------
// 主搜索 API
// -------------------------
app.get("/api/bt", async (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) return res.json({ data: [] });

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const collections = await db.listCollections().toArray();
    let results = [];

    for (const col of collections) {
      const c = db.collection(col.name);

      const docs = await c
        .find({
          $or: [
            { number: { $regex: keyword, $options: "i" } },
            { title: { $regex: keyword, $options: "i" } },
            { name: { $regex: keyword, $options: "i" } }
          ]
        })
        .toArray()
        .catch(() => []);

      for (const doc of docs) {
        results.push(mapTorrent(doc, col.name));
      }
    }

    res.json({ data: results });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// -------------------------
app.listen(PORT, () => console.log(`BT API running on port ${PORT}`));

