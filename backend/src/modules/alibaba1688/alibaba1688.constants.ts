export const ALIBABA_1688_PROVIDER = 'alibaba_1688' as const
export const ALIBABA_1688_SOURCE_TAG = '1688货源' as const

export const ALIBABA_1688_DEFAULTS = {
  gatewayUrl: 'https://gw.open.1688.com/openapi',
  protocol: 'param2',
  version: '1',
  namespace: 'com.alibaba.fenxiao.crossborder',
  keywordMethod: 'product.search.keywordQuery',
  imageMethod: 'product.search.imageQuery',
  detailMethod: 'product.search.queryProductDetail',
  pageSize: 20,
  requestTimeoutMs: 30000,
  datePattern: 'yyyy-MM-dd HH:mm:ss.SSS',
} as const
