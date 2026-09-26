import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { chainkeysApi } from './api-plugin'

export default defineConfig(({ mode }) => {
  const fromRoot = loadEnv(mode, '..', '')
  const fromWeb = loadEnv(mode, '.', '')
  Object.assign(process.env, fromRoot, fromWeb)
  return {
    plugins: [react(), chainkeysApi()],
    base: './',
  }
})
