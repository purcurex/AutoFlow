import { ServiceUnavailableException } from '@nestjs/common'
import { TestingModuleBuilder } from '@nestjs/testing'
import { FopDataService } from '../src/modules/fop-data/fop-data.service'
import { LocalWorkbenchService } from '../src/modules/workbench-replica/local-workbench.service'
import { ReplicaSyncService } from '../src/modules/workbench-replica/replica-sync.service'
import { ReplicaPublisher } from '../src/modules/workbench-replica/replica-publisher'
import { ReplicaBootstrapService } from '../src/modules/workbench-replica/replica-bootstrap.service'
import { ReplicaAuthorizationService } from '../src/modules/workbench-replica/replica-authorization.service'
import { ReplicaHttpSource } from '../src/modules/workbench-replica/replica-http-source'
import { REPLICA_CHANGE_SOURCE } from '../src/modules/workbench-replica/replica-change-contract'

/** Test runtime explicitly wins over private local-demo configuration. Never starts a real feed. */
export function configureReplicaTestRuntime():void {
  process.env.WORKBENCH_MOCK_ENABLED='false'
  process.env.WORKBENCH_READ_MODE='local'
  process.env.WORKBENCH_SYNC_ENABLED='false'
  process.env.FOP_QUERIES_PAUSED='true'
  process.env.FOP_DATA_MODE='demo'
}
const unavailable=()=>{throw new ServiceUnavailableException({code:'workbench_source_authorization_required',message:'Current source authorization is not configured in this test boundary'})}

/** Pure identity/permission tests do not instantiate replica services or a second database boundary. */
export function isolateReplicaProviders(builder:TestingModuleBuilder,providerListFixture=false):TestingModuleBuilder {
  for(const token of [ReplicaSyncService,ReplicaPublisher,ReplicaBootstrapService,ReplicaAuthorizationService])builder.overrideProvider(token).useValue({})
  const source={isConfigured:()=>false,barrier:unavailable,groups:unavailable}
  builder.overrideProvider(ReplicaHttpSource).useValue(source)
  builder.overrideProvider(REPLICA_CHANGE_SOURCE).useValue(source)
  builder.overrideProvider(LocalWorkbenchService).useFactory({inject:[FopDataService],factory:(data:FopDataService)=>{
    // This validates only business authorization against explicit fixture providers, not local SQL.
    // This is an explicit synthetic view fixture for legacy provider business-rule assertions.
    // Production controllers still call only LocalWorkbenchService and never gain a fallback.
    void providerListFixture
    const methods=['getOrders','exportOrders','getStockOrders','exportStockOrders','getRmaOrders','exportRmaOrders','getPurchaseReturns','exportPurchaseReturns','getPurchaseGroups','getPurchaseGroupDetails','exportPurchaseGroups'] as const
    return {enabled:true,mock:false,...Object.fromEntries(methods.map(method=>[method,(...args:any[])=>(data[method] as (...values:any[])=>unknown)(...args)])),unavailableSupplier:unavailable}
  }})
  return builder
}
