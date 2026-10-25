import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: { lint: string };
};
const hooks = readFileSync(new URL("../lefthook.yml", import.meta.url), "utf8");
const hookCommand = hooks.match(/^\s+run: (node_modules\/\.bin\/tsx scripts\/run-oxlint\.ts .+)$/m)?.[1];
assert.ok(hookCommand, "pre-commit 必须使用 lint 包装器");
const commands = { full: manifest.scripts.lint, staged: hookCommand };

function fixture(t: TestContext) {
    const root = mkdtempSync(join(tmpdir(), "temp-repo-lint-"));
    t.after(() => {
        assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()));
        assert.ok(basename(root).startsWith("temp-repo-lint-"));
        const modules = join(root, "node_modules");
        if (existsSync(modules)) unlinkSync(modules);
        rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "junction");

    function write(path: string, content: string): void {
        const target = join(root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    for (const path of [".oxlintrc.json", "scripts/run-oxlint.ts"]) {
        write(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
    }
    write("package.json", JSON.stringify({ type: "module" }));
    write(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true, jsx: "preserve" }, include: ["apps/**/*"] }),
    );

    function lint(mode: keyof typeof commands, file: string) {
        // 使用实际 package.json 和 hook 命令，防止配置切换导致局部规则漏检。
        const [launcher, ...args] = commands[mode].split(/\s+/);
        assert.ok(launcher === "tsx" || launcher === "node_modules/.bin/tsx");
        const selected = mode === "staged" ? args.map(arg => (arg === "{staged_files}" ? file : arg)) : [...args, file];
        const result = spawnSync(process.execPath, ["--import", "tsx", ...selected, "--format=json"], {
            cwd: root,
            env: { ...process.env, OXLINT_THREADS: "1" },
            encoding: "utf8",
        });
        if (result.error) throw result.error;
        return { status: result.status, output: result.stdout + result.stderr };
    }
    return { write, lint };
}

const conditionalHook = `declare function useState(value: number): [number, unknown];
export function Probe({ active }: { active: boolean }) {
    if (active) useState(1);
    return null;
}
`;
const localRules = JSON.stringify({
    extends: ["../../.oxlintrc.json"],
    plugins: ["typescript", "react"],
    rules: { "react/rules-of-hooks": "error", "typescript/no-floating-promises": "error" },
});

test("应用名不影响局部规则，完整 lint 和 commit 均拒绝条件 Hook", t => {
    const repo = fixture(t);
    for (const name of ["frontend", "desktop"]) {
        repo.write(`apps/${name}/.oxlintrc.json`, localRules);
        repo.write(`apps/${name}/probe.tsx`, conditionalHook);
        for (const mode of ["full", "staged"] as const) {
            const result = repo.lint(mode, `apps/${name}/probe.tsx`);
            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /rules-of-hooks/);
        }
    }
});

test("修复后检查通过，应用规则不会泄漏到其他项目", t => {
    const repo = fixture(t);
    repo.write("apps/frontend/.oxlintrc.json", localRules);
    repo.write(
        "apps/frontend/probe.tsx",
        conditionalHook.replace("if (active) useState(1);", "useState(active ? 1 : 0);"),
    );
    repo.write("apps/service/probe.tsx", conditionalHook);
    for (const mode of ["full", "staged"] as const) {
        for (const file of ["apps/frontend/probe.tsx", "apps/service/probe.tsx"]) {
            const result = repo.lint(mode, file);
            assert.equal(result.status, 0, result.output);
        }
    }
});

test("完整 lint 执行类型感知规则，commit 保持快速检查", t => {
    const repo = fixture(t);
    repo.write("apps/frontend/.oxlintrc.json", localRules);
    repo.write("apps/frontend/promise.ts", "Promise.resolve(1);\n");
    const staged = repo.lint("staged", "apps/frontend/promise.ts");
    assert.equal(staged.status, 0, staged.output);
    const full = repo.lint("full", "apps/frontend/promise.ts");
    assert.equal(full.status, 1, full.output);
    assert.match(full.output, /no-floating-promises/);
});
