import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const backendRoot = resolve(root, 'backend')
const port = Number(process.env.AUTOFLOW_VERIFY_PORT || 3199)
const baseUrl = `http://127.0.0.1:${port}`
let output = ''

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: backendRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    JWT_SECRET: process.env.JWT_SECRET || 'autoflow-deployment-verification-secret',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.invalid',
    SMTP_USER: process.env.SMTP_USER || 'deployment-verification',
    SMTP_PASS: process.env.SMTP_PASS || 'deployment-verification',
    ENABLE_ADMIN_BOOTSTRAP: 'false',
    DB_MIGRATIONS_RUN: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production process exited early.\n${output}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
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
    throw new Error('Content-Security-Policy header is missing.')
  }
  if (frontendResponse.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error('X-Content-Type-Options: nosniff header is missing.')
  }
  const html = await frontendResponse.text()
  if (!html.includes('<div id="app"></div>')) {
    throw new Error('Packaged frontend entry was not served.')
  }

  console.log(`Deployment runtime verification passed: ${baseUrl}`)
  console.log(`Database status: ${health.database}`)
} finally {
  child.kill()
}
