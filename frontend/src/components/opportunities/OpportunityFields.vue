<script setup lang="ts">
import CountryPicker from '@/components/ui/CountryPicker.vue'
import type { OpportunityFields, OpportunityOptions } from '@/api/opportunities'
const draft = defineModel<OpportunityFields>({ required: true })
defineProps<{ options: OpportunityOptions; disabled?: boolean }>()
</script>
<template><fieldset :disabled="disabled" class="opportunity-fields">
 <label>客户名称 <b>*</b><input v-model="draft.customerName" name="customerName" class="input" required maxlength="160" /></label>
 <label>商机阶段<select v-model="draft.stage" name="stage" class="input"><option :value="null">请选择</option><option v-for="item in options.stages" :key="item.value" :value="item.value">{{item.label}}</option></select></label>
 <label>预计日均量<select v-model="draft.dailyVolume" name="dailyVolume" class="input"><option :value="null">请选择</option><option v-for="item in options.dailyVolumes" :key="item.value" :value="item.value">{{item.label}}</option></select></label>
 <label>预计月订单额 (USD)<input v-model="draft.monthlyAmount" name="monthlyAmount" class="input" inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="请输入金额" /></label>
 <label>主卖产品<input v-model="draft.mainProducts" class="input" maxlength="4000" /></label>
 <label>国家<CountryPicker v-model="draft.country" :disabled="disabled" /></label>
 <label>城市<input v-model="draft.city" class="input" maxlength="120" /></label>
 <label>登记日期 <b>*</b><input v-model="draft.registeredOn" type="date" required class="input" /></label>
 <label>WhatsApp<input v-model="draft.whatsapp" class="input" maxlength="120" placeholder="国家区号及号码" /></label>
 <label class="span-2">店铺链接<input v-model="draft.storeUrl" type="url" pattern="https?://.*" class="input" maxlength="1000" placeholder="https://" /></label>
 <label class="span-2">客户经营范围<textarea v-model="draft.businessScope" class="input" rows="2" maxlength="4000" /></label>
 <label class="full">本周跟进情况<textarea v-model="draft.currentFollowUp" name="currentFollowUp" class="input" rows="3" maxlength="8000" /></label>
 <label class="span-2">下周计划<textarea v-model="draft.nextFollowUpPlan" class="input" rows="3" maxlength="8000" /></label>
 <label class="span-2">问题反馈<textarea v-model="draft.problemFeedback" class="input" rows="3" maxlength="8000" /></label>
</fieldset></template>
<style scoped>
.opportunity-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;border:0;padding:24px;margin:0;min-width:0}.opportunity-fields label{font-size:12px;font-weight:500;min-width:0}.input{margin-top:8px;width:100%}textarea{resize:vertical}.span-2{grid-column:span 2}.full{grid-column:1/-1}b{color:#c25252}.opportunity-fields:disabled{opacity:.8}@media(max-width:1100px){.opportunity-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.opportunity-fields{grid-template-columns:1fr;padding:18px}.span-2{grid-column:1}}
</style>
