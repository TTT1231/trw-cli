import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: ['src/index.ts'],
    format: 'esm',
    // Windows 上 npm 会生成 cmd shim 调 node，shebang 由这里注入
    banner: '#!/usr/bin/env node',
    platform: 'node',
    target: 'node20',
    dts: false,
    minify: false,
    clean: true,
})
