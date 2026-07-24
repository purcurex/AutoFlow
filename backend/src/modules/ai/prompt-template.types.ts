export const AI_PROMPT_MODULES = [
  'outreach_base',
  'channel_whatsapp',
  'channel_email',
  'channel_instagram',
  'channel_facebook',
  'channel_other',
  'quote_none',
  'quote_product',
  'quote_logistics',
  'quote_combined',
  'product_visual',
  'supplier_strength',
  'logistics_strength',
] as const

export type AiPromptModuleKey = (typeof AI_PROMPT_MODULES)[number]

export const AI_PROMPT_VARIABLES = [
  'channel', 'language', 'brandName', 'domain', 'category', 'country',
  'evidenceSummary', 'offer', 'quoteContext', 'productImageUrl',
] as const

export const SYSTEM_PROMPT_TEMPLATES: Array<{
  id: string
  moduleKey: AiPromptModuleKey
  name: string
  content: string
}> = [
  { id: 'a1000000-0000-4000-8000-000000000001', moduleKey: 'outreach_base', name: 'System Default', content: 'Write a specific, respectful first-touch message for {{brandName}} ({{domain}}). Use a low-pressure tone and end with one clear call to action.' },
  { id: 'a1000000-0000-4000-8000-000000000002', moduleKey: 'channel_whatsapp', name: 'WhatsApp Default', content: 'Write at most 70 words in short conversational paragraphs. Do not include a subject line.' },
  { id: 'a1000000-0000-4000-8000-000000000003', moduleKey: 'channel_email', name: 'Email Default', content: 'Write at most 130 words in three short paragraphs. Do not include a subject line in the message body.' },
  { id: 'a1000000-0000-4000-8000-000000000004', moduleKey: 'channel_instagram', name: 'Instagram Default', content: 'Write at most 60 words as a concise direct message. Avoid formal email language.' },
  { id: 'a1000000-0000-4000-8000-000000000005', moduleKey: 'channel_facebook', name: 'Facebook Default', content: 'Write at most 70 words as a concise direct message. Do not include a subject line.' },
  { id: 'a1000000-0000-4000-8000-000000000006', moduleKey: 'quote_none', name: 'No Quote Default', content: 'Do not mention pricing, quotations, product cost, freight cost, or discounts.' },
  { id: 'a1000000-0000-4000-8000-000000000007', moduleKey: 'quote_product', name: 'Product Quote Default', content: 'Include only verified product quotation facts from {{quoteContext}}. Keep quantity tiers clear and do not mention a freight quotation.' },
  { id: 'a1000000-0000-4000-8000-000000000008', moduleKey: 'quote_logistics', name: 'Freight Quote Default', content: 'Include only verified logistics quotation facts from {{quoteContext}}. State destination and channel when supplied; do not mention a product quotation.' },
  { id: 'a1000000-0000-4000-8000-000000000009', moduleKey: 'quote_combined', name: 'Combined Quote Default', content: 'Use only verified facts from {{quoteContext}}. Separate product price and destination freight so the customer can understand the total offer.' },
  { id: 'a1000000-0000-4000-8000-000000000010', moduleKey: 'product_visual', name: 'Product Visual Default', content: 'Refer naturally to the attached product image and summarize selling points only from the supplied evidence. Attachment URL: {{productImageUrl}}.' },
  { id: 'a1000000-0000-4000-8000-000000000011', moduleKey: 'supplier_strength', name: 'Supplier Strength Default', content: 'Emphasize sourcing, low-MOQ, quality-control, and supply flexibility only when supported by {{offer}}. Do not claim certifications, factory ownership, or exclusivity.' },
  { id: 'a1000000-0000-4000-8000-000000000012', moduleKey: 'logistics_strength', name: 'Logistics Strength Default', content: 'Emphasize logistics coordination and fulfillment support only from {{offer}}. Do not guarantee rates, delivery times, customs outcomes, or coverage.' },
  { id: 'a1000000-0000-4000-8000-000000000013', moduleKey: 'channel_other', name: 'Other Channel Default', content: 'Write a concise first-touch message suitable for the user-specified outreach channel. Avoid channel-specific formatting unless the user explicitly requests it.' },
]
