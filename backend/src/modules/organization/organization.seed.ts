import type { WorkbenchRole } from '../users/workbench-role'

// Synthetic sandbox structure only. These employees are not application accounts.
export const ORGANIZATION_NODE_SEEDS = [
  { key: 'root', parent: null, name: 'HyperZone' },
  { key: 'executive', parent: 'root', name: '总经办' },
  { key: 'marketing', parent: 'root', name: '营销中心' },
  { key: 'sales1', parent: 'marketing', name: '业务一部' },
  { key: 'europe', parent: 'sales1', name: '欧洲销售组' },
  { key: 'sales2', parent: 'marketing', name: '业务二部' },
  { key: 'northamerica', parent: 'sales2', name: '北美销售组' },
  { key: 'sales3', parent: 'marketing', name: '业务三部' },
  { key: 'asiapacific', parent: 'sales3', name: '亚太销售组' },
  { key: 'sales4', parent: 'marketing', name: '业务四部' },
  { key: 'keyaccounts', parent: 'sales4', name: '大客户组' },
  { key: 'operations', parent: 'root', name: '运营中心' },
  { key: 'store', parent: 'operations', name: '店铺运营' },
  { key: 'storegroup', parent: 'store', name: '独立站运营组' },
  { key: 'growth', parent: 'operations', name: '客户增长' },
  { key: 'success', parent: 'growth', name: '客户成功组' },
  { key: 'supply', parent: 'root', name: '供应链中心' },
  { key: 'product', parent: 'supply', name: '商品管理' },
  { key: 'procurement', parent: 'supply', name: '采购管理' },
  { key: 'purchasing', parent: 'procurement', name: '采购执行组' },
  { key: 'orders', parent: 'supply', name: '订单管理' },
  { key: 'dispatch', parent: 'orders', name: '履约调度组' },
  { key: 'logistics', parent: 'supply', name: '物流管理' },
  { key: 'aftersales', parent: 'supply', name: '售后管理' },
  { key: 'hangzhou', parent: 'supply', name: '杭州仓' },
  { key: 'hzoutbound', parent: 'hangzhou', name: '出库作业组' },
  { key: 'shenzhen', parent: 'supply', name: '深圳仓' },
  { key: 'szwarehouse', parent: 'shenzhen', name: '仓储作业组' },
  { key: 'it', parent: 'root', name: '信息管理部' },
  { key: 'finance', parent: 'root', name: '财务行政部' },
  { key: 'partners', parent: 'root', name: '合作伙伴' },
] as const

// Reference roster: only members with a confirmed department and eligible job.
// Codes retain the original demo employee identities where possible.
export const SALES_ROSTER_SEEDS = [
  { code: 'EMP001', name: '曹可滢', englishName: 'Ruth', department: 'europe', position: '外贸业务员' },
  { code: 'EMP013', name: '陈会娟', englishName: 'Coco', department: 'europe', position: '外贸业务员' },
  { code: 'EMP014', name: '董梦强', englishName: 'Alex', department: 'europe', position: '外贸业务员' },
  { code: 'EMP015', name: '李文静', englishName: 'Betty', department: 'europe', position: '外贸业务员' },
  { code: 'EMP016', name: '杨美婷', englishName: 'Heidi', department: 'europe', position: '外贸业务员' },
  { code: 'EMP002', name: '马政莹', englishName: 'Maya', department: 'northamerica', position: '外贸业务员' },
  { code: 'EMP017', name: '辛安冉', englishName: 'Stella', department: 'northamerica', position: '外贸业务员' },
  { code: 'EMP018', name: '曾婷婷', englishName: 'Mia', department: 'northamerica', position: '外贸业务员' },
  { code: 'EMP019', name: '张映婷', englishName: 'Zoe', department: 'northamerica', position: '外贸业务员' },
  { code: 'EMP003', name: '陈宣竹', englishName: 'Joy', department: 'asiapacific', position: '外贸业务员' },
  { code: 'EMP020', name: '林世龙', englishName: 'Jaylen', department: 'asiapacific', position: '外贸业务员' },
  { code: 'EMP021', name: '刘朵朵', englishName: 'Iris', department: 'asiapacific', position: '外贸业务员' },
  { code: 'EMP022', name: '杨莹', englishName: 'Kiki', department: 'asiapacific', position: '营销伙伴' },
  { code: 'EMP023', name: '叶力铭', englishName: 'Jennie', department: 'asiapacific', position: '外贸业务员' },
  { code: 'EMP004', name: '梁东澜', englishName: 'Liora', department: 'keyaccounts', position: '外贸业务员' },
] as const

export const ORGANIZATION_EMPLOYEE_SEEDS: { code: string; name: string; department: string; roles: WorkbenchRole[] }[] = [
  ...SALES_ROSTER_SEEDS.map(employee => ({ code: employee.code, name: `${employee.name}（${employee.englishName}）`, department: employee.department, roles: ['sales'] as WorkbenchRole[] })),
  { code: 'EMP005', name: '孙雅婷', department: 'storegroup', roles: ['sales'] },
  { code: 'EMP006', name: '吴景行', department: 'success', roles: ['sales'] },
  { code: 'EMP007', name: '黄若琳', department: 'product', roles: ['procurement'] },
  { code: 'EMP008', name: '郑宇航', department: 'purchasing', roles: ['procurement'] },
  { code: 'EMP009', name: '王书言', department: 'orders', roles: ['allocation'] },
  { code: 'EMP010', name: '李沐晨', department: 'dispatch', roles: ['dispatch'] },
  { code: 'EMP011', name: '张予安', department: 'hzoutbound', roles: ['warehouse'] },
  { code: 'EMP012', name: '刘安然', department: 'szwarehouse', roles: ['warehouse'] },
]
