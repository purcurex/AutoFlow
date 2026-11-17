import { collectedStockWhere } from './collected-stock-query'
it('scopes ownership before all filters and keeps unknown states out of paid lifecycle',()=>{const q=collectedStockWhere('b',['employee'],{lifecycle:'pending_procurement',stockType:'deposit',mode:'selected',orderIds:['1']});expect(q.params).toEqual(['b',['employee'],'deposit',['1']]);expect(q.where).toContain('owner_employee_id = ANY');expect(q.where).toContain("display->>'paymentStatus' = 'paid'");expect(q.where).toContain("display->>'purchaseStatus' IN");})
it('includes cancelled in sales overview but excludes them from procurement',()=>{expect(collectedStockWhere('b',null,{}).where).not.toContain("display->>'cancelled'='false'");expect(collectedStockWhere('b',null,{queue:'procurement'}).where).toContain("display->>'cancelled'='false'")})
it.each(['pending','approved'])('filters stock document approval %s before paging and independently of order status',reviewStatus=>{
 const {execFileSync}=require('node:child_process')
 const q=collectedStockWhere('b',null,{orderStatus:'paid',reviewStatus})
 const rows=[{id:'pending',orderStatus:'paid',reviewStatus:'pending'},{id:'approved',orderStatus:'paid',reviewStatus:'approved'},{id:'unknown',orderStatus:'paid',reviewStatus:'unknown'},{id:'unpaid',orderStatus:'unpaid',reviewStatus}]
 const script=`import sqlite3,json,sys
p=json.loads(sys.argv[1]);db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE stock(batch_id TEXT,entity_type TEXT,source_id TEXT,display TEXT)')
for r in p['rows']: db.execute('INSERT INTO stock VALUES(?,?,?,?)',('b','stock_orders',r['id'],json.dumps(r)))
print(json.dumps([r[0] for r in db.execute('SELECT source_id FROM stock WHERE '+p['where'],p['params'])]))`
 expect(JSON.parse(execFileSync('python3',['-c',script,JSON.stringify({...q,rows})],{encoding:'utf8'}))).toEqual([reviewStatus])
})
