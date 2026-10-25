#!/usr/bin/env node
/**
 * 从源 monorepo 仓库同步模板到 templates/monorepo，并做占位符化：
 *   - 根 package.json 的 name  -> "__NAME__"
 *   - 文本文件中的 @inner/ 前缀 -> __SCOPE__/
 * CLI（src/create.ts）只认占位符，不感知源仓库的具体包名；
 * 若源仓库将来更换 scope，只需改下面的 SCOPE_SOURCE。
 *
 * 用法: node scripts/sync-template.mjs [源目录]
 * 默认 ../zmsys-repo（与本仓库同级放置）
 */
import fs from 'node:fs'
import path from 'node:path'

const TEMPLATE_NAME = 'monorepo'
/** 源仓库的子包 scope 前缀 */
const SCOPE_SOURCE = '@inner/'
const SCOPE_PLACEHOLDER = '__SCOPE__/'
const SKIP = new Set(['.git', 'node_modules', '.turbo', 'dist', 'coverage', '.pnpm-store'])

const source = path.resolve(process.argv[2] ?? '../zmsys-repo')
const target = path.resolve('templates', TEMPLATE_NAME)

if (!fs.existsSync(path.join(source, 'package.json'))) {
    console.error(`找不到模板源仓库（缺少 package.json）: ${source}`)
    process.exit(1)
}

// 1. 清空旧模板后镜像复制，保证删除的文件不会残留
fs.rmSync(target, { recursive: true, force: true })

let copied = 0
function copyDir(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true })
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue
        const src = path.join(srcDir, entry.name)
        const dest = path.join(destDir, entry.name)
        if (entry.isDirectory()) copyDir(src, dest)
        else if (entry.isFile()) {
            fs.copyFileSync(src, dest)
            copied++
        }
    }
}
copyDir(source, target)

// 2. 占位符化根 package.json 的 name
const rootPkgPath = path.join(target, 'package.json')
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'))
rootPkg.name = '__NAME__'
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 4) + '\n')

// 3. 文本文件中 @inner/ -> __SCOPE__/（含 NUL 字节的二进制文件跳过）
let scopeFiles = 0
let scopeHits = 0
function placeholderize(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) placeholderize(full)
        else if (entry.isFile()) {
            const buf = fs.readFileSync(full)
            if (buf.includes(0)) continue
            const text = buf.toString('utf8')
            const hits = text.split(SCOPE_SOURCE).length - 1
            if (hits > 0) {
                fs.writeFileSync(full, text.replaceAll(SCOPE_SOURCE, SCOPE_PLACEHOLDER))
                scopeFiles++
                scopeHits += hits
            }
        }
    }
}
placeholderize(target)

// 4. 一级空目录补占位 README（git 与 npm 都不保留空目录，apps/ 目前为空）
const ensured = []
for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(target, entry.name)
    if (fs.readdirSync(dir).length === 0) {
        fs.writeFileSync(
            path.join(dir, 'README.md'),
            `# ${entry.name}\n\n由 pnpm-workspace.yaml 声明的 workspace 目录。\n\n> 此 README 仅用于让 git 与 npm 保留空目录，放入第一个子包后可删除。\n`,
        )
        ensured.push(entry.name)
    }
}

console.log(`✔ 同步完成: ${source} -> ${target}`)
console.log(`  复制文件: ${copied}`)
console.log(`  scope 占位符化: ${scopeHits} 处 / ${scopeFiles} 个文件 (${SCOPE_SOURCE} -> ${SCOPE_PLACEHOLDER})`)
if (ensured.length > 0) console.log(`  空目录已补 README: ${ensured.join(', ')}`)
console.log(`\n后续发布: pnpm build && npm version patch && npm publish`)
