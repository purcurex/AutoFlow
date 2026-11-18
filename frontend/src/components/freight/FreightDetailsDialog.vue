<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getLocalFreightDetails, exportLocalFreightDetails, type LocalFreightDetailsQuery, type LocalFreightDetailsResult } from '@/api/local-freight'
import { downloadBlob } from '@/utils/export'
import { onSessionReset } from '@/utils/session'
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
const props=defineProps<{query:LocalFreightDetailsQuery;name:string}>(),emit=defineEmits<{close:[]}>()
const {locale}=useI18n(),t=(cn:string,en:string)=>String(locale.value).startsWith('zh')?cn:en
const dialog=ref<HTMLDialogElement>(),closeButton=ref<HTMLButtonElement>(),titleId=useId(),page=ref(1),pageSize=ref(50),data=ref<LocalFreightDetailsResult>(),busy=ref(false),exporting=ref(false),error=ref('')
let revision=0,opener:HTMLElement|undefined
async function load(){const id=++revision;data.value=undefined;exporting.value=false;busy.value=true;error.value='';try{const result=await getLocalFreightDetails({...props.query,page:page.value,pageSize:pageSize.value});if(id===revision)data.value=result}catch{if(id===revision)error.value=t('明细加载失败，请重试或检查查询权限。','Details failed to load. Retry or check access.')}finally{if(id===revision)busy.value=false}}
async function exportRows(){const id=revision;exporting.value=true;error.value='';try{const blob=await exportLocalFreightDetails(props.query);if(id===revision)downloadBlob(blob,'freight-dispatch-details.xlsx')}catch{if(id===revision)error.value=t('导出失败；单次最多10,000笔，请缩小范围或重试。','Export failed. Limit the scope to 10,000 bills or retry.')}finally{if(id===revision)exporting.value=false}}
const time=(value:string)=>new Date(value).toLocaleString(String(locale.value),{timeZone:'Asia/Shanghai',hour12:false})
watch(()=>props.query,()=>{page.value=1;void load()},{immediate:true});watch([page,pageSize],()=>void load())
function changePageSize(value:number){pageSize.value=value;page.value=1}
onMounted(()=>{opener=document.activeElement instanceof HTMLElement?document.activeElement:undefined;dialog.value?.showModal();closeButton.value?.focus()})
const off=onSessionReset(()=>{revision++;data.value=undefined;emit('close')})
onBeforeUnmount(()=>{revision++;off();dialog.value?.close();if(opener?.isConnected)opener.focus({preventScroll:true})})
</script>
<template>
 <Teleport to="body"><dialog ref="dialog" class="freight-dialog freight-source-dialog ov-panel" aria-modal="true" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @click.self="emit('close')">
  <header class="ov-header"><h2 :id="titleId">{{name}} · {{t('实际运费发运单明细','Freight source dispatches')}}</h2><button ref="closeButton" @click="emit('close')" :aria-label="t('关闭明细','Close details')">×</button></header>
  <div class="ov-body freight-dialog-body">
   <p class="scope-note">{{t('已审核发运单 · 实际运费确认时间 UTC+8 · CNY；原生履约单号不代表关联已核验。商品明细及完整源单追溯待提供。','Approved dispatches · Freight confirmation UTC+8 · CNY. Native order references are not verified links. Products and full source tracing remain unavailable.')}}</p>
   <p v-if="error" role="alert" class="ov-error">{{error}} <button v-if="!data" @click="load">{{t('重试','Retry')}}</button></p>
   <p v-if="busy" role="status">{{t('正在加载发运单…','Loading dispatches…')}}</p>
   <template v-if="data">
    <div class="detail-toolbar"><span>{{data.from}} — {{data.to}} · {{t('共','Total')}} {{data.total}} {{t('单','bills')}} · CNY {{data.amount}}</span><div><button v-if="data.canExport" data-export-details :disabled="exporting||busy" @click="exportRows">{{exporting?t('正在导出…','Exporting…'):t('导出当前明细','Export details')}}</button><WorkbenchPagination :page="page" :page-size="pageSize" :pages="Math.max(1,Math.ceil(data.total/pageSize))" :disabled="busy||exporting" @page="page=$event" @page-size="changePageSize" /></div></div>
    <div class="ov-table-scroll"><table class="ov-table source-table"><thead><tr><th>{{t('发运单号','Dispatch')}}</th><th>{{t('确认时间 UTC+8','Confirmed UTC+8')}}</th><th>{{t('实际运费 CNY','Freight CNY')}}</th><th>{{t('有效计费重量 kg','Known weight kg')}}</th><th>{{t('物流服务商 / 渠道','Carrier / Channel')}}</th><th>{{t('业务员 / 原生部门','Owner / Native department')}}</th><th>{{t('仓库 / 国家','Warehouse / Country')}}</th><th>{{t('客户','Customer')}}</th><th>{{t('原生履约单号 / 跟踪号','Native order / Tracking')}}</th></tr></thead><tbody><tr v-for="r in data.items" :key="r.id"><td>{{r.documentNumber}}<small>{{r.id}}</small></td><td>{{time(r.confirmedAt)}}</td><td>{{r.amount}}</td><td>{{r.weightKg??t('未提供','Unavailable')}}</td><td>{{r.carrierName||'—'}}<small>{{r.channelName||'—'}}</small></td><td>{{r.ownerName||'—'}}<small>{{r.departmentName||'—'}}</small></td><td>{{r.warehouseName||'—'}}<small>{{r.country||'—'}}</small></td><td>{{r.customerName||'—'}}</td><td>{{r.orderNumber||'—'}}<small>{{r.trackingNumber||'—'}}</small></td></tr><tr v-if="!data.items.length"><td colspan="9">{{t('当前范围暂无已确认发运单','No confirmed dispatches in this scope')}}</td></tr></tbody></table></div>
   </template>
  </div>
 </dialog></Teleport>
</template>
<style scoped>
.freight-source-dialog{width:min(2200px,calc(100vw - 64px))}.ov-header{display:flex;justify-content:space-between;gap:20px}h2{font-size:16px}.scope-note{font-size:12px;line-height:1.7;color:var(--color-text-secondary);margin:0 0 14px}.detail-toolbar,.detail-toolbar>div{display:flex;align-items:center;gap:12px}.detail-toolbar{justify-content:space-between;margin-bottom:14px;font-size:12px}.source-table{min-width:1500px;width:100%}.source-table td,.source-table th{white-space:nowrap}.source-table small{display:block;color:var(--color-text-secondary);margin-top:5px}button{padding:6px 10px;border:1px solid var(--color-border);border-radius:5px;background:var(--color-surface);color:var(--color-text)}button:disabled{opacity:.5}
</style>
