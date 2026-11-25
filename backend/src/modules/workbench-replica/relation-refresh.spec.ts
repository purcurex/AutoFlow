import {relationSnapshotCurrent} from './relation-refresh'
it('rejects old, untracked and superseded relation snapshots',()=>{
 const now=Date.now(),task={requested_version:'2',published_version:'2',checked_at:new Date(now-1000)}
 expect(relationSnapshotCurrent(task,now)).toBe(true)
 expect(relationSnapshotCurrent({...task,requested_version:'3'},now)).toBe(false)
 expect(relationSnapshotCurrent({...task,checked_at:new Date(now-86400001)},now)).toBe(false)
 expect(relationSnapshotCurrent(null,now)).toBe(false)
})
import {explicitRelationNumbers} from './relation-refresh'
it('only extracts explicit source fields, including nested consumption references',()=>{
 expect(explicitRelationNumbers({sku:'TO1',note:'TO2',entries:[{hzkj_srcbillnumber:'TO3'},{hzkj_sale_order_billno:'TO4'}]})).toEqual(['TO3','TO4'])
})
