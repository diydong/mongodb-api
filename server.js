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
// 排除不查询的集合
// --------------------------------------------------
const EXCLUDE_COLLECTIONS = [
  "old_backup",
  "test_merge"
];

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

// UHD（超高清）
const UHD_COLLECTIONS = [
  "4k_video",
  "hd_chinese_subtitles"
];

// --------------------------------------------------
// 文档格式化函数
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
    uhd
  };
}

// --------------------------------------------------
// 主查询 API
// --------------------------------------------------
app.get("/api/bt", async (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) return res.json({ data: [] });

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const collections = await db.listCollections().toArray();
    let results = [];

    console.log(`📨 来自客户端的请求：keyword=${keyword}`);

    for (const col of collections) {

      // 排除不要的集合
      if (EXCLUDE_COLLECTIONS.includes(col.name)) {
        console.log(`⏭️ 跳过集合：${col.name}`);
        continue;
      }

      console.log(`🔍 查询集合：${col.name}`);

      const c = db.collection(col.name);

      const docs = await c
        .find({
          $or: [
            { number: { $regex: keyword, $options: "i" } },
            { title: { $regex: keyword, $options: "i" } }
          ]
        })
        .toArray()
        .catch((err) => {
          console.log(`❌ 查询失败：${col.name}`, err);
          return [];
        });

      console.log(`✔ 返回 ${docs.length} 条记录：${col.name}`);

      for (const doc of docs) {
        results.push(mapTorrent(doc, col.name));
      }
    }

    console.log(`📦 搜索完成，总返回：${results.length} 条\n`);

    res.json({ data: results });

  } catch (err) {
    console.error("❌ 服务器错误:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// --------------------------------------------------
app.listen(PORT, () => console.log(`🚀 BT API running on port ${PORT}`));
