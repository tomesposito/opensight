import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'echarts', test: /node_modules\/(echarts|zrender)\// }] },
      },
    },
  },
});
