import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Standalone UMD/IIFE embed build.
 * React is bundled so the script works on any Shopify theme.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist/widget',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/widget/entry.tsx'),
      name: 'NovaWidget',
      formats: ['umd', 'iife'],
      fileName: (format) =>
        format === 'umd' ? 'nova-widget.umd.js' : 'nova-widget.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'nova-widget.[ext]',
        exports: 'named',
      },
    },
    cssCodeSplit: false,
    minify: 'esbuild',
    sourcemap: false,
    target: 'es2018',
  },
});
