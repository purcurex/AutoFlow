import { readBusinessOwners } from './business-data-access'
import { directoryMembers, directoryPolicy } from '../organization/company-directory'
import type { DataSource } from 'typeorm'

it('rejects direct local customer analytics before enumerating any accounts for summary-only staff', async () => {
  const member = directoryMembers([['姓名', '账号', '英文名', '职务', '部门'], ['测试', 'staff', 'Staff', '订单管理', '公司/订单管理']])[0]
  const query = jest.fn(() => { throw new Error('Must not enumerate accounts') })
  const db = { getRepository: () => ({ findOne: async () => ({ id: 'u', ...directoryPolicy(member) }), createQueryBuilder: query }) } as unknown as DataSource
  await expect(readBusinessOwners(db, 'u')).rejects.toMatchObject({ status: 403 })
  expect(query).not.toHaveBeenCalled()
})
