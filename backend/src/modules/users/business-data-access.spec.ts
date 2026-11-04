import { readBusinessOwners } from './business-data-access'
import { directoryMembers, directoryPolicy } from '../organization/company-directory'
import type { DataSource } from 'typeorm'

it('部门经理的客户、报价及沟通读取仅按所属部门匹配，不递归子部门', async () => {
  const query = { select: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([{ id: 'colleague' }]) }
  const actor = { id: 'manager', role: 'user', businessRole: 'department_manager', businessDepartmentId: 'sales-1', chartPermissions: [], fopTenantId: 'tenant', fopBindingDetails: { organizationId: 'company-1' } }
  const db = { getRepository: () => ({ findOne: async () => actor, createQueryBuilder: () => query }) } as unknown as DataSource
  expect((await readBusinessOwners(db, actor.id)).ids).toEqual(['colleague'])
  expect(query.andWhere).toHaveBeenCalledWith('account.business_department_id = :department', { department: 'sales-1' })
  expect(query.andWhere.mock.calls.some(args => String(args[0]).includes('RECURSIVE'))).toBe(false)
  expect(query.where).toHaveBeenCalledWith('account.fop_tenant_id = :tenant', { tenant: 'tenant' })
  expect(query.andWhere).toHaveBeenCalledWith("account.fop_binding_details ->> 'organizationId' = :organization", { organization: 'company-1' })
})

it('rejects direct local customer analytics before enumerating any accounts for summary-only staff', async () => {
  const member = directoryMembers([['姓名', '账号', '英文名', '职务', '部门'], ['测试', 'staff', 'Staff', '订单管理', '公司/订单管理']])[0]
  const query = jest.fn(() => { throw new Error('Must not enumerate accounts') })
  const db = { getRepository: () => ({ findOne: async () => ({ id: 'u', ...directoryPolicy(member) }), createQueryBuilder: query }) } as unknown as DataSource
  await expect(readBusinessOwners(db, 'u')).rejects.toMatchObject({ status: 403 })
  expect(query).not.toHaveBeenCalled()
})
