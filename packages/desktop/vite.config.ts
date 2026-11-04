import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 复用 core 的引擎元数据（纯 TS 常量，无 node 依赖），避免前端重复维护一份
      // 纯函数常量同理别名到 core 源码，避免把 core 的 CJS 产物引入渲染层
      '@openloop/core/media-mime': path.resolve(__dirname, '../core/src/constants/media-mime.ts'),
      '@openloop/core/task-summary': path.resolve(__dirname, '../core/src/store/task-summary.ts'),
      '@openloop/core/agent-format': path.resolve(__dirname, '../core/src/agent/agent-format.ts'),
      // Agent 增量事件归约器：纯函数 + 纯类型，渲染层与服务端共用同一份语义
      '@openloop/core/agent-events': path.resolve(__dirname, '../core/src/agent/agent-events.ts'),
      '@openloop/core/types': path.resolve(__dirname, '../core/src/types/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.VITE_CORE_PORT || '19889'}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${process.env.VITE_CORE_PORT || '19889'}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    // 目标定在 es2022：xterm 6 的 ESM 产物带 `||=` 写回，压到 es2020 时 esbuild 会降级
    // 逻辑赋值并误删声明，导致打包后首条 DCS 查询抛 ReferenceError，TUI（yazi、vim）直接白屏
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xyflow')) {
              return 'vendor-flow';
            }
            if (id.includes('lucide-react') || id.includes('prismjs') || id.includes('react-markdown')) {
              return 'vendor-ui';
            }
            if (id.includes('/react/') || id.includes('/react-dom/')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
});
