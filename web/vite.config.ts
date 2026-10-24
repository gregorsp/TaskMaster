import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ONNX Runtime lädt seine WASM-Dateien zur Laufzeit nach. Unter COEP
 * (`require-corp`) müssen sie same-origin sein, deshalb kopieren wir sie aus
 * node_modules in `public/ort/`, statt sie von einem CDN zu ziehen.
 */
function ortWasmAssets(): Plugin {
  return {
    name: "taskmaster-ort-wasm-assets",
    buildStart() {
      const source = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist", import.meta.url));
      const target = fileURLToPath(new URL("./public/ort", import.meta.url));
      mkdirSync(target, { recursive: true });
      for (const file of readdirSync(source)) {
        if (!/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(file)) continue;
        copyFileSync(path.join(source, file), path.join(target, file));
      }
    },
  };
}

export default defineConfig({
  // Der ASR-Worker lädt ONNX Runtime per dynamischem Import — das geht nur als ES-Modul.
  worker: { format: "es" },
  plugins: [
    react(),
    tailwindcss(),
    ortWasmAssets(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      workbox: {
        // Die ONNX-Laufzeit (12–25 MB) gehört nicht ins Precache; sie wird
        // bei Bedarf geladen. Das Modell selbst liegt in OPFS.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        globIgnores: ["ort/**"],
      },
      manifest: {
        name: "TaskMaster",
        short_name: "TaskMaster",
        theme_color: "#1976d2",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { src: "icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
