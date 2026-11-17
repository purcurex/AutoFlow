/** Capture completion is never reported as full business-projection completion. */
export function timestampStatus(metadata: Record<string, any> | undefined) {
 if(!metadata||!Object.keys(metadata).length)return null
 const entities=Object.entries(metadata).map(([entityCode,m])=>({entityCode,watermark:m?.watermark??null,state:m?.state??'unknown',pendingProjection:m?.pendingProjection??null,...m?.presentation?{presentation:m.presentation}:{},...m?.publicationPending===true?{publicationPending:true}:{}}))
 return {mode:'timestamp',complete:false,projectionPending:entities.some(e=>e.publicationPending===true||e.state!=='applied'||e.pendingProjection!==0),entities}
}

/** A capture watermark alone must not advance the displayed business-data sync time. */
export function publishedTimestampTime(metadata:Record<string,any>|undefined,fallback:any,required:string[]):any {
 const values=required.map(code=>metadata?.[code])
 if(!values.length||values.some(m=>m?.state!=='applied'||m.pendingProjection!==0||m.publicationPending!==false||!Number.isFinite(Date.parse(m.capturedAt))))return fallback
 return values.map(m=>m.capturedAt as string).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]
}
