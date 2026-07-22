import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs'
import { AuditService } from './audit.service'

@Injectable()
export class RequestAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestAuditInterceptor.name)
  private readonly writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()
    const startedAt = Date.now()

    return next.handle().pipe(
      mergeMap((value) => this.finish(request, response, startedAt, 'succeeded').pipe(mergeMap(() => of(value)))),
      catchError((error: unknown) => this.finish(request, response, startedAt, 'failed', this.errorStatus(error))
        .pipe(mergeMap(() => throwError(() => error)))),
    )
  }

  private finish(
    request: Request,
    response: Response,
    startedAt: number,
    outcome: 'succeeded' | 'failed',
    errorStatus?: number,
  ): Observable<void> {
    const durationMs = Date.now() - startedAt
    const correlationId = String(request.headers['x-correlation-id'] || 'missing')
    const path = request.path.slice(0, 500)
    const statusCode = errorStatus || response.statusCode
    this.logger.log(JSON.stringify({
      correlationId,
      method: request.method,
      path,
      statusCode,
      outcome,
      durationMs,
      actorUserId: request.user?.userId || null,
    }))

    if (!this.writeMethods.has(request.method)) return of(undefined)
    const segments = path.split('/').filter(Boolean)
    return from(this.auditService.record({
      actorUserId: request.user?.userId || null,
      action: `${request.method} ${segments.slice(0, 4).join('/')}`.slice(0, 120),
      targetType: segments[1] || segments[0] || 'unknown',
      targetId: segments.find((segment) => /^[0-9a-f-]{36}$/i.test(segment)) || null,
      outcome,
      correlationId,
      metadata: { path, statusCode, durationMs },
    })).pipe(
      mergeMap(() => of(undefined)),
      catchError((error: unknown) => {
        this.logger.error(`Audit persistence failed for ${correlationId}`, error)
        return of(undefined)
      }),
    )
  }

  private errorStatus(error: unknown): number {
    if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
      return error.status
    }
    return 500
  }
}
