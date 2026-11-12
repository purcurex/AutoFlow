import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import type { FopIdentity, FopPermissionGrant, FopOrderPageQuery } from './fop-data.types'
import type { BusinessScope } from '../users/business-scope'

/** Offline protocol regression and explicitly invoked diagnostics only. Never registered in AppModule. */
export class KingdeeWorkbenchDiagnosticProvider extends KingdeeFopDataProvider {
  readonly supportedOrderQueues: readonly FopOrderPageQuery['queue'][] = ['unpaid', 'review', 'dispatch']
  readonly queriedStock: boolean = true
  readonly queriedRma: boolean = true
  isConfigured() { return !!this.config.get('FOP_KINGDEE_QUERY_URL')?.trim() && !!this.config.get('FOP_KINGDEE_SUMMARY_URL')?.trim() && super.isConfigured() }
  resolvePermissions(identity: Readonly<FopIdentity>, scope?: Readonly<BusinessScope>) { return this.diagnosticResolvePermissions(identity, scope) }
  resolveStockPermissions(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>) { return this.diagnosticResolveStockPermissions(identity, scope) }
  queryOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly = false) { return this.diagnosticQueryOrders(identity, permission, scope, query, summaryOnly) }
  queryRmaOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, flowStatus: 'active' | 'closed' | 'all' = 'all') { return this.diagnosticQueryRmaOrders(identity, permission, scope, flowStatus) }
  listStockOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope?: Readonly<BusinessScope>) { return this.diagnosticListStockOrders(identity, permission, scope) }
  listStockInventory(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope?: Readonly<BusinessScope>) { return this.diagnosticListStockInventory(identity, permission, scope) }
}
