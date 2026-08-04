import { sanitizeSourcingSnapshot } from './sourcing-snapshot'

describe('sanitizeSourcingSnapshot', () => {
  it('removes nested authentication, signature, image, token, and trace fields case-insensitively', () => {
    const result = sanitizeSourcingSnapshot({
      access_token: 'test-access-token',
      'access-token': 'test-access-token-hyphen',
      accessToken: 'test-access-token-camel',
      refresh_token: 'test-refresh-token',
      'refresh-token': 'test-refresh-token-hyphen',
      refreshToken: 'test-refresh-token-camel',
      app_secret: 'test-app-secret-underscore',
      appSecret: 'test-app-secret',
      _AOP_SIGNATURE: 'test-signature',
      image_base64: 'test-image-payload-underscore',
      imageBase64: 'test-image-payload',
      trace_info: { requestId: 'test-trace-id-underscore' },
      traceInfo: { requestId: 'test-trace-id' },
      token: 'test-root-token',
      accessTokenExpiresAt: '2026-08-04T06:00:00.000Z',
      nested: {
        token: 'test-temporary-token',
        offerId: 1688,
      },
    })

    expect(result).toEqual({
      accessTokenExpiresAt: '2026-08-04T06:00:00.000Z',
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

  it.each([
    '  HtTpS://test-user:test-password@[invalid::ipv6]/offer?token=test-query  ',
    'https://test-user:test-password@detail.1688.test:99999/offer?access_token=test-query',
  ])('replaces a malformed HTTP(S) URL with a fixed marker: %s', (url) => {
    const result = sanitizeSourcingSnapshot({ url })
    const serialized = JSON.stringify(result)

    expect(result.url).toBe('[invalid-http-url]')
    expect(serialized).not.toContain('test-user')
    expect(serialized).not.toContain('test-password')
    expect(serialized).not.toContain('test-query')
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
      `${'x'.repeat(65_522)}...[truncated]`,
    )
    expect(Buffer.byteLength(result.description as string, 'utf8')).toBe(
      65_536,
    )
    expect(result.exactBoundary).toBe('y'.repeat(64 * 1024))
  })

  it('applies the 64 KiB limit to UTF-8 bytes instead of character count', () => {
    const oversizedDescription = '汉'.repeat(30_000)

    const result = sanitizeSourcingSnapshot({
      description: oversizedDescription,
    })

    expect(result.description).toBe(
      `${'汉'.repeat(21_840)}...[truncated]`,
    )
    expect(Buffer.byteLength(result.description as string, 'utf8')).toBe(
      65_534,
    )
    expect(Buffer.byteLength(result.description as string, 'utf8')).toBeLessThanOrEqual(
      65_536,
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

  it('normalizes non-finite numbers to JSON null values', () => {
    const result = sanitizeSourcingSnapshot({
      notANumber: Number.NaN,
      positiveInfinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      finiteNumber: 1688,
    })

    expect(result).toEqual({
      notANumber: null,
      positiveInfinity: null,
      negativeInfinity: null,
      finiteNumber: 1688,
    })
  })

  it('normalizes non-JSON values without executing an own toJSON function', () => {
    let toJsonCalls = 0
    const input = {
      callable: () => 'unsafe-result',
      symbol: Symbol('unsafe-symbol'),
      undefinedValue: undefined,
      values: [undefined, Symbol('array-symbol'), () => 'array-callable'],
      providerPayload: {
        offerId: 1688,
        toJSON() {
          toJsonCalls += 1
          return { token: 'test-token-from-to-json', offerId: 1n }
        },
      },
    }

    const result = sanitizeSourcingSnapshot(input)

    expect(result).toEqual({
      callable: null,
      symbol: null,
      undefinedValue: null,
      values: [null, null, null],
      providerPayload: {
        offerId: 1688,
        toJSON: null,
      },
    })
    expect(toJsonCalls).toBe(0)
    expect(() => JSON.stringify(result)).not.toThrow()
    expect(JSON.stringify(result)).not.toContain('token')
    expect(toJsonCalls).toBe(0)
  })

  it('normalizes valid and invalid Date values without invoking Date serialization later', () => {
    const result = sanitizeSourcingSnapshot({
      createdAt: new Date('2026-08-04T06:00:00.000Z'),
      invalidDate: new Date(Number.NaN),
    })

    expect(result).toEqual({
      createdAt: '2026-08-04T06:00:00.000Z',
      invalidDate: null,
    })
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('converts class instances to plain sanitized records without prototype methods', () => {
    class ProviderOffer {
      constructor(
        public readonly offerId: number,
        public readonly token: string,
      ) {}

      getDisplayName(): string {
        return `offer-${this.offerId}`
      }
    }

    const result = sanitizeSourcingSnapshot({
      offer: new ProviderOffer(1688, 'test-provider-token'),
    })
    const offer = result.offer as Record<string, unknown>

    expect(offer).toEqual({ offerId: 1688 })
    expect(Object.getPrototypeOf(offer)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(offer, 'getDisplayName')).toBe(
      false,
    )
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
