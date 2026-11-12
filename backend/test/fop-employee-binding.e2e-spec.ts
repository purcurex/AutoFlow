import { configureReplicaTestRuntime, isolateReplicaProviders } from './replica-test-boundary'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { DataSource } from 'typeorm'
import * as request from 'supertest'
import { FOP_DATA_PROVIDER, FopPermissionDeniedError } from '../src/modules/fop-data/fop-data.types'
import type { VerifiedFopEmployeeBinding } from '../src/modules/fop-data/fop-employee-binding'
import { UsersService } from '../src/modules/users/users.service'

jest.setTimeout(30000)
const verified = (id = '11'): VerifiedFopEmployeeBinding => ({ tenantId: 'offline-tenant', userId: id, details: {
  employeeNumber: `ID-${id}`, username: `offline-employee-${id}`, name: '测试职员', employeeRecordId: id, employeeMasterId: `${id}1`, departmentId: '301', organizationId: '100',
  localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00.000Z' } })

configureReplicaTestRuntime()
describe('管理员绑定金蝶员工及业务查询身份（测试数据库，平台调用全部模拟）', () => {
  let app: INestApplication, db: DataSource, jwt: JwtService, adminId: string, otherId: string, targetId: string, duplicateId: string, crossId: string, departmentId: string
  const provider = { source: 'fop', supportsEmployeeBinding: true, pagedOrders: false, isConfigured: () => true, demoIdentity: () => null,
    listBindingEmployees: jest.fn(async () => ({ items: [], nextCursor: null, scopeVersion: 'a'.repeat(64) })),
    verifyEmployeeBinding: jest.fn(async (id: string) => verified(id)),
    resolvePermissions: jest.fn(async (identity: object) => ({ subject: identity, allowedOrderIds: [] })) }
  const auth = (id: string, sessionVersion = 0) => jwt.sign({ userId: id, sessionVersion })
  const bind = (id: string, body: object = { employeeId: '11', membershipId: '201' }, actor = adminId) => request(app.getHttpServer()).put(`/api/users/${id}/kingdee-binding`).auth(auth(actor), { type: 'bearer' }).send({ employeeNumber: `ID-${(body as { employeeId?: string }).employeeId ?? '11'}`, ...body })

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; process.env.DB_DATABASE = 'autoflow_test'; process.env.ENABLE_ADMIN_BOOTSTRAP = 'false'
    const { default: source } = await import('../src/database/data-source')
    if (source.options.database !== 'autoflow_test') throw new Error('Refusing to use a non-test database')
    await source.initialize(); await source.runMigrations(); await source.destroy()
    const { AppModule } = await import('../src/app.module')
    const module = await isolateReplicaProviders(Test.createTestingModule({ imports: [AppModule] })).overrideProvider(FOP_DATA_PROVIDER).useValue(provider).compile()
    app = module.createNestApplication(); app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    await app.init(); db = app.get(DataSource); jwt = app.get(JwtService)
    const users = app.get(UsersService)
    adminId = (await users.create('binding-test-admin@autoflow.test','binding-test-admin','OfflinePassword123')).id
    otherId = (await users.create('binding-test-other@autoflow.test','binding-test-other','OfflinePassword123')).id
    await db.query("UPDATE users SET role='admin', business_role='none' WHERE id=ANY($1::uuid[])",[[adminId,otherId]])
    async function create(actor: string, suffix: string) {
      const workspace = await request(app.getHttpServer()).get('/api/organization').auth(auth(actor), { type: 'bearer' }).expect(200)
      const department = workspace.body.nodes.find((node: any) => node.kind === 'department').id
      if (actor === adminId) departmentId = department
      const result = await request(app.getHttpServer()).post('/api/organization/employees').auth(auth(actor), { type: 'bearer' })
        .send({ name: '测试职员', code: `binding-test-${suffix}`, email: `binding-test-${suffix}@autoflow.test`, departmentId: department, workbenchRoles: ['sales'],
          account: { username: `binding-test-${suffix}`, password: 'OfflinePassword123' } }).expect(201)
      return result.body.employees.find((row: any) => row.code === `binding-test-${suffix}`).accountId
    }
    targetId = await create(adminId,'target'); duplicateId = await create(adminId,'duplicate'); crossId = await create(otherId,'cross')
  })
  afterAll(async () => {
    if (db?.isInitialized) await db.query("DELETE FROM users WHERE email LIKE 'binding-test-%@autoflow.test'")
    await app?.close()
  })

  it('普通员工和跨目录目标均被拒绝，且不会触发金蝶验证', async () => {
    await request(app.getHttpServer()).get('/api/users/fop-employees').auth(auth(targetId), { type: 'bearer' }).expect(403)
    await bind(duplicateId, undefined, targetId).expect(403)
    await bind(crossId).expect(404)
    expect(provider.verifyEmployeeBinding).not.toHaveBeenCalled()
    await request(app.getHttpServer()).get('/api/users/fop-employees').auth(auth(adminId), { type: 'bearer' }).expect(200)
  })

  it('拒绝自报租户/身份与旧裸ID写入口，避免绕过平台验证', async () => {
    await bind(targetId,{ employeeId:'11', membershipId:'201', userId:'999' }).expect(400)
    await request(app.getHttpServer()).put(`/api/users/${targetId}/fop-binding`).auth(auth(adminId), { type:'bearer' }).send({tenantId:'forged',userId:'999'}).expect(400)
    expect((await app.get(UsersService).findById(targetId))!.fopUserId).toBeNull()
  })

  it('绑定后保留原权限、映射本人范围，并立即撤销旧会话', async () => {
    const result = await bind(targetId).expect(200)
    expect(result.body).toMatchObject({ fopBinding:{tenantId:'offline-tenant',userId:'11'}, fopBindingDetails:{employeeRecordId:'11',employeeMasterId:'111',localDepartmentId:departmentId} })
    expect(JSON.stringify(result.body)).not.toMatch(/OfflinePassword|access_token|client_secret/)
    const account = (await app.get(UsersService).findById(targetId))!
    expect(account).toMatchObject({role:'user',businessRole:'salesperson',workbenchRoles:['sales'],sessionVersion:1})
    await request(app.getHttpServer()).get('/api/auth/profile').auth(auth(targetId),{type:'bearer'}).expect(401)
    await request(app.getHttpServer()).get('/api/autoflow/integrations/fop/data-access').auth(auth(targetId,1),{type:'bearer'}).expect(200)
    expect(provider.resolvePermissions).toHaveBeenLastCalledWith({tenantId:'offline-tenant',userId:'11'},{role:'salesperson',employeeId:'111',departmentId:'301'})
  })

  it('同一金蝶身份重复绑定返回409，目标账号保持未绑定', async () => {
    await bind(duplicateId).expect(409)
    expect((await app.get(UsersService).findById(duplicateId))!.fopBindingDetails).toBeNull()
  })

  it('代理用户验证失败时不修改目标，也不把失败验证标为成功', async () => {
    provider.verifyEmployeeBinding.mockRejectedValueOnce(new FopPermissionDeniedError('未配置代理用户','fop_proxy_user_required'))
    const result = await bind(duplicateId,{employeeId:'22',membershipId:'202'}).expect(403)
    expect(result.body.code).toBe('fop_proxy_user_required')
    expect((await app.get(UsersService).findById(duplicateId))!.fopUserId).toBeNull()
  })

  it('网络验证期间管理员被撤权时，保存事务重新核验并拒绝写入', async () => {
    provider.verifyEmployeeBinding.mockImplementationOnce(async () => { await db.query("UPDATE users SET role='user' WHERE id=$1",[adminId]);return verified('22') })
    try { await bind(duplicateId,{employeeId:'22',membershipId:'202'}).expect(403) }
    finally { await db.query("UPDATE users SET role='admin' WHERE id=$1",[adminId]) }
    expect((await app.get(UsersService).findById(duplicateId))!.fopUserId).toBeNull()
  })

  it('网络验证期间管理员旧会话被撤销时拒绝继续保存', async () => {
    provider.verifyEmployeeBinding.mockImplementationOnce(async () => { await db.query('UPDATE users SET session_version=session_version+1 WHERE id=$1',[adminId]);return verified('22') })
    try { await bind(duplicateId,{employeeId:'22',membershipId:'202'}).expect(401) }
    finally { await db.query('UPDATE users SET session_version=0 WHERE id=$1',[adminId]) }
    expect((await app.get(UsersService).findById(duplicateId))!.fopUserId).toBeNull()
  })

  it('网络验证期间目标会话版本变化时拒绝覆盖，保留目标的新状态', async () => {
    provider.verifyEmployeeBinding.mockImplementationOnce(async () => { await db.query('UPDATE users SET session_version=session_version+1 WHERE id=$1',[duplicateId]);return verified('22') })
    await bind(duplicateId,{employeeId:'22',membershipId:'202'}).expect(409)
    expect(await app.get(UsersService).findById(duplicateId)).toMatchObject({fopUserId:null,fopBindingDetails:null,sessionVersion:1})
  })

  it('创建账号与可信绑定同事务完成，验证失败不留下半个账号', async () => {
    const body = {name:'新测试职员',code:'binding-test-create',email:'binding-test-create@autoflow.test',departmentId,workbenchRoles:['sales'],
      account:{username:'binding-test-create',password:'OfflinePassword123',kingdeeEmployee:{employeeNumber:'ID-22',employeeId:'22',membershipId:'202'}}}
    provider.verifyEmployeeBinding.mockRejectedValueOnce(new FopPermissionDeniedError('不可用','fop_employee_unavailable'))
    await request(app.getHttpServer()).post('/api/organization/employees').auth(auth(adminId),{type:'bearer'}).send(body).expect(403)
    expect(await app.get(UsersService).findByEmail(body.email)).toBeNull()
    await request(app.getHttpServer()).post('/api/organization/employees').auth(auth(adminId),{type:'bearer'}).send(body).expect(201)
    expect(await app.get(UsersService).findByEmail(body.email)).toMatchObject({fopUserId:'22',fopBindingDetails:{employeeMasterId:'221'}})
  })

  it('解绑保留角色和本地组织，撤销旧会话并清空整份映射', async () => {
    await request(app.getHttpServer()).delete(`/api/users/${targetId}/kingdee-binding`).auth(auth(adminId),{type:'bearer'}).expect(200)
    expect(await app.get(UsersService).findById(targetId)).toMatchObject({fopTenantId:null,fopUserId:null,fopBindingDetails:null,role:'user',businessRole:'salesperson',sessionVersion:2})
    await request(app.getHttpServer()).get('/api/auth/profile').auth(auth(targetId,1),{type:'bearer'}).expect(401)
  })

  it('数据库拒绝将已验证身份的用户名替换为JSON null', async () => {
    await expect(db.query("UPDATE users SET fop_binding_details=jsonb_set(fop_binding_details,'{username}','null'::jsonb) WHERE email=$1",['binding-test-create@autoflow.test'])).rejects.toMatchObject({code:'23514'})
  })
})
