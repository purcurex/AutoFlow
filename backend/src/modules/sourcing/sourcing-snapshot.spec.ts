import { sanitizeSourcingSnapshot } from './sourcing-snapshot'

describe('sanitizeSourcingSnapshot', () => {
  it('removes nested authentication, signature, image, token, and trace fields case-insensitively', () => {
    const result = sanitizeSourcingSnapshot({
      access_token: 'test-access-token',
      AccessToken: 'test-access-token-camel',
      REFRESH_TOKEN: 'test-refresh-token',
      refreshToken: 'test-refresh-token-camel',
      appSecret: 'test-app-secret',
      _AOP_SIGNATURE: 'test-signature',
      imageBase64: 'test-image-payload',
      nested: {
        token: 'test-temporary-token',
        traceInfo: { requestId: 'test-trace-id' },
        offerId: 1688,
      },
    })

    expect(result).toEqual({
      nested: {
        offerId: 1688,
      },
    })
  })

  it('removes HTTP(S) URL credentials and query parameters while preserving safe URL structure', () => {
    const result = sanitizeSourcingSnapshot({
      promotionUrl:
        'https://test-user:test-password@detail.1688.test:8443/offer/1.html?token=test-token&spm=test#specification',
      callbackUrl: 'http://api.1688.test/result?access_token=test-token',
      relativePath: '/offer/1.html?token=keep-as-non-url',
    })

    expect(result).toEqual({
      promotionUrl:
        'https://detail.1688.test:8443/offer/1.html#specification',
      callbackUrl: 'http://api.1688.test/result',
      relativePath: '/offer/1.html?token=keep-as-non-url',
    })
  })

  it('recursively sanitizes arrays and nested objects', () => {
    const result = sanitizeSourcingSnapshot({
      offers: [
        { offerId: 1, token: 'test-token-1' },
        {
          offerId: 2,
          variants: [
            { skuId: 'sku-1', imageBase64: 'test-image-payload' },
          ],
        },
      ],
    })

    expect(result).toEqual({
      offers: [
        { offerId: 1 },
        { offerId: 2, variants: [{ skuId: 'sku-1' }] },
      ],
    })
  })

  it('replaces circular references without overflowing the stack', () => {
    const circularOffer: Record<string, unknown> = { offerId: 1 }
    circularOffer.self = circularOffer

    expect(sanitizeSourcingSnapshot({ offer: circularOffer })).toEqual({
      offer: {
        offerId: 1,
        self: '[circular]',
      },
    })
  })

  it('truncates strings longer than 64 KiB with a marker', () => {
    const oversizedDescription = 'x'.repeat(64 * 1024 + 1)

    const result = sanitizeSourcingSnapshot({
      description: oversizedDescription,
      exactBoundary: 'y'.repeat(64 * 1024),
    })

    expect(result.description).toBe(
      `${'x'.repeat(64 * 1024)}...[truncated]`,
    )
    expect(result.exactBoundary).toBe('y'.repeat(64 * 1024))
  })

  it('applies the 64 KiB limit to UTF-8 bytes instead of character count', () => {
    const oversizedDescription = '汉'.repeat(30_000)

    const result = sanitizeSourcingSnapshot({
      description: oversizedDescription,
    })

    expect(Buffer.byteLength(result.description as string, 'utf8')).toBe(
      65_535 + Buffer.byteLength('...[truncated]', 'utf8'),
    )
    expect(result.description).toBe(
      `${'汉'.repeat(21_845)}...[truncated]`,
    )
  })

  it('copies __proto__ as an own field without changing result prototypes', () => {
    const input = JSON.parse(
      '{"__proto__":{"offerId":1},"nested":{"__proto__":{"offerId":2}}}',
    ) as Record<string, unknown>

    const result = sanitizeSourcingSnapshot(input)
    const nested = result.nested as Record<string, unknown>

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(
      true,
    )
    expect(result.__proto__).toEqual({ offerId: 1 })
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(nested, '__proto__')).toBe(
      true,
    )
    expect(nested.__proto__).toEqual({ offerId: 2 })
  })

  it('normalizes bigint values to persistable decimal strings', () => {
    const result = sanitizeSourcingSnapshot({
      offerId: 9_007_199_254_740_993n,
      quantitySteps: [1n, 10n],
    })

    expect(result).toEqual({
      offerId: '9007199254740993',
      quantitySteps: ['1', '10'],
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('does not mutate the input object or its nested collections', () => {
    const input = {
      promotionUrl:
        'https://test-user:test-password@detail.1688.test/offer/1.html?token=test-token',
      offers: [{ offerId: 1, token: 'test-temporary-token' }],
    }
    const originalUrl = input.promotionUrl
    const originalOffer = input.offers[0]

    const result = sanitizeSourcingSnapshot(input)

    expect(input).toEqual({
      promotionUrl: originalUrl,
      offers: [{ offerId: 1, token: 'test-temporary-token' }],
    })
    expect(result).not.toBe(input)
    expect(result.offers).not.toBe(input.offers)
    expect((result.offers as Array<Record<string, unknown>>)[0]).not.toBe(
      originalOffer,
    )
  })

  it.each([null, undefined, 'response', 1688, true, [1, 2]])(
    'returns an empty record when the root value is not a plain record: %p',
    (value) => {
      expect(sanitizeSourcingSnapshot(value)).toEqual({})
    },
  )
})
