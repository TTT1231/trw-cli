import fs from 'node:fs'
import pc from 'picocolors'
import { runCreate } from './create'

const helpText = `${pc.bold('trw-cli')} - TRW 项目脚手架

${pc.bold('用法:')}
  trw create [template] [project-name]

${pc.bold('命令:')}
  create                从模板创建新项目

${pc.bold('选项:')}
  --scope <name>        子包 scope（默认取项目名）
  --force               目标目录非空时跳过确认
  -h, --help            显示本帮助
  -v, --version         显示版本号

${pc.bold('示例:')}
  trw create monorepo my-app
  trw create monorepo my-app --scope my-org
`

function getVersion(): string {
    const pkg: { version: string } = JSON.parse(
        fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    )
    return pkg.version
}

function main(): Promise<void> | void {
    const argv = process.argv.slice(2)
    const command = argv[0]

    if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
        console.log(helpText)
        return
    }
    if (command === '-v' || command === '--version' || command === 'version') {
        console.log(getVersion())
        return
    }
    if (command !== 'create') {
        throw new Error(`未知命令 ${pc.red(command)}\n\n${helpText}`)
    }

    let template: string | undefined
    let projectName: string | undefined
    let scope: string | undefined
    let force: boolean | undefined

    const positional: string[] = []
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--scope') {
            scope = argv[++i]
            if (scope === undefined) throw new Error('--scope 需要一个值')
        } else if (arg === '--force') {
            force = true
        } else if (arg === '-h' || arg === '--help') {
            console.log(helpText)
            return
        } else if (arg.startsWith('--')) {
            throw new Error(`未知选项 ${pc.red(arg)}`)
        } else {
            positional.push(arg)
        }
    }
    ;[template, projectName] = positional

    return runCreate(template, projectName, { scope, force })
}

const result = main()
if (result instanceof Promise) {
    result.catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
    })
}
