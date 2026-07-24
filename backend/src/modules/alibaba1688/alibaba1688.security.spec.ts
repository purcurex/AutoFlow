import {
  redactAlibaba1688Sensitive,
  sanitizeAlibaba1688Message,
} from './alibaba1688.security'

describe('Alibaba 1688 secret redaction', () => {
  it('redacts nested credentials without mutating ordinary evidence', () => {
    const redacted = redactAlibaba1688Sensitive({
      appSecret: 'secret-value',
      nested: {
        access_token: 'access-value',
        title: 'Portable bottle',
      },
      rows: [{ refreshToken: 'refresh-value' }],
    })

    expect(redacted).toEqual({
      appSecret: '[REDACTED]',
      nested: {
        access_token: '[REDACTED]',
        title: 'Portable bottle',
      },
      rows: [{ refreshToken: '[REDACTED]' }],
    })
  })

  it('removes known secret values and bearer tokens from provider text', () => {
    const sanitized = sanitizeAlibaba1688Message(
      'failed access_token=access-value appSecret=secret-value Authorization: Bearer abc.def.ghi',
      ['access-value', 'secret-value'],
    )

    expect(sanitized).not.toContain('access-value')
    expect(sanitized).not.toContain('secret-value')
    expect(sanitized).not.toContain('abc.def.ghi')
    expect(sanitized).toContain('[REDACTED]')
  })
})
