import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getToken, runCheck, queryBody, runAuthCheck } from './fop-openapi-smoke.mjs'

const config = { FOP_OPENAPI_IDENTITY: 'test-only-identity', FOP_OPENAPI_CLIENT_ID: 'test-only-client', FOP_OPENAPI_CLIENT_SECRET: 'test-only-secret', FOP_OPENAPI_USERNAME: 'test-user', FOP_OPENAPI_ACCOUNT_ID: 'test-account', FOP_TEST_CUSTOMER_ID: '9223372036854775806', FOP_TEST_ORDER_TYPE: 'confirmed-type', FOP_TEST_ORDER_NUMBER: 'SO261028000002' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })

test('probe never sends supplied credentials and does not report gateway rejection as success', async () => {
  const result = await runCheck(config, { probe: true }, async (url, init) => {
    assert.equal(url, 'https://hyperzone.test.kdgalaxy.com/kapi/v2/hzkj/hzkj_ordercenter/order/queryOrder')
    assert.equal(init.headers.access_token, undefined); assert.equal(init.headers['x-acgw-identity'], undefined)
    return json({ errorCode: '2501', messagecn: '不存在应用信息[网关]' }, 519)
  })
  assert.equal(result.report.success, false); assert.equal(result.report.errorCode, '2501'); assert.equal(result.raw, null)
})
test('acquires enhanced token then queries exact order with header credentials and zero-based page', async () => {
  const calls = []
  const result = await runCheck(config, {}, async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'error')
    const body = JSON.parse(init.body)
    if (calls.length === 1) {
      assert.ok(url.endsWith('/kapi/oauth2/getToken'))
      assert.equal(body.client_secret, config.FOP_OPENAPI_CLIENT_SECRET)
      assert.equal(body.accountId, 'test-account'); assert.ok(body.nonce); assert.ok(body.timestamp.endsWith('Z'))
      return json({ status: true, errorCode: '0', data: { access_token: 'test-only-token' } })
    }
    assert.equal(init.headers.access_token, 'test-only-token')
    assert.equal(init.headers['x-acgw-identity'], 'test-only-identity')
    assert.equal(body.customerId, config.FOP_TEST_CUSTOMER_ID); assert.equal(body.pageIndex, 0)
    return json({ status: true, errorCode: '0', data: { total: 1, array: [{ billno: config.FOP_TEST_ORDER_NUMBER }] } })
  })
  assert.equal(calls.length, 2); assert.equal(result.report.success, true); assert.equal(result.report.matchedOrder, true)
  assert.ok(!JSON.stringify(result.report).includes('test-only-'))
})
test('empty or different order results are not reported as a matching order', async () => {
  for (const array of [[], [{ billno: 'OTHER' }]]) {
    const result = await runCheck({ ...config, FOP_OPENAPI_ACCESS_TOKEN: 'existing-token' }, {}, async () => json({ status: true, data: { array } }))
    assert.equal(result.report.success, true); assert.equal(result.report.matchedOrder, false)
  }
})
test('HTTP 200 token/business error envelopes still fail without leaking messages', async () => {
  await assert.rejects(getToken(config, async () => json({ status: false, errorCode: '401', message: config.FOP_OPENAPI_CLIENT_SECRET })), error => !error.message.includes(config.FOP_OPENAPI_CLIENT_SECRET))
  const result = await runCheck({ ...config, FOP_OPENAPI_ACCESS_TOKEN: 'existing-token' }, {}, async () => json({ status: false, errorCode: '1001', message: config.FOP_OPENAPI_CLIENT_SECRET }))
  assert.equal(result.report.success, false); assert.equal(result.raw, null)
})
test('refuses unconfirmed hosts, missing assignments and unknown query schemas before network access', async () => {
  const network = async () => { throw new Error('must not make a network call') }
  await assert.rejects(runCheck({ ...config, FOP_OPENAPI_BASE_URL: 'https://other.example' }, {}, network), /test origin/)
  await assert.rejects(runCheck({ ...config, FOP_TEST_CUSTOMER_ID: '' }, {}, network), /FOP_TEST_CUSTOMER_ID/)
  await assert.rejects(runCheck(config, { operation: 'departments' }, network), /schemas were not supplied/)
  await assert.rejects(runCheck(config, { operation: 'approve' }, network), /read-only/)
})
test('uses each related document number independently, with documented pagination', () => {
  assert.deepEqual(queryBody({ FOP_TEST_DISPATCH_NUMBER: 'D-1' }, 'dispatch'), { data: { billno: 'D-1' }, pageNo: 1, pageSize: 10 })
  assert.throws(() => queryBody(config, 'allocation'), /FOP_TEST_ALLOCATION_NUMBER/)
})
test('supports configured Swagger header variant and GET user queries without placing tokens in URL', async () => {
  const result = await runCheck({ ...config, FOP_OPENAPI_ACCESS_TOKEN: 'existing-token', FOP_OPENAPI_TOKEN_HEADER: 'accessToken' }, { operation: 'user-by-id', body: { id: '9223372036854775806' } }, async (url, init) => {
    assert.equal(new URL(url).searchParams.get('id'), '9223372036854775806')
    assert.ok(!url.includes('existing-token')); assert.equal(init.headers.accessToken, 'existing-token'); assert.equal(init.body, undefined)
    return json({ status: true, data: { rows: [] } })
  })
  assert.equal(result.report.success, true)
})
test('preserves original response text containing 64-bit IDs', async () => {
  const raw = '{"status":true,"data":{"array":[{"id":9223372036854775806,"billno":"SO261028000002"}]}}'
  const result = await runCheck({ ...config, FOP_OPENAPI_ACCESS_TOKEN: 'existing-token' }, {}, async () => new Response(raw))
  assert.equal(result.raw, raw)
})
test('can check token acquisition before order fields are known without returning the token', async () => {
  const result = await runAuthCheck(config, async () => json({ status: true, data: { access_token: 'test-only-token' } }))
  assert.equal(result.report.success, true); assert.equal(result.raw, null)
  assert.ok(!JSON.stringify(result).includes('test-only-token'))
  await assert.rejects(runAuthCheck({ ...config, FOP_OPENAPI_ACCESS_TOKEN: 'unverified-token' }), /supplied token/)
})
test('network errors cannot echo request credentials to CLI output', async () => {
  await assert.rejects(getToken(config, async () => { throw new Error(config.FOP_OPENAPI_CLIENT_SECRET) }), error => !error.message.includes(config.FOP_OPENAPI_CLIENT_SECRET))
})
