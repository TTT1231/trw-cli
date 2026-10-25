import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveAffectedRun, turboCli } from "./run-affected.js";

const require = createRequire(import.meta.url);
const config = readFileSync(new URL("../turbo.json", import.meta.url), "utf8");

interface DryTask {
    readonly taskId: string;
    readonly command: string;
    readonly hash: string;
}

function fixture(t: TestContext, committed = true) {
    const root = mkdtempSync(join(tmpdir(), "temp-repo-check-"));
    t.after(() => {
        // 只清理本测试创建的临时仓库，不使用待测仓库路径。
        assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()));
        assert.ok(basename(root).startsWith("temp-repo-check-"));
        rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    const env: NodeJS.ProcessEnv = { ...process.env, TURBO_TELEMETRY_DISABLED: "1", NO_COLOR: "1" };
    for (const name of ["TURBO_SCM_BASE", "TURBO_SCM_HEAD", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
        delete env[name];
    }
    function write(path: string, content: string): void {
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    function git(...args: string[]): string {
        const result = spawnSync(
            "git",
            [
                "-c",
                `core.hooksPath=${join(root, ".git", "no-hooks")}`,
                "-c",
                "commit.gpgsign=false",
                "-c",
                "user.name=Scope test",
                "-c",
                "user.email=scope@example.invalid",
                ...args,
            ],
            { cwd: root, env, encoding: "utf8" },
        );
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    }
    function commit(): void {
        git("add", ".");
        git("commit", "-qm", "fixture");
    }
    function dry(task: "test" | "typecheck" = "test"): DryTask[] {
        const invocation = resolveAffectedRun(root, [task, "--base", "main"], env);
        const result = spawnSync(process.execPath, [turboCli, ...invocation.args, "--dry=json"], {
            cwd: root,
            env: invocation.env,
            encoding: "utf8",
            maxBuffer: 8 * 1024 * 1024,
        });
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout) as { tasks: DryTask[] };
        return report.tasks.filter(item => item.command !== "<NONEXISTENT>");
    }
    function selected(task: "test" | "typecheck" = "test"): string[] {
        return dry(task)
            .map(item => item.taskId)
            .sort();
    }

    write(
        "package.json",
        JSON.stringify({
            name: "scope-fixture",
            private: true,
            packageManager: "pnpm@12.8.1",
            scripts: { "test:scripts": "node --version", "typecheck:scripts": "node --version" },
        }),
    );
    write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    write(".gitignore", "node_modules\n.turbo\n");
    write("turbo.json", config);
    write("vitest.unit.config.ts", "export default {};\n");
    write("scripts/sample.ts", "export const value = 1;\n");
    write("tsconfig.json", "{}\n");
    let lockfile = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
    for (const name of ["shared", "frontend", "desktop", "backend", "cli"]) {
        const path = `${name === "shared" ? "packages" : "apps"}/${name}`;
        const dependencies = ["frontend", "desktop"].includes(name) ? { "@fixture/shared": "workspace:*" } : {};
        write(
            `${path}/package.json`,
            JSON.stringify({
                name: `@fixture/${name}`,
                version: "0.0.0",
                dependencies,
                scripts: { test: "node --version", typecheck: "node --version" },
            }),
        );
        write(`${path}/src/index.ts`, "export const value = 1;\n");
        lockfile +=
            Object.keys(dependencies).length === 0
                ? `  ${path}: {}\n`
                : `  ${path}:\n    dependencies:\n      '@fixture/shared':\n        specifier: workspace:*\n        version: link:../../packages/shared\n`;
    }
    write("pnpm-lock.yaml", lockfile);
    git("init", "-q", "-b", "main");
    if (committed) {
        commit();
        git("checkout", "-qb", "feature");
    }
    return { root, env, write, git, commit, dry, selected };
}

test("首次提交前和没有已发布基线时执行快速检查；显式错误基线失败", t => {
    const repo = fixture(t, false);
    const initial = resolveAffectedRun(repo.root, ["test"], repo.env);
    assert.ok(!initial.args.includes("--affected"));
    assert.match(initial.message, /尚无 Git 提交/);
    repo.commit();
    assert.match(resolveAffectedRun(repo.root, ["test"], repo.env).message, /没有可比较/);
    assert.throws(() => resolveAffectedRun(repo.root, ["test", "--base", "missing"], repo.env), /基线不存在/);
    assert.throws(() => resolveAffectedRun(repo.root, ["test", "a.test.ts"], repo.env), /指定文件/);
});

test("优先采用远端默认分支；本地分支提交和工作区改动同时纳入", t => {
    const repo = fixture(t);
    const base = repo.git("rev-parse", "main");
    repo.git("update-ref", "refs/remotes/origin/develop", base);
    repo.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop");
    repo.write("apps/frontend/src/index.ts", "export const value = 2;\n");
    repo.commit();
    repo.write("apps/desktop/src/index.ts", "export const value = 3;\n");
    repo.git("add", "apps/desktop");
    repo.write("apps/backend/src/index.ts", "export const value = 4;\n");
    repo.write("apps/cli/src/new file.ts", "export const value = 5;\n");
    const invocation = resolveAffectedRun(repo.root, ["test"], repo.env);
    assert.match(invocation.message, /origin\/develop/);
    assert.equal(invocation.env.TURBO_SCM_BASE, base);
    assert.deepEqual(
        repo.selected(),
        ["backend", "cli", "desktop", "frontend"].map(name => `@fixture/${name}#test`),
    );
});

test("只改前端不选择后端、桌面端和根脚本；typecheck 同样按项目选择", t => {
    const repo = fixture(t);
    repo.write("apps/frontend/src/index.ts", "export const value = 2;\n");
    assert.deepEqual(repo.selected(), ["@fixture/frontend#test"]);
    assert.deepEqual(repo.selected("typecheck"), ["@fixture/frontend#typecheck"]);
});

test("修改共享源码选择其消费者，并使消费者的缓存失效", t => {
    const repo = fixture(t);
    repo.write("apps/frontend/src/index.ts", "export const value = 2;\n");
    const before = repo.dry().find(item => item.taskId === "@fixture/frontend#test")?.hash;
    assert.ok(before);
    repo.write("packages/shared/src/index.ts", "export const value = 3;\n");
    assert.deepEqual(repo.selected(), ["@fixture/desktop#test", "@fixture/frontend#test", "@fixture/shared#test"]);
    const after = repo.dry().find(item => item.taskId === "@fixture/frontend#test")?.hash;
    assert.notEqual(after, before);
});

test("移动文件同时影响移出和移入的应用", t => {
    const repo = fixture(t);
    repo.git("mv", "apps/frontend/src/index.ts", "apps/backend/src/moved.ts");
    assert.deepEqual(repo.selected(), ["@fixture/backend#test", "@fixture/frontend#test"]);
});

test("纯说明文档不触发检查；根脚本只选择自身的测试和类型检查", t => {
    const repo = fixture(t);
    repo.write("docs/testing.md", "# Test documentation\n");
    assert.deepEqual(repo.selected(), []);
    repo.write("scripts/sample.ts", "export const value = 2;\n");
    assert.deepEqual(repo.selected(), ["//#test:scripts"]);
    assert.deepEqual(repo.selected("typecheck"), ["//#typecheck:scripts"]);
});

test("显式声明的跨包文件输入会选择对应测试", t => {
    const repo = fixture(t);
    repo.write("api/openapi.yaml", "openapi: 3.1.0\n");
    repo.write(
        "apps/frontend/turbo.json",
        JSON.stringify({
            extends: ["//"],
            tasks: { test: { inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/api/openapi.yaml"] } },
        }),
    );
    repo.commit();
    repo.git("branch", "-f", "main", "HEAD");
    repo.write("api/openapi.yaml", "openapi: 3.1.1\n");
    assert.deepEqual(repo.selected(), ["@fixture/frontend#test"]);
});

test("全局配置改动扩大检查；无共同祖先或另类 head 不会静默跳过", t => {
    const repo = fixture(t);
    repo.write("turbo.json", `${config}\n`);
    assert.equal(repo.selected().length, 6);
    assert.throws(
        () => resolveAffectedRun(repo.root, ["test"], { ...repo.env, TURBO_SCM_HEAD: "HEAD~1" }),
        /TURBO_SCM_HEAD/,
    );
    repo.git("checkout", "--orphan", "other");
    repo.commit();
    assert.throws(() => resolveAffectedRun(repo.root, ["test", "--base", "main"], repo.env), /共同祖先/);
});

test("共用单测配置不会发现契约、数据库集成和 e2e 文件", t => {
    const repo = fixture(t);
    for (const path of [
        "src/value.test.ts",
        "test/view.spec.tsx",
        "tests/deep/value.test.mts",
        "test/contracts/api.test.ts",
        "tests/integration/db.test.ts",
        "tests/e2e/page.spec.ts",
        "src/api.contract.test.ts",
        "src/db.integration.spec.ts",
        "src/page.e2e.test.ts",
    ])
        repo.write(path, "export {};\n");
    const vitestCli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const result = spawnSync(
        process.execPath,
        [
            vitestCli,
            "list",
            "--filesOnly",
            "--config",
            fileURLToPath(new URL("../vitest.unit.config.ts", import.meta.url)),
        ],
        { cwd: repo.root, env: repo.env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /value\.test\.ts/);
    assert.match(result.stdout, /view\.spec\.tsx/);
    assert.match(result.stdout, /value\.test\.mts/);
    assert.doesNotMatch(result.stdout, /api\.test|db\.test|page\.spec|api\.contract|db\.integration|page\.e2e/);
});
