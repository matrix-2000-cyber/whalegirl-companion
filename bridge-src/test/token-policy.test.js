import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compactChatTools, isLightChat, chatRequestConfig, restoreResumeReasoning } from '../token-policy.js'

test('light chat excludes recall, tasks, links and media; respects lower existing effort', () => {
  for (const message of [
    { text: '记住我爱吃米饭' }, { text: '上次的那个问题' }, { text: '画一张海边图' }, { text: '为什么会这样' },
    { text: 'https://example.com' }, { text: '看看', images: [{}] }, { text: '看看', videos: [{}] }, { text: '鱼'.repeat(81) },
  ]) assert.equal(isLightChat(message), false)
  const config = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' }
  assert.equal(chatRequestConfig(config, { fromQQ: true, lightChat: true, step: 1 }), config)
  const other = { ...config, provider: 'other', reasoningEffort: 'max' }
  assert.equal(chatRequestConfig(other, { fromQQ: true, lightChat: true, step: 1 }), other)
})

test('resuming after an interrupted light chat restores original effort, without crossing routes/sessions', () => {
  const config = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' }
  const baseline = { ...config, sessionId: 'qq', reasoningEffort: 'high' }
  assert.equal(restoreResumeReasoning(config, baseline, 'qq').reasoningEffort, 'high')
  assert.equal(restoreResumeReasoning(config, baseline, 'other'), config)
  assert.equal(restoreResumeReasoning(config, { ...baseline, model: 'other' }, 'qq'), config)
  const max = { ...config, reasoningEffort: 'max' }
  assert.equal(restoreResumeReasoning(max, baseline, 'qq'), max)
})

test('installed DeepSeek addition-only projection removes historical REA declarations', async () => {
  const require = createRequire(process.env.DSH_PACKAGE_JSON || join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh/package.json'))
  const api = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
  assert.equal(typeof api.projectToolUpdates, 'function')
  const oldTools = [{ name: 'mcp__rea__decompile', description: 'x'.repeat(100000), parameters: { type: 'object', properties: {} } },
    { name: 'memory_search', description: '记忆检索', parameters: { type: 'object', properties: {} } }]
  const { tools } = compactChatTools({ tools: oldTools })
  const result = api.projectToolUpdates([], tools, 'addition-only', { tools: oldTools, updates: [] })
  assert.deepEqual(result.tools.map(t => t.name), ['memory_search'])
})
