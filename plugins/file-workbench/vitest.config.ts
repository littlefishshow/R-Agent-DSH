import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { dshClientArtifacts } from './tests/helpers/dsh-client-artifacts.ts'

export default defineConfig({
  plugins: [dshClientArtifacts()],
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-renderer/src': resolve('tests/fixtures/dsh/ui-renderer'),
      '@deepseek-ai/dsh-client-ui-conversation/src': resolve('tests/fixtures/dsh/ui-conversation'),
      '@deepseek-ai/dsh-client-locale/src': resolve('tests/fixtures/dsh/locale'),
    },
  },
  test: {
    maxWorkers: 4,
    server: { deps: { inline: [/@deepseek-ai\//] } },
    projects: [
      { extends: true, test: { name: 'host', include: ['tests/host/**/*.spec.ts'], environment: 'node', testTimeout: 20_000 } },
      { extends: true, test: { name: 'client', include: ['tests/client/**/*.spec.{ts,tsx}'], environment: 'jsdom', testTimeout: 15_000 } },
      { extends: true, test: { name: 'bundle', include: ['tests/packaging/**/*.built.spec.ts'], environment: 'jsdom', testTimeout: 20_000 } },
    ],
  },
})
