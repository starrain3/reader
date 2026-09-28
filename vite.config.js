import { defineConfig } from 'vite';

export default defineConfig({
  // 使用相對路徑，確保部署在 GitHub Pages 子路徑時能正常讀取資源
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
