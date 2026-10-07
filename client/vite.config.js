import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const emptyFile = fileURLToPath(new URL('./src/empty.js', import.meta.url))
const projectRoot = fileURLToPath(new URL('./', import.meta.url))
const localApiUrl = 'http://localhost:5000'
const stripApiSuffix = (value = '') => value.replace(/\/api\/?$/, '').replace(/\/+$/, '')

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const allowRemoteApiOnLocalhost = env.VITE_ALLOW_REMOTE_API_ON_LOCALHOST === 'true'
  const proxyTarget = stripApiSuffix(
    allowRemoteApiOnLocalhost
      ? env.VITE_API_URL || localApiUrl
      : localApiUrl
  )

  return {
    plugins: [react()],
    resolve: {
      alias: [
        { find: 'fs', replacement: emptyFile },
        { find: 'path', replacement: emptyFile },
        { find: 'os', replacement: emptyFile },
        { find: 'util', replacement: emptyFile },
        { find: 'buffer', replacement: emptyFile },
        {
          find: /^@tensorflow\/tfjs-data\/dist\/sources\/file_data_source(?:\.js)?$/,
          replacement: emptyFile,
        },
      ],
    },
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      rollupOptions: {
        // Keep the HTML entry relative so Vite/Rolldown does not emit an
        // absolute Windows path as the output asset name.
        input: 'index.html',
      },
    },
  }
})
