import {
  buildParam2SignaturePath,
  serializeParam2Parameters,
  serializeParam2Value,
  signParam2Request,
} from './param2-signer'

describe('Alibaba 1688 Param2 signer', () => {
  it('builds the exact cross-border Param2 signature path', () => {
    expect(buildParam2SignaturePath(
      '1',
      'com.alibaba.fenxiao.crossborder',
      'product.search.keywordQuery',
      '4270841',
    )).toBe(
      'param2/1/com.alibaba.fenxiao.crossborder/product.search.keywordQuery/4270841',
    )
  })

  it('produces the deterministic uppercase HMAC-SHA1 used by Ocean SDK', () => {
    const signature = signParam2Request(
      'param2/1/com.alibaba.fenxiao.crossborder/product.search.keywordQuery/4270841',
      {
        access_token: 'test-access-token',
        _aop_timestamp: '1720000000000',
        offerQueryParam: '{"beginPage":1,"keyword":"pet bottle","pageSize":20}',
      },
      'test-app-secret',
    )

    expect(signature).toBe('FE6C75940513C73E740E738124C7FE8AF61B4D30')
  })

  it('serializes nested JSON compactly and deterministically', () => {
    const first = serializeParam2Value({
      pageSize: 20,
      filters: [{ end: '100', start: '10', ignored: undefined }],
      keyword: 'pet bottle',
      beginPage: 1,
    })
    const second = serializeParam2Value({
      beginPage: 1,
      keyword: 'pet bottle',
      filters: [{ start: '10', end: '100' }],
      pageSize: 20,
    })

    expect(first).toBe(
      '{"beginPage":1,"filters":[{"end":"100","start":"10"}],"keyword":"pet bottle","pageSize":20}',
    )
    expect(second).toBe(first)
  })

  it('omits null top-level parameters and stringifies primitive values', () => {
    expect(serializeParam2Parameters({
      missing: undefined,
      alsoMissing: null,
      enabled: false,
      page: 2,
      keyword: 'bottle',
    })).toEqual({
      enabled: 'false',
      page: '2',
      keyword: 'bottle',
    })
  })
})
