# 火宝短剧 — Vercel Serverless 部署

serverless 形态的部署说明。同一代码库支持三种形态：桌面（Electron）、
服务器（Node 常驻）、Serverless。能力差异由 `GET /api/v1/capabilities`
协商，前端自动适配。

**入口位置约定**：API 函数入口在 `backend/api/[[...route]].ts`（必须位于 backend/ 内，
使 @vercel/node 的依赖锚点 = backend/package.json）；仓库根 `vercel.json` 以 **services 模式**
定义两个服务（backend = Hono 函数，frontend = Nuxt 静态站点）、公网 rewrite 与 crons。
浏览器请求经同一域名的 rewrite 进入 backend（/api、/static），服务间无互调，不需要 binding。

## 前置准备

1. **Turso 数据库**（免费额度够用）：[turso.tech](https://turso.tech) 创建数据库与 token
   ```bash
   turso db create huobao
   turso db show huobao --url      # → DATABASE_URL（libsql://...）
   turso db tokens create huobao   # → DATABASE_AUTH_TOKEN
   ```
2. **Vercel Blob 存储**：Vercel 项目 Dashboard → Storage → Create Blob Store，
   绑定后自动注入 `BLOB_READ_WRITE_TOKEN`

## 环境变量（Vercel 项目 → Settings → Environment Variables，全部标记 Sensitive）

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | Turso 连接串（`libsql://xxx.turso.io`）。经 Vercel Storage 市场绑定 Turso 的，注入的 `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` 会被自动识别，无需再配镜像变量 |
| `DATABASE_AUTH_TOKEN` | ✅ | Turso 访问令牌（同上，`TURSO_AUTH_TOKEN` 兼容） |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob 读写令牌（Storage 集成自动注入） |
| `CRON_SECRET` | ✅ | sweep 端点鉴权，任意随机串（`openssl rand -base64 32`） |
| `HUOBAO_ACCESS_PASSWORD` | 建议 | 初始访问密码（≥4 位）：库中从未设过密码时自动启用，之后可在设置页修改，改后此变量即失效 |
| `HUOBAO_SERVERLESS` | ✅ | 固定 `1`，开启 serverless 行为分支 |
| `HUOBAO_VERSION` | 建议 | 当前版本号，health 接口与更新检查用 |

**AI 服务密钥不在环境变量里**——部署后在「设置」页配置（存
`ai_service_configs` 表，见产品决策）。

## 部署步骤

1. Vercel → Add New Project → 导入本仓库
2. Framework Preset 选 **Other**；根目录保持仓库根（vercel.json 已在根目录）
3. 配置上表环境变量
4. Deploy。首次启动会自动建表（DDL 幂等重放）+ 种子数据
5. 打开站点 → 设置页 → 添加 AI 服务配置（文本/图片/视频）

## 能力降级说明（相对桌面/服务器版）

| 能力 | 状态 | 说明 |
|---|---|---|
| 剧本/资产/分镜/生图/生视频全流水线 | ✅ | 无差异 |
| 成片拼接导出 | ❌ | serverless 无 ffmpeg，导出页按钮禁用并引导桌面/服务器版 |
| 视频海报帧 | ❌ | 列表页用 `<video>` 首帧预览兜底 |
| 大文件上传（视频/音频） | ✅ | 走 Vercel Blob 客户端直传（绕过函数 4.5MB 请求体限制） |
| 技能/提示词在线编辑 | ✅ | 写入 `workspace_overrides` 表（文件系统只读） |
| 内置技能删除 | ❌ | 随部署物只读分发 |
| 服务器自更新（server-update） | ❌ | 不可变部署，走 Vercel 重新部署 |

## 任务续跑机制

生成任务的推进不依赖常驻进程：
- 提交阶段：`@vercel/functions` 的 `waitUntil` 在响应后继续执行
- 轮询阶段：Vercel Cron 每分钟调 `GET /api/v1/tasks/sweep`（`CRON_SECRET` 鉴权），
  单次推进一档；任务以 `sys_task.updated_at` 心跳互斥，超 2 小时兜底标失败

**注意**：Vercel Hobby 计划的 Cron 最短间隔为每天一次（`vercel.json` 里的 sweep cron
仅为兜底；视频任务会极慢），Pro 计划改回 `* * * * *` 每分钟。Hobby 用户务必用外部
cron（如 cron-job.org）每分钟 `GET /api/v1/tasks/sweep` + `Authorization: Bearer <CRON_SECRET>`
替代，这是任务推进的实际驱动。

## 与桌面/服务器形态的关系

代码分支由 `HUOBAO_SERVERLESS=1` 环境变量控制（见 `backend/src/utils/runtime-mode.ts`），
桌面版与 standard 服务器版不设置该变量，行为与迁移前完全一致。
