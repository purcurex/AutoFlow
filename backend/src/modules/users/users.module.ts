import { Module } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
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
import { KingdeeFopDataProvider } from '../fop-data/fop-kingdee.provider'

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController, WorkbenchController, FulfillmentOrdersController],
  providers: [UsersService, WorkbenchAccessService, FopDataService, {
    provide: FOP_DATA_PROVIDER,
    inject: [ModuleRef, ConfigService],
    useFactory: (modules: ModuleRef, config: ConfigService) => {
      if (config.get<string>('FOP_DATA_MODE') === 'kingdee') return new KingdeeFopDataProvider(config)
      // Resolve the demo workspace lazily; default live mode needs no fixture dependency.
      const demo = new DemoFopDataProvider({ getWorkspace: ownerUserId => modules.get(OrganizationService, { strict: false }).getWorkspace(ownerUserId) })
      return demo.isConfigured() ? demo : new UnconfiguredFopDataProvider()
    },
  }],
  exports: [UsersService, WorkbenchAccessService, FopDataService],
})
export class UsersModule {}
