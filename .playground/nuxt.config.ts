import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  extends: [['..', { install: true }]],
  modules: ['@nuxt/eslint'],

  eslint: {
    config: {
      // Use the generated ESLint config for lint root project as well
      rootDir: fileURLToPath(new URL('..', import.meta.url))
    }
  },

  compatibilityDate: '2025-01-07'
})