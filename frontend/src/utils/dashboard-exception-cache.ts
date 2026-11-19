import { isWorkbenchScopeError } from '@/api/workbench-dashboard'
import { getFopOrders, type FopQueuePage } from '@/api/fop-orders'
import { assertCurrentSession, captureSession, onSessionReset } from './session'

export const EXCEPTION_CACHE_TTL = 60_000
let cached: { value: FopQueuePage; at: number } | undefined
let pending: Promise<FopQueuePage> | undefined
let controller: AbortController | undefined
let generation = 0
export function clearDashboardExceptionCache() {
 generation++; controller?.abort(); controller=undefined; pending=undefined; cached=undefined
}
onSessionReset(clearDashboardExceptionCache)
export function peekDashboardExceptions() {
 return cached?.value
}
/** Local read only. Share in-flight work across navigation; never persist account data. */
export function getDashboardExceptions(force=false):Promise<FopQueuePage> {
 if(pending)return pending
 if(!force && cached && Date.now()-cached.at < EXCEPTION_CACHE_TTL)return Promise.resolve(cached.value)
 const session=captureSession(), epoch=generation
 const request=new AbortController();controller=request
 const promise=getFopOrders({queue:'exceptions',page:1,pageSize:5,sortBy:'paidAt',sortOrder:'desc'},request.signal)
 .then(value=>{assertCurrentSession(session);if(epoch!==generation)throw new Error('Exception cache invalidated');cached={value,at:Date.now()};return value})
 .catch(error=>{if(epoch===generation&&isWorkbenchScopeError(error))cached=undefined;throw error})
 .finally(()=>{if(pending===promise){pending=undefined;controller=undefined}})
 pending=promise;return promise
}
