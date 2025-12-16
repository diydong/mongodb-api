import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const PORT = process.env.PORT || 3000;

const client = new MongoClient(MONGO_URI);
const app = express();
app.use(cors());

// 自动格式化成 Torrent 模型
function mapTorrent(doc) {
  return {
    id: Number(doc.tid || doc.id || 0),
    site: "BT",
    size_mb: 0,
    seed: 0,
    title: doc.title || doc.name || "",
    chinese: /[\u4e00-\u9fa5]/.test(doc.title || ""),
    uc: false,
    free: true,
    download_url: doc.magnet || doc.magnet_url || doc.download || "",
    cover: Array.isArray(doc.img) ? doc.img[0] : doc.cover || ""
  };
}

app.get("/api/bt", async (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) return res.json({ data: [] });

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

    results.push(...docs.map(mapTorrent));
  }

  res.json({ data: results });
});

app.listen(PORT, () => console.log(`BT API running on port ${PORT}`));
