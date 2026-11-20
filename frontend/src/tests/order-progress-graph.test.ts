import { expect,it } from 'vitest'
import { progressLayout } from '@/utils/order-progress-graph'
it('positions merged and branched relationships by document, deduplicating entry edges',()=>{
 const g:any={rootDocumentId:'a',documents:['a','b','c','d'].map(id=>({id,number:id})),relations:[['a','b'],['a','c'],['b','d'],['c','d'],['c','d'],['unknown','d']].map(([fromDocumentId,toDocumentId],i)=>({id:String(i),fromDocumentId,toDocumentId}))}
 const r=progressLayout(g)
 expect(r.edges).toHaveLength(4);expect(r.nodes[3]!.x).toBeGreaterThan(r.nodes[1]!.x)
 expect(r.nodes[1]!.x).toBe(r.nodes[2]!.x);expect(r.nodes[1]!.y).not.toBe(r.nodes[2]!.y)
})
it('bounds cyclic graphs without hanging',()=>{const r=progressLayout({documents:[{id:'a'},{id:'b'}],relations:[{id:'1',fromDocumentId:'a',toDocumentId:'b'},{id:'2',fromDocumentId:'b',toDocumentId:'a'}]} as any);expect(r.nodes).toHaveLength(2)})
