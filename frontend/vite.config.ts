import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: backend,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (forwarded, request) => {
            if (request.headers.origin === "http://" + request.headers.host) {
              forwarded.setHeader("Origin", backend);
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "../threadline/web",
    emptyOutDir: true,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        entryFileNames: "app.js",
        assetFileNames: "style.css",
      },
    },
  },
});
