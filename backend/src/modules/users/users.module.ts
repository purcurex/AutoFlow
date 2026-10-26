import { HttpFopDataProvider } from '../fop-data/fop-http.provider'
import { FopApprovalService } from '../fop-data/fop-approval.service'
import { Module } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'
import { User } from './user.entity'
import { WorkbenchAccessService } from './workbench-access.service'
import { FulfillmentOrdersController, WorkbenchController } from './workbench.controller'
import { FopDataService } from '../fop-data/fop-data.service'
import { FOP_DATA_PROVIDER, UnconfiguredFopDataProvider } from '../fop-data/fop-data.types'
import { DemoFopDataProvider } from '../fop-data/fop-demo.provider'
import { OrganizationService } from '../organization/organization.service'

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController, WorkbenchController, FulfillmentOrdersController],
  providers: [FopApprovalService, UsersService, WorkbenchAccessService, FopDataService, {
    provide: FOP_DATA_PROVIDER,
    inject: [ModuleRef],
    useFactory: (modules: ModuleRef) => {
      // Resolve the demo workspace lazily; default live mode needs no fixture dependency.
      const demo = new DemoFopDataProvider({ getWorkspace: ownerUserId => modules.get(OrganizationService, { strict: false }).getWorkspace(ownerUserId) })
      const http = new HttpFopDataProvider()
      return demo.isConfigured() ? demo : http.isConfigured() ? http : new UnconfiguredFopDataProvider()
    },
  }],
  exports: [UsersService, WorkbenchAccessService, FopDataService],
})
export class UsersModule {}
