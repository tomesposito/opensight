import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The local node:http API has no CORS. Browser requests stay same-origin.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3000', rewrite: path => path.replace(/^\/api/, '') } } },
  build: {
    rolldownOptions: {
      output: {
        comments: { legal: true },
        codeSplitting: { groups: [{ name: 'echarts', test: /node_modules\/(echarts|zrender)\// }] },
      },
    },
  },
});
