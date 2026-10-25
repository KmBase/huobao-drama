// 一次性工具：从 assets/icon.ico 提取最大 PNG 帧，生成托盘双图标（tray.png / tray-dot.png）
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const ASSETS = path.resolve(import.meta.dirname, '..', 'assets')

const buf = fs.readFileSync(path.join(ASSETS, 'icon.ico'))
const count = buf.readUInt16LE(4)
let best = null
let bestSize = 0
for (let i = 0; i < count; i++) {
  const off = 6 + i * 16
  const size = buf.readUInt32LE(off + 8)
  const start = buf.readUInt32LE(off + 12)
  if (size > bestSize) { bestSize = size; best = buf.subarray(start, start + size) }
}
console.log('frames:', count, 'chosen bytes:', bestSize, 'png?', best[1] === 0x50 && best[2] === 0x4e)
const src = path.join(ASSETS, '_tray-src.png')
fs.writeFileSync(src, best)

const dotSvg = Buffer.from('<svg width="32" height="32"><circle cx="26" cy="8" r="6.5" fill="#FF3B30" stroke="white" stroke-width="2"/></svg>')
const base = await sharp(src).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
fs.writeFileSync(path.join(ASSETS, 'tray.png'), base)
fs.writeFileSync(path.join(ASSETS, 'tray-dot.png'), await sharp(base).composite([{ input: dotSvg }]).png().toBuffer())
fs.unlinkSync(src)
console.log('done')
