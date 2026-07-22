import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LeadEntity } from '../autoflow/entities'
import { QuotationEntity } from './entities/quotation.entity'
import { QuotationVersionEntity } from './entities/quotation-version.entity'
import { QuotationController } from './quotation.controller'
import { QuotationService } from './quotation.service'

@Module({
  imports: [TypeOrmModule.forFeature([QuotationEntity, QuotationVersionEntity, LeadEntity])],
  controllers: [QuotationController],
  providers: [QuotationService],
  exports: [QuotationService],
})
export class QuotationModule {}
