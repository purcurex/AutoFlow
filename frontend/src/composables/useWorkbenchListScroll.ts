import { onMounted, onBeforeUnmount, ref, type Ref, type InjectionKey } from 'vue'
export const workbenchListScrollKey: InjectionKey<{ available: Ref<boolean>; atTop: Ref<boolean>; atBottom: Ref<boolean>; jump: (end: boolean) => void }> = Symbol('workbenchListScroll')
/** One scroll viewport per active list; nested detail tables stay inside that viewport. */
export function useWorkbenchListScroll(root: Ref<HTMLElement | null>) {
 const available=ref(false),atTop=ref(true),atBottom=ref(true)
 let target:HTMLElement|null=null,frame=0,observer:MutationObserver|undefined,resize:ResizeObserver|undefined
 const update=()=>{if(!target)return;atTop.value=target.scrollTop<=1;atBottom.value=target.scrollTop+target.clientHeight>=target.scrollHeight-2}
 const measure=()=>{
  frame=0
  const next=Array.from(root.value?.querySelectorAll<HTMLElement>('.workbench-list-body,.parcel-scroll')??[]).find(el=>el.getClientRects().length>0)??null
  if(next!==target){target?.removeEventListener('scroll',update);target?.classList.remove('workbench-scroll-viewport');target?.style.removeProperty('--list-viewport-height');target?.style.removeProperty('--list-sticky-header-height');target=next;target?.addEventListener('scroll',update,{passive:true});if(target){const page=root.value?.closest<HTMLElement>('[data-page-scroll]');if(page)page.scrollTop=0}}
  available.value=!!target
  if(target){target.classList.add('workbench-scroll-viewport');target.tabIndex=0;const header=target.querySelector<HTMLElement>(':scope > table > thead, :scope > .purchase-columns');const headerHeight=`${Math.ceil(header?.getBoundingClientRect().height ?? 0)}px`;if(target.style.getPropertyValue('--list-sticky-header-height')!==headerHeight)target.style.setProperty('--list-sticky-header-height',headerHeight);// Reserve only the real footer and the shared page padding, not a blank toolbar-sized gap.
   const bounds=target.getBoundingClientRect(),page=root.value?.closest<HTMLElement>('[data-page-scroll]')
   const bottom=Math.min(window.innerHeight,page?.getBoundingClientRect().bottom??window.innerHeight)
   const footerBottom=Array.from(root.value?.querySelectorAll<HTMLElement>('footer')??[])
    .filter(footer=>!target!.contains(footer)&&footer.getClientRects().length>0)
    .reduce((edge,footer)=>Math.max(edge,footer.getBoundingClientRect().bottom),bounds.bottom)
   const padding=root.value?parseFloat(getComputedStyle(root.value).paddingBottom)||8:8
   const height=Math.max(80,bottom-bounds.top-(footerBottom-bounds.bottom)-padding-1)
   const value=`${Math.floor(height)}px`;if(target.style.getPropertyValue('--list-viewport-height')!==value)target.style.setProperty('--list-viewport-height',value);update()}
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)}
 const jump=(end:boolean)=>{target?.scrollTo({top:end?target.scrollHeight:0,behavior:'instant'})}
 onMounted(()=>{observer=new MutationObserver(schedule);if(root.value){observer.observe(root.value,{childList:true,subtree:true});resize=new ResizeObserver(schedule);resize.observe(root.value)}window.addEventListener('resize',schedule);schedule()})
 onBeforeUnmount(()=>{observer?.disconnect();resize?.disconnect();window.removeEventListener('resize',schedule);target?.removeEventListener('scroll',update);cancelAnimationFrame(frame)})
 return {available,atTop,atBottom,jump}
}
