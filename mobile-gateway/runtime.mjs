import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
export function servicePort(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  if (!/^\d+$/.test(raw) || +raw < 1024 || +raw > 65535) throw Error('Invalid local service port')
  return +raw
}
export const dshOrigin = () => 'http://127.0.0.1:' + servicePort('WHALEGIRL_DSH_PORT', 3080)
export const gatewayPort = () => servicePort('WHALEGIRL_GATEWAY_PORT', 3091)
export const gatewayRoot = () => resolve(process.env.WHALEGIRL_STATE_ROOT || '.mobile-gateway')
export const bridgeKeyPath = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'whale-mobile/internal-key.json')
