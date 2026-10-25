// Exercise the actual plugin with an in-memory host and fake OneBot socket.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

const hostRequire = createRequire(process.env.DSH_PACKAGE_JSON || join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
const hostNamespaces = new Map()
for (const name of ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools']) {
  const filename = hostRequire.resolve(name).replace(/index\.cjs$/, 'index.mjs')
  hostNamespaces.set(name, await import(pathToFileURL(filename).href))
}
const flush = () => new Promise(resolve => setImmediate(resolve))
async function fixture(t, mode = 'tool') {
  const dir = mkdtempSync(join(tmpdir(), 'whale-integration-'))
  const calls = [], turns = [], handlers = new Map(), tools = new Map(), routes = new Map(), cleanups = [], prompts = [], processes = [], guards = []
  writeFileSync(join(dir, 'launcher-win10.bat'), '@echo off\n')
  const settings = { targetSessionId: 'test-session', agentPreset: 'whale-girl', onebotUrl: 'ws://fake.invalid', whitelist: ['10001', '10002'], groupWhitelist: ['20001'], wakeProbability: 1, replyMode: mode, replyMaxChars: 1500, stripMarkdown: false, napcatInstallDir: dir }
  let socket
  class Socket {
    readyState = 0
    constructor() { socket = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
    close() { this.readyState = 3 }
    send(json) {
      const r = JSON.parse(json); calls.push(r)
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ status: 'ok', retcode: 0, echo: r.echo, data: r.action === 'get_login_info' ? { user_id: '99999' } : { message_id: calls.length } }) }))
    }
  }
  const context = vm.createContext({ console, process, Buffer, URL, AbortSignal, fetch, structuredClone, WebSocket: Socket,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {} })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url)) return cache.get(url)
    const m = new vm.SourceTextModule(readFileSync(fileURLToPath(url), 'utf8'), { context, identifier: url })
    cache.set(url, m)
    await m.link(async (specifier, referencing) => {
      if (specifier.startsWith('.')) return load(new URL(specifier, referencing.identifier).href)
      const key = 'external:' + specifier
      if (cache.has(key)) return cache.get(key)
      let ns = hostNamespaces.get(specifier) ?? await import(specifier)
      if (specifier === 'node:os') ns = { ...ns, homedir: () => dir }
      if (specifier === 'node:child_process') ns = { ...ns, spawn: (command, args, options) => {
        const child = { command, args, options, killed: false, unrefCalled: false, on() { return this }, unref() { this.unrefCalled = true }, kill() { this.killed = true } }
        processes.push(child)
        return child
      } }
      const external = new vm.SyntheticModule(Object.keys(ns), function () { for (const [k, v] of Object.entries(ns)) this.setExport(k, v) }, { context })
      cache.set(key, external)
      return external
    })
    return m
  }
  const module = await load(new URL('../index.js', import.meta.url).href)
  await module.evaluate()
  const emitFor = (id, event) => { for (const handler of [...(handlers.get('session/event') ?? [])]) handler({ id }, event) }
  const emit = event => emitFor('test-session', event)
  const agent = { id: 'test-session', status: 'idle', ctx: null, followup(message) { this.status = 'running'; turns.push(message); emit({ type: 'user/message', data: message }); emit({ type: 'turn/start', data: { turn: turns.length } }) } }
  const guestOptions = [], guestAgents = new Map(), scopes = new Map(), presetMounts = []
  agent.session = { header: { cwd: join(dir, 'owner-workspace') }, snapshotEvents: () => [] }
  const ctx = {
    logger: { info() {}, warn() {} },
    settings: { register() {}, get: () => settings },
    agents: { get: id => id === agent.id ? agent : guestAgents.get(id), withInitiator: (_agent, run) => run(),
      create: async options => {
        guestOptions.push(options)
        const guest = { id: options.sessionId, session: { header: { cwd: options.meta.cwd }, snapshotEvents: () => [] }, options: options.agentOptions, status: 'idle', ctx: null,
          followup(message) { this.status = 'running'; turns.push(message); emitFor(this.id, { type: 'turn/start', data: { turn: turns.length } }); emitFor(this.id, { type: 'user/message', data: message }) } }
        const listeners = new Map(); scopes.set(guest.id, listeners)
        guest.ctx = { ...ctx, on(name, handler) {
          if (!listeners.has(name)) listeners.set(name, [])
          listeners.get(name).unshift(handler)
          return () => { const list = listeners.get(name); const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1) }
        } }
        await options.setup?.(guest.ctx)
        guestAgents.set(guest.id, guest)
        return { agent: guest, dispose: async () => guestAgents.delete(guest.id) }
      } },
    tools: { register: tool => { tools.set(tool.name, tool) }, guard: check => { guards.push(check); return () => guards.splice(guards.indexOf(check), 1) } },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup },
    on: (name, handler) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); return () => { const list = handlers.get(name); const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1) } },
    get: name => name === 'systemPrompt' ? { context: p => { prompts.push(p.text); return () => {} } } : name === 'agentPresets' ? { mount: async (agentCtx, preset) => { presetMounts.push({ agentCtx, preset }) } } : undefined,
    inject: (_names, run) => run({ webServer: { register: route => { routes.set(route.path, route.handler); return () => {} } }, effect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) } }),
  }
  // Keep agent-scoped listeners separate from the plugin's global listeners.
  const scopedHandlers = new Map()
  agent.ctx = { ...ctx, on(name, handler) {
    if (!scopedHandlers.has(name)) scopedHandlers.set(name, [])
    scopedHandlers.get(name).unshift(handler)
    return () => { const list = scopedHandlers.get(name); const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1) }
  } }
  module.namespace.apply(ctx, { ...settings, statePath: join(dir, 'state.json'), debugTools: true })
  await flush(); await flush()
  function unload() { for (const cleanup of cleanups.splice(0).reverse()) cleanup() }
  t.after(() => { unload(); rmSync(dir, { recursive: true, force: true }) })
  async function call(name, args) { const r = await tools.get(name).execute(args); return JSON.parse(r) }
  async function http(path, payload, method = 'POST', headers = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload ?? {}))])
    req.method = method; req.url = path; req.socket = { remoteAddress: '127.0.0.1' }
    req.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify(payload ?? {}))), ...headers }
    let result
    await routes.get(path)(req, { writeHead() {}, end: body => { result = JSON.parse(body) } })
    return result
  }
  function end() { emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } }); agent.status = 'idle' }
  async function waitForTurns(n) { for (let i = 0; i < 50 && turns.length < n; i++) await new Promise(r => setTimeout(r, 10)); assert.equal(turns.length, n) }
  async function scoped(name, args, final, forAgent = agent) {
    const listeners = [...((scopes.get(forAgent.id) ?? scopedHandlers).get(name) ?? [])]
    const run = i => i === listeners.length ? Promise.resolve(final) : listeners[i](...args, () => run(i + 1))
    return run(0)
  }
  const mobileHttp = payload => http('/api/whale-mobile/chat', payload, 'POST', { authorization: 'Bearer ' + JSON.parse(readFileSync(join(dir, '.dsh', 'whale-mobile', 'internal-key.json'))).key })
  return { call, http, mobileHttp, end, emit, emitFor, guestOptions, guestAgents, guards, turns, calls, settings, routes, prompts, waitForTurns, processes, unload, agent, presetMounts,
    mobileProgress: id => http('/api/whale-mobile/progress', { id }, 'POST', { authorization: 'Bearer ' + JSON.parse(readFileSync(join(dir, '.dsh', 'whale-mobile', 'internal-key.json'))).key }),
    stream: (forAgent, frame) => { for (const h of handlers.get('agent/assistant-stream') ?? []) h({ agent: forAgent, frame }) },
    assembly: (assembly, forAgent = agent) => scoped('system-prompt/assemble', [assembly, { agent: forAgent }], assembly, forAgent),
    request: (config, step = 1, forAgent = agent) => scoped('agent/request', [{ agent: forAgent, step }], config, forAgent),
    receive: event => socket.onmessage({ data: JSON.stringify(event) }) }
}

