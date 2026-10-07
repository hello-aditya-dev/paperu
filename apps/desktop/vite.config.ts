/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Paperu desktop frontend — Vite config.
// Tauri expects the dev server on a fixed port (1420) and the
// production bundle emitted to `dist/`.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@paperu/contracts": resolve(__dirname, "../../packages/contracts/src"),
      "@paperu/design-tokens": resolve(
        __dirname,
        "../../packages/design-tokens/src",
      ),
      "@paperu/ui": resolve(__dirname, "../../packages/ui/src"),
      "@paperu/test-fixtures": resolve(
        __dirname,
        "../../packages/test-fixtures/src",
      ),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react-router")
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    // Use happy-dom instead of jsdom: jsdom 30 has a webidl
    // threads pool supports dynamic imports (needed for lazy-loaded routes)
    
    environment: "happy-dom",
    pool: "threads",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
