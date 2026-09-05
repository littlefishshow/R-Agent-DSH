/** Keyless acceptance against an installed official DSH executable and a prepared profile. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const [binArg, homeArg, ...flags] = process.argv.slice(2)
if (!binArg || !homeArg) throw new Error('Usage: node scripts/acceptance.mjs <official dsh lib/bin.js> <isolated DSH_HOME> [--keep-open]')
const bin = resolve(binArg)
const home = resolve(homeArg)
const workspace = join(home, 'acceptance-workspace')
const port = 3137
const origin = `http://127.0.0.1:${port}`
const requests = []
const transcript = []
let dsh
let dshExit
let logs = ''
let cancelledStreams = 0
const mock = createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let text = ''
  for await (const chunk of req) text += chunk
  const body = JSON.parse(text)
  requests.push(body)
  const prompt = JSON.stringify(body.messages.at(-1)?.content)
  const answer = prompt.includes('Modify this passage.')
    ? '```markdown\nAlpha revised by the local mock.\n```'
    : 'Bundle mock answer: the selected passage is Alpha passage.'
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta, finish_reason = null) => ({
    id: randomUUID(), object: 'chat.completion.chunk', created: 1, model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  })
  res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: answer }))}\n\n`)
  if (prompt.includes('STREAM UNTIL CANCEL')) {
    res.once('close', () => { cancelledStreams += 1 })
    return
  }
  res.write(`data: ${JSON.stringify({ ...chunk({}, 'stop'), usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 } })}\n\n`)
  res.end('data: [DONE]\n\n')
})
await new Promise(done => mock.listen(0, '127.0.0.1', done))
const mockOrigin = `http://127.0.0.1:${mock.address().port}`

async function waitUntil(probe, label) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await probe()) return
    await delay(150)
  }
  throw new Error(`Timed out: ${label}\n${logs.slice(-5000)}`)
}

async function start() {
  logs = ''
  dsh = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(port)], {
    cwd: workspace, windowsHide: true,
    env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: 'file-workbench-local-test', DEEPSEEK_BASE_URL: mockOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  dshExit = new Promise(done => dsh.once('exit', done))
  dsh.stdout.on('data', chunk => { logs += chunk })
  dsh.stderr.on('data', chunk => { logs += chunk })
  await waitUntil(async () => {
    if (dsh.exitCode !== null) throw new Error(logs)
    return logs.includes('dsh web:') && fetch(origin).then(response => response.ok).catch(() => false)
  }, 'DSH web startup')
}

async function stop() {
  if (dsh?.exitCode === null) { dsh.kill(); await dshExit }
}

async function rpc(channel, method, payload, raw = false) {
  const response = await fetch(`${origin}${channel}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  })
  assert.equal(response.status, 200, `${method}: ${await response.clone().text()}`)
  const message = await response.json()
  if (raw) return message.result
  assert.equal(message.result.ok, true, `${method}: ${JSON.stringify(message.result)}`)
  return message.result.value
}
const fileRpc = (method, payload, raw) => rpc('/rpc-fileworkbench', method, payload, raw)
const api = (method, payload = {}) => rpc('/api', method, payload)
const note = (name, details) => { transcript.push({ name, ...details }); console.log(`PASS ${name}`) }

async function completed(id, marker) {
  let history
  await waitUntil(async () => {
    history = await api('session.history', { sessionId: id, maxMessages: 100 })
    const list = await api('session.list')
    return JSON.stringify(history).includes(marker) && list.items.some(row => row.sessionId === id && !row.running)
  }, `completed session ${id}`)
  return history
}

try {
  await mkdir(workspace, { recursive: true })
  const path = join(workspace, 'guide.md')
  const content = '# Bundle acceptance\n\nAlpha passage.\n\nMath: $x^2$.\n\n![pixel](pixel.png)\n'
  await writeFile(path, content)
  await writeFile(join(workspace, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1cAAAAASUVORK5CYII=', 'base64'))
  await start()
  const { workspace: record } = await api('workspace.create', { path: workspace })
  const snapshot = await fileRpc('readText', { path })
  assert.equal(snapshot.content, content)
  assert.equal((await fileRpc('readImage', { path: join(workspace, 'pixel.png') })).mediaType, 'image/png')
  const created = await fileRpc('createEntry', { parent: workspace, name: 'scratch.txt', kind: 'file' })
  await fileRpc('writeText', { path: created.entry.path, content: 'temporary' })
  const copied = await fileRpc('copyEntry', { source: created.entry.path, destParent: workspace, name: 'copied.txt' })
  const renamed = await fileRpc('renameEntry', { path: copied.entry.path, newName: 'renamed.txt' })
  await fileRpc('deleteEntry', { path: renamed.entry.path })
  await fileRpc('deleteEntry', { path: created.entry.path })
  note('installed file/image/CRUD RPC', { files: (await fileRpc('listDir', { path: workspace })).entries.map(entry => entry.name) })
  const children = []
  for (const action of ['ask', 'explain', 'summarize', 'modify']) {
    const selectedText = 'Alpha passage.'
    const selection = await fileRpc('startSelectionSession', {
      workspaceId: record.workspaceId, path, expectedVersion: snapshot.version,
      selectedText, lineContext: selectedText + '\n', action,
      ...(action === 'ask' ? { instruction: 'Explain this passage.' } : action === 'modify' ? { instruction: 'Modify this passage.' } : {}),
      selectionId: randomUUID(), visibleStart: 18, occurrence: 0,
      sourceStart: content.indexOf(selectedText), sourceEnd: content.indexOf(selectedText) + selectedText.length + 1,
      colorIndex: children.length,
    })
    await completed(selection.sessionId, action === 'modify' ? 'Alpha revised' : 'Bundle mock answer')
    children.push({ action, ...selection })
  }
  assert.equal(new Set(children.map(child => child.fileSessionId)).size, 1)
  assert.equal(new Set(children.map(child => child.sessionId)).size, 4)
  const modelContexts = requests.filter(body => JSON.stringify(body.messages).includes('<file_context>'))
  assert.equal(modelContexts.length, 4)
  for (const body of modelContexts) assert.equal((JSON.stringify(body.messages).match(/<file_context>/g) ?? []).length, 1)
  note('four actions and independent children with one file snapshot each', { actions: children.map(child => child.action), modelRequests: modelContexts.length })
  await api('session.prompt', { sessionId: children[0].sessionId, mode: 'queue', content: [{ type: 'text', text: 'Follow-up on Alpha.' }] })
  await waitUntil(async () => requests.length >= 5 && (await api('session.list')).items.some(row => row.sessionId === children[0].sessionId && !row.running), 'follow-up')
  const history = await api('session.history', { sessionId: children[0].sessionId, maxMessages: 100 })
  assert.ok(JSON.stringify(history).includes('Follow-up on Alpha.'))
  note('follow-up and full history', {})
  await api('session.prompt', { sessionId: children[0].sessionId, mode: 'queue', content: [{ type: 'text', text: 'STREAM UNTIL CANCEL' }] })
  await waitUntil(async () => requests.some(body => JSON.stringify(body.messages.at(-1)?.content).includes('STREAM UNTIL CANCEL')), 'stream admission')
  await api('session.cancel', { sessionId: children[0].sessionId })
  await waitUntil(async () => cancelledStreams === 1 && (await api('session.list')).items.some(row => row.sessionId === children[0].sessionId && !row.running), 'cancel quiescence')
  note('stream cancellation', {})
  const version2 = await fileRpc('writeText', { path, content: content + '\nSaved through the plugin.\n', expectedVersion: snapshot.version })
  assert.notEqual(version2.version, snapshot.version)
  assert.equal((await fileRpc('writeText', { path, content, expectedVersion: snapshot.version }, true)).ok, false)
  assert.ok((await readFile(path, 'utf8')).includes('Saved through the plugin.'))
  note('save and stale-version rejection', {})
  await fileRpc('deleteSelectionSession', { workspaceId: record.workspaceId, path, sessionId: children[0].sessionId })
  assert.ok(!(await api('session.list')).items.some(row => row.sessionId === children[0].sessionId))
  note('live child deletion', {})
  await stop()
  await start()
  const restored = await api('session.list')
  for (const child of children.slice(1)) assert.ok(restored.items.some(row => row.sessionId === child.sessionId))
  await fileRpc('deleteSelectionSession', { workspaceId: record.workspaceId, path, sessionId: children[2].sessionId })
  assert.ok(!(await api('session.list')).items.some(row => row.sessionId === children[2].sessionId))
  note('restart recovery and cold child deletion', {})
  const expected = JSON.parse(await readFile(new URL('../tests/fixtures/acceptance.expected.json', import.meta.url), 'utf8'))
  assert.deepEqual(transcript, expected)
  await writeFile(join(home, 'acceptance.json'), JSON.stringify({ status: 'PASS_WITH_LOCAL_MODEL', transcript, workspace, children, logs }, null, 2))
  console.log(`Acceptance complete: ${origin}; ${join(home, 'acceptance.json')}`)
  if (flags.includes('--keep-open')) await new Promise(done => {
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
  })
} catch (error) {
  await writeFile(join(home, 'acceptance-failed.json'), JSON.stringify({ error: String(error), logs, requests, transcript }, null, 2))
  throw error
} finally {
  await stop()
  mock.closeAllConnections()
  await new Promise(done => mock.close(done))
}
