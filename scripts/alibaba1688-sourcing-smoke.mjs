let baseUrl
let authToken
let pageSize
let timeoutMs

/**
 * 对一个已归属当前登录用户的工作流执行真实寻源冒烟验证。
 * 仅输出搜索标识、分页和数量，不输出商品内容、凭据或供应商原始报文。
 */
async function verifyWorkflow({ mode, workflowId }) {
  const started = await requestJson(
    `/autoflow/workflows/${encodeURIComponent(workflowId)}/sourcing/search`,
    {
      method: 'POST',
      body: JSON.stringify({ force: true, pageSize }),
    },
  )
  assertSearchStart(started)

  const firstPage = await waitForPage(workflowId, started.searchId, 1, pageSize)
  const firstPageIds = offerIds(firstPage)
  if (firstPageIds.length === 0) {
    throw new Error(`${mode} page 1 succeeded without any sourcing offers`)
  }
  if ((firstPage.pagination?.totalPages || 0) < 2) {
    throw new Error(`${mode} search must return at least 2 pages for pagination verification`)
  }
  await requestJson(
    `/autoflow/workflows/${encodeURIComponent(workflowId)}`
      + `/sourcing/searches/${encodeURIComponent(started.searchId)}/pages/2`,
    { method: 'POST' },
  )
  const secondPage = await waitForPage(workflowId, started.searchId, 2, pageSize)
  const secondPageCount = offerIds(secondPage).length

  const firstPageAgain = await getPage(workflowId, started.searchId, 1, pageSize)
  if (JSON.stringify(firstPageIds) !== JSON.stringify(offerIds(firstPageAgain))) {
    throw new Error(`${mode} page 1 result identifiers changed after loading another page`)
  }

  return {
    mode,
    status: 'PASS',
    searchId: started.searchId,
    totalRecords: firstPage.pagination?.totalRecords ?? null,
    totalPages: firstPage.pagination?.totalPages ?? null,
    firstPageCount: firstPageIds.length,
    secondPageCount,
  }
}

/** 轮询数据库分页状态；HTTP 请求本身不会长时间占用后端连接。 */
async function waitForPage(workflowId, searchId, page, requestedPageSize) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const summary = await getPage(workflowId, searchId, page, requestedPageSize)
    const pageStatus = summary.pagination?.status
    if (pageStatus === 'succeeded') return summary
    if (pageStatus === 'failed') {
      const code = sanitize(summary.pagination?.errorCode || 'UNKNOWN')
      const message = sanitize(summary.pagination?.errorMessage || 'Sourcing page failed')
      throw new Error(`page ${page} failed (${code}: ${message})`)
    }
    await delay(1500)
  }
  throw new Error(`page ${page} did not finish within ${timeoutMs} ms`)
}

function getPage(workflowId, searchId, page, requestedPageSize) {
  const params = new URLSearchParams({
    searchId,
    page: String(page),
    pageSize: String(requestedPageSize),
  })
  return requestJson(
    `/autoflow/workflows/${encodeURIComponent(workflowId)}/sourcing?${params.toString()}`,
    { method: 'GET' },
  )
}

/**
 * 统一发送带 JWT 的 JSON 请求，并在错误输出前进行凭据脱敏。
 * 每个请求设置独立超时，避免冒烟任务无限占用。
 */
async function requestJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(Math.min(timeoutMs, 30000)),
  })
  const body = await safeJson(response)
  if (!response.ok) {
    const code = sanitize(body?.code || body?.error?.code || `HTTP_${response.status}`)
    const message = sanitize(body?.message || body?.error?.message || response.statusText)
    throw new Error(`${code}: ${message}`)
  }
  return body
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function assertSearchStart(value) {
  if (!value || typeof value.searchId !== 'string' || !value.searchId) {
    throw new Error('Sourcing start response did not contain searchId')
  }
  if (value.pageSize !== pageSize) {
    throw new Error(`Sourcing start returned unexpected pageSize ${String(value.pageSize)}`)
  }
}

function offerIds(summary) {
  const items = Array.isArray(summary?.items)
    ? summary.items
    : Array.isArray(summary?.offers) ? summary.offers : []
  return items.map((item) => String(item.id || item.providerOfferId || ''))
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the live 1688 smoke test`)
  return value
}

function normalizeBaseUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('AUTOFLOW_BASE_URL must be an HTTP(S) URL without embedded credentials')
  }
  if (url.pathname === '/') url.pathname = '/api'
  return url.toString().replace(/\/$/, '')
}

function readPageSize(value) {
  const parsed = Number(value)
  if (![10, 20, 50].includes(parsed)) {
    throw new Error('ALIBABA_1688_SMOKE_PAGE_SIZE must be 10, 20, or 50')
  }
  return parsed
}

function readPositiveInteger(name, value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function sanitize(value) {
  return String(Array.isArray(value) ? value.join('; ') : value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(access[_-]?token|app[_-]?secret|app[_-]?key|signature)\b\s*[:=]\s*[^\s,;&]+/gi, '$1=[REDACTED]')
    .slice(0, 240)
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function main() {
  baseUrl = normalizeBaseUrl(process.env.AUTOFLOW_BASE_URL || 'http://localhost:3000/api')
  authToken = required('AUTOFLOW_AUTH_TOKEN')
  pageSize = readPageSize(process.env.ALIBABA_1688_SMOKE_PAGE_SIZE || '20')
  timeoutMs = readPositiveInteger(
    'ALIBABA_1688_SMOKE_TIMEOUT_MS',
    process.env.ALIBABA_1688_SMOKE_TIMEOUT_MS || '120000',
  )
  const workflows = [
    { mode: 'keyword', workflowId: required('AUTOFLOW_KEYWORD_WORKFLOW_ID') },
    { mode: 'image', workflowId: required('AUTOFLOW_IMAGE_WORKFLOW_ID') },
  ]
  const results = []
  for (const workflow of workflows) {
    results.push(await verifyWorkflow(workflow))
  }
  console.log(JSON.stringify({ status: 'PASS', provider: 'alibaba_1688', results }, null, 2))
}

try {
  await main()
} catch (error) {
  console.error(JSON.stringify({
    status: 'failed',
    provider: 'alibaba_1688',
    reason: sanitize(error instanceof Error ? error.message : 'Unknown smoke test error'),
  }, null, 2))
  process.exitCode = 1
}
