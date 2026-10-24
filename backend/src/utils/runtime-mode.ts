/**
 * 运行形态总开关
 *
 * serverless（Vercel）形态注入 HUOBAO_SERVERLESS=1，联动三处行为：
 *   - 存储走 Vercel Blob（utils/storage.ts 内部分支），/static 302 重定向
 *   - 视频海报帧跳过（utils/video-poster.ts，无 ffmpeg）
 *   - 拼接降级浏览器合成（routes/merge.ts + /api/v1/capabilities）
 * 本地（dev/桌面/standard 服务器）不设置该变量，一切保持原状。
 */
export const IS_SERVERLESS = process.env.HUOBAO_SERVERLESS === '1'
