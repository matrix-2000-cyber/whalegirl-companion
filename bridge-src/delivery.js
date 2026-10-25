// All QQ replies in a turn share a frozen route and one six-message budget.
import { randomUUID } from 'node:crypto'
export const MESSAGE_CHARS = 20
export const TURN_MESSAGES = 6

export function splitReply(text) {
  const chars = [...String(text ?? '').trim()]
  const parts = []
  while (chars.length) {
    const end = Math.min(MESSAGE_CHARS, chars.length)
    const part = chars.splice(0, end).join('').trim()
    if (part) parts.push(part)
  }
  return parts
}

export function destinationOf(msg) {
  return msg?.groupId ? { kind: 'group', groupId: String(msg.groupId) }
    : msg?.userId ? { kind: 'private', userId: String(msg.userId) } : null
}

export function sameDestination(a, b) {
  return !!a && !!b && a.kind === b.kind && String(a.groupId ?? a.userId) === String(b.groupId ?? b.userId)
}

export function createReplyDelivery({ transport, stripText = String, quote = () => false, pause = () => Promise.resolve() }) {
  let active = null
  let serial = Promise.resolve()
  let disposed = false
  function begin(destination, messageId = null) {
    if (disposed) throw new Error('QQ delivery disposed')
    if (active) throw new Error('Previous QQ reply is still active')
    let resolve
    const done = new Promise(r => { resolve = r })
    active = { id: randomUUID(), destination: destination ? Object.freeze({ ...destination }) : null, messageId, used: 0, done, resolve, closed: false }
    return active
  }
  function finish(lease = active) {
    if (!lease) return Promise.resolve()
    lease.closing = true
    return serial.finally(() => {
      lease.closed = true
      if (active === lease) active = null
      lease.resolve()
    })
  }
  function send(parts, destination, lease = active) {
    const admitted = !lease?.closing
    const run = async () => {
      const dest = destination ?? lease?.destination
      const drop = reason => ({ sent: 0, dropped: true, reason, remaining: Math.max(0, TURN_MESSAGES - (lease?.used ?? 0)) })
      if (!admitted || disposed || !lease || lease !== active || lease.closed) return drop('no-active-turn')
      if (!dest?.kind) return drop('no-destination')
      if (lease.destination && !sameDestination(dest, lease.destination)) return drop('wrong-destination')
      if (!transport.isOpen()) return drop('not-connected')
      if (!parts.length) return drop('empty')
      if (parts.some(segments => [...segments.filter(s => s.type === 'text').map(s => String(s.data?.text ?? '')).join('')].length > MESSAGE_CHARS)) return drop('text-too-long')
      // Reject the entire call if it cannot fit. Never silently truncate text.
      if (lease.used + parts.length > TURN_MESSAGES) return { ...drop('turn-limit'), requested: parts.length, limit: TURN_MESSAGES }
      let sent = 0
      const sentTexts = []
      for (const segments of parts) {
        if (disposed) return { sent, dropped: true, reason: 'disposed', destination: dest }
        // Reserve before I/O: an ambiguous timeout must not allow a seventh send.
        lease.used++
        const message = [...segments]
        if (quote() && lease.used === 1 && lease.messageId && sameDestination(dest, lease.destination)) {
          message.unshift({ type: 'reply', data: { id: String(lease.messageId) } })
        }
        try {
          await transport.call(dest.kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
            ...(dest.kind === 'group' ? { group_id: dest.groupId } : { user_id: dest.userId }), message,
          })
        } catch (error) {
          return { sent, sentText: sentTexts.join(''), dropped: true, reason: 'send-failed', error: error?.message ?? String(error), destination: dest, remaining: TURN_MESSAGES - lease.used }
        }
        sent++
        sentTexts.push(segments.filter(s => s.type === 'text').map(s => s.data.text).join(''))
        if (sent < parts.length) await pause()
      }
      return { sent, sentText: sentTexts.join(''), dropped: false, destination: dest, chunks: parts.length, remaining: TURN_MESSAGES - lease.used }
    }
    const result = serial.then(run)
    serial = result.catch(() => {})
    return result
  }
  return {
    begin, finish, current: () => active,
    sendText: (text, dest) => send(splitReply(stripText(text)).map(text => [{ type: 'text', data: { text } }]), dest),
    sendSegments: (segments, dest) => send([segments], dest),
    dispose() { disposed = true; if (active) { active.closed = true; active.resolve(); active = null } },
  }
}
