# 测试与类型检查

本地按改动选择文件或项目；CI 通过 `check:ci:*` 组合全量检查，复用包内和仓库脚本的检查命令。

## 使用

在仓库根按需选择，测试文件路径相对于所属包：

| 验证目标                 | 命令                                           |
| ------------------------ | ---------------------------------------------- |
| 某个测试文件／用例       | `pnpm --filter <包名> test <文件> [-t <用例>]` |
| 某个项目的类型           | `pnpm --filter <包名> typecheck`               |
| 分支影响范围内的快速测试 | `pnpm test`                                    |
| 分支影响范围内的类型检查 | `pnpm typecheck`                               |
| 仓库脚本                 | `pnpm test:scripts`                            |

例如修改请求客户端时：

```sh
pnpm --filter __SCOPE__/request test src/request-client/request-client.test.ts
```

根目录 `test` 和 `typecheck` 的范围包含整个分支相对基线的改动，以及暂存、未暂存、未跟踪文件。加 `--dry` 可预览选中的任务。尚无提交或找不到默认分支时，会提示并回退到所有已配置的对应快速检查。

已通过且输入未变的检查无需重复执行。pre-commit 只执行暂存 TS 文件的轻量 lint 和暂存文件的格式化；pre-push 自动执行 `pnpm typecheck`。

## CI 与本地复现

[CI](../.github/workflows/ci.yml) 使用根 [package.json](../package.json) 中的两个入口：

| 命令                   | 检查范围                              |
| ---------------------- | ------------------------------------- |
| `pnpm check:ci:static` | 全量 lint、所有包及仓库脚本的类型检查 |
| `pnpm check:ci:unit`   | 所有包的快速测试、仓库脚本测试        |

这些入口不按本地 Git 改动缩小范围，Turbo 仍可复用缓存。

复现 CI 失败时，在仓库根执行失败步骤中的同名命令；日志已定位具体用例时，可先运行所属包的该用例。依赖按锁文件安装，并按对应 CI 步骤准备平台、Node/pnpm 版本、环境变量和所需服务。

## 新增应用或共享包

每个包维护自己的 `package.json` 脚本，根命令会自动发现：

| 包内脚本    | 内容                                                       |
| ----------- | ---------------------------------------------------------- |
| `test`      | 快速单测／组件测试；不启动真实数据库、外部服务或完整应用栈 |
| `typecheck` | TypeScript 项目的完整类型检查，可使用编译器增量缓存        |

无测试的包不声明 `test`，不使用 `--passWithNoTests` 隐藏漏配。workspace 依赖写进包清单，包括使用的 `__SCOPE__/tsconfig`，让消费者进入影响范围。

普通 TypeScript 包复用当前入口：

```json
{
    "scripts": {
        "test": "vitest run --config ../../vitest.unit.config.ts",
        "typecheck": "tsc --noEmit"
    }
}
```

[共用单测配置](../vitest.unit.config.ts) 只发现 `src/`、`test/`、`tests/` 下的 `*.test.*`／`*.spec.*`，排除契约、集成和 e2e 目录与对应后缀。

## 新增测试层级

按需新增以下包内命令：

| 命令               | 验证对象                   | 典型触发                      |
| ------------------ | -------------------------- | ----------------------------- |
| `test:contract`    | API 请求、响应、错误格式   | 接口定义、DTO、客户端适配变化 |
| `test:integration` | 服务与真实测试数据库       | SQL、事务、迁移、鉴权变化     |
| `test:e2e`         | 浏览器／桌面端完整用户流程 | 关键流程、启动或打包变化      |

新增时配置所属包脚本、`turbo.json` 中同名任务，再添加或扩展对应的 `check:ci:*` 入口和 CI 步骤。纯契约检查可缓存；数据库集成和 e2e 默认 `cache: false`，CI 提供独立测试环境。变量在任务 `env` 中声明，缺失必需环境应失败。

例如集成测试的 CI 入口可命名为 `check:ci:integration`，调用 `turbo run test:integration`；本地按需运行 `pnpm --filter <包名> test:integration`。这些层级独立于普通 `test` 和 Git hooks。

HTTP、IPC、OpenAPI、SQL 文件依赖不会自动变成包依赖。读取包外文件的任务，应在包级 `turbo.json` 中声明输入，例如：

```json
{
    "extends": ["//"],
    "tasks": {
        "test:contract": {
            "dependsOn": ["transit"],
            "inputs": ["$TURBO_DEFAULT$", "$TURBO_ROOT$/contracts/**"],
            "outputs": []
        }
    }
}
```

重写 `inputs` 时保留默认文件和该任务使用的共享配置；消费同一接口的应用分别声明依赖。自动筛选不能推断业务语义，修改事务、鉴权、IPC、应用入口时仍需选择相应集成或冒烟测试。

## 范围与缓存

[范围脚本](../scripts/run-affected.ts) 默认依次选择 `origin/HEAD`、`origin/main`、`origin/master`、非当前分支的本地 `main`／`master`，从共同祖先比较改动。PR 目标不是默认分支时，给 `test` 或 `typecheck` 添加 `--base <ref>`，例如 `pnpm test --base origin/develop`。也可通过 `TURBO_SCM_BASE` 指定基线。

脚本不自动 fetch，指定基线须已存在于本地；显式基线错误或无法确定共同祖先时直接失败。

[Turbo 配置](../turbo.json) 按任务输入选择检查并复用缓存；类型检查还可使用 TypeScript 增量缓存。共享源码通过 `transit` 传播影响和缓存失效，不要求先跑完依赖包的测试。根脚本独立选择；纯 `docs/*.md` 说明不触发它们。锁文件、根包配置、Turbo 配置改动会扩大检查范围。

没有选中任务只表示无适用检查，不代表业务行为已验证。
