# @trw/cli

TRW 项目脚手架。基于内置模板创建项目，模板与 CLI 通过占位符契约解耦——日常只需维护模板本身。

## 安装

```bash
npm install -g @trw/cli
```

## 用法

```bash
trw create monorepo [project-name]
```

不带参数则交互式引导（选模板 → 输入项目名 → 确认 scope）：

```bash
$ trw create monorepo my-app
? 子包 scope（回车使用 @my-app/）: my-org

✔ 项目创建成功
✔ 包名: my-app，子包 scope: @my-org/
```

| 选项 | 说明 |
| --- | --- |
| `--scope <name>` | 子包 scope，默认取项目名（`@<project-name>/`） |
| `--force` | 目标目录非空时跳过确认 |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本号 |

## scope 替换机制

模板内的子包统一使用 `__SCOPE__/` 占位符（同步时由源仓库的 `@inner/` 转换而来）。
创建项目时替换为 `@<scope>/`，覆盖所有出现位置：各子包 `package.json` 的 `name`、
`workspace:*` 依赖引用、源码 `import`、`tsconfig.json` paths、`pnpm-lock.yaml` 等。
根 `package.json` 的 `name` 同样由 `"__NAME__"` 占位符还原为项目名。

二进制文件（图片、字体等，按 NUL 字节识别）不做替换，仅字节级复制；
复制不做行尾转换，保持模板 `.gitattributes` 声明的 LF 规范形态在所有平台一致。

## 模板维护

```
templates/
└── monorepo/        # 模板内容，随包发布（勿手改，由同步脚本生成）
```

日常更新流程：

1. 修改源仓库（`zmsys-repo`）
2. 同步：`pnpm sync-template`（也可传参指定源目录：`node scripts/sync-template.mjs <path>`）
3. 发布：`pnpm build && npm version patch && npm publish`

同步脚本会自动完成：

- 跳过 `.git` / `node_modules` / `.turbo` / `dist` / `coverage`
- 根 `package.json` 的 `name` → `"__NAME__"`
- 文本文件中 `@inner/` → `__SCOPE__/`（源仓库若更换 scope，改 `scripts/sync-template.mjs` 中的 `SCOPE_SOURCE`）
- 一级空目录补占位 README（git 与 npm 均不保留空目录）

## 开发

```bash
pnpm install
pnpm build          # tsdown 打包为 dist/index.mjs 单文件
node dist/index.mjs create monorepo test-app --scope demo   # 本地试跑
```

结构：

```
src/index.ts            # 参数解析与帮助信息
src/create.ts           # create 主流程（交互、复制、占位符还原、git init）
src/fs.ts               # 目录复制、文本替换、二进制检测等工具
scripts/sync-template.mjs  # 模板同步与占位符化
```

## License

ISC
