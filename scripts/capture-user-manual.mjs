import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const baseUrl = process.env.AUTOFLOW_MANUAL_URL || 'http://127.0.0.1:5173'
const email = process.env.AUTOFLOW_MANUAL_EMAIL
const password = process.env.AUTOFLOW_MANUAL_PASSWORD
const outputDir = join(process.cwd(), 'docs', 'assets', 'user-manual')
const debugPort = 9333

if (!email || !password) throw new Error('AUTOFLOW_MANUAL_EMAIL and AUTOFLOW_MANUAL_PASSWORD are required')
mkdirSync(outputDir, { recursive: true })

const profileDir = mkdtempSync(join(tmpdir(), 'autoflow-manual-'))
const browser = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-features=TranslateUI',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' })

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.waiters = new Map()
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      const waiters = this.waiters.get(message.method) || []
      this.waiters.delete(message.method)
      waiters.forEach((resolve) => resolve(message.params))
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitFor(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs)
      const wrapped = (params) => {
        clearTimeout(timeout)
        resolve(params)
      }
      this.waiters.set(method, [...(this.waiters.get(method) || []), wrapped])
    })
  }

  close() {
    this.socket.close()
  }
}

async function debuggerReady() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (response.ok) return
    } catch {
      // Edge is still starting.
    }
    await delay(200)
  }
  throw new Error('Edge remote debugger did not start')
}

async function navigate(client, path) {
  const loaded = client.waitFor('Page.loadEventFired')
  await client.send('Page.navigate', { url: `${baseUrl}${path}` })
  await loaded
  await delay(1300)
}

async function screenshot(client, name) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  writeFileSync(join(outputDir, name), Buffer.from(result.data, 'base64'))
}

let client
try {
  await debuggerReady()
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${baseUrl}/login`)}`, {
    method: 'PUT',
  })
  const target = await targetResponse.json()
  client = new CdpClient(target.webSocketDebuggerUrl)
  await client.connect()
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  })

  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('autoflow-locale', 'zh-CN'); localStorage.setItem('autoflow-theme', 'light'); localStorage.setItem('darkMode', 'false'); document.documentElement.classList.remove('dark')`,
  })
  await navigate(client, '/login')
  await screenshot(client, '01-login.png')

  const loginExpression = `(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
    });
    if (!response.ok) throw new Error('Login failed with HTTP ' + response.status);
    const result = await response.json();
    localStorage.setItem('user', JSON.stringify(result.user));
    return result.user.role;
  })()`
  const loginResult = await client.send('Runtime.evaluate', {
    expression: loginExpression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (loginResult.exceptionDetails || loginResult.result?.value !== 'admin') {
    throw new Error('Admin browser login failed')
  }

  const pages = [
    ['/', '02-dashboard.png'],
    ['/workflows/new', '03-create-workflow.png'],
    ['/workflows', '04-workflows.png'],
    ['/leads', '05-leads.png'],
    ['/outreach', '06-outreach.png'],
    ['/quotes', '07-quotes.png'],
    ['/follow-ups', '08-follow-ups.png'],
    ['/settings', '09-settings.png'],
    ['/admin', '10-admin.png'],
  ]
  for (const [path, name] of pages) {
    await navigate(client, path)
    await screenshot(client, name)
  }

  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('autoflow-locale', 'en')`,
  })
  await navigate(client, '/')
  await screenshot(client, '11-dashboard-en.png')

  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('autoflow-locale', 'zh-CN'); localStorage.setItem('autoflow-theme', 'light'); localStorage.setItem('darkMode', 'false'); document.documentElement.classList.remove('dark')`,
  })
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await navigate(client, '/')
  await screenshot(client, '13-dashboard-mobile.png')

  await client.send('Runtime.evaluate', {
    expression: `document.querySelector('header button')?.click()`,
  })
  await delay(350)
  await screenshot(client, '14-mobile-navigation.png')

  console.log(`Captured ${pages.length + 4} light-theme screenshots in ${outputDir}`)
} finally {
  client?.close()
  browser.kill()
  await delay(300)
  rmSync(profileDir, { recursive: true, force: true })
}
