const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('fs'), os = require('os'), path = require('path'), { createHash } = require('crypto')
const { collect } = require('./workbench-store-name-import.cjs')
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-store-name-'))
  const source = { status: true, errorCode: '0', data: { organizationIds: ['100000'], items: [{ id: '101', billno: 'TO101', hzkj_org: { id: '100000' }, hzkj_shop: { id: '201', name: 'Edelsound' } }] } }
  const body = JSON.stringify(source), file = 'shop-201.json'
  const manifest = { version: 1, complete: true, tenantId: 'hyperzone.test', companyId: '100000', language: 'zh_CN', source: 'employee-orders/page',
    stores: [{ shopId: '201', name: 'Edelsound', sourceOrderId: '101', sourceOrderNumber: 'TO101', file, sha256: createHash('sha256').update(body).digest('hex') }],
    targets: [{ source_id: '101', order_number: 'TO101', shop_id: '201' }] }
  const save = () => { fs.writeFileSync(path.join(directory, file), body); fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest)) }
  save()
  return { directory, manifest, save, close: () => fs.rmSync(directory, { recursive: true, force: true }) }
}
test('accepts verified same-company reference facts', () => {
  const f = fixture(); try { assert.equal(collect(f.directory).stores.get('201').name, 'Edelsound') } finally { f.close() }
})
test('rejects edited response, incorrect locale, cross-store linkage and duplicate targets', () => {
  const mutations = [
    f => { f.manifest.language = 'en_US'; f.save() },
    f => { f.manifest.stores[0].name = 'Guessed'; f.save() },
    f => { f.manifest.targets[0].shop_id = '202'; f.save() },
    f => { f.manifest.targets.push(f.manifest.targets[0]); f.save() },
    f => { f.manifest.stores[0].file = '../other.json'; f.save() },
    f => fs.appendFileSync(path.join(f.directory, 'shop-201.json'), ' '),
  ]
  for (const mutate of mutations) { const f = fixture(); try { mutate(f); assert.throws(() => collect(f.directory)) } finally { f.close() } }
})
