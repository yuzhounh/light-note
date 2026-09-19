import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../src/LightNote.App/Editor',
    emptyOutDir: true,
  },
})
