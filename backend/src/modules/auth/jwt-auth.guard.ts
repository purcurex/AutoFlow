import { Injectable, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { ModuleRef, Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { AuthGuard } from '@nestjs/passport'
import { UsersService } from '../users/users.service'
import { businessScope } from '../users/business-scope'
import { ALLOW_WITHOUT_BUSINESS_DATA } from './management-access.decorator'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly modules: ModuleRef, private readonly reflector: Reflector) { super() }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store')
    await super.canActivate(context)
    const req = context.switchToHttp().getRequest<Request>()
    const account = await this.modules.get(UsersService, { strict: false }).findById(req.user!.userId)
    if (!account) throw new UnauthorizedException('Account no longer exists')
    // Every authenticated request uses current grants, never stale JWT role claims.
    req.user!.role = account.role
    req.user!.businessRole = businessScope(account).role
    const managementEndpoint = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_BUSINESS_DATA, [context.getHandler(), context.getClass()])
    if (!managementEndpoint && req.user!.businessRole === 'none') {
      throw new ForbiddenException({ code: 'business_access_disabled', message: 'Business data access is disabled for this account' })
    }
    return true
  }
}
