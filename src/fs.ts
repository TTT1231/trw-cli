import fs from 'node:fs'
import path from 'node:path'

/** 复制模板时跳过的目录（构建产物与仓库元数据，不属于模板内容） */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.turbo', 'dist', 'coverage'])

export function isEmpty(dir: string): boolean {
    if (!fs.existsSync(dir)) return true
    const files = fs.readdirSync(dir)
    return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

/** npm 包名合法性校验（支持 @scope/name 形式） */
export function isValidPackageName(name: string): boolean {
    return /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)
}

/** 把任意输入归一化为合法包名：目录名允许更宽松，包名必须收敛到合法字符集 */
export function toValidPackageName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/^[._]+/, '')
        .replace(/[^a-z0-9-~]+/g, '-')
}

/** 递归复制目录。用 copyFileSync 做字节级复制，不经过任何行尾转换，
 *  保持模板 .gitattributes 声明的 LF 规范形态在所有平台一致 */
export function copyDir(srcDir: string, destDir: string): void {
    fs.mkdirSync(destDir, { recursive: true })
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue
        const src = path.join(srcDir, entry.name)
        const dest = path.join(destDir, entry.name)
        if (entry.isDirectory()) copyDir(src, dest)
        else if (entry.isFile()) fs.copyFileSync(src, dest)
    }
}

/** 遍历目录下所有文件（含子目录） */
export function walkFiles(dir: string, visit: (file: string) => void): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walkFiles(full, visit)
        else if (entry.isFile()) visit(full)
    }
}

/** 字面量替换对：sync 脚本写入占位符，create 还原为真实值 */
export type Replacement = [literal: string, value: string]

/** 对单个文件做原地文本替换，返回替换次数。
 *  含 NUL 字节的文件视为二进制（图片、字体等）自动跳过 */
export function replaceInFile(file: string, replacements: Replacement[]): number {
    const buf = fs.readFileSync(file)
    if (buf.includes(0)) return 0
    let content = buf.toString('utf8')
    let count = 0
    for (const [literal, value] of replacements) {
        const parts = content.split(literal)
        count += parts.length - 1
        if (parts.length > 1) content = parts.join(value)
    }
    if (count > 0) fs.writeFileSync(file, content)
    return count
}

/** 判断模板目录中是否出现某字面量（用于决定是否需要询问 scope） */
export function templateContains(dir: string, literal: string): boolean {
    let found = false
    walkFiles(dir, (file) => {
        if (found) return
        const buf = fs.readFileSync(file)
        if (!buf.includes(0) && buf.includes(literal)) found = true
    })
    return found
}
