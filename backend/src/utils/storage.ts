/**
 * 文件存储工具 — 本地磁盘 / Vercel Blob 双实现
 *
 * 相对路径 `static/<subDir>/<file>` 是全链路的规范引用形态（DB 存它、前端经
 * /static/ 访问它），两种实现产出完全一致的相对路径，调用方无感知：
 *   - 本地：写入 STORAGE_ROOT，serveStatic 直接读盘
 *   - Blob：put 到同构 pathname，/static 路由 302 重定向到 Blob URL
 * serverless 开关见 utils/runtime-mode.ts；@vercel/blob 均为动态 import，
 * 保证本地/桌面形态不引入该依赖（desktop esbuild 已列 external）。
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import { STORAGE_ROOT } from './paths.js'
import { IS_SERVERLESS } from './runtime-mode.js'

async function putBlob(pathname: string, buffer: Buffer, contentType?: string): Promise<void> {
  const { put } = await import('@vercel/blob')
  await put(pathname, buffer, { access: 'public', addRandomSuffix: false, contentType })
}

/** 统一写入口：local 落盘 / Blob put，均返回规范相对路径 */
async function saveBuffer(buffer: Buffer, subDir: string, filename: string, contentType?: string): Promise<string> {
  const relativePath = `static/${subDir}/${filename}`
  if (IS_SERVERLESS) {
    await putBlob(relativePath, buffer, contentType)
  } else {
    const dir = path.join(STORAGE_ROOT, subDir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, filename), buffer)
  }
  return relativePath
}

/** Blob 模式下由相对路径解析出可读 URL（head 是权威解析，兼容自定义前缀） */
async function blobUrlFor(relativePath: string): Promise<string> {
  const { head } = await import('@vercel/blob')
  const meta = await head(relativePath)
  return meta.url
}

/** 读取已存储文件的原始字节（Blob 模式经 URL fetch，本地模式读盘） */
async function readFileBuffer(relativePath: string): Promise<Buffer> {
  if (IS_SERVERLESS) {
    const resp = await fetch(await blobUrlFor(relativePath))
    if (!resp.ok) throw new Error(`Blob read failed: ${resp.status} ${relativePath}`)
    return Buffer.from(await resp.arrayBuffer())
  }
  return fs.readFileSync(getAbsolutePath(relativePath))
}

/**
 * 下载远程文件到本地存储
 */
export async function downloadFile(url: string, subDir: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)

  const ext = getExtFromUrl(url)
  const filename = `${uuid()}${ext}`
  return saveBuffer(Buffer.from(await resp.arrayBuffer()), subDir, filename)
}

/**
 * 保存上传的文件
 */
export async function saveUploadedFile(data: ArrayBuffer, subDir: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName) || '.bin'
  const filename = `${uuid()}${ext}`
  return saveBuffer(Buffer.from(data), subDir, filename)
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  return '.bin'
}

/**
 * 获取本地文件的绝对路径 —— 仅本地存储实现可用（sharp/ffmpeg 读盘）。
 * Blob 形态的读取一律走 readFileBuffer / blobUrlFor。
 */
export function getAbsolutePath(relativePath: string): string {
  if (relativePath.startsWith('static/')) {
    return path.join(STORAGE_ROOT, '..', relativePath)
  }
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 保存 Base64 编码的图片数据到存储
 * 用于 Gemini 等只返回 base64 数据的厂商
 */
export async function saveBase64Image(base64Data: string, mimeType: string, subDir: string): Promise<string> {
  const ext = mimeTypeToExt(mimeType)
  const filename = `${uuid()}${ext}`
  return saveBuffer(Buffer.from(base64Data, 'base64'), subDir, filename, mimeType)
}

/** 由图片相对路径推导缩略图路径：static/images/x.png → static/images/x_thumb.webp */
export function thumbPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_thumb.webp')
}

/**
 * 为已落盘图片生成列表页缩略图（宽 400 WebP，与原图同目录）。
 * 失败（文件损坏/格式异常等）返回 null，不阻断主流程。
 */
export async function generateImageThumb(relativePath: string): Promise<string | null> {
  try {
    const thumbRel = thumbPathFor(relativePath)
    const input = await readFileBuffer(relativePath)
    const output = await sharp(input)
      .rotate()
      .resize({ width: 400, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    if (IS_SERVERLESS) {
      await putBlob(thumbRel, output, 'image/webp')
    } else {
      fs.writeFileSync(getAbsolutePath(thumbRel), output)
    }
    return thumbRel
  } catch (err) {
    console.warn(`[storage] 缩略图生成失败 ${relativePath}:`, (err as Error).message)
    return null
  }
}

export async function readImageAsDataUrl(relativePath: string): Promise<string> {
  const buffer = await readFileBuffer(relativePath)
  const ext = path.extname(relativePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  return compressImageAsDataUrl(await readFileBuffer(relativePath), options)
}

/**
 * 下载远程图片并压缩为 data URL（远程参考图归一化，供 multipart/base64 上传类厂商使用）
 */
export async function fetchImageAsCompressedDataUrl(
  url: string,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!resp.ok) throw new Error(`下载参考图失败: HTTP ${resp.status}`)
  return compressImageAsDataUrl(Buffer.from(await resp.arrayBuffer()), options)
}

/** sharp 输入 → 压缩 JPEG data URL（本地路径与远程下载共享同一压缩管线） */
async function compressImageAsDataUrl(
  input: string | Buffer,
  options: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  } = {},
): Promise<string> {
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const resized = sharp(input).rotate().resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  })
  const metadata = await resized.metadata()
  const output = metadata.hasAlpha
    ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
  const mimeType = 'image/jpeg'
  return `data:${mimeType};base64,${output.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return map[ext] || 'image/png'
}

export { blobUrlFor }
