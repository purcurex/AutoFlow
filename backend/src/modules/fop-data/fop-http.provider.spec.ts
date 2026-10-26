import { HttpFopDataProvider } from './fop-http.provider'
import { FopPermissionDeniedError } from './fop-data.types'
describe('FOP employee HTTP gateway', () => {
  const original = { url: process.env.FOP_EMPLOYEE_API_URL, token: process.env.FOP_EMPLOYEE_API_TOKEN }
  const identity = { tenantId: 't', userId: 'u' }
  afterEach(() => { jest.restoreAllMocks(); if (original.url === undefined) delete process.env.FOP_EMPLOYEE_API_URL; else process.env.FOP_EMPLOYEE_API_URL = original.url; if (original.token === undefined) delete process.env.FOP_EMPLOYEE_API_TOKEN; else process.env.FOP_EMPLOYEE_API_TOKEN = original.token })
  function configured() { process.env.FOP_EMPLOYEE_API_URL = 'https://fop.example/employee'; process.env.FOP_EMPLOYEE_API_TOKEN = 'test-only'; return new HttpFopDataProvider() }
  it('does not call an absent or insecure endpoint', async () => {
    delete process.env.FOP_EMPLOYEE_API_URL
    const network = jest.spyOn(globalThis, 'fetch')
    await expect(new HttpFopDataProvider().approvalTargets(identity, 'review', 'o')).rejects.toThrow('not configured')
    process.env.FOP_EMPLOYEE_API_URL = 'http://fop.example'
    expect(new HttpFopDataProvider().isConfigured()).toBe(false)
    expect(network).not.toHaveBeenCalled()
  })
  it('sends delegated identity and trusted command to the exact configured HTTPS path', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'approved', message: 'ok', warning: null }), { status: 200 }))
    const command = { tenantId: 't', orderId: 'o', entity: 'hzkj_orders', id: 'o', number: 'SO', status: 'B' as const, version: '7', eligible: true, reason: null, operation: 'audit' as const, idempotencyKey: 'a'.repeat(64), requestId: 'r', actorAccountId: 'account' }
    expect(await configured().approveDocument(identity, command)).toMatchObject({ status: 'approved' })
    expect(network).toHaveBeenCalledTimes(1)
    expect(network.mock.calls[0][0]).toBe('https://fop.example/employee/approvals/audit')
    const options = network.mock.calls[0][1]!
    expect(options.redirect).toBe('error'); expect(options.method).toBe('POST')
    expect(JSON.parse(String(options.body))).toEqual({ subject: identity, command })
  })
  it('does not retry network failures and preserves permission denial', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(new Response('', { status: 403 }))
    const provider = configured()
    await expect(provider.approvalTargets(identity, 'review', 'o')).rejects.toThrow('timeout')
    expect(network).toHaveBeenCalledTimes(1)
    await expect(provider.approvalTargets(identity, 'review', 'o')).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })
})
