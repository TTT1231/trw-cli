import { promises as fs } from "node:fs";
import { join } from "node:path";

// 保持纯 JS 并用 node 直接运行，不依赖 node_modules：
// 若用 tsx 执行，删除 node_modules 会连带删掉 .bin 下的 cmd shim，
// cmd.exe 读不回批处理就会报「系统找不到指定的路径」并以退出码 1 结束；
// 纯 node 脚本清理后重复执行也成立。

const rootDir = process.cwd();

// 分批并发删除，避免一次性打开过多文件句柄
const CONCURRENCY_LIMIT = 10;

// 版本控制与编辑器配置不属于构建产物，既不进入也不删除
const SKIP_DIRS = new Set([".DS_Store", ".git", ".idea", ".vscode"]);

// 默认清理的构建产物；--del-lock 时追加 pnpm-lock.yaml
const DEFAULT_TARGETS = ["node_modules", "dist", ".turbo", "dist.zip"];

/**
 * 递归扫描 currentDir，删除名字命中 targets 的文件或目录。
 */
async function cleanDir(currentDir, targets, depth) {
    // 目录树可能存在自引用符号链接，用深度上限兜底
    if (depth > 10) {
        console.warn(`Max recursion depth reached at: ${currentDir}`);
        return;
    }

    let dirents;
    try {
        // withFileTypes 一次拿全类型信息，省去逐个 lstat
        dirents = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
        // 读取失败说明目录刚被上层删除或无权限，跳过即可
        return;
    }

    for (let i = 0; i < dirents.length; i += CONCURRENCY_LIMIT) {
        const batch = dirents.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(
            batch.map(async dirent => {
                if (SKIP_DIRS.has(dirent.name)) return;

                const itemPath = join(currentDir, dirent.name);

                if (targets.has(dirent.name)) {
                    try {
                        // force 把「已不存在」视为成功；recursive 兼容目录目标
                        await fs.rm(itemPath, { force: true, recursive: true });
                        console.log(`✅ Deleted: ${itemPath}`);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        console.error(`❌ Failed to delete ${itemPath}: ${message}`);
                    }
                    return;
                }

                // Dirent 不跟随符号链接，pnpm 的软链结构不会被误入
                if (dirent.isDirectory()) {
                    await cleanDir(itemPath, targets, depth + 1);
                }
            }),
        );
    }
}

const targets = new Set(DEFAULT_TARGETS);
if (process.argv.includes("--del-lock")) {
    targets.add("pnpm-lock.yaml");
}

console.log(`🚀 Cleaning ${[...targets].join(", ")} from ${rootDir}`);
const startTime = Date.now();
await cleanDir(rootDir, targets, 0);
console.log(`✨ Cleanup completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
