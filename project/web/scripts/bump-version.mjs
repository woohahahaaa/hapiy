#!/usr/bin/env node
// bump-version.mjs — 每次打包自动把软件版本号的 minor 位 +1（约定复刻自
// 隔壁 wogo/scripts/bump-center-version.mjs）。
//
// 规则：版本号 x.y.z —— 每次 `./pack.sh` 把 y 加 1（重复打包会让版本号虚高，
// 可接受）；major x 由维护者手动提升；patch z 保持不变。bump 直接写回
// project/web/package.json 的 version 字段 —— 打包（dmg 文件名 / Info.plist）
// 和前端侧边栏标题都从那里读取，保证全链路同一个数字。
//
//   node scripts/bump-version.mjs          # 1.0.0 -> 1.1.0
//   node scripts/bump-version.mjs --show   # 只打印当前版本
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(here, '../package.json')
const onlyShow = process.argv.includes('--show')

const src = readFileSync(pkgPath, 'utf8')
const re = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/
const m = re.exec(src)
if (m === null) {
  console.error(`bump-version: version field not found in ${pkgPath}`)
  process.exit(1)
}

const [, major, minor, patch] = m
if (onlyShow) {
  console.log(`hapiy version: ${major}.${minor}.${patch}`)
  process.exit(0)
}

const next = `${major}.${Number(minor) + 1}.${patch}`
writeFileSync(pkgPath, src.replace(re, `"version": "${next}"`), 'utf8')
console.log(`hapiy version: ${major}.${minor}.${patch} -> ${next}`)