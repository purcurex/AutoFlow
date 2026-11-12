import { CollectedWorkbenchService } from './collected-workbench.service'
import { ReceiptNoticesQueryDto } from './receipt-notices.dto'
import { receiptNoticeProgress } from './receipt-notices'
import { localDispatchDocumentsSql, localLogisticsSql, localDispatchLogisticsSql, localWarehouseLogisticsSql, localReviewLogisticsSql, localProcurementPaidAtSql } from './local-workbench-logistics'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ReplicaAuthorizationService } from './replica-authorization.service'
import { ConfigService } from '@nestjs/config'
import { DataSource, EntityManager } from 'typeorm'
import { UsersService } from '../users/users.service'
import { User } from '../users/user.entity'
import { businessScope } from '../users/business-scope'
import { WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { FULFILLMENT_QUEUE_ROLES, ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'
import { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import { localDepartments, localEmployeeFilter, localOwnership, localSalespeople } from '../fop-data/local-workbench-scope'
import { buildRmaOrders } from '../fop-data/rma-orders'
import { PurchaseReturnQueryDto } from '../fop-data/purchase-returns.dto'
import { PurchaseGroupQueryDto } from '../fop-data/procurement-groups.dto'
import { RmaQueryDto } from '../fop-data/rma-orders.dto'
import { StockOrdersQueryDto } from '../fop-data/fop-stock.dto'
import { buildLocalOrderQuery, LocalOrderFilters, LocalReadScope, stockOrderStatusSql, stockPurchaseSql, localResourceGrantSql, localReturnJoins, localReturnAuthorized, localReturnAmbiguous, unconfigured } from './local-workbench-query'
import { buildReplicaOrganization } from './local-workbench-organization'
import { localNumber, localOrder, LocalRow, localStockOrder } from './local-workbench-mapping'
import { workbenchMockEnabled, refreshMockProofs, assertMockDatabase } from './workbench-mock'
import { MockWorkbenchCapabilities } from './mock-workbench-capabilities'
import { collectReplicaPages, sameReplicaExportProof, ReplicaExportProof } from './collect-replica-pages'
import { buildFulfillmentWorkbook } from '../fop-data/fop-order-export'
import { buildStockWorkbook } from '../fop-data/fop-stock-export'
import { buildRmaWorkbook } from '../fop-data/rma-orders-export'
import { buildPurchaseReturnWorkbook } from '../fop-data/purchase-returns-export'
import { buildPurchaseGroupWorkbook } from '../fop-data/procurement-groups-export'
import { createHash } from 'node:crypto'

interface CompanyRow extends LocalRow { connection_id: string; company_id: string; active_dataset_id: string | null; tenant_id: string; source_company_id: string }
interface Context { user: User; companies: CompanyRow[]; organizations: Map<string, LocalWorkbenchOrganization>; scopes: LocalReadScope[]; signature: string; resources: string[]; grants: Map<string,string> }

@Injectable()
export class LocalWorkbenchService {
  private readonly deliveryChecks=new WeakMap<EntityManager,(()=>Promise<void>)[]>()
  constructor(private readonly db: DataSource, private readonly users: UsersService, private readonly config: ConfigService,
    @Optional() private readonly authorization?: ReplicaAuthorizationService,
    @Optional() private readonly collected?: CollectedWorkbenchService) {}
  async collectedStatus(userId: string) { return this.collected?.enabled ? this.collected.status(userId) : null }
  get enabled(): boolean { return this.config.get<string>('WORKBENCH_READ_MODE', 'local') === 'local' }
  get mock(): boolean { const enabled=workbenchMockEnabled(this.config); if(enabled)assertMockDatabase(this.db); return enabled }
  private grantSignature(grants: LocalRow[]): string {
    // Lease renewal does not change the authorization set; freshness is checked independently at delivery.
    return JSON.stringify(grants.map(({verified_at:_verified,source_as_of:_asOf,expires_at:_expires,...grant})=>grant))
  }

  private async account(userId: string, role?: WorkbenchRole): Promise<User> {
    const user = await this.users.findById(userId)
    if (!user || user.accountDisabled) throw new UnauthorizedException('Account no longer exists')
    const business = businessScope(user)
    if (business.role === 'none') throw new ForbiddenException('Business data access is disabled')
    const roles = user.role === 'admin' || business.role === 'admin' ? [...WORKBENCH_ROLES] : user.workbenchRoles ?? []
    if (role && !roles.includes(role)) throw new ForbiddenException('Workbench access denied')
    return user
  }

  private async companies(user: User, manager: Pick<EntityManager, 'query'> = this.db): Promise<CompanyRow[]> {
    const linked: LocalRow[] = await manager.query('SELECT owner_user_id, archived_at FROM organization_employees WHERE account_id = $1 LIMIT 2', [user.id])
    if (linked.length > 1 || linked[0]?.archived_at || linked[0] && user.organizationWorkspaceOwnerId && linked[0].owner_user_id !== user.organizationWorkspaceOwnerId) throw new ForbiddenException('Current local organization assignment is unavailable')
    const ownerId = linked[0]?.owner_user_id ?? user.organizationWorkspaceOwnerId ?? (user.role === 'admin' ? user.id : null)
    if (!ownerId) throw new ForbiddenException('Current local organization assignment is unavailable')
    const rows: CompanyRow[] = await manager.query(`SELECT c.id AS connection_id, c.tenant_id, c.workspace_owner_id, co.id AS company_id, co.source_company_id, co.active_dataset_id,
      co.verified_at, co.expires_at, co.scope_version, d.state AS dataset_state, d.validated_at, d.activated_at,d.applied_watermarks
      FROM hz_fop_connections c JOIN hz_fop_companies co ON co.connection_id = c.id
      LEFT JOIN hz_fop_datasets d ON d.id = co.active_dataset_id AND d.company_id = co.id AND d.connection_id = c.id
      WHERE c.workspace_owner_id = $1 AND c.status = 'active' AND co.enabled IS TRUE
      ORDER BY c.id, co.id`, [ownerId])
    if (user.role === 'admin' || businessScope(user).role === 'admin') return rows
    const bindings: LocalRow[] = await manager.query(`SELECT connection_id, employee_master_id,person_record_id,employee_number,state,enabled,directory_verified_at FROM hz_fop_employee_bindings WHERE local_account_id = $1`, [user.id])
    return rows.filter(row => {
      const binding=bindings.find(binding=>binding.connection_id===row.connection_id)
      return binding ? binding.enabled && ['directory_verified','identity_verified'].includes(binding.state)
        && typeof binding.employee_master_id==='string' && /^[1-9]\d{0,18}$/.test(binding.employee_master_id)
        && typeof binding.person_record_id==='string' && /^[1-9]\d{0,18}$/.test(binding.person_record_id) && !!binding.employee_number?.trim()
        && !!binding.directory_verified_at && Number.isFinite(Date.parse(binding.directory_verified_at)) && Date.parse(binding.directory_verified_at)<=Date.now()
        : user.fopTenantId===row.tenant_id && user.fopBindingDetails?.organizationId===row.source_company_id
    })

  }

  /** Current local account and workspace/company scope; permits status before a dataset is initialized. */
  async replicaScope(userId: string): Promise<{ connectionId: string; companyId: string; datasetId: string | null }[]> {
    const user = await this.account(userId)
    return (await this.companies(user)).map(row => ({ connectionId: row.connection_id, companyId: row.company_id, datasetId: row.active_dataset_id }))
  }

  private async organization(manager: Pick<EntityManager, 'query'>, user: User, company: CompanyRow): Promise<LocalWorkbenchOrganization> {
    const nodes: LocalRow[] = await manager.query('SELECT id,parent_id,name,kind FROM organization_nodes WHERE owner_user_id = $1 ORDER BY id', [company.workspace_owner_id])
    const employees: LocalRow[] = await manager.query(`SELECT e.id,e.department_id,e.account_id,e.name,e.archived_at,u.account_disabled,u.fop_tenant_id,u.fop_binding_details,
      b.id AS binding_id,b.enabled AS binding_enabled,b.state AS binding_state,b.employee_master_id,b.person_record_id,b.employee_number,b.directory_verified_at
      FROM organization_employees e LEFT JOIN users u ON u.id = e.account_id
      LEFT JOIN hz_fop_employee_bindings b ON b.local_account_id = u.id AND b.connection_id = $2
      WHERE e.owner_user_id = $1 ORDER BY e.id`, [company.workspace_owner_id, company.connection_id])
    return buildReplicaOrganization(user, company.workspace_owner_id, nodes, employees, company)
  }

  private async context(manager: EntityManager, userId: string, role: WorkbenchRole, query: { departmentId?: string; ownerId?: string }, resource: string | string[]): Promise<Context> {
    const user = await this.account(userId, role)
    // Renew only independent permissions, before opening the business snapshot. Never read remote order pages.
    if (this.authorization && !this.mock) for (const company of await this.companies(user)) await this.authorization.ensure({connectionId:company.connection_id,companyId:company.company_id})
    const companies = await this.companies(user, manager)
    if (!companies.length || companies.some(row => !row.active_dataset_id || row.dataset_state !== 'active' || !row.validated_at || !row.activated_at)) throw new ServiceUnavailableException({ code: 'workbench_replica_not_initialized', message: 'Local workbench replica is not initialized' })
    const now = Date.now()
    if (companies.some(row => !row.verified_at || Date.parse(row.verified_at) > now || Date.parse(row.verified_at) < now - 60_000 || !row.expires_at || Date.parse(row.expires_at) <= now)) throw new ServiceUnavailableException({ code: 'workbench_replica_authorization_stale', message: 'Company authorization requires current verification' })
    const organizations = new Map<string, LocalWorkbenchOrganization>(), scopes: LocalReadScope[] = [], grantsSnapshot=new Map<string,string>()
    const resources=Array.isArray(resource)?resource:[resource]
    for (const company of companies) {
      const entities=company.applied_watermarks?._local?.entityCodes
      if(Array.isArray(entities)&&!this.mock){
        const required:Record<string,string>={orders:'hzkj_orders',stock_orders:'hzkj_stock_order_new',purchases:'hzkj_purorderbill',rma:'hzkj_after_sale_orders',receipt_notices:'hzkj_receiptnotice'}
        if(resources.some(name=>name==='purchase_returns'||required[name]&&!entities.includes(required[name])))throw new ServiceUnavailableException({code:'workbench_replica_entity_not_initialized',message:'The active snapshot does not cover this resource; no empty-list fallback is allowed'})
      }
      const org = await this.organization(manager, user, company)
      const filter = localEmployeeFilter(org, query)
      organizations.set(company.company_id, org)
      scopes.push({ connectionId: company.connection_id, companyId: company.company_id, datasetId: company.active_dataset_id!, employeeIds: filter.employeeIds })
      for (const resourceName of resources) {
      const grants=await this.grants(manager,company,resourceName)
      if (!grants.some(grant=>this.freshGrant(grant))) throw new ServiceUnavailableException({ code: 'workbench_replica_authorization_stale', message: `Current ${resourceName} authorization is unavailable` })
      grantsSnapshot.set(`${company.company_id}:${resourceName}`,this.grantSignature(grants))
      }
    }
    return { user, companies, organizations, scopes, resources, grants:grantsSnapshot, signature: JSON.stringify([user.role, user.businessRole, user.dataDisplayScope, user.workbenchRoles, user.sessionVersion, [...organizations].map(([id, org]) => [id, org.version])]) }
  }

  private async recheck(context: Context, _snapshotManager: EntityManager): Promise<void> {
    const deferred=this.deliveryChecks.get(_snapshotManager)
    if(deferred){deferred.push(()=>this.recheck(context,this.db.manager));return}
    const user = await this.account(context.user.id)
    const versions: unknown[] = []
    for (const company of context.companies) {
      const org = await this.organization(this.db, user, company)
      versions.push([company.company_id, org.version])
    }
    if (context.signature !== JSON.stringify([user.role, user.businessRole, user.dataDisplayScope, user.workbenchRoles, user.sessionVersion, versions])) throw new ConflictException({ code: 'workbench_scope_changed', message: 'Current local role or organization changed; reload the list' })
    const currentCompanies=await this.companies(user)
    const key=(company: CompanyRow)=>[company.connection_id,company.company_id,company.active_dataset_id,company.scope_version]
    if(JSON.stringify(currentCompanies.map(key))!==JSON.stringify(context.companies.map(key)))throw new ConflictException({code:'workbench_scope_changed',message:'Current company or active dataset changed; reload the list'})
    for(const company of currentCompanies){
      if(!company.verified_at || Date.parse(company.verified_at)>Date.now() || Date.parse(company.verified_at)<Date.now()-60_000 || !company.expires_at || Date.parse(company.expires_at)<=Date.now())throw new ServiceUnavailableException({code:'workbench_replica_authorization_stale',message:'Company authorization expired during the query'})
      for(const resource of context.resources){
        const grants=await this.grants(this.db,company,resource)
        if(this.grantSignature(grants)!==context.grants.get(`${company.company_id}:${resource}`) || !grants.some(grant=>this.freshGrant(grant)))throw new ConflictException({code:'workbench_scope_changed',message:'Current resource authorization changed; reload the list'})
      }
    }
  }

  private async grants(manager: Pick<EntityManager,'query'>, company: CompanyRow, resource: string): Promise<LocalRow[]> {
    return manager.query(`SELECT id,target_key,decision,grant_version,verified_at,source_as_of,expires_at FROM hz_fop_resource_grants WHERE connection_id=$1 AND company_id=$2 AND resource_type=$3 ORDER BY id`,[company.connection_id,company.company_id,resource])
  }
  private freshGrant(grant: LocalRow): boolean {
    const now=Date.now()
    return !!grant.verified_at && Date.parse(grant.verified_at)<=now && Date.parse(grant.verified_at)>=now-60_000 && !!grant.source_as_of && Date.parse(grant.source_as_of)<=now && Date.parse(grant.source_as_of)>=now-60_000 && !!grant.expires_at && Date.parse(grant.expires_at)>now
  }

  private async read<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    if(this.mock)await refreshMockProofs(this.db)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout=()=>new ServiceUnavailableException({ code: 'workbench_replica_query_timeout', message: 'Local workbench query exceeded its time limit' })
    const deadline=Date.now()+30_000
    try {
      const deliveryChecks:(()=>Promise<void>)[]=[]
      const transaction=this.db.transaction('REPEATABLE READ', async manager => {
        await manager.query("SET LOCAL statement_timeout = '30000ms'")
        await manager.query('SET TRANSACTION READ ONLY')
        const timed=new Proxy(manager, { get(target,property,receiver) {
          if(property==='query') return async (sql: string, parameters?: unknown[]) => {
            const remaining=deadline-Date.now()
            if(remaining<=0)throw timeout()
            await target.query("SELECT set_config('statement_timeout',$1,true)", [String(remaining)])
            return target.query(sql,parameters)
          }
          return Reflect.get(target,property,receiver)
        } })
        this.deliveryChecks.set(timed,deliveryChecks)
        try{return await run(timed)}finally{this.deliveryChecks.delete(timed)}
      }).then(async result=>{for(const check of deliveryChecks){if(Date.now()>=deadline)throw timeout();await check()}return result})
      return await Promise.race([transaction,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(timeout()),30_000)})])
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === '42P01') throw new ServiceUnavailableException({ code: 'workbench_replica_not_initialized', message: 'Local workbench replica schema is not initialized' })
      if (code === '57014' || code === '55P03') throw timeout()
      throw error
    } finally { if(timer)clearTimeout(timer) }
  }

  // Same-document sources: warehouse_id ← hzkj_ware_house; supplier_id ← hzkj_providersupplier.
  // carrier_name ← hzkj_logistics_company; tracking_number ← hzkj_waybill_number (domestic inbound parcel).
  // Do not join fulfillment/dispatch channels or substitute their suppliers, warehouses or tracking numbers.
  async getReceiptNotices(userId: string, query: ReceiptNoticesQueryDto) {
    if(this.collected?.enabled)return this.collected.unavailable(userId,query,'warehouse')
    return this.read(async manager => {
      const context = await this.context(manager, userId, 'warehouse', query, 'receipt_notices')
      const values: unknown[] = [JSON.stringify(context.scopes.map(s => ({ connection_id: s.connectionId, company_id: s.companyId, dataset_id: s.datasetId, employee_ids: s.employeeIds })))]
      const bind = (value: unknown) => { values.push(value); return `$${values.length}` }
      const from = `FROM jsonb_to_recordset($1::jsonb) scope(connection_id uuid, company_id uuid, dataset_id uuid, employee_ids text[])
        JOIN hz_fop_source_documents sd ON sd.connection_id=scope.connection_id AND sd.company_id=scope.company_id AND sd.dataset_id=scope.dataset_id AND sd.entity_code='hzkj_receiptnotice'
        LEFT JOIN hz_fop_receipt_notices r ON r.document_id=sd.id AND r.company_id=sd.company_id AND r.dataset_id=sd.dataset_id
        LEFT JOIN hz_fop_workbench_receipt_notices p ON p.document_id=r.document_id
        LEFT JOIN hz_fop_reference_items supplier ON supplier.connection_id=sd.connection_id AND supplier.company_id=sd.company_id AND supplier.resource_type='supplier' AND supplier.source_id=r.supplier_id AND supplier.deleted_at IS NULL
        LEFT JOIN hz_fop_reference_items warehouse ON warehouse.connection_id=sd.connection_id AND warehouse.company_id=sd.company_id AND warehouse.resource_type='warehouse' AND warehouse.source_id=r.warehouse_id AND warehouse.deleted_at IS NULL`
      const authorized = `sd.deleted_at IS NULL AND ${localResourceGrantSql('receipt_notices', 'sd.source_id', 'sd.company_id', 'sd.connection_id')}`
      // Unmapped authorized notices must not disappear into a misleading zero total.
      const [missing] = await manager.query(`SELECT count(*)::int AS n ${from} WHERE ${authorized} AND (p.document_id IS NULL OR sd.validation_state<>'verified' OR p.source_version<>sd.source_version OR p.ownership_verified_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds' OR p.ownership_verified_at>CURRENT_TIMESTAMP)`, values)
      if (missing.n) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', total: null, message: 'Receipt notice projection or current ownership is incomplete' })
      const scoped = `${authorized} AND (scope.employee_ids IS NULL OR p.owner_employee_ids <@ scope.employee_ids)`
      const [unknown] = await manager.query(`SELECT count(*)::int AS n ${from} WHERE ${scoped} AND sd.raw_bill_status='C' AND (p.shipment_state='unknown' OR (p.shipment_state='shipped' AND (r.raw_wms_status IS NULL OR r.raw_wms_status NOT IN ('0','5','10','15','20','25','30') OR r.supplier_shipped_at IS NULL)))`, values)
      if (unknown.n) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', total: null, message: 'Receipt notice shipment or inbound status is unknown' })
      const conditions = [scoped, "sd.raw_bill_status='C'", "p.shipment_state='shipped'", "r.raw_wms_status IN ('0','5','10')", 'p.inbound_quantity<p.quantity']
      // Match the notice as a whole. A SKU search does not truncate its product list.
      if (query.search?.trim()) {
        const search = bind('%'+query.search.trim().replace(/[\\%_]/g,'\\$&')+'%')
        conditions.push(`(concat_ws(' ',sd.document_number,supplier.name,r.tracking_number) ILIKE ${search} ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.lines) line WHERE concat_ws(' ',line->>'sku',line->>'name',line->>'variant') ILIKE ${search} ESCAPE '\\'))`)
      }
      if (query.warehouseCode) conditions.push(`warehouse.code=${bind(query.warehouseCode)}`)
      if (query.status) conditions.push(query.status === 'partial' ? 'p.inbound_quantity>0' : 'p.inbound_quantity=0')
      const where = conditions.join(' AND ')
      const [invalidLines] = await manager.query(`SELECT count(*)::int AS n ${from}
        CROSS JOIN LATERAL (SELECT sum(l.quantity) AS quantity,sum(l."inboundQuantity") AS inbound,
          bool_or(l.quantity IS NULL OR l."inboundQuantity" IS NULL OR l.quantity<=0 OR l."inboundQuantity"<0 OR l."inboundQuantity">l.quantity) AS invalid
          FROM jsonb_to_recordset(p.lines) AS l(quantity numeric,"inboundQuantity" numeric)) checked
        WHERE ${where} AND (checked.invalid IS TRUE OR checked.quantity IS DISTINCT FROM p.quantity OR checked.inbound IS DISTINCT FROM p.inbound_quantity)`, values)
      if (invalidLines.n) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', total: null, message: 'Receipt notice header and entries disagree' })
      const [summary] = await manager.query(`SELECT count(*)::int AS total,COALESCE(sum(p.quantity),0) AS quantity,COALESCE(sum(p.inbound_quantity),0) AS inbound_quantity,COALESCE(sum(p.quantity-p.inbound_quantity),0) AS pending_quantity,max(p.published_at) AS synced_at ${from} WHERE ${where}`, values)
      const warehouses = await manager.query(`SELECT DISTINCT warehouse.code,warehouse.name ${from} WHERE ${scoped} AND warehouse.code IS NOT NULL ORDER BY warehouse.code`, [values[0]])
      const page = query.page ?? 1, pageSize = query.pageSize ?? 20
      const rows = await manager.query(`SELECT sd.id,sd.document_number,r.supplier_shipped_at,r.tracking_number,r.raw_wms_status,p.*,supplier.name AS supplier_name,warehouse.name AS warehouse_name,warehouse.code AS warehouse_code ${from} WHERE ${where} ORDER BY r.supplier_shipped_at DESC,sd.id LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,pageSize,(page-1)*pageSize])
      const items = rows.map((row: LocalRow) => {
        const progress = receiptNoticeProgress(row.shipment_state, row.raw_wms_status, row.lines)
        if (!progress || progress.quantity !== Number(row.quantity) || progress.inboundQuantity !== Number(row.inbound_quantity)) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', total: null, message: 'Receipt notice header and entries disagree' })
        return { id: row.id, number: row.document_number, supplier: row.supplier_name ?? null, warehouse: row.warehouse_name ?? null, warehouseCode: row.warehouse_code ?? null,
          shippedAt: row.supplier_shipped_at, carrier: row.carrier_name, trackingNumber: row.tracking_number, lines: row.lines, ...progress }
      })
      await this.recheck(context, manager)
      return { items, total: summary.total, page, pageSize, source: this.mock ? 'mock' : 'fop', refreshedAt: new Date().toISOString(), warehouses,
        departments: [...new Map([...context.organizations.values()].flatMap(org => localDepartments(org)).map(row => [row.id,row])).values()],
        totals: { quantity: Number(summary.quantity), inboundQuantity: Number(summary.inbound_quantity), pendingQuantity: Number(summary.pending_quantity) },
        replica: { readMode: 'local' as const, datasetId: context.scopes.map(s => s.datasetId).sort().join(','), revision: String(summary.synced_at ?? ''), sourceSyncedAt: summary.synced_at ? new Date(summary.synced_at).toISOString() : null } }
    })
  }

  async getOrders(userId: string, query: ListFulfillmentOrdersDto) {
    const role = FULFILLMENT_QUEUE_ROLES[query.queue]
    if (!role || query.workbenchRole && query.workbenchRole !== role) throw new BadRequestException('Invalid fulfillment queue or workbench role')
    return this.orders(userId, query, role, false)
  }
  async getStockOrders(userId: string, query: StockOrdersQueryDto) {
    return this.orders(userId, { ...query, queue: query.queue ?? 'all' }, query.queue === 'procurement' ? 'procurement' : 'sales', true)
  }

  private async orders(userId: string, query: LocalOrderFilters & { departmentId?: string; ownerId?: string; projection?: 'count' }, role: WorkbenchRole, stock: boolean) {
    if(this.collected?.enabled)return this.collected.orders(userId,query,role,stock||query.queue==='rma')
    return this.read(async manager => {
      const context = await this.context(manager, userId, role, query, stock ? 'stock_orders' : query.queue === 'rma' ? ['orders', 'rma'] : query.queue === 'purchase_returns' ? ['orders','purchases','purchase_returns'] : 'orders')
      const searchOwnerIds=[...new Set([...context.organizations.values()].flatMap(org=>org.members.filter(member=>query.search?.trim() && member.name.toLowerCase().includes(query.search.trim().toLowerCase())).map(member=>member.employeeId)))]
      const sql = buildLocalOrderQuery(context.scopes, {...query,searchOwnerIds}, stock)
      const completeness: LocalRow[] = await manager.query(`SELECT count(*)::text AS unknown_count ${sql.from} WHERE ${sql.completenessWhere}
        AND (${!stock && ['dispatch','procurement','allocation','allocation_review'].includes(query.queue) ? 'delivery.incomplete OR' : ''} ${!stock && query.queue==='shipping' ? "native.raw_delivery_status IS NULL OR native.raw_delivery_status NOT IN ('0','1','2') OR" : !stock && ['procurement','procurement_shipping'].includes(query.queue) ? "native.raw_purchase_status IS NULL OR native.raw_purchase_status NOT IN ('0','1','2','3','4') OR" : ''} o.readiness <> 'ready' OR o.published_at IS NULL OR o.total_amount IS NULL OR o.total_quantity IS NULL OR sd.validation_state <> 'verified'
          OR o.ownership_verified_at IS NULL OR o.ownership_verified_at < CURRENT_TIMESTAMP - INTERVAL '60 seconds' OR o.ownership_verified_at > CURRENT_TIMESTAMP OR o.ownership_version IS NULL
          OR m.classification_state IS NULL OR m.classification_state = 'unknown' OR m.projection_revision <> o.projection_revision OR m.rule_version <> o.rule_version
          OR EXISTS (SELECT 1 FROM hz_fop_workbench_order_lines invalid_line WHERE invalid_line.order_document_id = o.document_id AND invalid_line.company_id = o.company_id AND invalid_line.dataset_id = o.dataset_id AND invalid_line.projection_revision <> o.projection_revision))`, sql.completenessValues)
      if (Number(completeness[0]?.unknown_count) > 0) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', queueState: 'incomplete', total: null, message: 'Authorized candidates contain unknown or incomplete queue classifications' })
      const memberWhere = `${sql.where} AND o.readiness = 'ready' AND m.classification_state = 'member' AND m.projection_revision = o.projection_revision`
      const aggregate: LocalRow[] = await manager.query(`SELECT count(*)::text AS case_count, count(DISTINCT o.document_id)::text AS order_count, COALESCE(max(o.projection_revision),0)::text AS revision, max(o.published_at) AS source_synced_at ${sql.from} WHERE ${memberWhere}`, sql.values)
      const monies: LocalRow[] = await manager.query(`SELECT currency_code AS currency,sum(total_amount)::text AS amount,sum(total_quantity)::text AS quantity FROM (SELECT DISTINCT o.document_id,o.currency_code,o.total_amount,o.total_quantity ${sql.from} WHERE ${memberWhere}) amounts GROUP BY currency_code ORDER BY currency_code NULLS LAST`, sql.values)
      let shippingCountries:string[]|undefined
      if(!stock&&query.queue==='review'&&!query.completed){
        const countrySql=buildLocalOrderQuery(context.scopes,{...query,searchOwnerIds,shippingCountryCode:undefined})
        const countries:LocalRow[]=await manager.query(`SELECT DISTINCT o.country_code ${countrySql.from} WHERE ${countrySql.where} AND o.readiness='ready' AND m.classification_state='member' AND m.projection_revision=o.projection_revision AND o.country_code ~ '^[A-Z]{2}$' ORDER BY o.country_code`,countrySql.values)
        shippingCountries=countries.map(row=>row.country_code)
      }
      const page = query.page ?? 1, pageSize = query.pageSize ?? 20
      const rows: LocalRow[] = query.projection === 'count' ? [] : await manager.query(`SELECT o.*, ${!stock && ['shipping','procurement','procurement_shipping'].includes(query.queue) ? `native.raw_purchase_status AS source_purchase_status,native.raw_delivery_status AS source_outbound_status,${query.queue==='shipping' ? "CASE native.raw_delivery_status WHEN '0' THEN 'pending' WHEN '1' THEN 'partial' WHEN '2' THEN 'completed' ELSE 'unknown' END AS outbound_state," : ''}` : ''} ${query.queue === 'rma' ? 'rm.rma_document_id AS selected_rma_id,' : ''} sd.source_id, sd.source_audited_at, m.queue_code, m.phase_completed_at, ${query.queue === 'allocation_review' && query.completed ? 'allocation_approval.review_state AS allocation_review_state,allocation_approval.audited_at AS allocation_audited_at,' : ''} ${query.queue === 'shipping' ? localWarehouseLogisticsSql : query.queue === 'dispatch' ? localDispatchLogisticsSql : query.queue === 'review' && !query.completed ? localReviewLogisticsSql : localLogisticsSql} AS logistics_packages,
        ${query.queue === 'dispatch' ? "delivery.task_state AS dispatch_task_state,CASE WHEN delivery.task_state='dispatch_synced' THEN 'synced' WHEN delivery.task_state='unknown' THEN 'unknown' ELSE 'pending' END AS shopify_sync_state,delivery.audited_at AS dispatch_audited_at," : ''}
        (SELECT f.custom_channel_name FROM hz_fop_fulfillment_orders f WHERE f.document_id=o.document_id AND f.company_id=o.company_id AND f.dataset_id=o.dataset_id) AS custom_channel_name,
        ${localProcurementPaidAtSql} AS procurement_paid_at,
        (SELECT jsonb_agg(jsonb_build_object('id',a_sd.source_id,'number',a_sd.document_number))->0 FROM hz_fop_document_relations ar JOIN hz_fop_allocations a ON a.document_id=ar.to_document_id AND a.company_id=o.company_id AND a.dataset_id=o.dataset_id JOIN hz_fop_source_documents a_sd ON a_sd.id=a.document_id WHERE ar.from_document_id=o.document_id AND ar.company_id=o.company_id AND ar.dataset_id=o.dataset_id AND ar.relation_type='allocation' AND ar.resolution_state='resolved' AND ar.removed_at IS NULL AND a_sd.deleted_at IS NULL AND a_sd.validation_state='verified' HAVING count(*)=1) AS allocation_document,
        ${localDispatchDocumentsSql} AS dispatch_documents,
        ${!stock && query.queue==='procurement' ? 'delivery.logistics_gate AS logistics_gate,' : ''} ${stockOrderStatusSql} AS stock_order_status, ${stockPurchaseSql} AS stock_purchase_status,
        (SELECT wr.code FROM hz_fop_reference_items wr WHERE wr.connection_id = o.connection_id AND wr.company_id = o.company_id AND wr.resource_type = 'warehouse' AND wr.source_id = o.warehouse_id AND wr.deleted_at IS NULL LIMIT 1) AS warehouse_code,
        exception_mark.type AS exception_type, exception_mark.reason AS exception_reason, exception_mark.occurred_at AS exception_occurred_at
        ${sql.from} LEFT JOIN LATERAL (SELECT e.type,e.reason,e.occurred_at FROM hz_fop_exception_marks e WHERE e.company_id = o.company_id AND e.dataset_id = o.dataset_id AND e.order_document_id = o.document_id AND e.active IS TRUE ORDER BY e.occurred_at DESC NULLS LAST,e.id LIMIT 1) exception_mark ON TRUE
        WHERE ${memberWhere} ORDER BY ${sql.orderBy} LIMIT $${sql.values.length + 1} OFFSET $${sql.values.length + 2}`, [...sql.values, pageSize, (page - 1) * pageSize])
      const ids = rows.map(row => row.document_id)
      const lines: LocalRow[] = ids.length ? await manager.query(`SELECT l.* FROM hz_fop_workbench_order_lines l JOIN hz_fop_workbench_orders o ON o.document_id = l.order_document_id AND o.company_id = l.company_id AND o.dataset_id = l.dataset_id AND o.projection_revision = l.projection_revision WHERE l.order_document_id = ANY($1::uuid[]) ORDER BY l.order_document_id,l.sequence,l.id`, [ids]) : []
      let items = rows.map(row => {
        const mapped = stock ? localStockOrder(row, lines.filter(line => line.order_document_id === row.document_id)) : localOrder(row, lines.filter(line => line.order_document_id === row.document_id))
        return localOwnership(mapped, context.organizations.get(row.company_id)!)
      })
      if (query.queue === 'rma' && ids.length) {
        const caseRows: LocalRow[] = await manager.query(`SELECT DISTINCT rma.*, rma_sd.source_id, rma_sd.document_number, rma_sd.source_created_at, rma_sd.source_modified_at, order_sd.source_id AS order_source_id, o.company_id
          FROM hz_fop_workbench_orders o JOIN hz_fop_source_documents order_sd ON order_sd.id = o.document_id AND order_sd.company_id = o.company_id AND order_sd.dataset_id = o.dataset_id
          JOIN hz_fop_document_relations relation ON relation.from_document_id = o.document_id AND relation.company_id = o.company_id AND relation.dataset_id = o.dataset_id AND relation.relation_type = 'rma' AND relation.resolution_state = 'resolved' AND relation.removed_at IS NULL
          JOIN hz_fop_rma_orders rma ON rma.document_id = relation.to_document_id AND rma.company_id = relation.company_id AND rma.dataset_id = relation.dataset_id
          JOIN hz_fop_source_documents rma_sd ON rma_sd.id = rma.document_id AND rma_sd.company_id = rma.company_id AND rma_sd.dataset_id = rma.dataset_id
          WHERE o.document_id = ANY($1::uuid[]) AND rma_sd.deleted_at IS NULL AND rma_sd.validation_state = 'verified' AND ${localResourceGrantSql('rma', 'rma_sd.source_id')}`, [ids])
        const subject = { tenantId: 'local-replica', userId }
        const cases = caseRows.map(row => ({ id: `${row.company_id}:${row.source_id}`, orderId: row.order_source_id, tenantId: subject.tenantId, type: row.after_sale_type,
          isOpen: row.is_open, number: row.document_number, stage: row.raw_flow_status, reason: row.reason, createdAt: row.source_created_at, updatedAt: row.source_modified_at,
          requestedAmount: row.requested_amount == null ? null : localNumber(row.requested_amount, 'RMA requested amount'), currency: row.requested_currency,
          refundAmount: row.refund_amount == null ? null : localNumber(row.refund_amount, 'RMA refund amount'), refundCurrency: row.refund_currency }))
        const paths = new Map(items.map(item => [item.id, item.departmentPathIds ?? []]))
        const selectedCases = new Set(rows.map(row => row.selected_rma_id))
        const selectedIds = new Set(caseRows.filter(row => selectedCases.has(row.document_id)).map(row => `${row.company_id}:${row.source_id}`))
        items = buildRmaOrders({ subject, cases }, { subject, allowedOrderIds: items.map(item => item.id), allowedRmaCaseIds: cases.map(item => item.id) }, items as ReturnType<typeof localOrder>[], { type: query.rmaType as RmaQueryDto['type'], flowStatus: query.rmaFlowStatus as RmaQueryDto['flowStatus'] }, paths).filter(row => selectedIds.has(row.id))
      }
      let returnTotals: Record<string,number>={}
      if(query.queue==='purchase_returns') {
        const invalid:LocalRow[]=await manager.query(`SELECT count(*) AS n ${sql.from} ${localReturnJoins} WHERE ${memberWhere} AND ${localReturnAuthorized} AND ${localReturnAmbiguous}`,sql.values)
        if(Number(invalid[0]?.n)>0)throw new ServiceUnavailableException({code:'workbench_replica_incomplete',message:'Physical return lines need exact single-source requested and returned quantities',total:null})
        const allReturns:LocalRow[]=await manager.query(`SELECT count(DISTINCT pr.document_id) FILTER (WHERE return_sd.document_number IS NOT NULL)::int AS return_count,COALESCE(sum(return_detail.requested_quantity),0) AS quantity,COALESCE(sum(return_detail.returned_quantity),0) AS returned_quantity ${sql.from} ${localReturnJoins} WHERE ${memberWhere} AND ${localReturnAuthorized}`,sql.values)
        returnTotals={returnCount:allReturns[0]?.return_count??0,quantity:localNumber(allReturns[0]?.quantity??'0','return quantity'),returnedQuantity:localNumber(allReturns[0]?.returned_quantity??'0','returned quantity')}
        if(ids.length){
          const documents:LocalRow[]=await manager.query(`SELECT o.document_id AS order_document_id,pr.document_id AS return_document_id,pr.supplier_id,pr.raw_physical_status,return_sd.source_id AS return_source_id,return_sd.document_number AS return_number,return_sd.source_created_at,purchase_sd.source_id AS purchase_source_id,purchase_sd.document_number AS purchase_number,return_line.*,return_detail.requested_quantity,return_detail.returned_quantity,
            (SELECT ri.name FROM hz_fop_reference_items ri WHERE ri.connection_id=o.connection_id AND ri.company_id=o.company_id AND ri.resource_type='supplier' AND ri.source_id=pr.supplier_id AND ri.deleted_at IS NULL LIMIT 1) AS supplier_name
            FROM hz_fop_workbench_orders o ${localReturnJoins} WHERE o.document_id=ANY($1::uuid[]) AND ${localReturnAuthorized} ORDER BY o.document_id,pr.document_id,return_line.sequence,return_line.id`,[ids])
          items=items.map((item,index)=>{
            const grouped=new Map<string,any>()
            for(const document of documents.filter(document=>document.order_document_id===rows[index].document_id)){
              let entry=grouped.get(document.return_document_id)
              if(!entry){entry={id:document.return_source_id,number:document.return_number??null,status:this.mock&&['pending_outbound','in_transit','received','completed','cancelled'].includes(document.raw_physical_status)?document.raw_physical_status:'unknown',purchaseOrder:{id:document.purchase_source_id,number:document.purchase_number??''},supplier:{id:document.supplier_id??'',name:document.supplier_name??''},warehouseCode:'',warehouse:'',createdAt:document.source_created_at?new Date(document.source_created_at).toISOString():null,logistics:{carrier:null,trackingNumber:null},lines:[],quantity:0,returnedQuantity:0};grouped.set(document.return_document_id,entry)}
              const quantity=localNumber(document.requested_quantity,'return requested quantity'),returnedQuantity=localNumber(document.returned_quantity,'returned quantity')
              entry.lines.push({id:document.source_entry_id,sku:document.sku_code??'',name:document.product_name??'',variant:document.variant??'',imageUrl:document.image_url??null,quantity,returnedQuantity,sourceOrder:{id:item.id,number:(item as ReturnType<typeof localOrder>).orderNumber,kind:'fulfillment',customerName:item.customerName,owner:item.owner,department:item.department,departmentPathIds:item.departmentPathIds}});entry.quantity+=quantity;entry.returnedQuantity+=returnedQuantity
            }
            const purchaseReturns=[...grouped.values()]
            return {...item,purchaseReturns,returnQuantity:purchaseReturns.reduce((sum,entry)=>sum+entry.quantity,0),returnedQuantity:purchaseReturns.reduce((sum,entry)=>sum+entry.returnedQuantity,0)}
          })
        }
      }
      const syncProof: LocalRow[] = await manager.query(`SELECT min(latest.source_as_of) AS source_synced_at FROM jsonb_to_recordset($1::jsonb) scope(company_id uuid,dataset_id uuid)
        LEFT JOIN LATERAL (SELECT b.source_as_of FROM hz_fop_sync_barriers b WHERE b.company_id = scope.company_id AND b.dataset_id = scope.dataset_id AND b.state = 'satisfied' AND b.purpose IN ('bootstrap_cutover','manual_refresh') ORDER BY b.source_as_of DESC LIMIT 1) latest ON TRUE
        HAVING count(latest.source_as_of) = count(*)`, [JSON.stringify(context.scopes.map(scope => ({ company_id: scope.companyId, dataset_id: scope.datasetId })))])
      await this.recheck(context, manager)
      const summary = aggregate[0] ?? {}, amountRows = monies.some(row => !row.currency || row.currency === 'XXX') ? [] : monies.map(row => ({ currency: row.currency, amount: localNumber(row.amount, 'total amount') }))
      const departments = [...new Map([...context.organizations.values()].flatMap(org => localDepartments(org)).map(row => [row.id, row])).values()]
      const salespeople = [...new Map([...context.organizations.values()].flatMap(org => localSalespeople(org, query)).map(row => [row.id, row])).values()]
      return { source: this.mock ? 'mock' as const : 'fop' as const, refreshedAt: new Date().toISOString(), items, total: Number((query.queue === 'rma' ? summary.case_count : summary.order_count) ?? 0), page, pageSize, departments, salespeople, ...(shippingCountries?{shippingCountries}:{}), queueState: 'ready',
        totals: { orderCount: Number(summary.order_count ?? 0), itemQuantity: monies.reduce((sum, row) => sum + localNumber(row.quantity, 'quantity total'), 0), ...(stock ? { amounts: amountRows } : { amountsByCurrency: amountRows }),...returnTotals, ...(query.queue === 'rma' ? {caseCount:Number(summary.case_count ?? 0)} : {}) },
        replica: { readMode: 'local' as const, datasetId: context.scopes.map(scope => scope.datasetId).sort().join(','), revision: context.companies.map(company=>`${company.company_id}:${String(company.applied_watermarks?._local?.projectionRevision??'0')}`).sort().join(','), sourceSyncedAt: syncProof[0]?.source_synced_at ? new Date(syncProof[0].source_synced_at).toISOString() : null } }
    })
  }

  /** These projections require verified source mappings before local delivery; never delegate to a live provider. */
  async getRmaOrders(userId: string, query: RmaQueryDto) { return this.orders(userId, { ...query, queue: 'rma', rmaType: query.type, rmaFlowStatus: query.flowStatus }, 'sales', false) }
  async getPurchaseGroups(userId: string, query: PurchaseGroupQueryDto) { return this.purchaseGroups(userId, query) }
  async getPurchaseGroupDetails(userId: string, groupId: string, query: PurchaseGroupQueryDto) { return this.purchaseGroups(userId, query, groupId) }
  private async purchaseGroups(userId: string, query: PurchaseGroupQueryDto, groupId?: string): Promise<any> {
    if(this.collected?.enabled)return this.collected.unavailable(userId,query,'procurement',groupId)
    if(query.purchaseStage && query.purchaseStage!=='uncreated'&&!this.mock) throw unconfigured('Purchase payment/placement stage filters need a normalized standalone purchase status projection')
    return this.read(async manager=>{
      const context=await this.context(manager,userId,'procurement',query,['orders','purchases'])
      const sql=buildLocalOrderQuery(context.scopes,{...query,purchaseGrouping:true})
      const incomplete: LocalRow[]=await manager.query(`SELECT count(*) AS n ${sql.from} WHERE ${sql.completenessWhere} AND (${query.queue==='procurement' ? 'delivery.incomplete OR' : ''} o.readiness<>'ready' OR o.ownership_verified_at IS NULL OR o.ownership_verified_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds' OR sd.validation_state<>'verified' OR m.classification_state IS NULL OR m.classification_state='unknown' OR m.projection_revision<>o.projection_revision)`,sql.completenessValues)
      if(Number(incomplete[0]?.n)>0) throw new ServiceUnavailableException({code:'workbench_replica_incomplete',total:null,queueState:'incomplete',message:'Procurement queue projection is incomplete'})
      const scoped=`SELECT o.*,sd.source_id ${sql.from} WHERE ${sql.where} AND ${query.completed ? "m.classification_state IN ('member','non_member') AND (native.raw_purchase_status IN ('3','4') OR EXISTS(SELECT 1 FROM hz_fop_workbench_purchase_allocations candidate_purchase WHERE candidate_purchase.order_document_id=o.document_id AND candidate_purchase.company_id=o.company_id AND candidate_purchase.dataset_id=o.dataset_id))" : "m.classification_state='member'"} AND o.readiness='ready' AND m.projection_revision=o.projection_revision`
      const broken:LocalRow[]=await manager.query(`WITH scoped AS (${scoped}) SELECT count(*) AS n FROM scoped o WHERE NOT EXISTS (SELECT 1 FROM hz_fop_workbench_procurement_demands d WHERE d.order_document_id=o.document_id AND d.company_id=o.company_id AND d.dataset_id=o.dataset_id AND d.projection_revision=o.projection_revision)
        OR EXISTS (SELECT 1 FROM hz_fop_workbench_procurement_demands d WHERE d.order_document_id=o.document_id AND d.company_id=o.company_id AND d.dataset_id=o.dataset_id AND (d.calculation_state<>'known' OR d.projection_revision<>o.projection_revision OR d.unassigned_quantity IS NULL))
        OR EXISTS (SELECT 1 FROM hz_fop_workbench_purchase_allocations a WHERE a.order_document_id=o.document_id AND a.company_id=o.company_id AND a.dataset_id=o.dataset_id AND (a.allocation_state<>'known' OR a.projection_revision<>o.projection_revision OR a.allocated_requirement_quantity IS NULL OR a.supplier_shipped_quantity IS NULL OR a.cancelled_quantity IS DISTINCT FROM 0 OR a.returned_quantity IS DISTINCT FROM 0))`,sql.values)
      if(Number(broken[0]?.n)>0)throw new ServiceUnavailableException({code:'workbench_replica_incomplete',message:'Exact procurement demand, allocation, cancellation or return coverage is incomplete',total:null})
      const mockStage:Record<string,string>={placement_pending:"sf.raw_platform_status='pending'",payment_pending:"sf.raw_platform_status='placed' AND sf.raw_trade_status IN ('unpaid','partial')",refund_pending:"sf.raw_trade_status='refunded'"}
      const groupFilter=query.purchaseStage==='uncreated'?"WHERE b.group_id='uncreated'":this.mock&&query.purchaseStage&&mockStage[query.purchaseStage]?`WHERE EXISTS (SELECT 1 FROM hz_fop_purchase_orders sf WHERE sf.document_id=b.purchase_document_id AND sf.company_id=o.company_id AND sf.dataset_id=o.dataset_id AND ${mockStage[query.purchaseStage]})`:''
      const obligations=`WITH scoped AS (${scoped}), obligations AS (
        SELECT a.order_document_id,a.order_line_id,a.purchase_line_id,a.purchase_document_id,('purchase:'||a.purchase_document_id::text) AS group_id,a.allocated_requirement_quantity AS quantity,a.supplier_shipped_quantity AS shipped
        FROM hz_fop_workbench_purchase_allocations a JOIN scoped o ON o.document_id=a.order_document_id AND o.company_id=a.company_id AND o.dataset_id=a.dataset_id AND o.projection_revision=a.projection_revision
        JOIN hz_fop_source_documents pd ON pd.id=a.purchase_document_id AND pd.company_id=a.company_id AND pd.dataset_id=a.dataset_id AND pd.deleted_at IS NULL AND pd.validation_state='verified'
        WHERE ${localResourceGrantSql('purchases','pd.source_id')}
        UNION ALL SELECT d.order_document_id,d.order_line_id,NULL::uuid,NULL::uuid,'uncreated',d.unassigned_quantity,0::numeric
        FROM hz_fop_workbench_procurement_demands d JOIN scoped o ON o.document_id=d.order_document_id AND o.company_id=d.company_id AND o.dataset_id=d.dataset_id AND o.projection_revision=d.projection_revision
        WHERE d.unassigned_quantity>0 ${query.completed || query.queue==='procurement_shipping' ? 'AND FALSE' : ''}
      ), linked_groups AS (SELECT b.group_id,count(DISTINCT b.order_document_id)::int AS detail_order_count,count(DISTINCT NULLIF(btrim(l.sku_code),''))::int AS sku_count,sum(b.quantity) AS quantity,sum(b.shipped) AS shipped_quantity,sum(b.quantity-b.shipped) AS pending_quantity,max(o.customer_paid_at) AS latest_paid_at,min(o.customer_paid_at) AS earliest_paid_at
        FROM obligations b JOIN scoped o ON o.document_id=b.order_document_id
        JOIN hz_fop_source_lines l ON l.id=b.order_line_id AND l.document_id=o.document_id AND l.company_id=o.company_id AND l.dataset_id=o.dataset_id
        ${groupFilter} GROUP BY b.group_id), purchase_entries AS (
        SELECT g.group_id,l.id,l.sku_code,d.sales_order_number,d.ordered_quantity,d.supplier_shipped_quantity,d.cancelled_quantity,
          EXISTS(SELECT 1 FROM hz_fop_workbench_purchase_allocations a WHERE a.purchase_line_id=l.id AND a.purchase_document_id=l.document_id AND a.company_id=l.company_id AND a.dataset_id=l.dataset_id) AS has_source,
          EXISTS(SELECT 1 FROM hz_fop_workbench_purchase_allocations a
            LEFT JOIN hz_fop_workbench_orders linked_order ON linked_order.document_id=a.order_document_id AND linked_order.company_id=a.company_id AND linked_order.dataset_id=a.dataset_id
            LEFT JOIN hz_fop_source_documents linked_sd ON linked_sd.id=linked_order.document_id AND linked_sd.company_id=a.company_id AND linked_sd.dataset_id=a.dataset_id
            WHERE a.purchase_line_id=l.id AND a.purchase_document_id=l.document_id AND a.company_id=l.company_id AND a.dataset_id=l.dataset_id
              AND (linked_order.document_id IS NULL OR linked_sd.deleted_at IS NOT NULL OR linked_sd.validation_state IS DISTINCT FROM 'verified'
                OR linked_order.readiness IS DISTINCT FROM 'ready' OR linked_order.ownership_verified_at IS NULL OR linked_order.ownership_verified_at<CURRENT_TIMESTAMP-INTERVAL '60 seconds'
                OR linked_order.ownership_verified_at>CURRENT_TIMESTAMP OR linked_order.ownership_version IS NULL
                OR a.allocation_state IS DISTINCT FROM 'known' OR a.projection_revision IS DISTINCT FROM linked_order.projection_revision
                OR NOT ${localResourceGrantSql('orders','linked_sd.source_id','linked_order.company_id','linked_order.connection_id')}
                OR NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS allowed_scope(connection_id uuid,company_id uuid,dataset_id uuid,employee_ids text[])
                  WHERE allowed_scope.connection_id=linked_order.connection_id AND allowed_scope.company_id=linked_order.company_id AND allowed_scope.dataset_id=linked_order.dataset_id
                    AND (allowed_scope.employee_ids IS NULL OR linked_order.owner_employee_id=ANY(allowed_scope.employee_ids))))) AS source_unavailable
        FROM linked_groups g JOIN hz_fop_source_documents pd ON pd.id=CASE WHEN g.group_id='uncreated' THEN NULL ELSE substring(g.group_id FROM 10)::uuid END
        JOIN hz_fop_source_lines l ON l.document_id=pd.id AND l.company_id=pd.company_id AND l.dataset_id=pd.dataset_id AND l.removed_at IS NULL
        LEFT JOIN hz_fop_procurement_line_details d ON d.line_id=l.id AND d.company_id=l.company_id AND d.dataset_id=l.dataset_id
      ), purchase_totals AS (
        SELECT group_id,count(DISTINCT NULLIF(btrim(sales_order_number),''))::int AS order_count,count(DISTINCT NULLIF(btrim(sku_code),''))::int AS sku_count,
          sum(ordered_quantity) AS quantity,sum(supplier_shipped_quantity) AS shipped_quantity,sum(ordered_quantity-supplier_shipped_quantity) AS pending_quantity,
          bool_or(sales_order_number IS NULL OR NULLIF(btrim(sku_code),'') IS NULL OR ordered_quantity IS NULL OR ordered_quantity<=0
            OR supplier_shipped_quantity IS NULL OR supplier_shipped_quantity<0 OR supplier_shipped_quantity>ordered_quantity OR cancelled_quantity IS DISTINCT FROM 0 OR NOT has_source OR source_unavailable) AS incomplete
        FROM purchase_entries GROUP BY group_id
      ), all_groups AS (
        SELECT g.group_id,g.detail_order_count,g.latest_paid_at,g.earliest_paid_at,
          CASE WHEN g.group_id='uncreated' THEN g.detail_order_count ELSE p.order_count END AS order_count,
          CASE WHEN g.group_id='uncreated' THEN g.sku_count ELSE p.sku_count END AS sku_count,
          CASE WHEN g.group_id='uncreated' THEN g.quantity ELSE p.quantity END AS quantity,
          CASE WHEN g.group_id='uncreated' THEN g.shipped_quantity ELSE p.shipped_quantity END AS shipped_quantity,
          CASE WHEN g.group_id='uncreated' THEN g.pending_quantity ELSE p.pending_quantity END AS pending_quantity,
          g.group_id<>'uncreated' AND (p.group_id IS NULL OR p.incomplete) AS incomplete
        FROM linked_groups g LEFT JOIN purchase_totals p ON p.group_id=g.group_id
      ), groups AS (SELECT * FROM all_groups WHERE ${query.completed ? "group_id<>'uncreated' AND pending_quantity=0 AND quantity>0" : 'pending_quantity>0'})`
      const invalidGroups:LocalRow[]=await manager.query(`${obligations} SELECT count(*)::int AS n FROM all_groups WHERE incomplete`,sql.values)
      if(Number(invalidGroups[0]?.n)>0)throw new ServiceUnavailableException({code:'workbench_replica_incomplete',total:null,message:'Whole purchase entries, source sales numbers or full document authorization are incomplete'})
      const stats:LocalRow[]=await manager.query(`${obligations} SELECT count(*)::int AS group_count,count(*) FILTER (WHERE group_id<>'uncreated')::int AS purchase_count,COALESCE(sum(pending_quantity),0) AS pending_quantity FROM groups`,sql.values)
      const orderStats:LocalRow[]=await manager.query(`${obligations} SELECT count(DISTINCT b.order_document_id)::int AS order_count,count(DISTINCT b.order_document_id) FILTER (WHERE b.group_id='uncreated')::int AS uncreated_count FROM obligations b JOIN groups g ON g.group_id=b.group_id`,sql.values)
      const groupRows:LocalRow[]=await manager.query(`${obligations} SELECT g.*,pd.source_id AS purchase_source_id,pd.document_number,p.purchase_type,p.platform_code,p.supplier_id,p.raw_trade_status,p.raw_platform_status,
        (SELECT po.external_order_id FROM hz_fop_platform_orders po WHERE po.purchase_document_id=pd.id AND po.company_id=pd.company_id AND po.dataset_id=pd.dataset_id AND po.removed_at IS NULL LIMIT 1) AS platform_order_number,
        p.paid_at AS purchase_paid_at,
        (SELECT ri.name FROM hz_fop_reference_items ri WHERE ri.connection_id=pd.connection_id AND ri.company_id=pd.company_id AND ri.resource_type='supplier' AND ri.source_id=p.supplier_id AND ri.deleted_at IS NULL LIMIT 1) AS supplier_name
        FROM groups g LEFT JOIN hz_fop_source_documents pd ON pd.id=CASE WHEN g.group_id='uncreated' THEN NULL ELSE substring(g.group_id FROM 10)::uuid END
        LEFT JOIN hz_fop_purchase_orders p ON p.document_id=pd.id AND p.company_id=pd.company_id AND p.dataset_id=pd.dataset_id
        ${groupId ? `WHERE g.group_id=$${sql.values.length+1}` : ''} ORDER BY (g.group_id='uncreated') DESC,g.latest_paid_at ${query.sortOrder==='asc'?'ASC':'DESC'} NULLS LAST,g.group_id
        LIMIT $${sql.values.length+(groupId?2:1)} OFFSET $${sql.values.length+(groupId?3:2)}`,[...sql.values,...(groupId?[groupId]:[]),groupId?1:query.pageSize,groupId?0:(query.page-1)*query.pageSize])
      if(groupId && !groupRows.length)throw new NotFoundException('Purchase group unavailable')
      const summaries=groupRows.map(row=>({id:row.group_id,kind:row.group_id==='uncreated'?'uncreated':'purchase',purchase:row.group_id==='uncreated'?null:{id:row.purchase_source_id,number:row.document_number??'',purchaseType:row.purchase_type??'unknown',platform:row.platform_code==='1688'?'1688':row.platform_code?'other':null,supplier:{id:row.supplier_id??'',name:row.supplier_name??''},platformOrderNumber:row.platform_order_number??null,payment:this.mock&&['paid','unpaid','partial','refunded'].includes(row.raw_trade_status)?row.raw_trade_status:'unknown',placement:this.mock&&['pending','placed'].includes(row.raw_platform_status)?row.raw_platform_status:'unknown',paidAt:row.purchase_paid_at?new Date(row.purchase_paid_at).toISOString():null},orderCount:row.order_count,skuCount:row.sku_count,quantity:localNumber(row.quantity,'procurement quantity'),shippedQuantity:localNumber(row.shipped_quantity,'supplier shipped quantity'),pendingQuantity:localNumber(row.pending_quantity,'pending procurement quantity'),shipment:row.group_id==='uncreated'?'unknown':Number(row.shipped_quantity)===0?'pending':Number(row.pending_quantity)===0?'shipped':'partial',earliestReceiptAt:row.earliest_paid_at?new Date(row.earliest_paid_at).toISOString():null,latestConsumerPaidAt:row.latest_paid_at?new Date(row.latest_paid_at).toISOString():null}))
      if(groupId){
        const values=[...sql.values,groupId]
        const details:LocalRow[]=await manager.query(`${obligations} SELECT o.*,b.order_line_id,pl.source_entry_id AS purchase_entry_id,b.quantity AS obligation_quantity,b.shipped AS shipped_quantity,l.source_entry_id,l.sku_code,l.product_name,l.image_url,l.variant
          FROM (SELECT b.order_document_id FROM obligations b JOIN scoped detail_order ON detail_order.document_id=b.order_document_id WHERE b.group_id=$${values.length} GROUP BY b.order_document_id,detail_order.customer_paid_at ORDER BY detail_order.customer_paid_at ${query.sortOrder==='asc'?'ASC':'DESC'} NULLS LAST,b.order_document_id LIMIT $${values.length+1} OFFSET $${values.length+2}) selected
          JOIN scoped o ON o.document_id=selected.order_document_id JOIN obligations b ON b.order_document_id=o.document_id AND b.group_id=$${values.length}
          JOIN hz_fop_source_lines l ON l.id=b.order_line_id AND l.document_id=o.document_id AND l.company_id=o.company_id AND l.dataset_id=o.dataset_id
          LEFT JOIN hz_fop_source_lines pl ON pl.id=b.purchase_line_id AND pl.document_id=b.purchase_document_id AND pl.company_id=o.company_id AND pl.dataset_id=o.dataset_id
          ORDER BY o.customer_paid_at ${query.sortOrder==='asc'?'ASC':'DESC'} NULLS LAST,o.document_id,l.sequence,pl.source_entry_id`,[...values,query.pageSize,(query.page-1)*query.pageSize])
        const rows=new Map<string,any>()
        for(const detail of details){let row=rows.get(detail.document_id);if(!row){const mapped=localOwnership(localOrder(detail,[]),context.organizations.get(detail.company_id)!);row={orderId:mapped.id,orderNumber:mapped.orderNumber,shopifyOrderNumber:mapped.shopifyOrderNumber,customerName:mapped.customerName,storeName:mapped.storeName,ownerName:mapped.owner?.name??'',departmentName:mapped.department?.name??'',warehouse:mapped.warehouse,paidAt:mapped.paidAt,consumerPaidAt:mapped.consumerPaidAt,lines:[]};rows.set(detail.document_id,row)}row.lines.push({fulfillmentLineId:detail.source_entry_id,purchaseLineId:detail.purchase_entry_id??null,sku:detail.sku_code??'',name:detail.product_name??'',imageUrl:detail.image_url??null,variant:detail.variant??'',quantity:localNumber(detail.obligation_quantity,'requirement quantity'),shippedQuantity:localNumber(detail.shipped_quantity,'shipped quantity')})}
        await this.recheck(context,manager)
        return {group:summaries[0],items:[...rows.values()],total:groupRows[0].detail_order_count,page:query.page,pageSize:query.pageSize}
      }
      await this.recheck(context,manager)
      return {source:this.mock?'mock':'fop',refreshedAt:new Date().toISOString(),items:summaries,departments:[...context.organizations.values()].flatMap(localDepartments),total:stats[0]?.group_count??0,page:query.page,pageSize:query.pageSize,totals:{groupCount:stats[0]?.group_count??0,purchaseCount:stats[0]?.purchase_count??0,orderCount:orderStats[0]?.order_count??0,uncreatedCount:orderStats[0]?.uncreated_count??0,pendingQuantity:localNumber(stats[0]?.pending_quantity??'0','pending quantity')}}
    })
  }
  async getPurchaseReturns(userId: string, query: PurchaseReturnQueryDto) {
    if(this.collected?.enabled)return this.collected.unavailable(userId,query,query.workbenchRole)
    if(!['procurement','warehouse'].includes(query.workbenchRole))throw new BadRequestException('Invalid purchase return role')
    if(query.status && query.status!=='unknown'&&!this.mock)throw unconfigured('Physical return progress requires a normalized physical-state projection; platform refund state cannot substitute')
    return this.orders(userId,{...query,queue:'purchase_returns',...(this.mock?{returnStatus:query.status}:{})},query.workbenchRole,false)
  }

  async getStockCustomers(userId: string, query: unknown): Promise<any> { await this.account(userId, 'sales'); if(this.mock)return new MockWorkbenchCapabilities(this.db,this).stockCustomers(userId,query as LocalRow); throw unconfigured('On-demand FOP customer ownership API is not configured') }
  async getStockInventory(userId: string, query: unknown): Promise<any> { await this.account(userId); if(this.mock)return new MockWorkbenchCapabilities(this.db,this).stockInventory(userId,query as LocalRow); throw unconfigured('On-demand FOP reserved-stock API is not configured') }
  async getAllocationInventory(userId: string, query: unknown): Promise<any> { await this.account(userId,(query as LocalRow).queue==='shipping'?'warehouse':'allocation'); if(this.mock)return new MockWorkbenchCapabilities(this.db,this).allocationInventory(userId,query as LocalRow); throw unconfigured('On-demand FOP current-inventory API is not configured') }
  async unavailableSupplier(userId: string): Promise<any> { await this.account(userId); throw unconfigured('Supplier contacts require independent current source revalidation') }
  private async refreshExportAuthorization(userId: string): Promise<void> {
    if (this.mock) return
    const unavailable = () => new ServiceUnavailableException({ code: 'workbench_replica_export_revalidation_required', message: 'Export delivery requires current source authorization and ownership revalidation; the source adapter is unavailable' })
    const authorization = this.authorization
    if (!authorization) throw unavailable()
    const account = await this.account(userId), companies = await this.companies(account)
    if (!companies.length) throw unavailable()
    try {
      for (const company of companies) {
        const proof = await authorization.refresh({ connectionId: company.connection_id, companyId: company.company_id })
        const streams: LocalRow[] = await this.db.query(`SELECT s.stream_key,s.source_scope_version,s.applied_cursor FROM hz_fop_sync_streams s
          JOIN hz_fop_companies co ON co.active_dataset_id=s.dataset_id AND co.id=s.company_id AND co.connection_id=s.connection_id
          WHERE co.connection_id=$1 AND co.id=$2 AND co.enabled`, [company.connection_id, company.company_id])
        // A fresh authorization lease alone cannot prove that local ownership has caught up.
        if (!streams.length || streams.length !== Object.keys(proof.ownershipVector).length
          || streams.some(stream => stream.source_scope_version !== proof.scopeVersion || proof.ownershipVector[stream.stream_key] !== stream.applied_cursor)) throw unavailable()
      }
    } catch (error) {
      if (error instanceof ForbiddenException || /(?:company_access_denied|permission_denied)/.test((error as Error).message)) {
        throw new ForbiddenException('Current source authorization does not allow export delivery', { cause: error })
      }
      throw new ServiceUnavailableException(unavailable().getResponse(), { cause: error })
    }
  }

  private async exportSnapshot(userId: string): Promise<{ replica: ReplicaExportProof; signature: string }> {
    const user = await this.account(userId), companies = await this.companies(user)
    if (!companies.length || companies.some(company => !company.active_dataset_id || company.dataset_state !== 'active' || !company.validated_at || !company.activated_at)) throw new ConflictException('Active export dataset is unavailable')
    const organizations: unknown[] = []
    for (const company of companies) organizations.push([company.company_id, (await this.organization(this.db, user, company)).version])
    if (!this.mock) {
      const proofs: { company: CompanyRow; grants: LocalRow[] }[] = []
      for (const company of companies) proofs.push({ company, grants: await this.db.query(`SELECT verified_at,source_as_of,expires_at FROM hz_fop_resource_grants
        WHERE connection_id=$1 AND company_id=$2`, [company.connection_id, company.company_id]) })
      // Evaluate after every awaited lookup: a proof may expire while organizations or another company are read.
      const now = Date.now(), time = (value: unknown) => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
      for (const { company, grants } of proofs) {
        const verified = time(company.verified_at), expires = time(company.expires_at)
        if (!Number.isFinite(verified) || verified > now || verified < now - 60_000 || !Number.isFinite(expires) || expires <= now || !grants.length
          || grants.some(grant => time(grant.verified_at) !== verified || time(grant.source_as_of) !== verified || time(grant.expires_at) !== expires)) {
          throw new ServiceUnavailableException({ code: 'workbench_replica_export_revalidation_required', message: 'Current company and resource proofs expired or no longer share the verified source lease' })
        }
      }
    }
    return {
      replica: { readMode: 'local', datasetId: companies.map(company => company.active_dataset_id!).sort().join(','), revision: companies.map(company => `${company.company_id}:${String(company.applied_watermarks?._local?.projectionRevision ?? '0')}`).sort().join(',') },
      signature: JSON.stringify([this.mock, user.role, user.businessRole, user.businessDepartmentId, user.businessEmployeeId, user.dataDisplayScope, [...(user.workbenchRoles ?? [])].sort(), user.sessionVersion,
        companies.map(company => [company.connection_id, company.company_id, company.active_dataset_id, String(company.scope_version)]), organizations]),
    }
  }

  private async localExport(userId:string, query:LocalRow, version:number, kind:'orders'|'stock'|'rma'|'groups'|'returns'):Promise<Buffer> {
    if(this.collected?.enabled)return this.collected.export(userId,query,version,kind)
    const assertSession=async()=>{const account=await this.account(userId);if((account.sessionVersion??0)!==version)throw new UnauthorizedException('Session expired')}
    await assertSession()
    const ids=kind==='groups'?query.groupIds:kind==='rma'?query.caseIds:query.orderIds
    if(!['selected','filtered'].includes(query.mode)||query.mode==='selected'&&(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)||query.mode==='filtered'&&ids!==undefined)throw new BadRequestException('Invalid export selection')
    await this.refreshExportAuthorization(userId)
    const initial = await this.exportSnapshot(userId), source = this.mock ? 'mock' as const : 'fop' as const
    const assertSnapshot = async () => {
      const current = await this.exportSnapshot(userId)
      if (current.signature !== initial.signature || !sameReplicaExportProof(current.replica, initial.replica)) throw new ConflictException({ code: 'workbench_replica_export_changed', message: 'Export dataset, published revision or current account scope changed' })
      return current
    }
    const page = async (read: () => Promise<any>, groupDetails = false) => {
      await assertSnapshot()
      const result = await read()
      const current = await assertSnapshot()
      if (result.source !== undefined && result.source !== source) throw new ConflictException('Export source changed during pagination')
      // Group projections predate response metadata; bound them to the independently checked local publication.
      return groupDetails || kind === 'groups' ? { ...result, replica: result.replica ?? current.replica } : result
    }
    const load=()=>collectReplicaPages<LocalRow>(async pageNumber=>{
      const q={...query,page:pageNumber,pageSize:100} as any
      return page(()=>kind==='orders'?this.getOrders(userId,q):kind==='stock'?this.getStockOrders(userId,q):kind==='rma'?this.getRmaOrders(userId,q):kind==='groups'?this.getPurchaseGroups(userId,q):this.getPurchaseReturns(userId,q))
    }, initial.replica)
    const select=(rows:LocalRow[])=>query.mode==='selected'?rows.filter(row=>ids.includes(row.id)):rows
    const currentRows=async()=>{
      const current=select((await load()).items).map(row=>({...row}))
      if(kind==='groups')for(const row of current)row.rows=(await collectReplicaPages<LocalRow>(pageNumber=>page(()=>this.getPurchaseGroupDetails(userId,row.id,{...query,page:pageNumber,pageSize:100} as any),true),initial.replica)).items
      return current
    }
    const rows=await currentRows()
    if(query.mode==='selected'&&rows.length!==ids.length)throw new ConflictException('Selected records changed or are outside the current scope')
    if(!rows.length)throw new ConflictException('No records to export')
    let buffer:Buffer
    if(kind==='groups'){
      buffer=await buildPurchaseGroupWorkbook(rows as any,query as any,source)
    }else buffer=kind==='orders'?await buildFulfillmentWorkbook(rows as any,query as any,source):kind==='stock'?await buildStockWorkbook(rows as any,source,query.queue!=='procurement',query):kind==='rma'?await buildRmaWorkbook(rows as any,query as any,source):await buildPurchaseReturnWorkbook(rows as any,query as any,source)
    const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(key,item)=>key==='hours'?undefined:item)).digest('hex')
    if(digest(rows)!==digest(await currentRows()))throw new ConflictException('Data or permissions changed before export delivery')
    await this.refreshExportAuthorization(userId)
    await assertSnapshot()
    await assertSession()
    await assertSnapshot()
    return buffer
  }
  async exportOrders(userId: string, query: unknown, sessionVersion = 0): Promise<Buffer> { return this.localExport(userId,query as LocalRow,sessionVersion,'orders') }
  async exportStockOrders(userId: string, query: unknown, sessionVersion = 0): Promise<Buffer> { return this.localExport(userId,query as LocalRow,sessionVersion,'stock') }
  async exportRmaOrders(userId: string, query: unknown, sessionVersion = 0): Promise<Buffer> { return this.localExport(userId,query as LocalRow,sessionVersion,'rma') }
  async exportPurchaseGroups(userId: string, query: unknown, sessionVersion = 0): Promise<Buffer> { return this.localExport(userId,query as LocalRow,sessionVersion,'groups') }
  async exportPurchaseReturns(userId: string, query: unknown, sessionVersion = 0): Promise<Buffer> { return this.localExport(userId,query as LocalRow,sessionVersion,'returns') }
}
