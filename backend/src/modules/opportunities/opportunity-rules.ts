import { BadRequestException, ConflictException } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { normalizeShippingCountry } from '../fop-data/shipping-country'

export const STAGES = [
  {value:'a_a_intentional_cooperation',label:'意向下单'}, {value:'f_non-viable_lead',label:'无效商机'},
  {value:'a_Place_an_order',label:'正式下单'}, {value:'b_related_stores',label:'关联店铺'},
  {value:'c_registration_platform',label:'注册平台'}, {value:'d_business_opportunity_conflict',label:'商机冲突'},
  {value:'e_terminate_cooperation',label:'停止合作'},
]
export const DAILY_VOLUMES = [{value:'ten',label:'1-10'},{value:'twenty',label:'11-20'},{value:'fifty',label:'20-50'},{value:'more',label:'50以上'}]
export const FIELD_COLUMNS: Record<string,string> = {customerName:'customer_name',stage:'stage',dailyVolume:'daily_volume',monthlyAmount:'monthly_amount',mainProducts:'main_products',country:'country',city:'city',businessScope:'business_scope',whatsapp:'whatsapp',storeUrl:'store_url',registeredOn:'registered_on',currentFollowUp:'current_follow_up',nextFollowUpPlan:'next_follow_up_plan',problemFeedback:'problem_feedback'}
const lengths: Record<string,number> = {customerName:160,mainProducts:4000,city:120,businessScope:4000,whatsapp:120,storeUrl:1000,currentFollowUp:8000,nextFollowUpPlan:8000,problemFeedback:8000}
const bad = (field:string): never => { throw new BadRequestException(`${field}格式不正确`) }
export function validDate(value:unknown, field='日期'): string {
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value<'1900-01-01' || value>'9999-12-31') return bad(field)
  const d=new Date(`${value}T00:00:00Z`)
  if(!Number.isFinite(d.valueOf()) || d.toISOString().slice(0,10)!==value) return bad(field)
  return value
}
export function validateFields(input:unknown, create=false): Record<string,any> {
  if(!input || typeof input!=='object' || Array.isArray(input)) return bad('资料')
  const result:Record<string,any>={}
  for(const [key,value] of Object.entries(input)) {
    if(!Object.prototype.hasOwnProperty.call(FIELD_COLUMNS,key)) return bad(key)
    if(key==='monthlyAmount') {
      if(value===null || value==='') result[key]=null
      else if(typeof value==='string' && /^\d{1,16}(\.\d{1,2})?$/.test(value)) result[key]=value
      else bad(key)
    } else if(key==='stage' || key==='dailyVolume') {
      const options=key==='stage'?STAGES:DAILY_VOLUMES
      if(value===null || value==='') result[key]=null
      else if(typeof value==='string' && options.some(o=>o.value===value)) result[key]=value
      else bad(key)
    } else if(key==='country') {
      if(value===null || value==='') result[key]=''
      else { const country=normalizeShippingCountry(value); if(!country) bad(key); result[key]=country }
    } else if(key==='registeredOn') result[key]=validDate(value,key)
    else {
      if(typeof value!=='string' || value.trim().length>(lengths[key]??8000) || value.includes('\0')) bad(key)
      result[key]=(value as string).trim()
      if(key==='customerName' && !result[key]) bad(key)
      if(key==='storeUrl' && result[key]) {
        try { const url=new URL(result[key]); if(!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password) bad(key) } catch { bad(key) }
      }
    }
  }
  if(create && !result.customerName) bad('客户名称')
  return result
}
export function validateFollowUp(input:Record<string,unknown>): Record<string,any> {
  if(!input || typeof input!=='object' || Array.isArray(input)) return bad('跟进')
  const {followedOn,...fields}=input
  const allowed=['stage','dailyVolume','monthlyAmount','currentFollowUp','nextFollowUpPlan','problemFeedback']
  if(Object.keys(fields).some(k=>!allowed.includes(k))) bad('跟进字段')
  const result:Record<string,any>={...validateFields(fields),followedOn:validDate(followedOn,'跟进日期')}
  for(const key of allowed.filter(k=>k!=='problemFeedback')) if(result[key]===undefined || result[key]===null || result[key]==='') bad(key)
  return {...result,problemFeedback:result['problemFeedback']??''}
}
export function applyFollowUp(header:{lastFollowedOn:string|null;[key:string]:any}, follow:Record<string,any>): Record<string,any> {
  if(header.lastFollowedOn && follow.followedOn<header.lastFollowedOn) return {}
  const {followedOn,...fields}=follow
  return {...fields,lastFollowedOn:followedOn}
}
export function assertVersion(current:number, requested:unknown): void {
  if(!Number.isInteger(requested) || Number(requested)<1) bad('版本')
  if(current!==requested) throw new ConflictException('商机已被修改，请刷新后重试')
}
export function canWrite(actor:{id:string;role:string;accountDisabled:boolean},ownerId:string,ids:string[]): boolean {
  return !actor.accountDisabled && ids.includes(ownerId) && (actor.id===ownerId || actor.role==='admin')
}
export function opportunityOptions() {
  const names=new Intl.DisplayNames(['zh-CN'],{type:'region'})
  const countries:Array<{value:string;label:string}>=[]
  for(let a=65;a<=90;a++) for(let b=65;b<=90;b++) {const value=String.fromCharCode(a,b); if(normalizeShippingCountry(value)) countries.push({value,label:names.of(value)??value})}
  countries.sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'))
  return {stages:STAGES,dailyVolumes:DAILY_VOLUMES,countries,currency:'USD' as const}
}
export function validateQuery(input:Record<string,unknown>={}) {
  const result:Record<string,any>={page:1,pageSize:50}
  for(const [key,value] of Object.entries(input)) {
    if(value===undefined || value==='') continue
    if(['page','pageSize'].includes(key)) {const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>(key==='page'?1000000:200))bad(key);result[key]=n}
    else if(key==='from'||key==='to') result[key]=validDate(value,key)
    else if(key==='country'||key==='stage') result[key]=validateFields({[key]:value})[key]
    else if(key==='search') {if(typeof value!=='string'||value.length>160)bad(key);result[key]=(value as string).trim()}
    else if(key==='ownerId') {if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))bad(key);result[key]=value}
    else bad(key)
  }
  if(result.from&&result.to&&result.from>result.to)bad('日期范围')
  return result
}
export async function exportWorkbook(items:Record<string,any>[]):Promise<Buffer> {
  const workbook=new Workbook(),sheet=workbook.addWorksheet('商机')
  const cols=[['number','商机单号'],['customerName','客户名称'],['ownerName','业务员'],['status','状态'],['stage','商机阶段'],['dailyVolume','预计日均量'],['monthlyAmount','预计月订单额'],['currency','币种'],['country','国家'],['city','城市'],['mainProducts','主要产品'],['businessScope','经营范围'],['whatsapp','WhatsApp'],['storeUrl','店铺链接'],['registeredOn','登记日期'],['lastFollowedOn','最后跟进日期'],['currentFollowUp','本周跟进情况'],['nextFollowUpPlan','下周计划'],['problemFeedback','问题反馈']]
  sheet.columns=cols.map(([key,header])=>({key,header,width:22}))
  const countries=opportunityOptions().countries
  for(const item of items) sheet.addRow({...item,status:'暂存',stage:STAGES.find(s=>s.value===item.stage)?.label??'',dailyVolume:DAILY_VOLUMES.find(s=>s.value===item.dailyVolume)?.label??'',country:countries.find(c=>c.value===item.country)?.label??item.country,monthlyAmount:item.monthlyAmount??''})
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}]
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
