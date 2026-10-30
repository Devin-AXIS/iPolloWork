import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'reload-extension-contracts',
      handleHotUpdate({ file, server }) {
        // Registries have module identity; reload them together instead of retaining stale entries.
        if (
          /\/src\/(core|plugins)\//.test(file) ||
          /\/src\/ui\/(views\.tsx|view-registry\.ts|bootstrap\.ts|plugin-runtime\.ts|extension-context\.tsx)$/.test(
            file,
          )
        ) {
          server.ws.send({ type: 'full-reload' })
          return []
        }
      },
    },
  ],
  server: { port: 5710, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5711' } },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, maxSize: 400_000 },
            { name: 'document-editor', test: /node_modules[\\/](@tiptap[\\/]|prosemirror-)/, maxSize: 400_000 },
          ],
        },
      },
    },
  },
})
