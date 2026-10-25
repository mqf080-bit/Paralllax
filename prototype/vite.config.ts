import { defineConfig } from 'vite';

// Step 0 的链路只走 loopback：
// http://localhost 与 http://127.0.0.1 都是 secure context，WebXR 才可用。
// 局域网 IP（192.168.x.x）不是 secure context，Quest 上拿不到 navigator.xr —— 见 agent.md §4。
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        game: 'index.html',
        editor: 'editor.html',
        bgLab: 'bg-lab.html',
      },
    },
  },
});
