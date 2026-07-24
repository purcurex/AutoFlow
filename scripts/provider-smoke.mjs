import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const backendDir = join(root, 'backend')
const config = {
  ...readEnv(join(backendDir, '.env')),
  ...readEnv(join(backendDir, '.env.providers.local')),
  ...process.env,
}

function readEnv(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
}

function required(name) {
  const value = config[name]?.trim()
  if (!value) throw new Error(`${name} is not configured in backend/.env.providers.local`)
  return value
}

function baseUrl(name, fallback) {
  return (config[name]?.trim() || fallback).replace(/\/$/, '')
}

async function requestJson(url, init, timeoutMs) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (response.ok) return response.json()

    const detail = await safeErrorDetail(response)
    if (response.status !== 429 || attempt === 3) {
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}${detail ? ` (${detail})` : ''}`)
    }
    const retryAfterSeconds = Number(response.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 10000)
      : attempt * 2000
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  throw new Error(`Request retries exhausted for ${new URL(url).hostname}`)
}

async function safeErrorDetail(response) {
  try {
    const body = await response.json()
    const code = body?.error?.code ?? body?.code
    const message = body?.error?.message ?? body?.message
    return [code, message].filter(Boolean).join(': ').slice(0, 240)
  } catch {
    return ''
  }
}

async function checkZhipu() {
  const model = config.ZHIPU_MODEL?.trim() || 'glm-5.2'
  const data = await requestJson(
    `${baseUrl('ZHIPU_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${required('ZHIPU_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        thinking: { type: 'disabled' },
        max_tokens: 16,
        temperature: 0,
      }),
    },
    Number(config.ZHIPU_REQUEST_TIMEOUT_MS || 30000),
  )
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('Zhipu returned no message content')
  return { provider: 'zhipu', model: data.model || model, requestId: data.request_id || data.id || 'not-returned' }
}

async function checkPipiAds() {
  const data = await requestJson(
    `${baseUrl('PIPIADS_BASE_URL', 'https://www.pipispy.com/open-api/v1')}/data`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: required('PIPIADS_API_KEY'),
        uri: '/v3/api/open/adspy/list',
        params: {
          current_page: 1,
          page_size: 1,
          extend_keywords: [{ type: 1, keyword: config.PIPIADS_SMOKE_KEYWORD || 'pet grooming brush' }],
          data_type: [1, 3],
          shop_type: ['shopify'],
          is_url: 1,
          ad_state: 1,
          sort: 1,
          sort_type: 'desc',
        },
      }),
    },
    Number(config.PIPIADS_REQUEST_TIMEOUT_MS || 30000),
  )
  if (data.code !== 200 || data.fail === true || data.success === false || !Array.isArray(data.data?.data)) {
    const message = typeof data.message === 'string' ? `: ${data.message.slice(0, 200)}` : ''
    throw new Error(`PipiAds rejected the smoke request with code ${data.code ?? 'unknown'}${message}`)
  }
  return {
    provider: 'pipiads',
    records: data.data.data.length,
    remainingCredits: data.remaining_credits ?? 'not-returned',
  }
}

async function checkSerpApi() {
  const params = new URLSearchParams({
    engine: 'google_lens',
    type: 'visual_matches',
    url: config.SERPAPI_SMOKE_IMAGE_URL || 'https://i.imgur.com/HBrB8p0.png',
    api_key: required('SERPAPI_KEY'),
    hl: 'en',
    safe: 'active',
  })
  const data = await requestJson(
    `https://serpapi.com/search.json?${params.toString()}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    30000,
  )
  if (data.error) throw new Error(`SerpApi Google Lens rejected the request: ${String(data.error).slice(0, 200)}`)
  return {
    provider: 'serpapi',
    engine: 'google_lens',
    searchStatus: data.search_metadata?.status || 'not-returned',
    visualMatches: Array.isArray(data.visual_matches) ? data.visual_matches.length : 0,
  }
}

const providerArgument = process.argv.find((value) => value.startsWith('--provider='))?.split('=')[1]
const availableChecks = {
  zhipu: checkZhipu,
  pipiads: checkPipiAds,
  serpapi: checkSerpApi,
}
if (providerArgument && !(providerArgument in availableChecks)) {
  throw new Error('Provider must be zhipu, pipiads, or serpapi')
}
const providerNames = providerArgument ? [providerArgument] : Object.keys(availableChecks)
const checks = await Promise.allSettled(providerNames.map((name) => availableChecks[name]()))
const providers = checks.map((result, index) => result.status === 'fulfilled'
  ? { status: 'ok', ...result.value }
  : { status: 'failed', provider: providerNames[index], reason: result.reason instanceof Error ? result.reason.message : 'unknown error' })

console.log(JSON.stringify({ status: providers.every((item) => item.status === 'ok') ? 'ok' : 'failed', providers }, null, 2))
if (providers.some((item) => item.status === 'failed')) {
  process.exitCode = 1
}
