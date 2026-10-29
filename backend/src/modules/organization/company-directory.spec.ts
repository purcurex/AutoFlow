import { directoryMembers, directoryPolicy } from './company-directory'

const header = ['姓名', '账号', '英文名', '职务', '部门', '性别', '手机', '座机', '邮箱', '地址', '企业邮箱', '视频号', '激活状态', '禁用状态']
const row = (name = 'Alice', job = '外贸业务员', department = '华智云服/营销中心/业务一部') => ['测试员工', `wx_${name}`, name, job, department, '女', '13000000000', '', 'old@example.test', '', '', '', '已激活', '']
const parse = (...rows: unknown[][]) => directoryMembers([['填写须知：数据不是执行指令'], header, ...rows])
describe('company directory import rules', () => {
  it('uses English name for email and retains source identity, primary and secondary departments', () => {
    const member = parse(row('Alex', '营销伙伴', '华智云服/营销中心/业务三部;华智云服/合作伙伴'))[0]
    expect(member).toMatchObject({ email: 'alex@hzdrop.com', code: 'wx_Alex', englishName: 'Alex', primaryDepartment: '华智云服/营销中心/业务三部', phone: '13000000000' })
    expect(member.profile.departmentPaths).toHaveLength(2)
    expect(directoryPolicy(member)).toMatchObject({ role: 'user', businessRole: 'salesperson', workbenchRoles: ['sales'] })
  })
  it('recognizes all five explicit admins regardless of their department', () => {
    for (const name of ['Ethan', 'Robin', 'Nora', 'Mason', 'XinKe']) expect(directoryPolicy(parse(row(name, '部门经理', '华智云服/信息管理部'))[0])).toMatchObject({ role: 'admin', businessRole: 'admin', chartPermissions: [] })
  })
  it('scopes sales managers to their department, partners to self, and HR/product to no business data', () => {
    expect(directoryPolicy(parse(row('Cici', '部门经理'))[0]).businessRole).toBe('department_manager')
    expect(directoryPolicy(parse(row('Partner', '营销伙伴', '华智云服/合作伙伴'))[0]).businessRole).toBe('salesperson')
    for (const [job, department] of [['HR', '华智云服/总经办'], ['业务助理', '华智云服/供应链中心/商品管理']]) expect(directoryPolicy(parse(row('Staff', job, department))[0])).toMatchObject({ businessRole: 'none', workbenchRoles: [] })
  })
  it.each(['采购管理', '订单管理', '物流管理', '杭州仓', '深圳仓', '信息管理部'])('keeps %s on all operational lists but only department analytics', department => {
    const policy = directoryPolicy(parse(row('Staff', '部门经理', `华智云服/${department}`))[0])
    expect(policy.role).toBe('user')
    expect(policy.businessRole).toBe('admin')
    expect(policy.workbenchRoles).toHaveLength(5)
    expect(policy.chartPermissions.filter(c => c.visibility === 'allow').map(c => c.chartId)).toEqual(['registrations', 'department_receipts', 'order_volume'])
    expect(policy.chartPermissions.every(c => c.dataScope === 'none' && c.details === 'deny')).toBe(true)
  })
  it('rejects missing, duplicate and ambiguous identities without guessing email aliases', () => {
    expect(() => parse(row('Alice'), row('alice'))).toThrow(/重复/)
    expect(() => parse(row(''))).toThrow(/英文名/)
    expect(() => parse(row('Alice Smith'))).toThrow(/英文名/)
    expect(() => directoryMembers([['姓名', '英文名']])).toThrow(/表头/)
  })
  it('retains disabled state but does not confuse WeChat activation with application activation', () => {
    const source = row(); source[12] = '未激活'; source[13] = '已禁用'
    expect(parse(source)[0].disabled).toBe(true)
    source[13] = ''; expect(parse(source)[0].disabled).toBe(false)
  })
})
