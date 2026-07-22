import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const backendDir = join(root, 'backend')
const port = Number(process.env.PRODUCTION_SMOKE_PORT || 3199)
const baseUrl = `http://127.0.0.1:${port}`
let output = ''

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendDir,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.invalid',
    SMTP_USER: process.env.SMTP_USER || 'smoke-test',
    SMTP_PASS: process.env.SMTP_PASS || 'smoke-test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited early.\n${output}`)
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Timed out waiting for ${url}.\n${output}`)
}

try {
  const healthResponse = await waitFor(`${baseUrl}/api/health`)
  const health = await healthResponse.json()
  if (health.status !== 'ok' || health.database !== 'up') {
    throw new Error(`Unexpected health response: ${JSON.stringify(health)}`)
  }

  const frontendResponse = await waitFor(baseUrl)
  if (!frontendResponse.headers.get('content-security-policy')) {
    throw new Error('Production response is missing Content-Security-Policy.')
  }
  if (frontendResponse.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error('Production response is missing X-Content-Type-Options: nosniff.')
  }
  const html = await frontendResponse.text()
  if (!html.includes('<div id="app"></div>')) {
    throw new Error('Packaged frontend entry was not served by the production backend.')
  }

  console.log(`Production smoke passed at ${baseUrl}`)
} finally {
  child.kill()
}
