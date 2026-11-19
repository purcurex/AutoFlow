<script setup lang="ts">
import { crmMockOpportunitiesApi, isCrmMockId } from '@/mocks/crm'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppLayout } from '@/components/layout'
import OpportunityFields from '@/components/opportunities/OpportunityFields.vue'
import OpportunityStage from '@/components/opportunities/OpportunityStage.vue'
import { opportunitiesApi as realOpportunitiesApi, emptyOpportunity, opportunityPayload, opportunityError, optionLabel, type Opportunity, type OpportunityOptions, type FollowUpInput } from '@/api/opportunities'
import { onSessionReset } from '@/utils/session'
const route = useRoute(), router = useRouter()
const isNew = computed(() => route.path === '/opportunities/new')
const currentApi = () => isNew.value || isCrmMockId(String(route.params.id)) ? crmMockOpportunitiesApi : realOpportunitiesApi
const record = ref<Opportunity | null>(null), draft = ref(emptyOpportunity())
const options = ref<OpportunityOptions>({ stages: [], dailyVolumes: [], countries: [], currency: 'USD' })
const busy = ref(false), saving = ref(false), loaded = ref(false), error = ref(''), notice = ref(''), showFollowUp = ref(false), showDelete = ref(false)
const canEdit = computed(() => isNew.value || record.value?.canEdit === true)
const hasUnsavedChanges = computed(() => record.value !== null && JSON.stringify(opportunityPayload(draft.value)) !== JSON.stringify(opportunityPayload(record.value)))
const follow = reactive<FollowUpInput>({ version: 0, followedOn: '', stage: '', dailyVolume: '', monthlyAmount: '', currentFollowUp: '', nextFollowUpPlan: '', problemFeedback: '' })
let generation = 0
function clear() { generation++; record.value = null; draft.value = emptyOpportunity(); loaded.value = false; error.value = ''; notice.value = ''; showFollowUp.value = false; showDelete.value = false; busy.value = false; saving.value = false; Object.assign(follow, { version: 0, followedOn: '', stage: '', dailyVolume: '', monthlyAmount: '', currentFollowUp: '', nextFollowUpPlan: '', problemFeedback: '' }) }
const cleanup = onSessionReset(clear)
onBeforeUnmount(() => { generation++; cleanup() })
function apply(value: Opportunity) { record.value = value; draft.value = opportunityPayload(value) }
async function load() {
 clear(); const ticket = generation; busy.value = true
 try { const [choices, value] = await Promise.all([currentApi().options(), isNew.value ? Promise.resolve(null) : currentApi().get(String(route.params.id))]); if (ticket !== generation) return; options.value = choices; if (value) apply(value); loaded.value = true }
 catch (e) { if (ticket === generation) error.value = opportunityError(e) }
 finally { if (ticket === generation) busy.value = false }
}
watch(() => route.path, load, { immediate: true })
function validateAmount(value: string | null) { return value === null || value === '' || /^\d+(\.\d{1,2})?$/.test(value) }
async function save() {
 if (saving.value || !loaded.value || !canEdit.value) return
 const payload = opportunityPayload(draft.value)
 if (!payload.customerName) { error.value = '请填写客户名称'; return }
 if (!payload.registeredOn) { error.value = '请填写登记日期'; return }
 if (!validateAmount(payload.monthlyAmount)) { error.value = '预计月订单额须为非负金额，最多保留两位小数'; return }
 const ticket = generation; saving.value = true; error.value = ''; notice.value = ''
 try { const result = isNew.value ? await currentApi().create(payload) : await currentApi().update(record.value!.id, { ...payload, version: record.value!.version }); if (ticket !== generation) return; apply(result); notice.value = '商机已保存'; if (isNew.value) await router.replace(`/opportunities/${result.id}`) }
 catch (e) { if (ticket === generation) error.value = opportunityError(e) }
 finally { if (ticket === generation) saving.value = false }
}
function openFollowUp() {
 if (!record.value || !canEdit.value || saving.value) return
 if (hasUnsavedChanges.value) { notice.value = ''; error.value = '商机资料有未保存的修改，请先保存商机，再新增跟进。'; return }
 Object.assign(follow, { version: record.value.version, followedOn: emptyOpportunity().registeredOn!, stage: record.value.stage || '', dailyVolume: record.value.dailyVolume || '', monthlyAmount: record.value.monthlyAmount || '', currentFollowUp: '', nextFollowUpPlan: '', problemFeedback: '' }); error.value = ''; showFollowUp.value = true
}
async function saveFollowUp() {
 if (saving.value || !record.value || !canEdit.value) return
 if (![follow.followedOn, follow.stage, follow.dailyVolume, follow.monthlyAmount, follow.currentFollowUp.trim(), follow.nextFollowUpPlan.trim()].every(Boolean)) { error.value = '请完整填写标星的跟进信息'; return }
 if (!validateAmount(follow.monthlyAmount)) { error.value = '预计月订单额须为非负金额，最多保留两位小数'; return }
 const ticket = generation; saving.value = true; error.value = ''; notice.value = ''
 try { const result = await currentApi().followUp(record.value.id, { ...follow, currentFollowUp: follow.currentFollowUp.trim(), nextFollowUpPlan: follow.nextFollowUpPlan.trim() }); if (ticket !== generation) return; apply(result); showFollowUp.value = false; notice.value = '跟进记录已保存' }
 catch (e) { if (ticket === generation) error.value = opportunityError(e) }
 finally { if (ticket === generation) saving.value = false }
}
async function remove() {
 if (saving.value || !record.value?.canDelete) return
 const ticket = generation; saving.value = true; error.value = ''
 try { await currentApi().remove(record.value.id, record.value.version); if (ticket === generation) await router.push('/opportunities') }
 catch (e) { if (ticket === generation) error.value = opportunityError(e) }
 finally { if (ticket === generation) saving.value = false }
}
</script>
<template><AppLayout><div class="opportunity-detail">
 <header class="detail-heading"><div><RouterLink to="/opportunities" class="back-link">← 商机管理</RouterLink><h1>{{isNew?'新增商机':record?.customerName||'商机详情'}}</h1><p>{{isNew?'填写客户名称即可保存，其他资料可后续补充。':record?.number||'正在读取商机'}}</p></div><div class="heading-actions"><button v-if="record?.canDelete" class="btn btn-ghost delete-button" :disabled="saving||busy" @click="showDelete=true">删除商机</button><button v-if="record?.canEdit" data-test="add-follow-up" class="btn opportunity-primary-action" :disabled="saving||busy" @click="openFollowUp">＋ 新增跟进</button></div></header>
 <p v-if="error&&!showFollowUp&&!showDelete" role="alert" class="error-panel">{{error}} <button v-if="!saving" class="btn btn-ghost" @click="load">重新加载</button></p><p v-if="notice" role="status" class="notice-panel">{{notice}}</p>
 <div v-if="busy" class="panel empty-state">正在加载商机…</div>
 <template v-else-if="loaded">
  <section v-if="record" class="panel detail-summary"><div><span>单据状态</span><strong>暂存</strong></div><div><span>业务员</span><strong>{{record.ownerName||'—'}}</strong></div><div><span>商机阶段</span><OpportunityStage :value="record.stage" :options="options.stages" /></div><div><span>最后跟进日期</span><strong>{{record.lastFollowedOn||'—'}}</strong></div><div v-if="record.sourceLeadId"><span>来源线索</span><RouterLink :to="`/leads/${record.sourceLeadId}`">{{record.sourceLeadName||'查看线索'}}</RouterLink></div></section>
  <form class="panel detail-form" data-test="opportunity-form" @submit.prevent="save"><div class="section-title"><h2>商机资料</h2><span v-if="!canEdit">当前商机为只读</span><span v-else><b>*</b> 为必填项</span></div><OpportunityFields v-model="draft" :options="options" :disabled="!canEdit||saving" /><footer v-if="canEdit"><RouterLink class="btn btn-ghost" to="/opportunities">返回列表</RouterLink><button type="submit" class="btn opportunity-primary-action" :disabled="saving">{{saving?'保存中…':'保存商机'}}</button></footer></form>
  <section v-if="record" class="panel follow-history" data-test="history"><div class="section-title"><h2>跟进记录</h2><span>{{record.followUps?.length||0}} 条</span></div><p v-if="!record.followUps?.length" class="history-empty">暂无跟进记录，点击“新增跟进”记录客户进展。</p><article v-for="item in record.followUps" :key="item.id" class="history-item"><header><strong>{{item.followedOn}}</strong><OpportunityStage :value="item.stage" :options="options.stages" /><span>预计日均量 {{optionLabel(options.dailyVolumes,item.dailyVolume)}}</span><span>预计月订单额 USD {{item.monthlyAmount}}</span><span v-if="item.createdByName">{{item.createdByName}}</span></header><div class="history-columns"><div><h3>本周跟进情况</h3><p>{{item.currentFollowUp}}</p></div><div><h3>下周计划</h3><p>{{item.nextFollowUpPlan}}</p></div><div><h3>问题反馈</h3><p>{{item.problemFeedback||'—'}}</p></div></div></article></section>
 </template>
 <div v-if="showFollowUp" class="modal-backdrop" @keydown.esc="!saving&&(showFollowUp=false)"><section role="dialog" aria-modal="true" aria-labelledby="follow-title" class="opportunity-modal"><header><div><h2 id="follow-title">新增跟进反馈</h2><p>{{record?.customerName}}</p></div><button class="btn btn-ghost" aria-label="关闭跟进窗口" :disabled="saving" @click="showFollowUp=false">×</button></header><form data-test="follow-up-form" @submit.prevent="saveFollowUp"><fieldset :disabled="saving" class="follow-grid"><label>跟进日期 <b>*</b><input v-model="follow.followedOn" name="followedOn" type="date" required class="input" /></label><label>商机阶段 <b>*</b><select v-model="follow.stage" required class="input"><option value="">请选择</option><option v-for="item in options.stages" :key="item.value" :value="item.value">{{item.label}}</option></select></label><label>预计日均量 <b>*</b><select v-model="follow.dailyVolume" required class="input"><option value="">请选择</option><option v-for="item in options.dailyVolumes" :key="item.value" :value="item.value">{{item.label}}</option></select></label><label>预计月订单额 (USD) <b>*</b><input v-model="follow.monthlyAmount" name="followMonthlyAmount" required inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" class="input" /></label><label class="full">本周跟进情况 <b>*</b><textarea v-model="follow.currentFollowUp" name="followCurrent" required rows="3" maxlength="8000" class="input" /></label><label class="full">下周计划 <b>*</b><textarea v-model="follow.nextFollowUpPlan" name="followNext" required rows="3" maxlength="8000" class="input" /></label><label class="full">问题反馈<textarea v-model="follow.problemFeedback" rows="2" maxlength="8000" class="input" /></label></fieldset><p v-if="error" role="alert" class="modal-error">{{error}}</p><footer><button type="button" class="btn btn-ghost" :disabled="saving" @click="showFollowUp=false">取消</button><button type="submit" class="btn opportunity-primary-action" :disabled="saving">{{saving?'保存中…':'保存跟进'}}</button></footer></form></section></div>
 <div v-if="showDelete" class="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="delete-title" class="opportunity-modal delete-modal"><header><h2 id="delete-title">删除商机</h2></header><p class="delete-description">确定删除“{{record?.customerName}}”（{{record?.number}}）？删除后将从商机列表移除，历史记录保留。</p><p v-if="error" role="alert" class="modal-error">{{error}}</p><footer><button class="btn btn-ghost" :disabled="saving" @click="showDelete=false">取消</button><button class="btn opportunity-primary-action" :disabled="saving" @click="remove">{{saving?'删除中…':'确认删除'}}</button></footer></section></div>
