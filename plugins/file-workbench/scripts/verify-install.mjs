/** Install, exercise and uninstall a tarball against a stock DSH in a new, isolated home. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const [binArg, bundleArg, homeArg] = process.argv.slice(2)
if (!binArg || !bundleArg || !homeArg) throw new Error('Usage: node scripts/verify-install.mjs <official dsh lib/bin.js> <tarball> <new isolated DSH_HOME>')
const bin = resolve(binArg)
const bundle = resolve(bundleArg)
const home = resolve(homeArg)
// Refuse an existing home: acceptance creates and permanently deletes test sessions.
await mkdir(home)
const env = { ...process.env, DSH_HOME: home }

function run(args, label) {
  const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error(`${label}: ${result.error ?? result.signal ?? result.status}\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

run([bin, 'plugin', '--profile', 'web', 'add', bundle], 'install tarball')
console.log('PASS normal bundle installation into a fresh profile')
const composed = run([bin, '--profile', 'web', '--dump-config'], 'compose installed profile')
assert.ok(composed.includes('dsh-file-workbench/persistence'))
assert.ok(composed.includes('dsh-file-workbench/workspaces'))
await writeFile(join(home, 'installed.yml'), composed)
run([resolve('scripts/acceptance.mjs'), bin, home], 'installed application acceptance')
const acceptance = JSON.parse(await readFile(join(home, 'acceptance.json'), 'utf8'))
assert.equal(acceptance.status, 'PASS_WITH_LOCAL_MODEL')
console.log('PASS installed application transcript (7 scenarios)')

run([bin, 'plugin', '--profile', 'web', 'remove', 'dsh-file-workbench'], 'uninstall bundle')
const restored = run([bin, '--profile', 'web', '--dump-config'], 'compose restored profile')
assert.ok(!restored.includes('dsh-file-workbench'))
await writeFile(join(home, 'uninstalled.yml'), restored)
const origin = 'http://127.0.0.1:3137'
let logs = ''
const server = spawn(process.execPath, [bin, 'web', '--no-open', '--port', '3137'], {
  cwd: acceptance.workspace, windowsHide: true,
  env: { ...env, DEEPSEEK_API_KEY: 'file-workbench-local-test', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const exited = new Promise(done => server.once('exit', done))
server.stdout.on('data', chunk => { logs += chunk })
server.stderr.on('data', chunk => { logs += chunk })
try {
  const deadline = Date.now() + 30_000
  while (!logs.includes('dsh web:')) {
    if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Original DSH failed to boot: ${logs}`)
    await delay(100)
  }
  const html = await fetch(origin).then(response => response.text())
  for (const name of ['ui-layout', 'ui-sidebar', 'ui-workspace', 'ui-trajectory']) {
    assert.ok(html.includes(`@deepseek-ai/dsh-client-${name}`), `restored browser module ${name}`)
  }
  assert.ok(!html.includes('dsh-file-workbench'))
  const api = async (method, payload = {}) => {
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
    })
    assert.equal(response.status, 200)
    const message = await response.json()
    assert.equal(message.result.ok, true, JSON.stringify(message.result))
    return message.result.value
  }
  const list = await api('session.list')
  for (const child of acceptance.children.filter(row => row.action === 'explain' || row.action === 'modify')) {
    assert.ok(list.items.some(row => row.sessionId === child.sessionId))
    const history = await api('session.history', { sessionId: child.sessionId, maxMessages: 100 })
    assert.ok(JSON.stringify(history).includes(child.action === 'modify' ? 'Alpha revised' : 'Bundle mock answer'))
  }
  console.log('PASS uninstall restores original UI and preserves readable session data')
  await writeFile(join(home, 'verification.json'), JSON.stringify({
    status: 'PASS_WITH_LOCAL_MODEL',
    bundle, installedApplication: acceptance.transcript,
    uninstall: { originalUiRestored: true, survivingSessionsReadable: true },
  }, null, 2))
  console.log(`Evidence: ${join(home, 'verification.json')}`)
} finally {
  if (server.exitCode === null) { server.kill(); await exited }
}
