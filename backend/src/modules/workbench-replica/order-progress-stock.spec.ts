import { readConsumedStockChains } from './order-progress-stock'
import { readCollectedChain } from './collected-chain-query'
import { ConflictException } from '@nestjs/common'
jest.mock('./collected-chain-query',()=>({readCollectedChain:jest.fn()}))
beforeEach(()=>jest.resetAllMocks())
it('groups current records and distinguishes reservation from usage without widening scope',async()=>{
 const db={query:jest.fn().mockResolvedValue([{stock_id:'S1',number:'IO1',record_id:'R1',use_status:'1',quantity:'2',payload:{skuNumber:'SKU1'}},{stock_id:'S1',number:'IO1',record_id:'R2',use_status:'0',quantity:'1',payload:{}},{stock_id:'S2',number:'IO2',record_id:'R3',use_status:'1',quantity:'3',payload:{}}])}
 ;(readCollectedChain as jest.Mock).mockResolvedValue({documents:[],relations:[]})
 const result=await readConsumedStockChains(db,{id:'B'},['E'],'TO1')
 expect(result).toHaveLength(2);expect(result[0].records.map((r:any)=>r.status)).toEqual(['已耗用','预占'])
 expect(readCollectedChain).toHaveBeenNthCalledWith(1,db,{id:'B'},['E'],'S1','stock')
 expect(db.query.mock.calls[0][0]).toContain("c.use_status IN ('0','1') AND c.quantity>0")
 expect(db.query.mock.calls[0][0]).toContain('e.owner_employee_id=ANY($3::text[])')
 expect(db.query.mock.calls[0][1]).toEqual(['B','TO1',['E']])
})
it('returns no unrelated graph and tolerates a stale stock graph',async()=>{
 const db={query:jest.fn().mockResolvedValue([{stock_id:'S',number:'IO',record_id:'R',use_status:'1',quantity:'1',payload:{}}])}
 ;(readCollectedChain as jest.Mock).mockRejectedValue(new ConflictException())
 expect((await readConsumedStockChains(db,{id:'B'},[], 'TO'))[0].graph).toBeNull()
 db.query.mockResolvedValue([]);expect(await readConsumedStockChains(db,{id:'B'},[], 'TO')).toEqual([])
 expect(readCollectedChain).toHaveBeenCalledTimes(1)
})
