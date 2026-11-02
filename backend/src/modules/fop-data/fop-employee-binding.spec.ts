import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import type { FopEmployeeBindingDetails } from './fop-employee-binding'

const envelope = (data: unknown) => new Response(JSON.stringify({ status: true, errorCode: '0', data }))
const identity = (userId: string) => ({ tenantId: 'offline-tenant', userId })
const scope = { role: 'salesperson' as const, employeeId: '111', departmentId: '301' }
const details = (username = 'employee-a', employeeRecordId = '11'): FopEmployeeBindingDetails => ({ username, employeeRecordId,
  employeeMasterId: employeeRecordId === '11' ? '111' : '222', name: '测试职员', departmentId: '301', organizationId: '100',
  localEmployeeId: 'local-employee', localDepartmentId: 'local-department', verifiedAt: '2026-10-29T00:00:00.000Z' })

function setup() {
  const config: Record<string,string> = { FOP_KINGDEE_QUERY_URL: 'https://offline.test/query', FOP_KINGDEE_SUMMARY_URL: 'https://offline.test/summary',
    FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL: 'https://offline.test/permissions', FOP_KINGDEE_DIRECTORY_URL: 'https://offline.test/directory',
    FOP_KINGDEE_ACCOUNT_STATES_URL: 'https://offline.test/states', FOP_KINGDEE_TOKEN_URL: 'https://offline.test/token',
    FOP_KINGDEE_CLIENT_ID: 'offline-client', FOP_KINGDEE_CLIENT_SECRET: 'offline-secret', FOP_KINGDEE_ACCOUNT_ID: 'offline-center',
    FOP_KINGDEE_USERNAME: 'directory-reader', FOP_KINGDEE_IDENTITY: 'offline-gateway', FOP_KINGDEE_ORGANIZATION_IDS: '100' }
  const bindings = new Map([['11', details()], ['22', details('employee-b', '22')]])
  const tokenUsers = new Map<string,string>(), issued = new Map<string,number>()
  const controls = { refreshA: false, disabled: false, rejectedUser: '', wrongSubject: false, foreignDirectory: false, gatewayDenied: false }
  const request = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body))
    if (path === '/token') {
      if (body.username === controls.rejectedUser) return new Response(JSON.stringify({ status: false, errorCode: '603', message: '该用户不在代理用户中' }))
      const count = (issued.get(body.username) ?? 0) + 1; issued.set(body.username, count)
      const token = `${body.username}-token-${count}`; tokenUsers.set(token, body.username)
      return envelope({ access_token: token, expires_in: 7_200_000 })
    }
    const username = tokenUsers.get((init?.headers as Record<string,string>).access_token)
    if (!username) throw new Error('Unknown test token')
    if (path === '/permissions') {
      if (controls.gatewayDenied) return new Response(JSON.stringify({status:false,errorCode:'2504'}),{status:519})
      if (controls.refreshA && username === 'employee-a') { controls.refreshA = false; return new Response('', { status: 401 }) }
      const userId = controls.wrongSubject && username !== 'directory-reader' ? '999' : username === 'directory-reader' ? '30' : username === 'employee-a' ? '11' : '22'
      return envelope({ subject: identity(userId), currentOrganization: { id: '100', name: '测试公司' },
        grants: { orders: ['100'], receipts: username === 'employee-b' ? ['100'] : [], registrations: [], freight: [] } })
    }
    expect(username).toBe('directory-reader')
    if (path === '/directory') return envelope({ schemaVersion: 1, subject: identity('30'), organizationId: controls.foreignDirectory ? '200' : '100', resource: 'employees',
      scopeVersion: 'a'.repeat(64), nextCursor: null, items: [{ id: '11', masterId: '111', membershipId: '201', departmentId: '301',
        name: '测试职员', username: 'employee-a', state: controls.disabled ? 'disabled' : 'active' }] })
    if (path === '/states') return envelope({ schemaVersion: 1, subject: identity('30'), organizationId: '100',
      items: body.query.employeeIds.map((id: string) => ({ id, state: controls.disabled ? 'disabled' : 'active' })) })
    throw new Error('Unexpected test route')
  })
  const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request, async id => bindings.get(id.userId) ?? null)
  return { provider, request, bindings, issued, controls }
}

