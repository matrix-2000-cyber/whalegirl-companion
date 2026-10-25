// Presentation-only savings. Never edit history, memory sections or memory tools.
export function compactChatTools(assembly) {
  const tools = assembly.tools.filter(tool => !tool.name.startsWith('mcp__rea__') && !tool.name.startsWith('mcp__sequential-thinking__'))
  const sections = assembly.sections?.filter(section => section.name !== 'mcp:rea' && section.name !== 'mcp:sequential-thinking')
  const sectionsChanged = sections && sections.length !== assembly.sections.length
  return tools.length === assembly.tools.length && !sectionsChanged ? assembly : { ...assembly, tools, ...(sectionsChanged ? { sections } : {}) }
}

export function restoreResumeReasoning(config, baseline, sessionId) {
  return ['low','off'].includes(config.reasoningEffort) && baseline?.sessionId === sessionId &&
    baseline.provider === config.provider && baseline.model === config.model && ['low','medium','high','max'].includes(baseline.reasoningEffort) && baseline.reasoningEffort!==config.reasoningEffort
    ? { ...config, reasoningEffort: baseline.reasoningEffort } : config
}

export function mobileChatRequestConfig(config,{record,agent}){
  if(!record?.fastChat||record.maintenance||config.provider!=='deepseek-official'||config.model!=='deepseek-flash')return config
  const pending=[...(agent?.inbox?.nextStep??[]),...(agent?.inbox?.nextTurn??[])]
  if(pending.some(m=>/meow-memory|dream|reflect/i.test(JSON.stringify(m))))return config
  return config.reasoningEffort==='off'?config:{...config,reasoningEffort:'off'}
}

export function isLightChat(message) {
  const text = String(message?.text ?? '').trim()
  return text.length > 0 && [...text].length <= 80 &&
    !message.images?.length && !message.videos?.length &&
    !/https?:|\[图片|\[视频|记住|记得|记忆|回忆|以前|之前|上次|还记|整理|总结|分析|解释|为什么|怎么办|计划|代码|程序|计算|证明|搜索|查一下|查查|画|截图|提醒|定时|设置|帮我|操作|转账|评论|空间|梦境|dream|reflect/i.test(text)
}

export function chatRequestConfig(config, { fromQQ, lightChat, step, agent }) {
  // Only the first request of a short QQ chat. Tool/memory continuations and
  // independent reflection/dream turns retain the resolved model and effort.
  if (!fromQQ || !lightChat || step !== 1 || config.provider !== 'deepseek-official' || config.model !== 'deepseek-flash') return config
  if (!['high', 'max'].includes(config.reasoningEffort)) return config
  const pending = [...(agent?.inbox?.nextStep ?? []), ...(agent?.inbox?.nextTurn ?? [])]
  if (pending.some(m => /meow-memory|dream|reflect/i.test(JSON.stringify(m)))) return config
  return { ...config, reasoningEffort: 'low' }
}
