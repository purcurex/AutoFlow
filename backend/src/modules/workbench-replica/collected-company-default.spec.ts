import { defaultCollectedCompany } from './collected-company-default'
it('defaults missing company for every capture group without modifying input or claims',()=>{
 const batch={company_id:'100000',metadata:{entityCaptures:{rma:{complete:true},stock:{companyId:''},purchase:{companyId:'other'}},analyticsCaptures:{dispatch:{companyId:null,nativeOwnership:false}}}}
 const result=defaultCollectedCompany(batch)
 expect(result.metadata.entityCaptures.rma).toMatchObject({companyId:'100000',complete:true})
 expect(result.metadata.entityCaptures.stock.companyId).toBe('100000')
 expect(result.metadata.entityCaptures.purchase.companyId).toBe('other')
 expect(result.metadata.analyticsCaptures.dispatch).toMatchObject({companyId:'100000',nativeOwnership:false})
 expect(batch.metadata.entityCaptures.rma).not.toHaveProperty('companyId')
 expect(defaultCollectedCompany(result)).toEqual(result)
})
it('does not invent missing captures or apply Huazhi defaults to other companies',()=>{
 const b={company_id:'other',metadata:{entityCaptures:{rma:{}}}}
 expect(defaultCollectedCompany(b)).toBe(b)
 expect(defaultCollectedCompany({company_id:'100000',metadata:{}}).metadata).toEqual({})
})
