/** Run the installed, unmodified DSH browser factories as ESM inside Vitest. */
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/** Only the module handoff changes; the published factory body and imports execute verbatim. */
export function dshClientArtifacts(): Plugin {
  return {
    name: 'test-installed-dsh-client-artifacts',
    enforce: 'pre',
    load(id) {
      if (!id.replaceAll('\\', '/').includes('/@deepseek-ai/') || !id.endsWith('.js')) return null
      // Several official tarballs reference omitted maps; remove only the
      // source-map directive so Vite can load their published JavaScript.
      const code = readFileSync(id, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, '')
      if (!code.startsWith('window.__ModuleLoader__.load(')) return code
      const dependencies = [...new Set([...code.matchAll(/\brequire\("([^"\n]+)"\)/g)].map(match => match[1]!))]
      const exports = [...new Set([...code.matchAll(/\bexports\.(\w+) =/g)].map(match => match[1]!))]
      const factoryStart = code.indexOf('factory: (require) => {') + 'factory: (require) => {'.length
      const factoryEnd = code.lastIndexOf('return module.exports;') + 'return module.exports;'.length
      if (factoryStart < 25 || factoryEnd < factoryStart) throw new Error(`unsupported DSH client artifact: ${id}`)
      return [
        ...dependencies.map((name, index) => `import * as dep${index} from ${JSON.stringify(name)};`),
        `const dependencies = {${dependencies.map((name, index) => `${JSON.stringify(name)}:dep${index}`).join(',')}};`,
        'const result = ((require) => {',
        code.slice(factoryStart, factoryEnd),
        '})(name => dependencies[name]);',
        ...exports.map(name => name === 'default' ? 'export default result.default;' : `export const ${name} = result.${name};`),
      ].join('\n')
    },
  }
}
