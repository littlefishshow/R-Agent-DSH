/** Preserve license and notice text for every dependency included in emitted source maps. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const packageRoots = new Set()
for (const file of (await readdir('lib')).filter(name => name.endsWith('.map'))) {
  const map = JSON.parse(await readFile(join('lib', file), 'utf8'))
  for (const source of map.sources ?? []) {
    const match = /^(.*\/node_modules\/(@[^/]+\/[^/]+|[^/]+))\//.exec(source)
    if (match) packageRoots.add(resolve('lib', match[1]))
  }
}
const sections = []
for (const root of packageRoots) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const notices = (await readdir(root, { withFileTypes: true }))
    .filter(file => file.isFile() && /^(license|licence|copying|notice)(\.|$)/i.test(file.name))
    .map(file => file.name).sort()
  if (!notices.length) throw new Error(`Missing distributable license text: ${manifest.name}`)
  const content = await Promise.all(notices.map(async file => `--- ${file} ---\n${await readFile(join(root, file), 'utf8')}`))
  sections.push({ name: `${manifest.name}@${manifest.version}`, content: content.join('\n') })
}
sections.sort((left, right) => left.name.localeCompare(right.name, 'en'))
await writeFile('lib/THIRD_PARTY_LICENSES.txt', sections.map(section => `${'='.repeat(72)}\n${section.name}\n${'='.repeat(72)}\n${section.content.trim()}\n`).join('\n'))
console.log(`Preserved licenses for ${sections.length} bundled dependencies`)