test('actual plugin serializes A/B messages, pins routes, and resets six-message budget', async t => {
  const f = await fixture(t)
  const first = f.call('qq_bridge_simulate', { userId: '10001', text: 'A 的消息' })
  await f.waitForTurns(1)
  const second = f.call('qq_bridge_simulate', { userId: '10002', text: 'B 的消息' })
  await flush()
  assert.equal(f.turns.length, 1)
  assert.equal((await f.call('qq_bridge_send', { text: '鱼'.repeat(120) })).sent, 6)
  assert.equal((await f.call('qq_bridge_send', { text: '第七条' })).reason, 'turn-limit')
  assert.ok(f.calls.filter(c => c.action === 'send_private_msg').every(c => c.params.user_id === '10001'))
  f.end(); await first; await f.waitForTurns(2)
  assert.equal((await f.call('qq_bridge_send', { text: 'B 的回复' })).sent, 1)
  assert.equal(f.calls.at(-1).params.user_id, '10002')
  f.end(); await second
  assert.ok(f.prompts.some(p => p.includes('最多 20 字') && p.includes('最多 6 条')))
})
test('actual marker mode uses the same limits and frozen recipient', async t => {
  const f = await fixture(t, 'marker')
  const inbound = f.call('qq_bridge_simulate', { userId: '10001', text: '你好' })
  await f.waitForTurns(1)
  f.emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '[QQ]\n' + '鱼'.repeat(120) + '\n[/QQ]' }] } } })
  f.end(); await inbound
  const sends = f.calls.filter(c => c.action === 'send_private_msg')
  assert.equal(sends.length, 6)
  assert.ok(sends.every(c => [...c.params.message.at(-1).data.text].length <= 20))
})
test('non-allowlisted simulated messages cannot start a turn or send', async t => {
  const f = await fixture(t)
  const r = await f.call('qq_bridge_simulate', { userId: 'unlisted', text: 'hello' })
  assert.equal(r.decision.action, 'drop')
  assert.equal(f.turns.length, 0)
  assert.equal(f.calls.filter(c => c.action.startsWith('send_')).length, 0)
})

