import { configDefaults, defineConfig } from "vitest/config";

// 在所属包的 cwd 执行；React 等应用可通过 mergeConfig 追加插件和环境。
export default defineConfig({
    test: {
        environment: "node",
        include: ["{src,test,tests}/**/*.{test,spec}.{ts,tsx,mts,cts}"],
        exclude: [
            ...configDefaults.exclude,
            "**/{contract,contracts,integration,e2e}/**",
            "**/*.{contract,integration,e2e}.{test,spec}.{ts,tsx,mts,cts}",
        ],
    },
});
