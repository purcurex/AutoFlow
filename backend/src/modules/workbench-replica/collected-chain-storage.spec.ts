import { createHash } from 'node:crypto'
import { chainContentHash } from './collected-chain-storage'
it('hashes a large collection item by item while preserving the original JSON hash',()=>{
 const ordered=[{name:'中文😀',raw:{id:'1',empty:null}},{raw:{id:'2',nested:['x',0,false]}}]
 const links={receipt:'order'},count=2
 const expected=createHash('sha256').update(JSON.stringify([2,ordered,links,count])).digest('hex')
 const original=JSON.stringify
 const spy=jest.spyOn(JSON,'stringify').mockImplementation(((v:any,...rest:any[])=>{
  if(v===ordered||Array.isArray(v)&&v.includes(ordered))throw Error('whole_collection_stringify_forbidden')
  return (original as any)(v,...rest)
 }) as any)
 try{expect(chainContentHash(ordered,links,count)).toBe(expected)}finally{spy.mockRestore()}
 expect(chainContentHash([],{},0)).toBe(createHash('sha256').update('[2,[],{},0]').digest('hex'))
})
