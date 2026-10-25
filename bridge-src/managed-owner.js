import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { mkdirSync } from 'node:fs'
export function managedOwnerFactory({ ctx, enabled, cwd, preset, save, hold }) {
  let pending
  return async () => {
    if (!enabled || !cwd || !isAbsolute(cwd)) throw Error('请先配置主人会话')
    if (pending) return pending
    pending = (async () => {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (!selection?.provider || !selection?.model) throw Error('请先在模型设置中选择可用的对话模型')
      mkdirSync(cwd, { recursive: true })
      const sessionId = 'session-' + randomUUID()
      const handle = await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions: { ...selection }, setup: preset })
      try { await save(sessionId) } catch (error) { await handle.dispose(); throw error }
      hold(sessionId, handle)
      return handle.agent
    })()
    try { return await pending } finally { pending = undefined }
  }
}
