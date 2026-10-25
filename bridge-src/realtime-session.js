// A small conversational handoff, never a replacement for the shared memory DB.
export function recentMobileContext(session, { maxMessages = 6, maxChars = 3000 } = {}) {
  const recent = []
  let mobile = false
  for (const event of (session?.snapshotEvents?.() ?? []).slice(-1000)) {
    if (event.type === 'user/message') {
      const message = event.data?.message ?? event.data
      const text = (message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
      mobile = /^\[手机 App · [^\n]+?\]/.test(text) && !/主动陪聊|\[meow-memory-/.test(text)
      if (mobile) recent.push({ role: 'user', text: text.split('\n[用户本次主动分享的摄像头画面]')[0].slice(0, 600) })
    } else if (event.type === 'assistant/message' && mobile) {
      const text = (event.data?.message?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
      if (text) recent.push({ role: 'assistant', text: text.slice(0, 600) })
    } else if (event.type === 'turn/end') mobile = false
  }
  const tail = recent.slice(-maxMessages)
  while (tail.length && JSON.stringify(tail).length > maxChars) tail.shift()
  return tail.length ? JSON.stringify(tail) : ''
}

// Observe the host's documented transient stream; do not wrap its LLM service.
// The durable final message is authoritative, and replaces the attempt preview.
export function createAssistantProgress(receipt) {
  let committed = '', attempt = null, deltas = 0
  function publish(value) {
    if (!receipt || receipt.text === value) return
    receipt.text = value
    receipt.revision++
    if (value.trim()) receipt.firstTextMs ??= Date.now() - receipt.created
  }
  return {
    frame(frame) {
      if (frame.type === 'start') attempt = { id: frame.attemptId, text: '', base: committed, revision: frame.revision }
      else if (attempt && frame.attemptId === attempt.id && frame.revision > attempt.revision) {
        attempt.revision = frame.revision
        if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') {
          attempt.text += frame.chunk.text ?? ''
          deltas++
          publish([attempt.base, attempt.text.trimStart()].filter(Boolean).join('\n'))
        } else if (frame.type === 'end') {
          // A retry cannot append a failed prefix to the next answer. The client
          // stops old speech if an already-spoken prefix is revised.
          if (frame.outcome?.eventType !== 'assistant/message') publish(committed)
          attempt = null
        }
      }
    },
    commit(text) { committed = text; publish(text) },
    get deltas() { return deltas },
  }
}
