import { Hono } from 'hono'
import { success } from '../utils/response.js'
import { IS_SERVERLESS } from '../utils/runtime-mode.js'

const app = new Hono()

// GET / — 部署形态能力协商：前端按能力渲染 UI，不探测环境
app.get('/', (c) => success(c, {
  mode: IS_SERVERLESS ? 'serverless' : 'server',
  // none → serverless 无 ffmpeg，成片拼接导出不可用（前端禁用并引导桌面/服务器版）；
  // 保留 'browser' 语义给将来 WebCodecs 拼接
  merge: IS_SERVERLESS ? 'none' : 'server',
  // serverless 无 ffmpeg，视频无海报帧（前端 <video> 自动出首帧预览）
  poster: !IS_SERVERLESS,
  // blob → 大文件上传走 /upload/direct 直传；local → multipart 常规上传
  storage: IS_SERVERLESS ? 'blob' : 'local',
  taskDriver: IS_SERVERLESS ? 'waituntil+sweep' : 'inline',
  serverUpdate: !IS_SERVERLESS,
}))

export default app
