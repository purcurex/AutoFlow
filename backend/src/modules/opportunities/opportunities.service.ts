import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { DataSource, EntityManager } from 'typeorm'
import { randomUUID } from 'crypto'
import { User } from '../users/user.entity'
import { readBusinessOwners } from '../users/business-data-access'
import { normalizeShippingCountry } from '../fop-data/shipping-country'
import { applyFollowUp, assertVersion, canWrite, exportWorkbook, FIELD_COLUMNS, opportunityOptions, validateFields, validateFollowUp, validateQuery } from './opportunity-rules'

type Scope={actor:User;ids:string[];signature:string}
type Store=DataSource|EntityManager
const projection=`o.*,o.registered_on::text AS registered_on,o.last_followed_on::text AS last_followed_on, COALESCE((SELECT NULLIF(e.name,'') FROM organization_employees e WHERE e.account_id=u.id ORDER BY e.archived_at NULLS FIRST,e.created_at DESC,e.id LIMIT 1),u.username) AS owner_name, l.brand_name AS source_lead_name`
const joins=`FROM local_opportunities o JOIN users u ON u.id=o.owner_user_id LEFT JOIN leads l ON l.id=o.source_lead_id`
function camelRow(row:Record<string,any>):Record<string,any> {
  return Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),value]))
}
@Injectable()
export class OpportunitiesService {
  constructor(private readonly dataSource:DataSource) {}

