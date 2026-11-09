import { parseKingdeeEnvelope } from './fop-kingdee-json'

describe('金蝶旧版包裹数量精确解码', () => {
  it('直接保留原始数字文本，长整数和小数不经浮点舍入', () => {
    const parsed = parseKingdeeEnvelope('{"schemaVersion":1,"items":[{"quantity":"2","lineQuantities":{"101":9007199254740993,"102":0.10000000000000000001}}]}')
    expect(parsed).toEqual({ schemaVersion: 1, items: [{ quantity: '2', lineQuantities: {
      '101': '9007199254740993', '102': '0.10000000000000000001',
    } }] })
  })
  it('新版本字符串数量保持原样，数组及其他数值字段不改变类型', () => {
    expect(parseKingdeeEnvelope('{"page":1,"amount":1.5,"values":[1,2],"lineQuantities":{"101":"0.30","102":null}}'))
      .toEqual({ page: 1, amount: 1.5, values: [1, 2], lineQuantities: { '101': '0.30', '102': null } })
  })
  it('相邻对象的同名来源行各自取值，不共享数字文本', () => {
    expect(parseKingdeeEnvelope('[{"lineQuantities":{"101":0.1}},{"lineQuantities":{"101":0.2}}]'))
      .toEqual([{ lineQuantities: { '101': '0.1' } }, { lineQuantities: { '101': '0.2' } }])
  })
  it('保留数量映射中的非法结构供契约校验，并拒绝损坏的JSON', () => {
    expect(parseKingdeeEnvelope('{"lineQuantities":[1,2]}')).toEqual({ lineQuantities: [1, 2] })
    expect(() => parseKingdeeEnvelope('{"lineQuantities":')).toThrow(SyntaxError)
  })
})
