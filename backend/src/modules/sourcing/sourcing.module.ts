import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Alibaba1688Module } from '../alibaba1688'
import { WorkflowRunEntity } from '../autoflow/entities'
import {
  SourcingOfferEntity,
  SourcingSearchEntity,
  SourcingSupplierEntity,
} from './entities'
import { SourcingController } from './sourcing.controller'
import { SourcingService } from './sourcing.service'

@Module({
  imports: [
    Alibaba1688Module,
    TypeOrmModule.forFeature([
      WorkflowRunEntity,
      SourcingSearchEntity,
      SourcingSupplierEntity,
      SourcingOfferEntity,
    ]),
  ],
  controllers: [SourcingController],
  providers: [SourcingService],
  exports: [SourcingService],
})
export class SourcingModule {}
