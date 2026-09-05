import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { createRequire } from 'node:module'

const PACKAGE_ID = 'dsh-file-workbench'
const CSS_PREFIX = '\0file-workbench-css:'
const CSS_SUFFIX = '.mjs'
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

function sourceAsset(source: string, importer: string): string {
  if (!source.startsWith('.')) return createRequire(importer).resolve(source)
  const direct = resolve(dirname(importer), source)
  if (existsSync(direct)) return direct
  const marker = `${process.platform === 'win32' ? '\\' : '/'}lib${process.platform === 'win32' ? '\\' : '/'}types${process.platform === 'win32' ? '\\' : '/'}`
  const at = direct.indexOf(marker)
  return at < 0 ? direct : resolve(direct.slice(0, at), 'src', direct.slice(at + marker.length))
}

function styleModule(file: string, css: string, classMap: Readonly<Record<string, string>>): string {
  const tagId = `${PACKAGE_ID}/${basename(file)}`
  return [
    `const css=${JSON.stringify(css)};`,
    `const tagId=${JSON.stringify(tagId)};`,
    "if(typeof document!=='undefined'&&document.querySelector('style[data-plugin-css='+JSON.stringify(tagId)+']')===null){",
    "const tag=document.createElement('style');",
    `tag.dataset.plugin=${JSON.stringify(PACKAGE_ID)};`,
    'tag.dataset.pluginCss=tagId;tag.textContent=css;document.head.appendChild(tag);}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

export default defineConfig([
  {
    name: `${PACKAGE_ID}/host`,
    entry: {
      index: 'src/index.ts',
      persistence: 'src/host/profile-persistence.ts',
      workspaces: 'src/host/workspaces/index.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    clean: false,
    sourcemap: true,
    dts: false,
    outputOptions: { entryFileNames: '[name].js' },
    deps: {
      neverBundle: (specifier: string) => specifier === '@deepseek-ai/cordis'
        || specifier === '@deepseek-ai/cordis-plugin-loader'
        || specifier.startsWith('@deepseek-ai/dsh-')
        || specifier === 'koffi',
    },
  },
  {
    name: `${PACKAGE_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    clean: false,
    sourcemap: true,
    dts: false,
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'process.env.DSH_CLIENT_COMMIT_HASH': 'undefined',
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'file-workbench-css',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || importer === undefined) return null
        return CSS_PREFIX + sourceAsset(source, importer) + CSS_SUFFIX
      },
      async load(id: string) {
        if (!id.startsWith(CSS_PREFIX)) return null
        const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
        this.addWatchFile(file)
        // Inline local font assets so the installed bundle has no source-tree
        // or CDN dependency. KaTeX fonts must work under any DSH mount URL.
        const sourceCss = (await readFile(file)).toString()
        const urls = [...sourceCss.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)]
        let bundledCss = sourceCss
        for (const match of urls) {
          const url = match[2]!
          if (/^(data:|https?:|#)/.test(url)) continue
          const bytes = await readFile(resolve(dirname(file), url))
          const mime = url.endsWith('.woff2') ? 'font/woff2' : url.endsWith('.woff') ? 'font/woff' : 'font/ttf'
          bundledCss = bundledCss.replaceAll(match[0], `url(data:${mime};base64,${bytes.toString('base64')})`)
        }
        const result = transform({
          filename: file,
          code: Buffer.from(bundledCss),
          cssModules: file.endsWith('.module.css') ? { pattern: '[hash]_[local]' } : false,
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, value] of Object.entries(result.exports ?? {})) classMap[local] = value.name
        return styleModule(file, result.code.toString(), classMap)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.cjs',
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({id:${JSON.stringify(PACKAGE_ID)},factory:(require)=>{`,
      footer: 'return module.exports;}});',
      intro: 'var module={exports:{}};var exports=module.exports;',
    },
  },
])
