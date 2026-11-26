import type { LocalAnalyticsResult, LocalAnalyticsQuery } from '@/api/local-dashboard-analytics'

/** The reference query uses the current account's authorized scope. */
export function registrationAxis(reference: LocalAnalyticsResult | undefined, dimension: string) {
 const values = [...(reference?.rows ?? []), ...(reference?.comparison?.previousData?.rows ?? [])]
  .filter(row => row.dimension === dimension || (dimension === 'person' && row.dimension === 'department'))
  .map(row => row.registrationCount ?? row.orderCount)
 const peak = Math.max(0, ...values.filter(Number.isFinite))
 const target = Math.max(1, peak / 5)
 const power = 10 ** Math.floor(Math.log10(target))
 const interval = Math.max(1, [1, 2, 5, 10].map(step => step * power).find(step => step >= target)!)
 // Always use the next readable tick, including when the peak is exactly on a tick.
 return { min: 0, max: (Math.floor(peak / interval) + 1) * interval, interval }
}

/** The center is separate; individual departments share only authorized department peaks. */
export function registrationReferences(query:LocalAnalyticsQuery, departments:{id:string;name:string}[]):LocalAnalyticsQuery[] {
 const selected=departments.find(d=>d.id===query.departmentId)
 if(!selected||selected.name==='营销中心')return [{...query}]
 const peers=departments.filter(d=>/^业务[一二三四]部$/.test(d.name))
 return (peers.length?peers:[selected]).map(d=>({...query,departmentId:d.id}))
}
export function mergeRegistrationReferences(values:LocalAnalyticsResult[]):LocalAnalyticsResult|undefined {
 if(!values.length)return undefined
 // Concatenate peaks; never sum the four departments into the marketing-center total.
 return {...values[0]!,rows:values.flatMap(value=>[...value.rows,...(value.comparison?.previousData?.rows??[])]),comparison:undefined}
}
