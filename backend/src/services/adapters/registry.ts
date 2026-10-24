/**
 * Provider Adapter 注册表
 * 按「接口协议」返回对应 Adapter 实例（协议与厂商解耦，自定义厂商只要选对协议即可复用）
 */
import { OpenAIImageAdapter } from './openai-image'
import { GeminiImageAdapter } from './gemini-image'
import { VolcEngineImageAdapter } from './volcengine-image'
import { AgnesImageAdapter } from './agnes-image'
import { VolcEngineVideoAdapter } from './volcengine-video'
import { MiniMaxVideoAdapter } from './minimax-video'
import { AliyunWanVideoAdapter } from './aliyun-wan-video'
import { AgnesVideoAdapter } from './agnes-video'
import type { ImageProviderAdapter, VideoProviderAdapter } from './types'

// 图片 Adapter 注册表（key 为协议 id）
export const imageAdapters: Record<string, ImageProviderAdapter> = {
  openai: new OpenAIImageAdapter(),
  gemini: new GeminiImageAdapter(),
  volcengine: new VolcEngineImageAdapter(),
  agnes: new AgnesImageAdapter(),
}

// 视频 Adapter 注册表（key 为协议 id）
export const videoAdapters: Record<string, VideoProviderAdapter> = {
  volcengine: new VolcEngineVideoAdapter(),
  minimax: new MiniMaxVideoAdapter(),
  aliyun: new AliyunWanVideoAdapter(),
  agnes: new AgnesVideoAdapter(),
}

/**
 * 获取图片 Adapter
 * @param protocol 接口协议（openai / gemini / volcengine / agnes）
 */
export function getImageAdapter(protocol: string): ImageProviderAdapter {
  const adapter = imageAdapters[String(protocol || '').toLowerCase()]
  if (!adapter) throw new Error(`不支持的图片协议: ${protocol}`)
  return adapter
}

/**
 * 获取视频 Adapter
 * @param protocol 接口协议（volcengine / minimax / aliyun / agnes）
 */
export function getVideoAdapter(protocol: string): VideoProviderAdapter {
  const adapter = videoAdapters[String(protocol || '').toLowerCase()]
  if (!adapter) throw new Error(`不支持的视频协议: ${protocol}`)
  return adapter
}
