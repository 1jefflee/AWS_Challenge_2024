import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { updateCommonjsPlugin } from './updateCommonJSPlugin';

// https://vitejs.dev/config/
//export default defineConfig({
//  plugins: [react()],
//})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), updateCommonjsPlugin()],
  define: {
      global: {},
  },
  server: {
      port: 5173,
  },
  resolve: {
      alias: {
          './runtimeConfig': './runtimeConfig.browser',
      },
  },
  build: {
    minify: false,
  },
});

