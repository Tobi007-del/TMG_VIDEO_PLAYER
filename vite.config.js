import { defineConfig } from "vite";

export default defineConfig({
  base: './',
  publicDir: "public",
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/api": {
        target: "http://localhost:5173", // When you fetch('/api/log-ip'), Vite redirects it to Vercel's local port
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        main: "./index.html",
      },
    },
  },
});
