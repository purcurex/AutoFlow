import { timestampStatus } from './timestamp-status'
it('separates captured watermarks from incomplete workbench projections',()=>{
 expect(timestampStatus({hzkj_orders:{state:'projection_pending',watermark:'2026-11-15T00:00:00Z',pendingProjection:2}})).toEqual({mode:'timestamp',complete:false,projectionPending:true,entities:[{entityCode:'hzkj_orders',watermark:'2026-11-15T00:00:00Z',state:'projection_pending',pendingProjection:2}]})
 expect(timestampStatus(undefined)).toBeNull()
})
it('keeps ordinary publication pending after a zero-row scan with no projection tasks',()=>{
 const status=timestampStatus({hzkj_orders:{state:'applied',pendingProjection:0,publicationPending:true,presentation:'previous_snapshot'}})
 expect(status?.projectionPending).toBe(true);expect(status?.complete).toBe(false)
 expect(status?.entities[0].publicationPending).toBe(true)
 expect(timestampStatus({hzkj_orders:{state:'applied',pendingProjection:0,publicationPending:false}})?.projectionPending).toBe(false)
})

import { publishedTimestampTime } from './timestamp-status'
it('shows a new sync time only after all required entity projections are published',()=>{
 const ready={state:'applied',pendingProjection:0,publicationPending:false,capturedAt:'2026-11-16T10:00:00Z'}
 expect(publishedTimestampTime({hzkj_orders:ready},'old',['hzkj_orders'])).toBe(ready.capturedAt)
 expect(publishedTimestampTime({hzkj_orders:ready},'old',['hzkj_orders','hzkj_deliver_bill'])).toBe('old')
 expect(publishedTimestampTime({hzkj_orders:{...ready,pendingProjection:1}},'old',['hzkj_orders'])).toBe('old')
 expect(publishedTimestampTime({hzkj_orders:ready,hzkj_deliver_bill:{...ready,capturedAt:'2026-11-16T11:00:00Z'}},'old',['hzkj_orders','hzkj_deliver_bill'])).toBe(ready.capturedAt)
})
