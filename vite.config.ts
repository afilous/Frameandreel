import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { youwareVitePlugin } from "@youware/vite-plugin-react";

// https://vite.dev/config/
export default defineConfig({
  define: {
    __GA_MEASUREMENT_ID__: JSON.stringify(process.env.GA_MEASUREMENT_ID || null),
    __HOTJAR_SITE_ID__: JSON.stringify(process.env.HOTJAR_SITE_ID || null),
    __LOOKER_STUDIO_URL__: JSON.stringify(process.env.LOOKER_STUDIO_URL || null),
  },
  plugins: [youwareVitePlugin(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    sourcemap: true,
    // Force full rebuild by disabling build cache
    cacheDir: false,
    rollupOptions: {
      output: {
        // Use content-based hashing for proper cache busting
        entryFileNames: 'assets/index-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // Ensure Vite doesn't use any persistent caching
  optimizeDeps: {
    force: true,
  },
});