test('incoming OneBot video reaches analysis and reports failure in context', async t => {
  const f = await fixture(t)
  f.receive({ post_type: 'message', message_type: 'private', user_id: '10001', message_id: 'v-1', message: [{ type: 'video', data: { file: 'missing-test-video.mp4' } }] })
  await f.waitForTurns(1)
  assert.match(f.turns[0].content[0].text, /视频解析失败/)
  assert.match(f.turns[0].content[0].text, /找不到视频文件/)
  f.end()
  await flush()
})

test('Windows launcher survives plugin unload and repeated launch is guarded', async t => {
  const f = await fixture(t)
  const result = await f.call('qq_bridge_napcat', { action: 'launch' })
  assert.equal(result.mode, 'independent-launcher')
  assert.equal(f.processes.length, 1)
  assert.equal(f.processes[0].options.detached, true)
  assert.equal(f.processes[0].options.windowsHide, true)
  assert.equal(f.processes[0].unrefCalled, true)
  const again = await f.call('qq_bridge_napcat', { action: 'launch' })
  assert.ok(again.error)
  assert.equal(f.processes.length, 1)
  f.unload()
  assert.equal(f.processes[0].killed, false)
})

test('drawing tool refuses to generate-and-send without an active reply turn', async t => {
  const f = await fixture(t)
  const result = await f.call('qq_bridge_draw', { prompt: 'test', send: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /对话轮次/)
  assert.equal(f.calls.filter(c => c.action.startsWith('send_')).length, 0)
})
test('drawing HTTP route rejects a stale turn identifier before generation', async t => {
  const f = await fixture(t)
  const result = await f.http('/api/qq-bridge/draw', { prompt: 'test', send: true, turnId: 'stale' })
  assert.equal(result.ok, false)
  assert.match(result.error, /轮次已变化/)
})
test('drawing test route never targets an owner outside the allowlist', async t => {
  const f = await fixture(t)
  const result = await f.http('/api/qq-bridge/test-draw', { prompt: 'test' })
  assert.equal(result.ok, false)
  assert.match(result.error, /白名单/)
  assert.equal(f.turns.length, 0)
})

test('target assembly drops unrelated MCP schemas and retains every memory section/tool', async t => {
  const f = await fixture(t)
  const incoming = f.call('qq_bridge_simulate', { userId: '10001', text: '在吗' })
  await f.waitForTurns(1)
  const assembly = { sections: [{ name: 'meow-memory:guide', text: '完整记忆手册' }], contexts: [{ name: 'memory', text: '历史快照' }], variables: {}, tools: [
    { name: 'mcp__rea__decompile', parameters: { huge: 'x'.repeat(50000) } }, { name: 'mcp__sequential-thinking__sequentialthinking' },
    { name: 'memory_search' }, { name: 'memory_read' }, { name: 'memory_write' }, { name: 'memory_dream' }, { name: 'qq_bridge_send' }, { name: 'read' },
  ] }
  const result = await f.assembly(assembly)
  assert.equal(result.tools.length, 6)
  assert.equal(result.sections, assembly.sections)
  assert.equal(result.contexts, assembly.contexts)
  assert.equal(result.variables, assembly.variables)
  assert.deepEqual(Array.from(result.tools, t => t.name), assembly.tools.slice(2).map(t => t.name))
  assert.equal(assembly.tools.length, 8)
  assert.equal(await f.assembly(assembly, { id: 'other' }), assembly)
  f.settings.targetSessionId = 'other'
  assert.equal(await f.assembly(assembly), assembly)
  f.settings.targetSessionId = f.agent.id
  f.end(); await incoming
  f.unload()
  assert.equal(await f.assembly(assembly), assembly)
})

test('light reasoning is limited to first short-chat request; memory/tasks keep original effort', async t => {
  const f = await fixture(t)
  const config = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 256000 }
  assert.equal(await f.request(config), config)
  let incoming = f.call('qq_bridge_simulate', { userId: '10001', text: '在吗' })
  await f.waitForTurns(1)
  const light = await f.request(config)
  assert.equal(light.reasoningEffort, 'low')
  assert.equal(light.maxTokens, config.maxTokens)
  assert.equal(config.reasoningEffort, 'high')
  assert.equal(await f.request(config, 2), config)
  assert.equal(await f.request(config, 1, { id: 'other' }), config)
  f.agent.inbox = { nextStep: [{ content: [{ type: 'text', text: '[meow-memory-reflect]' }] }] }
  assert.equal(await f.request(config), config)
  f.agent.inbox = undefined
  f.end(); await incoming
  assert.equal(await f.request(config), config)
  incoming = f.call('qq_bridge_simulate', { userId: '10001', text: '你还记得我之前说的事吗' })
  await f.waitForTurns(2)
  assert.equal(await f.request(config), config)
  f.end(); await incoming
})

