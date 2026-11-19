<script setup lang="ts">
import CountryPicker from '@/components/ui/CountryPicker.vue'
import DateSortHeader from '@/components/ui/DateSortHeader.vue'
import { crmMockOpportunitiesApi as opportunitiesApi } from '@/mocks/crm'
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AppLayout } from '@/components/layout'
import { PageHeader } from '@/components/ui'
import OpportunityStage from '@/components/opportunities/OpportunityStage.vue'
import { opportunityError, optionLabel, type Opportunity, type OpportunityOptions, type OpportunityQuery } from '@/api/opportunities'
import { onSessionReset } from '@/utils/session'
const options = ref<OpportunityOptions>({ stages: [], dailyVolumes: [], countries: [], currency: 'USD' })
const rows = ref<Opportunity[]>([]), owners = ref<{ id: string; name: string }[]>([]), total = ref<number | null>(null)
const filters = reactive({ search: '', stage: '', country: '', ownerId: '', from: '', to: '' })
const page = ref(1), pageSize = ref(20), busy = ref(false), exporting = ref(false), error = ref(''), optionsError = ref('')
const sortBy = ref<'registeredOn' | 'lastFollowedOn'>('registeredOn'), sortDirection = ref<'asc' | 'desc'>('desc')
function sortDate(field: 'registeredOn' | 'lastFollowedOn') { sortDirection.value = sortBy.value === field && sortDirection.value === 'asc' ? 'desc' : 'asc'; sortBy.value = field; void load(true) }
let generation = 0, optionsGeneration = 0, exportGeneration = 0
const cleanup = onSessionReset(() => { generation++; optionsGeneration++; exportGeneration++; rows.value = []; owners.value = []; total.value = null; error.value = ''; optionsError.value = ''; busy.value = false; exporting.value = false })
onBeforeUnmount(() => { generation++; optionsGeneration++; exportGeneration++; cleanup() })
function query(): OpportunityQuery { return { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page: page.value, pageSize: pageSize.value, sortBy: sortBy.value, sortDirection: sortDirection.value } }
async function load(reset = false) {
  if (reset) page.value = 1
  const ticket = ++generation; busy.value = true; error.value = ''
  if (filters.from && filters.to && filters.from > filters.to) { error.value = '登记开始日期不能晚于结束日期'; rows.value = []; total.value = null; busy.value = false; return }
  try { const result = await opportunitiesApi.list(query()); if (ticket !== generation) return; rows.value = result.items; total.value = result.total; owners.value = result.owners }
  catch (e) { if (ticket === generation) { error.value = opportunityError(e); rows.value = []; total.value = null } }
  finally { if (ticket === generation) busy.value = false }
}
async function loadOptions() { const ticket = ++optionsGeneration; try { const result = await opportunitiesApi.options(); if (ticket === optionsGeneration) { options.value = result; optionsError.value = '' } } catch (e) { if (ticket === optionsGeneration) optionsError.value = opportunityError(e) } }
async function exportRows() {
  if (exporting.value) return
  const ticket = ++exportGeneration; exporting.value = true; error.value = ''
  try { const { page: _page, pageSize: _size, ...params } = query(); const blob = await opportunitiesApi.export(params); if (ticket !== exportGeneration) return; const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = '商机管理.xlsx'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  catch (e) { if (ticket === exportGeneration) error.value = opportunityError(e) }
  finally { if (ticket === exportGeneration) exporting.value = false }
}
watch(filters, () => load(true)); watch(pageSize, () => load(true))
onMounted(() => { void loadOptions(); void load() })
const safeLink = (value: string | null) => value && /^https?:\/\//i.test(value) ? value : undefined
</script>
<template>
<AppLayout><div class="app-page opportunities-page">
 <PageHeader eyebrow="客户业务 · 商机管理" title="商机管理" />
 <section class="panel opportunities-panel">
  <div class="opportunity-toolbar">
   <div class="opportunity-actions"><RouterLink to="/opportunities/new" class="btn opportunity-primary-action">＋ 新增商机</RouterLink><button type="button" class="btn btn-secondary" data-test="export" :disabled="exporting||busy" @click="exportRows">{{ exporting ? '导出中…' : '导出 Excel' }}</button></div>
  <form class="opportunity-filters" @submit.prevent="load(true)">
   <input v-model="filters.search" class="input search" aria-label="搜索商机" placeholder="搜索客户名称 / 单号" />
   <select v-model="filters.stage" class="input" aria-label="商机阶段"><option value="">全部阶段</option><option v-for="item in options.stages" :key="item.value" :value="item.value">{{item.label}}</option></select>
   <CountryPicker v-model="filters.country" placeholder="全部国家" />
   <select v-model="filters.ownerId" class="input" aria-label="业务员"><option value="">全部业务员</option><option v-for="item in owners" :key="item.id" :value="item.id">{{item.name}}</option></select>
   <label>登记日期 <input v-model="filters.from" type="date" class="input" aria-label="登记开始日期" /></label><span class="date-separator">至</span><input v-model="filters.to" type="date" class="input" aria-label="登记结束日期" />
   <button class="btn btn-secondary" :disabled="busy">查询</button>
  </form>
  </div>
  <p v-if="error" role="alert" class="opportunity-error">{{error}} <button type="button" class="btn btn-ghost" @click="load()">重新查询</button></p>
  <p v-if="optionsError" role="alert" class="opportunity-error">选项加载失败：{{optionsError}} <button type="button" class="btn btn-ghost" @click="loadOptions">重试</button></p>

  <div class="opportunity-table-scroll" :class="{'is-empty':!rows.length}" :aria-busy="busy"><table class="data-table opportunity-table"><thead><tr><th>单号 / 客户名称</th><th>状态</th><th>业务员</th><th>商机阶段</th><th>预计日均量</th><th>预计月订单额 USD</th><th>主卖产品</th><th>国家 / 城市</th><th>客户经营范围</th><th>WhatsApp</th><th>店铺链接</th><DateSortHeader label="登记日期" :direction="sortBy==='registeredOn'?sortDirection:undefined" :disabled="busy" @sort="sortDate('registeredOn')" /><DateSortHeader label="最后跟进日期" :direction="sortBy==='lastFollowedOn'?sortDirection:undefined" :disabled="busy" @sort="sortDate('lastFollowedOn')" /><th>本周跟进情况</th><th>下周计划</th><th>问题反馈</th></tr></thead><tbody>
   <tr v-for="row in rows" :key="row.id"><td class="customer-cell"><RouterLink :to="`/opportunities/${row.id}`" class="customer-name" :title="row.customerName">{{row.customerName}}</RouterLink><RouterLink :to="`/opportunities/${row.id}`" class="number" :title="row.number">{{row.number}}</RouterLink></td><td><span class="draft-status">暂存</span></td><td><span class="truncate-cell" :title="row.ownerName">{{row.ownerName||'—'}}</span></td><td><OpportunityStage :value="row.stage" :options="options.stages" /></td><td>{{optionLabel(options.dailyVolumes,row.dailyVolume)}}</td><td class="amount">{{row.monthlyAmount??'—'}}</td><td><span class="truncate-cell" :title="row.mainProducts||undefined">{{row.mainProducts||'—'}}</span></td><td>{{optionLabel(options.countries,row.country)}}<small :title="row.city||undefined">{{row.city}}</small></td><td><span class="truncate-cell" :title="row.businessScope||undefined">{{row.businessScope||'—'}}</span></td><td><span class="truncate-cell" :title="row.whatsapp||undefined">{{row.whatsapp||'—'}}</span></td><td><a v-if="safeLink(row.storeUrl)" :href="safeLink(row.storeUrl)" class="truncate-cell" :title="row.storeUrl||undefined" target="_blank" rel="noopener noreferrer">{{row.storeUrl}}</a><span v-else>—</span></td><td>{{row.registeredOn||'—'}}</td><td>{{row.lastFollowedOn||'—'}}</td><td><span class="truncate-cell long" :title="row.currentFollowUp||undefined">{{row.currentFollowUp||'—'}}</span></td><td><span class="truncate-cell long" :title="row.nextFollowUpPlan||undefined">{{row.nextFollowUpPlan||'—'}}</span></td><td><span class="truncate-cell long" :title="row.problemFeedback||undefined">{{row.problemFeedback||'—'}}</span></td></tr>
   <tr v-if="!rows.length"><td colspan="16" class="opportunity-empty"><span>{{busy?'正在加载商机…':total===0?'暂无商机，可新增商机或从客户线索生成。':'商机查询未完成，请重试。'}}</span></td></tr>
  </tbody></table></div>
  <footer class="opportunity-pagination"><span v-if="total!==null">共 {{total}} 条商机</span><span v-else>{{busy?'正在加载…':'查询结果待加载'}}</span><label>每页 <select v-model="pageSize" class="input" aria-label="每页条数"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select></label><button class="btn btn-ghost" :disabled="busy||page===1" @click="page--;load()">上一页</button><span>{{page}} / {{total===null?'—':Math.max(1,Math.ceil(total/pageSize))}}</span><button class="btn btn-ghost" :disabled="busy||total===null||page*pageSize>=total" @click="page++;load()">下一页</button></footer>
 </section>
</div></AppLayout>
</template>
<style scoped>
:global([data-page-scroll]:has(>.opportunities-page)){display:flex;flex-direction:column}
.opportunities-page{display:flex;flex-direction:column;flex:1;min-width:0}.opportunities-panel{overflow:hidden;display:flex;flex-direction:column;flex:1;min-height:360px}.opportunity-toolbar{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;padding:20px}.opportunity-actions,.opportunity-filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.opportunity-filters{margin-left:auto}.opportunity-filters>.input{width:130px}.opportunity-filters>.search{width:280px}.opportunity-filters label{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap}.opportunity-filters input[type=date]{width:150px}
.opportunity-primary-action{background:var(--color-primary);border:1px solid var(--color-primary);color:var(--color-on-primary);box-shadow:none}.opportunity-primary-action:hover{background:var(--color-primary-strong);border-color:var(--color-primary-strong)}.opportunity-primary-action:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}:global(.dark .opportunity-primary-action){background:var(--color-primary);border-color:var(--color-selection-border);color:var(--color-on-primary)}:global(.dark .opportunity-primary-action:hover){background:var(--color-primary-strong)}
.date-separator{font-size:12px;color:var(--color-text-secondary)}.opportunity-pagination{display:flex;align-items:center;justify-content:flex-end;gap:15px;padding:16px 20px;border-top:1px solid var(--color-border);font-size:12px}.opportunity-pagination>span:first-child{margin-right:auto}.opportunity-pagination label{display:flex;align-items:center;gap:8px}.opportunity-pagination select{width:75px}.opportunity-table-scroll{overflow:auto;flex:1;container-type:inline-size}.opportunity-table-scroll.is-empty{display:flex;min-height:220px}.opportunity-table-scroll.is-empty .opportunity-table{flex:1}.opportunity-table-scroll.is-empty thead{height:48px}.opportunity-table{min-width:2040px;width:100%;font-size:12px}.opportunity-table th{white-space:nowrap}.opportunity-table td{vertical-align:middle}.opportunity-table .customer-cell{min-width:165px}.customer-name,.number{display:block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.customer-name{font-weight:600;color:var(--color-chart-link,var(--color-link))}.number,small{font-size:11px;display:block;color:var(--color-text-secondary);margin-top:5px}.truncate-cell{display:block;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.truncate-cell.long{max-width:180px}a.truncate-cell{color:var(--color-chart-link,var(--color-link))}.amount{font-variant-numeric:tabular-nums;text-align:right}.draft-status{color:#64748b;background:color-mix(in srgb,#64748b 10%,transparent);padding:4px 7px;border-radius:4px;white-space:nowrap}.opportunity-empty{text-align:center;padding:60px!important;color:var(--color-text-secondary)}.opportunity-empty span{display:block;position:sticky;left:60px;width:calc(100cqw - 120px)}.opportunity-error{margin:0 20px 12px;color:#c25252;font-size:13px}@media(max-width:760px){.opportunities-page{padding:16px}.opportunity-filters>.search{width:100%}.opportunity-pagination{flex-wrap:wrap}.opportunity-filters{margin-left:0;width:100%}}
</style>
