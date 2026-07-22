import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuditController } from './audit.controller'
import { AuditEventEntity } from './audit-event.entity'
import { AuditService } from './audit.service'
import { CorrelationIdMiddleware } from './correlation-id.middleware'
import { RequestAuditInterceptor } from './request-audit.interceptor'

@Module({
  imports: [TypeOrmModule.forFeature([AuditEventEntity])],
  controllers: [AuditController],
  providers: [
    AuditService,
    CorrelationIdMiddleware,
    { provide: APP_INTERCEPTOR, useClass: RequestAuditInterceptor },
  ],
  exports: [AuditService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
