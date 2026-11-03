import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Deux sorties :
//  - normale  : l'app servie par le serveur Node (web/dist) ;
//  - « demo » : la vitrine + la démo qui tourne entièrement dans le navigateur (Vercel).
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    root: __dirname,
    plugins: [react()],
    base: "/",
    define: { __DEMO__: JSON.stringify(demo) },
    build: {
      outDir: resolve(__dirname, demo ? "dist-demo" : "dist"),
      emptyOutDir: true,
      rollupOptions: {
        input: (demo
          ? { app: resolve(__dirname, "index.html"), site: resolve(__dirname, "site/index.html") }
          : { app: resolve(__dirname, "index.html") }) as Record<string, string>,
      },
    },
    server: {
      port: 5173,
      proxy: { "/api": "http://localhost:8080", "/mcp": "http://localhost:8080" },
      fs: { allow: [resolve(__dirname, "..")] },
    },
  };
});