  private async scope(actorId:string, store:Store=this.dataSource):Promise<Scope> {
    const actor=await store.getRepository(User).findOne({where:{id:actorId}})
    if(!actor || actor.accountDisabled) throw new UnauthorizedException('账号已停用或不存在')
    const {ids}=await readBusinessOwners(store as DataSource,actorId)
    return {actor,ids,signature:JSON.stringify([actor.sessionVersion,actor.role,actor.businessRole,actor.businessDepartmentId,actor.fopTenantId,actor.fopBindingDetails?.organizationId,ids.slice().sort()])}
  }
  private async recheck(actorId:string, previous:Scope, store:Store=this.dataSource) {
    const next=await this.scope(actorId,store)
    if(previous.signature!==next.signature) throw new ForbiddenException('账号权限已变化，请刷新后重试')
  }
  private writable(scope:Scope, ownerId:string) {
    if(!canWrite(scope.actor,ownerId,scope.ids)) throw new ForbiddenException('仅所属业务员或同公司系统管理员可修改商机')
  }
  private dto(row:Record<string,any>, scope:Scope) {
    const item=camelRow(row)
    // Audit foreign keys and deletion markers remain server-owned.
    delete item.deletedAt;delete item.deletedBy;delete item.createdBy;delete item.updatedBy
    item.canEdit=canWrite(scope.actor,item.ownerUserId,scope.ids);item.canDelete=item.canEdit
    return item
  }
  async options(actorId:string) {
    const scope=await this.scope(actorId), result=opportunityOptions()
    await this.recheck(actorId,scope);return result
  }
  private conditions(scope:Scope,query:Record<string,any>) {
    const args:any[]=[scope.ids],terms=['o.deleted_at IS NULL','o.owner_user_id = ANY($1::uuid[])']
    const add=(sql:string,value:any)=>{args.push(value);terms.push(sql.replace('?',`$${args.length}`))}
    if(query.ownerId) {if(!scope.ids.includes(query.ownerId)) throw new ForbiddenException('业务员不在当前可见范围');add('o.owner_user_id = ?::uuid',query.ownerId)}
    if(query.search) add("(o.customer_name ILIKE ? ESCAPE '\\' OR o.number ILIKE ? ESCAPE '\\')",`%${query.search.replace(/[\\%_]/g,'\\$&')}%`)
    // Search uses one bound value for both fields.
    if(query.search) terms[terms.length-1]=terms[terms.length-1].replace('?',`$${args.length}`)
    if(query.stage) add('o.stage = ?',query.stage)
    if(query.country) add('o.country = ?',query.country)
    if(query.from) add('o.registered_on >= ?::date',query.from)
    if(query.to) add('o.registered_on <= ?::date',query.to)
    return {where:terms.join(' AND '),args}
  }
  async list(actorId:string,input:Record<string,unknown>={}) {
    const scope=await this.scope(actorId),query=validateQuery(input),{where,args}=this.conditions(scope,query)
    const totals=await this.dataSource.query(`SELECT count(*)::int AS total ${joins} WHERE ${where}`,args)
    const rows=await this.dataSource.query(`SELECT ${projection} ${joins} WHERE ${where} ORDER BY o.registered_on DESC,o.created_at DESC,o.id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,query.pageSize,(query.page-1)*query.pageSize])
    const owners=await this.dataSource.query(`SELECT u.id,COALESCE((SELECT NULLIF(e.name,'') FROM organization_employees e WHERE e.account_id=u.id ORDER BY e.archived_at NULLS FIRST,e.created_at DESC,e.id LIMIT 1),u.username) AS name FROM users u WHERE u.id=ANY($1::uuid[]) ORDER BY name,u.id`,[scope.ids])
    const result={items:rows.map((r:any)=>this.dto(r,scope)),total:totals[0].total,page:query.page,pageSize:query.pageSize,owners}
    await this.recheck(actorId,scope);return result
  }
  async detail(actorId:string,id:string) {
    const scope=await this.scope(actorId)
    const result=await this.readDetail(this.dataSource,scope,id)
    await this.recheck(actorId,scope);return result
  }
  private async readDetail(store:Store,scope:Scope,id:string) {
    const rows=await store.query(`SELECT ${projection} ${joins} WHERE o.id=$1 AND o.deleted_at IS NULL AND o.owner_user_id=ANY($2::uuid[])`,[id,scope.ids])
    if(!rows.length) throw new NotFoundException('商机不存在')
    const history=await store.query(`SELECT f.*,f.followed_on::text AS followed_on,u.username AS created_by_name FROM local_opportunity_follow_ups f JOIN users u ON u.id=f.created_by WHERE f.opportunity_id=$1 ORDER BY f.followed_on DESC,f.created_at DESC,f.id DESC`,[id])
    return {...this.dto(rows[0],scope),followUps:history.map(camelRow)}
  }
  private async write<T>(actorId:string, work:(manager:EntityManager,scope:Scope)=>Promise<T>):Promise<T> {
    return this.dataSource.transaction(async manager=>{
      // Account deactivation/role edits cannot pass an in-flight write unnoticed.
      await manager.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[actorId])
      const scope=await this.scope(actorId,manager)
      const result=await work(manager,scope)
      await this.recheck(actorId,scope,manager)
      return result
    })
  }
  private async insert(manager:EntityManager,actorId:string,ownerId:string,fields:Record<string,any>,leadId:string|null=null) {
    const id=randomUUID(),number=`SJ${new Date().toISOString().slice(0,10).replace(/-/g,'')}${id.replace(/-/g,'').toUpperCase()}`
    const keys=Object.keys(fields),values=[id,number,ownerId,leadId,actorId,...keys.map(k=>fields[k])]
    const conflict=leadId?' ON CONFLICT (source_lead_id) WHERE deleted_at IS NULL AND source_lead_id IS NOT NULL DO NOTHING':''
    const inserted=await manager.query(`INSERT INTO local_opportunities (id,number,owner_user_id,source_lead_id,created_by,updated_by${keys.length?','+keys.map(k=>FIELD_COLUMNS[k]).join(','):''}) VALUES ($1,$2,$3,$4,$5,$5${keys.map((_,i)=>`,$${i+6}`).join('')})${conflict} RETURNING id`,values)
    if(inserted.length) return inserted[0].id as string
    const existing=await manager.query('SELECT id FROM local_opportunities WHERE source_lead_id=$1 AND deleted_at IS NULL',[leadId])
    if(!existing.length) throw new NotFoundException('来源商机已变化，请重试')
    return existing[0].id as string
  }
  async create(actorId:string,input:Record<string,unknown>) {
    const fields=validateFields(input,true)
    return this.write(actorId,async(manager,scope)=>{
      this.writable(scope,actorId)
      const id=await this.insert(manager,actorId,actorId,fields)
      return this.readDetail(manager,scope,id)
    })
  }
  async fromLead(actorId:string,leadId:string) {
    return this.write(actorId,async(manager,scope)=>{
      // The source row lock serializes generation, including a retry after deletion.
      const leads=await manager.query('SELECT * FROM leads WHERE id=$1 AND owner_user_id=ANY($2::uuid[]) FOR UPDATE',[leadId,scope.ids])
      if(!leads.length) throw new NotFoundException('线索不存在')
      const lead=leads[0];this.writable(scope,lead.owner_user_id)
      const existing=await manager.query('SELECT id FROM local_opportunities WHERE source_lead_id=$1 AND deleted_at IS NULL',[leadId])
      if(existing.length) return this.readDetail(manager,scope,existing[0].id)
      const options=opportunityOptions(),countryText=(lead.country??'').trim(),english=new Intl.DisplayNames(['en'],{type:'region'})
      const country=normalizeShippingCountry(countryText)??options.countries.find(c=>c.label===countryText || english.of(c.value)?.toLowerCase()===countryText.toLowerCase())?.value??''
      const contacts=await manager.query("SELECT value FROM lead_contacts WHERE lead_id=$1 AND type='whatsapp' ORDER BY is_primary DESC,created_at ASC LIMIT 1",[leadId])
      let storeUrl='';try {storeUrl=validateFields({storeUrl:lead.store_url??''}).storeUrl}catch { /* A legacy free-text link remains available on the source lead. */ }
      const fields=validateFields({customerName:lead.brand_name,mainProducts:lead.category??'',country,city:lead.city??'',storeUrl,whatsapp:contacts[0]?.value??'',currentFollowUp:lead.current_follow_up??'',nextFollowUpPlan:lead.next_follow_up_plan??''},true)
      const id=await this.insert(manager,actorId,lead.owner_user_id,fields,leadId)
      return this.readDetail(manager,scope,id)
    })
  }
  private async locked(manager:EntityManager,scope:Scope,id:string,version:unknown) {
    const rows=await manager.query('SELECT *,last_followed_on::text AS last_followed_on FROM local_opportunities WHERE id=$1 AND deleted_at IS NULL AND owner_user_id=ANY($2::uuid[]) FOR UPDATE',[id,scope.ids])
    if(!rows.length) throw new NotFoundException('商机不存在')
    this.writable(scope,rows[0].owner_user_id);assertVersion(rows[0].version,version)
    return rows[0]
  }
  private async updateFields(manager:EntityManager,id:string,actorId:string,fields:Record<string,any>) {
    const columns:Record<string,string>={...FIELD_COLUMNS,lastFollowedOn:'last_followed_on'},keys=Object.keys(fields)
    const assignments=keys.map((key,i)=>`${columns[key]}=$${i+3}`)
    await manager.query(`UPDATE local_opportunities SET ${[...assignments,'version=version+1','updated_by=$2','updated_at=now()'].join(',')} WHERE id=$1`,[id,actorId,...keys.map(k=>fields[k])])
  }
  async update(actorId:string,id:string,input:Record<string,unknown>) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('资料格式不正确')
    const {version,...body}=input,fields=validateFields(body)
    return this.write(actorId,async(manager,scope)=>{
      await this.locked(manager,scope,id,version)
      await this.updateFields(manager,id,actorId,fields)
      return this.readDetail(manager,scope,id)
    })
  }
  async addFollowUp(actorId:string,id:string,input:Record<string,unknown>) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('跟进格式不正确')
    const {version,...body}=input,follow=validateFollowUp(body)
    return this.write(actorId,async(manager,scope)=>{
      const row=await this.locked(manager,scope,id,version)
      await manager.query(`INSERT INTO local_opportunity_follow_ups (id,opportunity_id,created_by,followed_on,stage,daily_volume,monthly_amount,current_follow_up,next_follow_up_plan,problem_feedback) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[randomUUID(),id,actorId,follow.followedOn,follow.stage,follow.dailyVolume,follow.monthlyAmount,follow.currentFollowUp,follow.nextFollowUpPlan,follow.problemFeedback])
      await this.updateFields(manager,id,actorId,applyFollowUp({lastFollowedOn:row.last_followed_on},follow))
      return this.readDetail(manager,scope,id)
    })
  }
  async remove(actorId:string,id:string,version:unknown) {
    return this.write(actorId,async(manager,scope)=>{
      await this.locked(manager,scope,id,version)
      await manager.query('UPDATE local_opportunities SET deleted_at=now(),deleted_by=$2,updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1',[id,actorId])
      return {deleted:true}
    })
  }
  async export(actorId:string,input:Record<string,unknown>={}) {
    const scope=await this.scope(actorId),query=validateQuery(input),{where,args}=this.conditions(scope,query)
    const rows=await this.dataSource.query(`SELECT ${projection} ${joins} WHERE ${where} ORDER BY o.registered_on DESC,o.created_at DESC,o.id DESC LIMIT 10001`,args)
    if(rows.length>10000) throw new BadRequestException('导出最多10000条，请缩小查询范围')
    const result=await exportWorkbook(rows.map((r:any)=>this.dto(r,scope)))
    await this.recheck(actorId,scope);return result
  }
}
