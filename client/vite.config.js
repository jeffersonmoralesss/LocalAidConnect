import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// REQ-3.1.x / REQ-3.2.x: proxy /api to Express backend on :3001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
