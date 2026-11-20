import { readCollectedChain } from './collected-chain-query'
import { chainSourceSignature } from './collected-chain-storage'
const batch={id:'b',metadata:{},source_as_of:'2026-11-12T00:00:00Z'}
const row=()=>({authorized:true,signature:chainSourceSignature(batch),root_id:'r',revision:'v',built_at:'today',documents:[],lines:[],relations:[]})
it('does not disclose existence to an unauthorized caller',async()=>{
 const db={query:jest.fn().mockResolvedValue([{...row(),authorized:false}])}
 await expect(readCollectedChain(db,batch,[],'other')).rejects.toMatchObject({status:404})
 expect(db.query.mock.calls[0][1]).toEqual(['b','other',[]])
})
it('refuses an absent chain and a stale source batch',async()=>{
 const db={query:jest.fn().mockResolvedValue([{...row(),signature:null}])}
 await expect(readCollectedChain(db,batch,null,'1')).rejects.toMatchObject({status:503})
 db.query.mockResolvedValue([{...row(),signature:'old'}]);await expect(readCollectedChain(db,batch,null,'1')).rejects.toMatchObject({status:409})
})
it('returns only projected relation fields with explicit incomplete provenance',async()=>{
 const db={query:jest.fn().mockResolvedValue([row()])},result=await readCollectedChain(db,batch,['staff'],'1')
 expect(result.dataAvailability).toMatchObject({complete:false,sourceVersionsVerified:false,executionAvailable:false})
 expect(db.query.mock.calls[0][0]).toContain('f.owner_employee_id=ANY($3::text[])')
 expect(db.query.mock.calls[0][0]).not.toContain("'payload',")
})