</div></AppLayout></template>
<style scoped>
.opportunity-primary-action{background:var(--color-primary);border:1px solid var(--color-primary);color:var(--color-on-primary);box-shadow:none}.opportunity-primary-action:hover:not(:disabled){background:var(--color-primary-strong);border-color:var(--color-primary-strong)}.opportunity-primary-action:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}:global(.dark .opportunity-primary-action){background:var(--color-primary);border-color:var(--color-selection-border);color:var(--color-on-primary)}:global(.dark .opportunity-primary-action:hover:not(:disabled)){background:var(--color-primary-strong)}

.opportunity-detail{padding:24px;max-width:1800px;margin:0 auto;width:100%;min-width:0}.detail-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px}.back-link{font-size:12px;color:var(--color-text-secondary)}.detail-heading h1{font-size:24px;font-weight:700;margin-top:10px;overflow-wrap:anywhere}.detail-heading p{font-size:13px;color:var(--color-text-secondary);margin-top:7px}.heading-actions{display:flex;gap:12px;flex-shrink:0}.delete-button{color:#c25252}.detail-summary{display:flex;gap:40px;padding:22px 24px;flex-wrap:wrap;margin-bottom:20px}.detail-summary>div{display:flex;flex-direction:column;gap:9px}.detail-summary span{font-size:12px;color:var(--color-text-secondary)}.detail-summary strong,.detail-summary a{font-size:13px}.detail-summary a{color:var(--color-chart-link,var(--color-link))}.detail-form{overflow:hidden}.section-title{padding:20px 24px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between}.section-title h2{font-size:15px;font-weight:600}.section-title>span{font-size:12px;color:var(--color-text-secondary)}footer{display:flex;justify-content:flex-end;gap:12px;padding:16px 24px;border-top:1px solid var(--color-border)}.follow-history{margin-top:22px;overflow:hidden}.history-empty{padding:40px 24px;color:var(--color-text-secondary);font-size:13px;text-align:center}.history-item{padding:22px 24px;border-bottom:1px solid var(--color-border)}.history-item:last-child{border-bottom:0}.history-item header{display:flex;align-items:center;gap:20px;flex-wrap:wrap;font-size:12px}.history-item header strong{font-size:14px}.history-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:20px}.history-columns h3{font-size:12px;color:var(--color-text-secondary);margin-bottom:8px}.history-columns p{font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.error-panel,.notice-panel{padding:14px 18px;border:1px solid var(--color-border);border-radius:8px;font-size:13px;margin-bottom:18px}.error-panel,.modal-error{color:#c25252}.notice-panel{color:#059669}.modal-backdrop{position:fixed;inset:0;background:#10182766;display:flex;align-items:center;justify-content:center;padding:24px;z-index:100}.opportunity-modal{width:760px;max-width:100%;max-height:92vh;overflow:auto;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;box-shadow:0 18px 60px #0003}.opportunity-modal>header{padding:20px 24px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center}.opportunity-modal h2{font-size:18px;font-weight:600}.opportunity-modal header p{font-size:12px;color:var(--color-text-secondary);margin-top:6px}.follow-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:22px 24px}.follow-grid label{font-size:12px}.follow-grid .input{margin-top:8px}.full{grid-column:1/-1}b{color:#c25252}.modal-error{padding:0 24px 15px;font-size:13px}.delete-modal{width:490px}.delete-description{padding:24px;font-size:14px;line-height:1.8}@media(max-width:700px){.opportunity-detail{padding:16px}.detail-heading{align-items:flex-start;flex-direction:column}.history-columns{grid-template-columns:1fr}.detail-summary{gap:24px}.follow-grid{grid-template-columns:1fr}}
</style>
