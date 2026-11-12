import { CollectedWorkbenchService } from '../workbench-replica/collected-workbench.service'
import { FopApprovalService } from '../fop-data/fop-approval.service'
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
import { FopAccountBindingService } from './fop-account-binding.service'
import { FOP_EMPLOYEE_BINDER } from '../fop-data/fop-employee-binding'
import { LocalWorkbenchService } from '../workbench-replica/local-workbench.service'
import { ReplicaController } from '../workbench-replica/replica.controller'
import { ReplicaSyncService } from '../workbench-replica/replica-sync.service'
import { ReplicaPublisher } from '../workbench-replica/replica-publisher'
import { REPLICA_CHANGE_SOURCE } from '../workbench-replica/replica-change-contract'
import { ReplicaHttpSource } from '../workbench-replica/replica-http-source'
import { ReplicaBootstrapService } from '../workbench-replica/replica-bootstrap.service'
import { ReplicaAuthorizationService } from '../workbench-replica/replica-authorization.service'
import { DataSource } from 'typeorm'

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController, WorkbenchController, FulfillmentOrdersController, ReplicaController],
  providers: [CollectedWorkbenchService, LocalWorkbenchService, ReplicaSyncService, ReplicaPublisher, ReplicaBootstrapService, ReplicaAuthorizationService,
    { provide: ReplicaHttpSource, inject: [ConfigService, DataSource], useFactory: (config:ConfigService,db:DataSource)=>new ReplicaHttpSource(config,db) },
    { provide: REPLICA_CHANGE_SOURCE, useExisting: ReplicaHttpSource }, FopAccountBindingService, { provide: FOP_EMPLOYEE_BINDER, useExisting: FopAccountBindingService }, FopApprovalService, UsersService, WorkbenchAccessService, FopDataService, {
    provide: FOP_DATA_PROVIDER,
    inject: [ModuleRef, ConfigService],
    useFactory: (modules: ModuleRef, config: ConfigService) => {
      if (config.get<string>('FOP_DATA_MODE') === 'kingdee') return new KingdeeFopDataProvider(config, fetch, async identity => {
        const account = await modules.get(UsersService, { strict: false }).findByFopIdentity(identity)
        return account && !account.accountDisabled ? account.fopBindingDetails ?? null : null
      })
      if (config.get<string>('FOP_DATA_MODE') === 'demo') {
        // Resolve a workspace only for explicitly requested local/test fixtures.
        const demo = new DemoFopDataProvider({ getWorkspace: ownerUserId => modules.get(OrganizationService, { strict: false }).getWorkspace(ownerUserId) })
        if (demo.isConfigured()) return demo
      }
      return new UnconfiguredFopDataProvider()
    },
  }],
  exports: [UsersService, WorkbenchAccessService, FopDataService, LocalWorkbenchService],
})
export class UsersModule {}
