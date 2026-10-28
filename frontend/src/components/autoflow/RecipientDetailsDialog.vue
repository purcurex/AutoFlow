<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import ShippingCountryBadge from './ShippingCountryBadge.vue'
import type { ShippingRecipient } from '@/api/fop-orders'
defineProps<{ recipient: ShippingRecipient; countryCode?: string | null; orderNumber: string }>()
defineEmits<{ close: [] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
</script>
<template>
  <OrganizationModal :title="text('收件人信息', 'Recipient details')" size="compact" @close="$emit('close')">
    <div class="recipient-details">
      <div class="recipient-summary"><div><strong>{{ recipient.name || '—' }}</strong><p>{{ orderNumber }}</p></div><ShippingCountryBadge :code="countryCode" /></div>
      <dl class="recipient-fields">
        <div><dt>{{ text('联系电话', 'Phone') }}</dt><dd>{{ recipient.phone || '—' }}</dd></div>
        <div><dt>{{ text('电子邮箱', 'Email') }}</dt><dd>{{ recipient.email || '—' }}</dd></div>
        <div><dt>{{ text('州 / 省', 'State / Province') }}</dt><dd>{{ recipient.state || '—' }}</dd></div>
        <div><dt>{{ text('城市', 'City') }}</dt><dd>{{ recipient.city || '—' }}</dd></div>
        <div><dt>{{ text('邮编', 'Postal code') }}</dt><dd>{{ recipient.postalCode || '—' }}</dd></div>
        <div class="recipient-address"><dt>{{ text('详细地址', 'Street address') }}</dt><dd>{{ recipient.addressLine1 || '—' }}<span v-if="recipient.addressLine2">{{ recipient.addressLine2 }}</span></dd></div>
      </dl>
    </div>
  </OrganizationModal>
</template>
<style scoped>
.recipient-summary{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--color-border)}.recipient-summary>div{min-width:0}.recipient-summary strong{font-size:19px;font-weight:600;overflow-wrap:anywhere}.recipient-summary p{font-size:12px;color:var(--color-text-secondary);margin:6px 0 0;overflow-wrap:anywhere}
.recipient-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 24px;margin:22px 0 0}.recipient-fields dt{font-size:12px;color:var(--color-text-secondary);margin-bottom:7px}.recipient-fields dd{margin:0;font-size:14px;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap}.recipient-address{grid-column:1/-1}.recipient-address span{display:block}@media(max-width:480px){.recipient-fields{grid-template-columns:1fr;gap:16px}}
</style>
