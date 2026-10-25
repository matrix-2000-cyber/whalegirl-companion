// qq-bridge extras：看视频（1 秒 1 帧）、联网搜索、B站评论、Qzone 发帖、主动问候、热重载。
// 独立文件，避免再被 pnpm 覆盖整份 index.js；安装时请保留本文件。
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createGreetingScheduler } from './greetings.js'

const run = promisify(execFile)
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractBvid(input) {
  const s = String(input ?? '')
  const m = s.match(/BV[0-9A-Za-z]{10}/)
  return m ? m[0] : ''
}

export function registerExtras(ctx, deps) {
  const { defineTool, sendToQQ, sendStandalone, analyzeVideo, stateDir, readSettings, handles, ensureTargetAgent, mountPreset, transport, logger, drawForQQ, drawingStatus } = deps

  function textTool(name, description, execute, parameters = {}) {
    ctx.tools.register(defineTool({
      name,
      description,
      parameters,
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
      execute,
    }))
  }

  textTool('qq_bridge_draw', '免费画图：Cloudflare Free + FLUX，默认生成并发到本轮 QQ 聊天。每天最多 10 次，失败也计数；额度耗尽就停，不切换付费服务，也不退回拼图卡片。', async (args, exec) => {
    try {
      if (args.action === 'status') return JSON.stringify(drawingStatus(), null, 2)
      return JSON.stringify(await drawForQQ({ prompt: args.prompt, noSelf: args.noSelf === true, send: args.send !== false, signal: exec?.signal }), null, 2)
    } catch { return JSON.stringify({ ok: false, error: '免费绘图不可用，请查看配置或用量记录' }) }
  }, {
    action: { type: 'string', description: 'draw（默认）或 status（检查配置和今日用量）' },
    prompt: { type: 'string', description: '要画的场景、动作、构图与风格；推荐用清楚的英文描述' },
    noSelf: { type: 'boolean', description: 'true 只画指定场景，不加入鲸鱼娘角色；默认 false' },
    send: { type: 'boolean', description: '默认 true，生成后发到本轮聊天；false 只生成保存' },
  })

  textTool('qq_bridge_web_search', '联网搜索（走宿主的 web 服务）：返回标题/链接/摘要；需要全文再用 qq_bridge_web_fetch。', async (args, exec) => {
    try {
      const web = ctx.get('web')
      if (!web) return JSON.stringify({ ok: false, error: '宿主没有 web 服务' }, null, 2)
      const query = String(args.query ?? '').trim()
      if (!query) return JSON.stringify({ ok: false, error: 'query 为空' }, null, 2)
      const maxResults = Math.max(1, Math.min(8, Number(args.maxResults ?? 5) || 5))
      const r = await web.search({ query, maxResults }, exec?.signal ?? AbortSignal.timeout(30000))
      const results = (Array.isArray(r?.sources) ? r.sources : []).slice(0, maxResults).map((s) => ({
        title: s.title ?? '',
        url: s.url ?? '',
        snippet: String(s.snippet ?? s.description ?? '').slice(0, 300),
      }))
      return JSON.stringify({ ok: true, query, results }, null, 2)
    } catch (e) {
      return JSON.stringify({ ok: false, error: e?.message ?? String(e) }, null, 2)
    }
  }, { query: { type: 'string', required: true, description: '搜索词' }, maxResults: { type: 'number', description: '1-8，默认 5' } })

  textTool('qq_bridge_web_fetch', '读一个网页正文（走宿主的 web 服务），截到 4000 字。', async (args, exec) => {
    try {
      const web = ctx.get('web')
      if (!web) return JSON.stringify({ ok: false, error: '宿主没有 web 服务' }, null, 2)
      const url = String(args.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return JSON.stringify({ ok: false, error: '只支持 http(s)' }, null, 2)
      const r = await web.fetch({ url }, exec?.signal ?? AbortSignal.timeout(30000))
      const body = r?.body
      let text = ''
      if (typeof body === 'string') text = body
      else if (body?.kind === 'html' && body.content) text = htmlToText(body.content)
      else if ((body?.kind === 'markdown' || body?.kind === 'text') && body.content) text = body.content
      else if (body && typeof body === 'object') text = body.text ?? body.markdown ?? JSON.stringify(body)
      return JSON.stringify({ ok: true, url: r?.url ?? url, statusCode: r?.statusCode ?? null, text: String(text ?? '').slice(0, 4000) }, null, 2)
    } catch (e) {
      return JSON.stringify({ ok: false, error: e?.message ?? String(e) }, null, 2)
    }
  }, { url: { type: 'string', required: true, description: 'http(s) 网页地址' } })

  textTool('qq_bridge_watch_video', '看视频：本地 path 或 http(s) 链接。最多 24 帧，每批 4 帧一次识别；本地语音转写，失败会明确提示。', async (args, exec) => {
    return JSON.stringify(await analyzeVideo({ ...args, signal: exec?.signal }), null, 2)
  }, { path: { type: 'string', description: '本地视频路径' }, url: { type: 'string', description: 'http(s) 视频地址或 B站/小红书页面' } })

  textTool('qq_bridge_bili_comment', '给 B站视频发评论（默认 dry-run，只解析 aid/标题；确认后传 dryRun:false 才真发）。', async (args) => {
    try {
      const bvid = extractBvid(args.url ?? args.bvid ?? '')
      if (!bvid) return JSON.stringify({ ok: false, error: '没识别到 BV 号' }, null, 2)
      const text = String(args.text ?? '').trim()
      if (!text) return JSON.stringify({ ok: false, error: '评论为空' }, null, 2)
      if ([...text].length > 100) return JSON.stringify({ ok: false, error: '评论超过 100 字' }, null, 2)
      const script = process.env.QQ_BRIDGE_BILI_SCRIPT; if (!script) return JSON.stringify({ok:false,error:'未配置可选B站脚本'})
      const py = process.env.QQ_BRIDGE_PYTHON || 'python'
      const argv = [script, bvid, text]
      if (args.dryRun !== false) argv.push('--dry-run')
      if (args.like === true) argv.push('--like')
      const { stdout } = await run(py, argv, { timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
      return String(stdout || '').trim() || JSON.stringify({ ok: true })
    } catch (e) {
      return JSON.stringify({ ok: false, error: e?.message ?? String(e) }, null, 2)
    }
  }, {
    bvid: { type: 'string', description: 'BV 号' },
    url: { type: 'string', description: '含 BV 的链接（可选）' },
    text: { type: 'string', required: true, description: '评论内容，≤100 字' },
    dryRun: { type: 'boolean', description: '默认 true；false 才真发' },
    like: { type: 'boolean', description: '顺便点赞' },
  })

  textTool('qq_bridge_qzone', '发一条 QQ 空间说说（好友可见）；content 必填，图片可选（base64/http/file）。', async (args) => {
    try {
      const content = String(args.content ?? '').trim()
      if (!content) return JSON.stringify({ ok: false, error: '内容为空' }, null, 2)
      const r = await transport.call('send_qzone_msg', {
        content,
        ...(args.images ? { images: args.images } : {}),
        ugc_right: Number(args.ugcRight ?? 4),
      })
      return JSON.stringify({ ok: true, result: r }, null, 2)
    } catch (e) {
      return JSON.stringify({ ok: false, error: e?.message ?? String(e) }, null, 2)
    }
  }, { content: { type: 'string', required: true, description: '说说正文' }, images: { type: 'array', description: '图片列表（base64://、http、file）' }, ugcRight: { type: 'number', description: '1 所有人 / 4 好友 / 64 仅自己，默认 4' } })

  async function reloadAgent() {
    try {
      const id = readSettings().targetSessionId
      if (!id) return JSON.stringify({ ok: false, error: '没有 targetSessionId' }, null, 2)
      const live = ctx.agents.get(id)
      if (live) {
        await mountPreset(live.ctx)
        return JSON.stringify({ ok: true, sessionId: id, reloaded: false, mounted: true }, null, 2)
      }
      const a = await ensureTargetAgent()
      return JSON.stringify({ ok: true, sessionId: id, reloaded: false, status: a?.status ?? 'unknown' }, null, 2)
    } catch (e) {
      return JSON.stringify({ ok: false, error: e?.message ?? String(e) }, null, 2)
    }
  }
  textTool('qq_bridge_reload_agent', '重挂目标会话 preset，保留历史，让新提示与工具生效。', reloadAgent, {})

  const scheduler = createGreetingScheduler({ path: join(stateDir, 'qq-bridge-greetings.json'), send: sendStandalone, logger })
  textTool('qq_bridge_greeting', '主动问候/搭话：status 看配置与记录；set 改时间、开关和空闲搭话参数；test 立即发送（target=owner/woo 发文案，target=idle 立刻测试一句主动搭话）。可用 idle* 参数控制“安静久了主动问一句”。', async (args) => {
    const action = String(args.action ?? 'test')
    if (action === 'status') return JSON.stringify(scheduler.status(), null, 2)
    if (action === 'set') return JSON.stringify(scheduler.set(args), null, 2)
    if (action !== 'test') return JSON.stringify({ ok: false, error: 'action 必须是 status/set/test' })
    const who = String(args.target ?? 'owner')
    if (who === 'idle') {
      if (typeof scheduler.forceIdle !== 'function') return JSON.stringify({ ok: false, error: '当前调度器不支持空闲搭话测试' })
      return JSON.stringify(await scheduler.forceIdle({}), null, 2)
    }
    if (!['owner', 'woo'].includes(who)) return JSON.stringify({ ok: false, error: 'target 必须是 owner/woo/idle' })
    const config = scheduler.status().config
    return JSON.stringify(await sendToQQ(String(args.text ?? config[who + 'Text']).trim(), { kind: 'private', userId: config[who + 'Id'] }), null, 2)
  }, {
    action: { type: 'string', description: 'status/set/test' }, target: { type: 'string', description: 'owner/woo/idle' },
    text: { type: 'string', description: '测试文本；target=idle 时作为指定话题' }, enabled: { type: 'boolean', description: '启用定时问候' },
    times: { type: 'string', description: '爸爸问候时间，逗号分隔 HH:mm' }, wooTimes: { type: 'string', description: '闺蜜问候时间' },
    ownerId: { type: 'string', description: '爸爸 QQ 号' }, wooId: { type: 'string', description: '闺蜜 QQ 号' },
    ownerText: { type: 'string', description: '爸爸问候文案' }, wooText: { type: 'string', description: '闺蜜问候文案' },
    idleEnabled: { type: 'boolean', description: '启用“安静久了主动搭话”' },
    idleSilentMinutes: { type: 'number', description: '爸爸安静多少分钟后主动搭话（60–720）' },
    idleGapMinutes: { type: 'number', description: '两次主动搭话最小间隔分钟（60–720）' },
    idleMaxPerDay: { type: 'number', description: '每天最多主动搭话次数（1–4）' },
    activeFrom: { type: 'string', description: '可搭话时段开始 HH:mm' },
    activeTo: { type: 'string', description: '可搭话时段结束 HH:mm' },
  })
  const timer = setInterval(() => { void scheduler.tick() }, 30_000)
  ctx.effect?.(() => () => clearInterval(timer))
  return { scheduler, reloadAgent }
}
