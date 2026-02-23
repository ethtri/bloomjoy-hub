import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    // Set an explicit JS chunk budget below Vite's default 500 kB.
    chunkSizeWarningLimit: 450,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/@remix-run/router/")
          ) {
            return "framework";
          }

          if (id.includes("node_modules/@supabase/")) {
            return "supabase";
          }

          if (id.includes("node_modules/@tanstack/react-query/")) {
            return "react-query";
          }

          if (id.includes("node_modules/@radix-ui/")) {
            return "radix";
          }

          if (id.includes("node_modules/lucide-react/")) {
            return "icons";
          }

          if (id.includes("node_modules/recharts/")) {
            return "charts";
          }
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
