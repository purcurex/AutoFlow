import { ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { FOP_DATA_PROVIDER, FopDataProvider, FopIntegrationUnavailableError, FopPermissionDeniedError } from '../fop-data/fop-data.types'
import { BindFopEmployeeDto, FopEmployeesQueryDto } from '../fop-data/fop-employee-binding'
import { OrganizationService } from '../organization/organization.service'
import { UsersService } from './users.service'

/** 系统管理员维护一人一绑定；平台网络验证在本地保存事务之外执行。 */
@Injectable()
export class FopAccountBindingService {
  constructor(private readonly users: UsersService, private readonly modules: ModuleRef,
    @Inject(FOP_DATA_PROVIDER) private readonly provider: FopDataProvider) {}

  /** 每次采用数据库当前角色及会话版本，防止平台验证耗时期间撤权/重置密码后继续操作。 */
  private async requireAdmin(actorId: string, sessionVersion?: number) {
    const actor = await this.users.findById(actorId)
    if (!actor || actor.accountDisabled) throw new UnauthorizedException('账号已停用或不存在')
    if (sessionVersion !== undefined && actor.sessionVersion !== sessionVersion) throw new UnauthorizedException('管理员会话已失效，请重新登录')
    if (actor.role !== 'admin') throw new ForbiddenException('仅系统管理员可以绑定金蝶员工')
    return actor
  }

  /** 将平台错误归类为可交互的业务异常，不向浏览器透传上游响应或认证凭据。 */
  private async platform<T>(action: () => Promise<T>): Promise<T> {
    try { return await action() }
    catch (error) {
      if (error instanceof FopPermissionDeniedError) throw new ForbiddenException({ code: error.code, message: error.message })
      if (error instanceof FopIntegrationUnavailableError) throw new ServiceUnavailableException({
        code: ['fop_feature_not_configured','fop_endpoint_not_published'].includes(error.code) ? 'fop_employee_directory_not_configured' : error.code,
        message: '金蝶人员目录接口尚未接通，请核对实际URL、API登记及应用授权' })
      throw new ServiceUnavailableException({ code: 'fop_unavailable', message: '金蝶员工验证暂时失败，请稍后重试' })
    }
  }

  /** 目录返回前再次核验管理员会话，普通员工不能借绑定页面读取全员目录。 */
  async listEmployees(actorId: string, query: FopEmployeesQueryDto, sessionVersion?: number) {
    const actor = await this.requireAdmin(actorId, sessionVersion)
    const page = await this.platform(() => this.provider.listBindingEmployees(query.cursor, query.scopeVersion))
    await this.requireAdmin(actorId, actor.sessionVersion)
    return page
  }

  /** 先核对本地目标，再验证金蝶员工；平台验证失败时不进入绑定保存事务。 */
  async bind(actorId: string, targetId: string, input: BindFopEmployeeDto, sessionVersion?: number) {
    const actor = await this.requireAdmin(actorId, sessionVersion)
    const organization = this.modules.get(OrganizationService, { strict: false })
    // 先确认目标账号属于可维护目录；防止任意目标ID触发平台身份验证。
    const before = await organization.getAccount(actorId, targetId)
    const verified = await this.verify(actorId, input, actor.sessionVersion)
    return organization.setVerifiedFopBinding(actorId, targetId, verified, before.fopBinding, before.sessionVersion)
  }

  /** 新建账号也复用相同验证，避免先创建账号再绑定失败造成半成功和重复开通。 */
  async verify(actorId: string, input: BindFopEmployeeDto, sessionVersion?: number) {
    const actor = await this.requireAdmin(actorId, sessionVersion)
    const verified = await this.platform(() => this.provider.verifyEmployeeBinding(input.employeeId, input.membershipId))
    await this.requireAdmin(actorId, actor.sessionVersion)
    return { ...verified, actorSessionVersion: actor.sessionVersion }
  }

  async unbind(actorId: string, targetId: string, sessionVersion?: number) {
    const actor = await this.requireAdmin(actorId, sessionVersion)
    return this.modules.get(OrganizationService, { strict: false }).clearVerifiedFopBinding(actorId, targetId, actor.sessionVersion)
  }
}