test('mobile owner uses existing session, retains memory tools and cannot send to QQ', async t => {
  const f = await fixture(t)
  const response = f.mobileHttp({ principal: { id: 'owner', role: 'owner', name: '爸爸' }, text: '在吗' })
  await f.waitForTurns(1)
  assert.match(f.turns[0].content[0].text, /手机 App/)
  const normalConfig={provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'high'}
  assert.equal((await f.request(normalConfig)).reasoningEffort,'off')
  const assembly = await f.assembly({ tools: [{ name: 'qq_bridge_send' }, { name: 'pwsh' }, { name: 'memory_search' }, { name: 'memory_remember' }], sections: [], contexts: [], variables: {} })
  assert.deepEqual(Array.from(assembly.tools, t => t.name), ['memory_search', 'memory_remember'])
  assert.ok(f.guards.some(g => g({ name: 'pwsh', agent: f.agent })))
  assert.ok(f.guards.every(g => !g({ name: 'memory_remember', agent: f.agent })))
  assert.equal((await f.call('qq_bridge_send', { text: '不能串到QQ' })).sent, 0)
  assert.equal((await f.call('qq_bridge_send', { text: '再次也不能' })).sent, 0)
  f.emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '在呀，本鱼陪你～' }] } } })
  f.emit({ type: 'user/message', data: { id: 'memory-task', source: { kind: 'plugin:meow-memory' }, content: [{ type: 'text', text: '[meow-memory-reflect]' }] } })
  assert.equal(await f.request(normalConfig,2),normalConfig)
  f.emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '内部记忆整理过程，不应朗读' }] } } })
  f.end()
  const r = await response
  assert.equal(r.ok, true)
  assert.equal(r.sessionId, f.agent.id)
  assert.equal(r.text, '在呀，本鱼陪你～')
  assert.equal(f.guestOptions.length, 0)
  assert.equal(f.calls.filter(c => c.action.startsWith('send_')).length, 0)
  assert.ok(f.guards.every(g => !g({ name: 'pwsh', agent: f.agent })))
})

