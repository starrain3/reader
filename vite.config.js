import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isApk = mode === 'apk';

  return {
    // 使用相對路徑，確保部署在 GitHub Pages 子路徑與 Android APK 能正常讀取資源
    base: './',
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    define: {
      __IS_APK__: JSON.stringify(isApk),
      __APP_VERSION__: JSON.stringify('v3.2')
    }
  };
});

