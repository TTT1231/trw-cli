# AGENTS.md

## 项目架构

```
project/
├── apps/                    # 应用层
├── internal/                # 配置包
├── packages/                # 内部包，exports 直指 src 源码
│   ├── request/             # axios 请求客户端（拦截器 / 上传下载 / SSE）
│   └── utils/               # 通用工具函数
├── scripts/                 # gate
```

## 新增项目

- 新增应用或共享包时，声明实际 workspace 依赖并接入适用的检查命令，见 [测试接入](docs/testing.md#新增应用或共享包)。
- 项目专属 lint 规则放在项目内的 `.oxlintrc.json`，通过 `extends` 继承根配置；常规 lint 不传 `--config`，保留局部规则发现。
- 项目特有的使用、测试环境和排错说明放在所属 README；仅在有额外开发约束时添加局部 AGENTS.md。

## 验证改动

- 优先运行所属包的具体测试：`pnpm --filter <包名> test <文件> [-t <用例>]`；需要验证类型时用 `pnpm --filter <包名> typecheck`。
- 需要检查整个分支的影响范围时，用 `pnpm test` 或 `pnpm typecheck`；加 `--dry` 预览范围。
- 普通应用改动只验证所属应用；共享包改动包含消费者，接口、数据库、IPC 改动补对应测试。
- 包内 `test` 只放快速单测／组件测试；契约、集成、e2e 分开，按需执行。
- 不因 commit/push 重复已通过且输入未变的检查；pre-push 自动运行受影响项目的 typecheck。
- `check:ci:*` 用于 CI 和对应失败的本地复现。
- 如实报告执行范围；跳过、无匹配用例和缺环境都不等于通过。

需要 lint 时运行 `pnpm lint <文件或目录>`，加 `--fix` 自动修复；全量 lint 由 CI 执行。

## 按需阅读

- 选择测试、新增测试层级或复现 CI 失败：[测试说明](docs/testing.md)。
- 修改具体项目前，读取所属目录已有的 AGENTS.md 和 README。
