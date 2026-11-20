import api from '@/api'
export interface ProgressDocument {id:string;entity:string;sourceId:string;number:string|null;billStatus:string|null;capturedAt:string|null;businessStatus?:string|null}
export interface OrderProgress {
 number:string;id:string;kind:'fulfillment'|'stock';billStatus:string|null;customerName:string|null;source:'local';asOf:string|null
 details?:{shopifyOrderNumber:string|null;paidAt:string|null;fullTrackingNumbers:string[];lastMileTrackingNumbers:string[]}
 conclusions?:{fulfillment:string;allocation:string}
 businessStatus?:Record<string,string>|null
 stockChains?:{id:string;number:string;records:{id:string;status:string;quantity:string;sku:string|null;usedAt:string|null}[];graph:OrderProgress['graph']}[]
 memberships:{skuAssociation?:string;role:string;queue:string;name:string;accessible:boolean}[]
 graph:{rootDocumentId:string;documents:ProgressDocument[];relations:{id:string;fromDocumentId:string;toDocumentId:string;type:string}[];builtAt:string}|null
}
export const getOrderProgress=(number:string)=>api.get<OrderProgress>('/workbench/order-progress',{params:{number}}) as unknown as Promise<OrderProgress>
