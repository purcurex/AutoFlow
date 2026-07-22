import { randomUUID } from 'crypto'
import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = String(request.headers['x-correlation-id'] || '')
    const correlationId = /^[A-Za-z0-9._:-]{8,80}$/.test(incoming) ? incoming : randomUUID()
    request.headers['x-correlation-id'] = correlationId
    response.setHeader('X-Correlation-ID', correlationId)
    next()
  }
}
