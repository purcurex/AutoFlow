import { KingdeeFopDataProvider } from './fop-kingdee.provider'

const settings: Record<string, string> = {
  FOP_QUERIES_PAUSED: 'true',
  FOP_KINGDEE_QUERY_URL: 'https://example.test/query',
  FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL: 'https://example.test/permissions',
  FOP_KINGDEE_DIRECTORY_URL: 'https://example.test/directory',
  FOP_KINGDEE_TOKEN_URL: 'https://example.test/token',
  FOP_KINGDEE_TENANT_ID: 'test', FOP_KINGDEE_USER_ID: '100',
  FOP_KINGDEE_ORGANIZATION_IDS: '10', FOP_KINGDEE_IDENTITY: 'test',
  FOP_KINGDEE_OPENAPI_SIGN: 'test', FOP_KINGDEE_ACCESS_TOKEN: 'test',
}

it.each([false, true])('blocks all outbound traffic while paused (automatic token: %s)', async automatic => {
  const config: Record<string, string> = { ...settings, ...(automatic ? {
    FOP_KINGDEE_CLIENT_ID: 'test', FOP_KINGDEE_CLIENT_SECRET: 'test',
    FOP_KINGDEE_ACCOUNT_ID: 'test', FOP_KINGDEE_USERNAME: 'test',
  } : {}) }
  const request = jest.fn().mockRejectedValue(new Error('Mock transport must not be reached'))
  const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
  await expect(provider.resolvePermissions({ tenantId: 'test', userId: '100' }, { role: 'admin', departmentId: null, employeeId: null })).rejects.toMatchObject({ code: 'fop_queries_paused' })
  await expect(provider.getConnectionContext()).rejects.toMatchObject({ code: 'fop_queries_paused' })
  await expect(provider.listBindingEmployees()).rejects.toMatchObject({ code: 'fop_queries_paused' })
  expect(request).not.toHaveBeenCalled()
})

it('checks the pause again before retrying a failed upstream request', async () => {
  const config: Record<string, string> = { ...settings, FOP_QUERIES_PAUSED: 'false' }
  const request = jest.fn(async () => {
    config.FOP_QUERIES_PAUSED = 'true'
    return new Response(null, { status: 503 })
  })
  const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
  await expect(provider.getConnectionContext()).rejects.toMatchObject({ code: 'fop_queries_paused' })
  expect(request).toHaveBeenCalledTimes(1)
})