test('mobile guests get a new workspace/session and cannot claim the owner identity', async t => {
  const f = await fixture(t)
  assert.equal((await f.http('/api/whale-mobile/chat', { text: '未认证' })).ok, false)
  const invalid = await f.mobileHttp({ principal: { id: 'owner', role: 'friend', name: '伪装' }, text: 'hello' })
  assert.equal(invalid.ok, false)
  const id = 'd880d551-dd3e-44ce-8398-36b2785cf315'
  const response = f.mobileHttp({ principal: { id, role: 'friend', name: '朋友' }, text: '你好呀' })
  await f.waitForTurns(1)
  assert.equal(f.guestOptions.length, 1)
  const options = f.guestOptions[0]
  assert.notEqual(options.sessionId, f.agent.id)
  assert.ok(options.meta.cwd.endsWith(id))
  assert.equal(options.seed, undefined)
  f.emitFor(options.sessionId, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '你好呀～' }] } } })
  f.emitFor(options.sessionId, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal((await response).text, '你好呀～')
  assert.equal(f.calls.filter(c => c.action.startsWith('send_')).length, 0)
})

test('realtime owner uses a persistent lightweight session with shared memory, true deltas and isolated maintenance', async t => {
  const f = await fixture(t)
  const original = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '[手机 App · 爸爸] 刚刚在聊海' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '本鱼想看海。' }] } } }, { type: 'turn/end' },
  ]
  f.agent.session.snapshotEvents = () => original
  const originalSnapshot = JSON.stringify(original)
  const id = '690601fa-5fd7-478d-a44e-6257bfd40766'
  const response = f.mobileHttp({ id, principal: { id: 'owner', role: 'owner', name: '爸爸' }, text: '继续聊呀', realtime: true })
  await f.waitForTurns(1)
  const options = f.guestOptions[0], video = f.guestAgents.get(options.sessionId)
  assert.notEqual(video.id, f.agent.id)
  assert.equal(options.meta.cwd, f.agent.session.header.cwd)
  assert.equal(options.seed, undefined)
  assert.equal(f.agent.status, 'idle')
  assert.equal(f.turns[0].source.kind, 'user')
  assert.ok(f.presetMounts.length)
  const assembly = await f.assembly({ tools: [{ name: 'memory_search' }, { name: 'memory_remember' }, { name: 'pwsh' }], sections: [{ name: 'meow-memory:guide', text: '记忆' }], contexts: [], variables: {} }, video)
  assert.deepEqual(Array.from(assembly.tools, t => t.name), ['memory_search', 'memory_remember'])
  assert.ok(assembly.contexts.some(c => c.name === 'whale-video-handoff' && c.text.includes('刚刚在聊海')))
  assert.ok(f.guards.some(g => g({ name: 'pwsh', agent: video })))
  assert.ok(f.guards.every(g => !g({ name: 'memory_remember', agent: video })))
  const frame = { type: 'chunk', attemptId: 'a', revision: 2, chunk: { type: 'text-delta', text: '在呀。' } }
  f.stream(f.agent, { type: 'start', attemptId: 'wrong', revision: 1 })
  f.stream(f.agent, frame)
  assert.equal((await f.mobileProgress(id)).text, '')
  f.stream(video, { type: 'start', attemptId: 'a', revision: 1, turn: 1, step: 1 })
  f.stream(video, frame)
  assert.equal((await f.mobileProgress(id)).text, '在呀。')
  f.emitFor(video.id, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '在呀。' }] } } })
  f.emitFor(video.id, { type: 'user/message', data: { id: 'm', source: { kind: 'plugin:meow-memory' }, content: [{ type: 'text', text: '[meow-memory-reflect]' }] } })
  f.stream(video, { type: 'start', attemptId: 'm', revision: 3 })
  f.stream(video, { type: 'chunk', attemptId: 'm', revision: 4, chunk: { type: 'text-delta', text: '不能朗读的记忆整理' } })
  f.emitFor(video.id, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  video.status = 'idle'
  const result = await response
  assert.equal(result.text, '在呀。')
  assert.equal(result.nativeTextDeltas, 1)
  assert.equal(JSON.stringify(original), originalSnapshot)
  assert.equal((await f.mobileProgress(id)).done, true)
  const again = f.mobileHttp({ principal: { id: 'owner', role: 'owner', name: '爸爸' }, text: '再聊', realtime: true, initiative: 'idle' })
  await f.waitForTurns(2)
  assert.equal(f.guestOptions.length, 1)
  assert.ok(['plugin', 'plugin:whale-mobile'].includes(f.turns[1].source.kind))
  f.emitFor(video.id, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好呀。' }] } } })
  f.emitFor(video.id, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal((await again).sessionId, video.id)
})

test('qq_bridge_voice lists the library and sends a clip as a OneBot record segment', async t => {
  // 素材目录独立于仓库：从环境变量注入，验证工具/出站段拼接，不依赖真实生成的音频。
  const clips = mkdtempSync(join(tmpdir(), 'whale-clips-'))
  mkdirSync(join(clips, 'cute'), { recursive: true })
  writeFileSync(join(clips, 'cute', 'laugh_1.mp3'), Buffer.alloc(2048, 7))
  writeFileSync(join(clips, 'manifest.json'), JSON.stringify({
    version: 1,
    styles: { cute: { voice: 'test-voice' } },
    clips: [{ name: 'laugh_1', label: '笑', group: 'laugh', style: 'cute', file: 'cute/laugh_1.mp3', ms: 900, bytes: 2048 }],
    groups: { laugh: ['laugh_1'] },
  }))
  const previous = process.env.QQ_BRIDGE_VOICE_DIR
  process.env.QQ_BRIDGE_VOICE_DIR = clips
  t.after(() => {
    if (previous === undefined) delete process.env.QQ_BRIDGE_VOICE_DIR
    else process.env.QQ_BRIDGE_VOICE_DIR = previous
    rmSync(clips, { recursive: true, force: true })
  })
  const f = await fixture(t)
  const listed = await f.call('qq_bridge_voice', { action: 'list' })
  assert.equal(listed.ok, true)
  assert.ok(listed.clips.some(c => c.name === 'laugh_1'))
  // 先让 QQ 消息唤醒一轮：出站工具只在 QQ 轮里直接放行。
  const inbox = f.call('qq_bridge_simulate', { userId: '10001', text: '讲个笑话' })
  await f.waitForTurns(1)
  const sent = await f.call('qq_bridge_voice', { action: 'send', name: 'laugh' })
  assert.equal(sent.sent, 1)
  assert.equal(sent.ok, true)
  const sentCall = f.calls.filter(c => c.action === 'send_private_msg').at(-1)
  assert.equal(sentCall.params.user_id, '10001')
  assert.equal(sentCall.params.message[0].type, 'record')
  assert.ok(String(sentCall.params.message[0].data.file).startsWith('base64://'))
  f.end()
  await inbox
})
