# BT API Server (Node.js + MongoDB)

一个基于 Node.js 的轻量 BT 搜索 API，用于从 MongoDB 多集合中搜索番号 / 标题并返回 Torrent JSON 格式。

支持功能：
- `/api/bt?keyword=xxxx`
- 搜索所有集合
- 自动匹配：number / title / name
- 自动格式化 Torrent Model 输出
- Docker 自动构建
- 群晖 NAS 可直接运行

---

## 使用方法

### 📌 环境变量

| 名称 | 说明 |
|------|------|
| `MONGO_URI` | MongoDB 连接 URI |
| `DB_NAME` | 数据库名称 |

---

## 📦 运行（Docker Hub 拉取）

