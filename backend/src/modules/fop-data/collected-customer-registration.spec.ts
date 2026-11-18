import { customerCreatedAt, normalizeCustomerRegistration } from './collected-customer-registration'
const context={companyId:'100000',capturedAt:'2026-11-16T08:00:00.000Z'}
const row={id:'9007199254740993001',createorg_id:'100000',hzkj_biz_user_id:'700',hzkj_biz_user_name:'Alex',createtime:'2026-11-01 00:00:00'}
it('preserves exact source UserField ID and raw payload, without resolving by display name',()=>{
 expect(normalizeCustomerRegistration(row,context)).toMatchObject({source_id:row.id,source_owner_user_id:'700',created_at:'2026-10-31T16:00:00.000Z',raw:row})
 expect(normalizeCustomerRegistration({...row,hzkj_biz_user_id:null},context).source_owner_user_id).toBeNull()
 expect(()=>normalizeCustomerRegistration({...row,id:Number('9007199254740993001')},context)).toThrow()
 expect(()=>normalizeCustomerRegistration({...row,createorg_id:'200000'},context)).toThrow()
})
it('uses UTC+8 boundaries and rejects missing, partial or impossible creation timestamps',()=>{
 expect(customerCreatedAt('2026-11-01T00:00:00+08:00')).toBe('2026-10-31T16:00:00.000Z')
 expect(customerCreatedAt('2026-11-01T00:00:00Z')).toBe('2026-11-01T00:00:00.000Z')
 for(const v of [null,'2026-11-01','2026-02-30 00:00:00','2026-11-01 25:00:00','invalid'])expect(customerCreatedAt(v)).toBeNull()
})
