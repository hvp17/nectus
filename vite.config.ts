import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const localWorktreeIgnore = "**/.claude/**";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/native/**", localWorktreeIgnore],
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Don't scan nested git worktrees under .claude/ — they are full repo copies
    // and would run the suite multiple times over.
    exclude: [...configDefaults.exclude, localWorktreeIgnore],
  },
});
