import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import pc from 'picocolors'
import {
    copyDir,
    isEmpty,
    isValidPackageName,
    replaceInFile,
    toValidPackageName,
    templateContains,
    walkFiles,
} from './fs'

/** 模板与 CLI 的占位符契约，由 scripts/sync-template.mjs 在同步时写入：
 *  CLI 不感知模板源仓库的任何具体包名，只认占位符 */
const NAME_PLACEHOLDER = '"__NAME__"'
const SCOPE_PLACEHOLDER = '__SCOPE__/'

export interface CreateOptions {
    scope?: string
    force?: boolean
}

function cancel(message: string): never {
    throw new Error(message)
}

function onCancel(): never {
    cancel(`${pc.red('✖')} 操作已取消`)
}

/** 归一化为 @scope 形式，输入允许带或不带 @ 前缀 */
function normalizeScope(input: string): string {
    const bare = input.trim().replace(/^@+/, '')
    return bare ? `@${toValidPackageName(bare)}` : ''
}

function hasGit(): boolean {
    return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
}

export async function runCreate(
    rawTemplate: string | undefined,
    rawProjectName: string | undefined,
    options: CreateOptions,
): Promise<void> {
    const templatesRoot = fileURLToPath(new URL('../templates', import.meta.url))

    if (!fs.existsSync(templatesRoot)) {
        cancel(`模板目录不存在: ${templatesRoot}（本包疑似安装不完整）`)
    }
    const available = fs.readdirSync(templatesRoot).filter((name) => !name.startsWith('.'))
    if (available.length === 0) {
        cancel(`模板目录为空: ${templatesRoot}`)
    }

    let projectName = rawProjectName
    let templateName: string

    if (rawTemplate !== undefined && available.includes(rawTemplate)) {
        templateName = rawTemplate
    } else if (rawTemplate !== undefined) {
        cancel(`模板 ${pc.red(rawTemplate)} 不存在\n可用模板: ${available.join(', ')}`)
    } else if (available.length === 1) {
        templateName = available[0]
    } else {
        const answer = await prompts(
            {
                type: 'select',
                name: 'template',
                message: '选择模板:',
                choices: available.map((name) => ({ title: name, value: name })),
            },
            { onCancel },
        )
        if (typeof answer.template !== 'string') onCancel()
        templateName = answer.template
    }

    const templateDir = path.join(templatesRoot, templateName)
    if (!fs.statSync(templateDir).isDirectory()) {
        cancel(`模板 ${pc.red(templateName)} 不是一个目录`)
    }

    if (projectName === undefined) {
        const answer = await prompts(
            {
                type: 'text',
                name: 'projectName',
                message: '项目名称:',
                initial: 'my-app',
                validate: (input: string) =>
                    isValidPackageName(toValidPackageName(input)) ||
                    '包含无法转换为合法包名的字符',
            },
            { onCancel },
        )
        if (typeof answer.projectName !== 'string' || answer.projectName === '') onCancel()
        projectName = answer.projectName
    }
    const pkgName = toValidPackageName(projectName)

    // scope 只有在模板声明了占位符时才询问，纯应用模板无此步骤
    let scopeInput = options.scope
    if (scopeInput === undefined && templateContains(templateDir, SCOPE_PLACEHOLDER)) {
        const answer = await prompts(
            {
                type: 'text',
                name: 'scope',
                message: `子包 scope（回车使用 @${pkgName}/）:`,
                initial: pkgName,
            },
            { onCancel },
        )
        if (typeof answer.scope !== 'string' || answer.scope === '') onCancel()
        scopeInput = answer.scope
    }
    const scope = normalizeScope(scopeInput ?? pkgName)

    const rootDir = path.resolve(projectName)
    if (!isEmpty(rootDir)) {
        let overwrite = options.force === true
        if (options.force === undefined) {
            const answer = await prompts(
                {
                    type: 'confirm',
                    name: 'ok',
                    message: `目标目录 ${pc.cyan(rootDir)} 非空，继续创建？`,
                    initial: false,
                },
                { onCancel },
            )
            overwrite = answer.ok === true
        }
        if (!overwrite) {
            cancel(`${pc.red('✖')} 目标目录非空（可加 --force 跳过检查）`)
        }
    }

    console.log()
    console.log(`正在基于模板 ${pc.cyan(templateName)} 创建项目 ${pc.cyan(rootDir)} ...`)

    // 字节级复制，不做行尾转换，保持模板 .gitattributes 声明的 LF 规范形态
    copyDir(templateDir, rootDir)

    // 还原占位符：包名与子包 scope
    const replacements: [string, string][] = [
        [NAME_PLACEHOLDER, JSON.stringify(pkgName)],
        [SCOPE_PLACEHOLDER, `${scope}/`],
    ]
    let touchedFiles = 0
    walkFiles(rootDir, (file) => {
        if (replaceInFile(file, replacements) > 0) touchedFiles += 1
    })

    // 新项目顺手 git init；目录里已有 .git 时跳过
    if (!fs.existsSync(path.join(rootDir, '.git')) && hasGit()) {
        spawnSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' })
    }

    // Node 版本约束来自模板自身的 engines，CLI 不硬编码
    let enginesNote = ''
    const templatePkgPath = path.join(templateDir, 'package.json')
    if (fs.existsSync(templatePkgPath)) {
        const templatePkg: { engines?: { node?: string } } = JSON.parse(
            fs.readFileSync(templatePkgPath, 'utf8'),
        )
        if (templatePkg.engines?.node) {
            enginesNote = `（模板要求 Node ${templatePkg.engines.node}）`
        }
    }

    console.log()
    console.log(`${pc.green('✔')} 项目创建成功`)
    if (touchedFiles > 0) {
        console.log(
            `${pc.green('✔')} 包名: ${pc.cyan(pkgName)}，子包 scope: ${pc.cyan(`${scope}/`)}`,
        )
    }
    console.log()
    console.log('后续步骤:')
    console.log()
    const cd = /\s/.test(projectName) ? `"${projectName}"` : projectName
    console.log(`  ${pc.cyan(`cd ${cd}`)}`)
    console.log(`  ${pc.cyan('pnpm install')}${enginesNote ? `  ${pc.dim(enginesNote)}` : ''}`)
    console.log()
    console.log(
        `  常用脚本: ${pc.cyan('pnpm lint')} / ${pc.cyan('pnpm typecheck')} / ${pc.cyan('pnpm test')}`,
    )
    console.log()
}
