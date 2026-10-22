import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LeadEntity } from '../autoflow/entities'
import { FopIntegrationModule } from '../fop-integration/fop-integration.module'
import { QuotationEntity } from './entities/quotation.entity'
import { QuotationVersionEntity } from './entities/quotation-version.entity'
import { QuotationController } from './quotation.controller'
import { QuotationExcelExporter } from './quotation-excel.exporter'
import { QuotationService } from './quotation.service'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([QuotationEntity, QuotationVersionEntity, LeadEntity]),
    FopIntegrationModule,
  ],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationExcelExporter],
  exports: [QuotationService],
})
export class QuotationModule {}