describe('一人一绑定的真实金蝶身份隔离', () => {
  it('并发访问使用各自Token、身份和授权，重复请求只复用本人的Token', async () => {
    const { provider, issued } = setup()
    const [a,b] = await Promise.all([provider.resolvePermissions(identity('11'), scope), provider.resolvePermissions(identity('22'), { ...scope, employeeId: '222' })])
    expect(a.subject).toEqual(identity('11')); expect(b.subject).toEqual(identity('22'))
    expect(a.analyticsQuery?.receipts).toEqual([]); expect(b.analyticsQuery?.receipts).toEqual(['100'])
    await Promise.all([provider.resolvePermissions(identity('11'), scope), provider.resolvePermissions(identity('22'), scope)])
    expect(issued.get('employee-a')).toBe(1); expect(issued.get('employee-b')).toBe(1)
  })

  it('员工A认证过期只刷新A，不清除或替换员工B的Token', async () => {
    const { provider, issued, controls } = setup()
    await Promise.all([provider.resolvePermissions(identity('11'), scope), provider.resolvePermissions(identity('22'), scope)])
    controls.refreshA = true
    await Promise.all([provider.resolvePermissions(identity('11'), scope), provider.resolvePermissions(identity('22'), scope)])
    expect(issued.get('employee-a')).toBe(2); expect(issued.get('employee-b')).toBe(1)
  })

  it('同一认证用户重新绑定后替换旧连接缓存，不影响其他员工缓存', async () => {
    const { provider, bindings, issued } = setup()
    await Promise.all([provider.resolvePermissions(identity('11'),scope),provider.resolvePermissions(identity('22'),scope)])
    bindings.set('11',{...details(),verifiedAt:'2026-10-29T01:00:00.000Z'})
    await Promise.all([provider.resolvePermissions(identity('11'),scope),provider.resolvePermissions(identity('22'),scope)])
    expect(issued.get('employee-a')).toBe(2);expect(issued.get('employee-b')).toBe(1)
  })

  it('网关519未订阅API明确归类为授权缺失，不作为5xx重复请求', async () => {
    const { provider, controls, request } = setup();controls.gatewayDenied=true
    await expect(provider.resolvePermissions(identity('11'),scope)).rejects.toMatchObject({code:'fop_api_not_authorized'})
    expect(request.mock.calls.filter(call=>String(call[0]).endsWith('/permissions'))).toHaveLength(1)
  })

  it('解绑、代理用户未配置、平台返回他人身份均拒绝，不回退目录管理员Token', async () => {
    const a = setup(); a.bindings.delete('11')
    await expect(a.provider.resolvePermissions(identity('11'), scope)).rejects.toMatchObject({ code: 'fop_binding_required' })
    expect(a.request).not.toHaveBeenCalled()
    const b = setup(); b.controls.rejectedUser = 'employee-a'
    await expect(b.provider.resolvePermissions(identity('11'), scope)).rejects.toMatchObject({ code: 'fop_proxy_user_required' })
    const c = setup(); c.controls.wrongSubject = true
    await expect(c.provider.resolvePermissions(identity('11'), scope)).rejects.toMatchObject({ code: 'fop_permission_denied' })
  })

  it('即使员工令牌仍在缓存，人员状态变化也立即拒绝本次业务访问', async () => {
    const { provider, controls, issued } = setup()
    await provider.resolvePermissions(identity('11'), scope)
    controls.disabled = true
    await expect(provider.resolvePermissions(identity('11'), scope)).rejects.toMatchObject({ code: 'fop_employee_unavailable' })
    expect(issued.get('employee-a')).toBe(1)
  })

  it('绑定从可信目录派生用户名并核验Context身份，保留记录ID与masterId差异', async () => {
    const { provider } = setup()
    const binding = await provider.verifyEmployeeBinding('11','201')
    expect(binding).toMatchObject({ tenantId: 'offline-tenant', userId: '11', details: { username: 'employee-a', employeeRecordId: '11', employeeMasterId: '111', departmentId: '301' } })
    expect(JSON.stringify(binding)).not.toMatch(/offline-secret|token-/)
    await expect(provider.verifyEmployeeBinding('11','999')).rejects.toMatchObject({ code: 'fop_permission_denied' })
  })

  it('目录跨公司、账号禁用或认证主体不匹配不能写成已验证绑定', async () => {
    const a = setup(); a.controls.foreignDirectory = true
    await expect(a.provider.verifyEmployeeBinding('11','201')).rejects.toMatchObject({ code: 'fop_permission_denied' })
    const b = setup(); b.controls.disabled = true
    await expect(b.provider.verifyEmployeeBinding('11','201')).rejects.toMatchObject({ code: 'fop_employee_unavailable' })
    const c = setup(); c.controls.wrongSubject = true
    await expect(c.provider.verifyEmployeeBinding('11','201')).rejects.toMatchObject({ code: 'fop_permission_denied' })
  })
})
