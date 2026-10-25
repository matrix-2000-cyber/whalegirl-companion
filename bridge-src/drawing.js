import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DRAW_MODEL = '@cf/black-forest-labs/flux-1-schnell'
export const DRAW_DAILY_LIMIT = 10

export function drawingConfig(envFile = process.env.QQ_BRIDGE_ENV_FILE || join(process.env.WHALEGIRL_ROOT || process.cwd(), '.env.local')) {
  const values = {}
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(CLOUDFLARE_[A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  const get = key => process.env[key] || values[key] || ''
  return { accountId: get('CLOUDFLARE_ACCOUNT_ID'), token: get('CLOUDFLARE_API_TOKEN'), freePlanConfirmed: get('CLOUDFLARE_FREE_PLAN_CONFIRMED') === '1' }
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

export function createCloudflareDrawer({ stateDir, outputDir, getConfig = drawingConfig, request = fetch, now = () => new Date() }) {
  const ledgerPath = join(stateDir, 'qq-bridge-draw-usage.json')
  let serial = Promise.resolve()
  function load() {
    if (!existsSync(ledgerPath)) return { day: '', attempts: 0 }
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    if (typeof ledger.day !== 'string' || !Number.isInteger(ledger.attempts) || ledger.attempts < 0) throw new Error('绘图用量记录损坏，已停止调用')
    return ledger
  }
  function status() {
    const config = getConfig()
    let ledger
    try { ledger = load() }
    catch { return { provider: 'Cloudflare Workers AI', model: DRAW_MODEL, configured: !!(config.accountId && config.token), blocked: true, error: '绘图用量记录损坏，已停止调用' } }
    const day = now().toISOString().slice(0, 10) // Match Cloudflare's 00:00 UTC reset.
    return { provider: 'Cloudflare Workers AI', model: DRAW_MODEL, configured: !!(config.accountId && config.token), freePlanConfirmed: config.freePlanConfirmed, dailyLimit: DRAW_DAILY_LIMIT, used: ledger.day === day ? ledger.attempts : 0, resetTimezone: 'UTC' }
  }
  async function generate(args = {}) {
    const config = getConfig()
    if (!config.accountId || !config.token) return { ok: false, reason: 'not-configured', error: '尚未配置 Cloudflare 绘图授权' }
    if (!/^[a-f\d]{32}$/i.test(config.accountId)) return { ok: false, reason: 'invalid-account', error: 'Cloudflare 账户编号格式无效' }
    if (!config.freePlanConfirmed) return { ok: false, reason: 'free-plan-unconfirmed', error: '尚未确认 Workers Free 计划，未调用生图' }
    const prompt = String(args.prompt ?? '').trim()
    if (!prompt || prompt.length > 1400) return { ok: false, reason: 'invalid-prompt', error: '画面描述须为 1-1400 字符' }
    const style = args.noSelf === true
      ? 'Polished illustration, coherent composition, rich details, appealing colors. '
      : 'Polished anime illustration of Whale Girl: blue hair, whale-fin shaped ears, a blue whale tail, navy dress with white apron, expressive eyes, gentle playful personality. Keep this character design consistent. '
    const fullPrompt = style + prompt + ' No watermark, no UI panels, no card border. Do not add text unless explicitly requested.'
    const day = now().toISOString().slice(0, 10)
    let ledger = load()
    if (ledger.day !== day) ledger = { day, attempts: 0 }
    if (ledger.attempts >= DRAW_DAILY_LIMIT) return { ok: false, reason: 'daily-limit', error: '今天的 10 次绘图额度已用完，明天再画' }
    // Persist before network I/O; failures and timeouts also count. Never retry automatically.
    ledger.attempts++
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(ledgerPath + '.tmp', JSON.stringify(ledger))
    renameSync(ledgerPath + '.tmp', ledgerPath)
    try {
      const signal = AbortSignal.any([...(args.signal ? [args.signal] : []), AbortSignal.timeout(120000)])
      const response = await request(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${DRAW_MODEL}`, {
        method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, steps: 4 }), signal, redirect: 'error',
      })
      const data = await response.json()
      if (!response.ok || data.success === false) {
        const codes = (data.errors ?? []).map(e => e.code).join(',')
        return { ok: false, reason: response.status === 429 ? 'quota-or-rate-limit' : 'provider-error', error: `Cloudflare 生图失败（HTTP ${response.status}${codes ? '，代码 ' + codes : ''}）`, used: ledger.attempts }
      }
      const encoded = data.result?.image
      if (typeof encoded !== 'string' || encoded.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('模型未返回有效图片')
      const bytes = Buffer.from(encoded, 'base64')
      const ext = imageType(bytes)
      if (!ext || bytes.length > 10 * 1024 * 1024) throw new Error('返回内容不是有效图片或超过 10MB')
      mkdirSync(outputDir, { recursive: true })
      const path = join(outputDir, `flux-${now().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}.${ext}`)
      writeFileSync(path, bytes, { flag: 'wx' })
      return { ok: true, provider: 'cloudflare', model: DRAW_MODEL, path, bytes: bytes.length, used: ledger.attempts, remaining: DRAW_DAILY_LIMIT - ledger.attempts }
    } catch (error) {
      // No provider response text or credentials in diagnostics.
      return { ok: false, reason: 'generation-failed', error: error.name === 'TimeoutError' ? '绘图超时，本次仍计入额度' : '绘图连接或图片校验失败，本次仍计入额度', used: ledger.attempts }
    }
  }
  return {
    status,
    draw(args) {
      const job = serial.then(() => generate(args))
      serial = job.catch(() => {})
      return job
    },
  }
}
