import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);
export const turboCli = resolve(dirname(require.resolve("turbo/package.json")), "bin/turbo");

const tasks = {
    test: ["test", "test:scripts"],
    typecheck: ["typecheck", "typecheck:scripts"],
} as const;

function git(cwd: string, args: string[]): string | undefined {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    if (result.error !== undefined) throw result.error;
    if (result.status === 0) return result.stdout.trim();
    if (result.status === 1) return undefined;
    throw new Error(result.stderr.trim() || `git ${args[0]} failed (${String(result.status)})`);
}

function commit(cwd: string, ref: string): string | undefined {
    return git(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
}

interface AffectedRun {
    readonly args: string[];
    readonly env: NodeJS.ProcessEnv;
    readonly message: string;
}

/** 只决定比较基线；改动文件、反向依赖和缓存交给 Turbo。 */
export function resolveAffectedRun(cwd: string, argv: string[], env: NodeJS.ProcessEnv = process.env): AffectedRun {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { base: { type: "string" }, dry: { type: "boolean", default: false } },
    });
    const task = positionals[0];
    if (positionals.length !== 1 || (task !== "test" && task !== "typecheck")) {
        throw new Error(
            "用法：pnpm test|typecheck [--base <ref>] [--dry]；指定文件请用 pnpm --filter <包名> test <文件>。",
        );
    }
    if (values.base === "") throw new Error("--base 不能为空。");
    if (env.TURBO_SCM_HEAD) throw new Error("本地检查包含工作区改动，请先取消 TURBO_SCM_HEAD。");
    git(cwd, ["rev-parse", "--show-toplevel"]);

    const args = ["run", ...tasks[task], "--ui=stream", "--output-logs=new-only"];
    if (values.dry) args.push("--dry");
    const runEnv = { ...env };
    delete runEnv.TURBO_SCM_BASE;
    delete runEnv.TURBO_SCM_HEAD;
    // Git 的重命名检测可能只报告新路径；按删除 + 新增处理，保留两端的影响。
    const configCount = Number(runEnv.GIT_CONFIG_COUNT ?? "0");
    if (!Number.isSafeInteger(configCount) || configCount < 0) throw new Error("GIT_CONFIG_COUNT 无效。");
    runEnv.GIT_CONFIG_COUNT = String(configCount + 1);
    runEnv[`GIT_CONFIG_KEY_${configCount}`] = "diff.renames";
    runEnv[`GIT_CONFIG_VALUE_${configCount}`] = "false";

    const explicitBase = values.base ?? (env.TURBO_SCM_BASE || undefined);
    let base = explicitBase;
    let baseCommit = base === undefined ? undefined : commit(cwd, base);
    if (explicitBase !== undefined && baseCommit === undefined) {
        throw new Error(`比较基线不存在：${explicitBase}。请先 fetch 或指定已有的 --base。`);
    }

    const head = commit(cwd, "HEAD");
    if (head === undefined) {
        return { args, env: runEnv, message: "尚无 Git 提交，执行所有已配置的快速检查。" };
    }
    if (base === undefined) {
        const remoteHead = git(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
        const branch = git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
        const candidates = [remoteHead, "origin/main", "origin/master", "main", "master"];
        for (const candidate of candidates) {
            // 默认分支尚未发布时，不能把它自己当基线而漏掉首次推送。
            if (candidate === undefined || candidate === branch) continue;
            const resolved = commit(cwd, candidate);
            if (resolved !== undefined) {
                base = candidate;
                baseCommit = resolved;
                break;
            }
        }
    }
    if (baseCommit === undefined) {
        return { args, env: runEnv, message: "没有可比较的默认分支，执行所有已配置的快速检查；可用 --base 指定基线。" };
    }

    const mergeBase = git(cwd, ["merge-base", "--all", baseCommit, head]);
    if (mergeBase === undefined || mergeBase.includes("\n")) {
        throw new Error(`无法确定与 ${base} 的唯一共同祖先；请补全 Git 历史或指定其他 --base。`);
    }
    args.push("--affected");
    runEnv.TURBO_SCM_BASE = mergeBase;
    return { args, env: runEnv, message: `基线 ${base}；检查分支改动、暂存、未暂存及未跟踪文件影响的项目。` };
}

function main(): void {
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    const invocation = resolveAffectedRun(cwd, process.argv.slice(2));
    console.log(invocation.message);
    const result = spawnSync(process.execPath, [turboCli, ...invocation.args], {
        cwd,
        env: invocation.env,
        stdio: "inherit",
    });
    if (result.error !== undefined) throw result.error;
    if (result.signal !== null) process.kill(process.pid, result.signal);
    else process.exitCode = result.status ?? 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
