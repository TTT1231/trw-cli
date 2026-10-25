# trw-cli

[![npm version](https://img.shields.io/npm/v/trw-cli.svg)](https://www.npmjs.com/package/trw-cli)

一条命令，创建一个配置齐全的前端 monorepo 项目。

## 它能干什么

手动搭一个 monorepo 项目，要装一堆工具、写一堆配置：包管理、代码检查、格式化、测试、提交检查……用 trw-cli，一条命令全部搞定，生成的项目装完依赖就能直接写代码。

## 安装

```bash
npm install -g trw-cli
```

## 创建项目

```bash
trw create monorepo
```

它会问你两个问题：

1. 项目叫什么名字（比如 `my-app`）
2. 子包用什么前缀（直接回车就行，默认和项目名一样）

不想被问，可以一步到位：

```bash
trw create monorepo my-app
```

创建完，照着提示做：

```bash
cd my-app
pnpm install
```

## 生成的项目里有什么

monorepo 就是**一个仓库里放多个子包**，子包之间可以直接引用，不用先发到 npm。

模板里已经配好的东西：

| 东西 | 是干嘛的 |
| --- | --- |
| `packages/request` | 网络请求（基于 axios，支持上传、下载、实时推送） |
| `packages/utils` | 常用工具函数 |
| `internal/tsconfig` | 共享的 TypeScript 配置 |
| turbo | 一条命令跑完所有子包的检查和测试 |
| oxlint / oxfmt | 代码检查、代码格式化 |
| vitest | 单元测试 |
| lefthook | 提交代码前自动检查，有问题不让提交 |

所有依赖的版本都是锁定的，团队里任何人安装出来的版本一模一样，不会出现「我这里能跑，你那里不能跑」。

## 环境要求

- Node.js 20 或更高（运行 trw-cli 用）
- Node.js 24 或更高（生成的项目用）
- pnpm（生成的项目用它管理依赖）
- git 可有可无（有就自动帮你 `git init`）

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `trw create monorepo [项目名]` | 创建项目 |
| `trw -h` | 查看帮助 |
| `trw -v` | 查看版本 |

| 选项 | 作用 |
| --- | --- |
| `--scope 前缀` | 自定义子包前缀（默认用项目名） |
| `--force` | 目标文件夹不为空时照样创建 |

## 问题反馈

- 仓库：https://github.com/TTT1231/trw-cli
- 提问题：https://github.com/TTT1231/trw-cli/issues

## License

ISC
