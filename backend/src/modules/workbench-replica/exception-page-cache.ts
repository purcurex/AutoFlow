/** Permission/data revision is part of the caller's key. Always authorize before and after reading.
 * Store serialized SQL results, not authorized responses; callers cannot mutate another request's data. */
export class ExceptionPageCache<T> {
 private entries=new Map<string,{expires:number;json:string;bytes:number}>()
 private inFlight=new Map<string,Promise<T>>()
 private bytes=0
 constructor(private readonly now=()=>Date.now(),private readonly ttl=10_000,private readonly maxEntries=32,private readonly maxBytes=8*1024*1024){}
 async read(key:string,load:()=>Promise<T>,refresh=false):Promise<T>{
  if(refresh){const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key)}this.inFlight.delete(key)}
  const existing=this.entries.get(key)
  if(existing&&existing.expires>this.now())return JSON.parse(existing.json)
  if(existing){this.bytes-=existing.bytes;this.entries.delete(key)}
  const pending=this.inFlight.get(key);if(pending)return structuredClone(await pending)
  const task=load().then(result=>{
   if(result==null||this.inFlight.get(key)!==task)return result
   const json=JSON.stringify(result),bytes=Buffer.byteLength(json)
   if(bytes<=this.maxBytes){
    for(const [k,v] of this.entries)if(v.expires<=this.now()){this.entries.delete(k);this.bytes-=v.bytes}
    while(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes){const first=this.entries.entries().next().value;if(!first)break;this.entries.delete(first[0]);this.bytes-=first[1].bytes}
    this.entries.set(key,{json,bytes,expires:this.now()+this.ttl});this.bytes+=bytes
   }
   return result
  })
  const tracked=this.inFlight.size<this.maxEntries
  if(tracked)this.inFlight.set(key,task)
  try{return structuredClone(await task)}finally{if(tracked&&this.inFlight.get(key)===task)this.inFlight.delete(key)}
 }
}
