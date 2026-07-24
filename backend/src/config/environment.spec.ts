import { validateEnvironment } from './environment'

describe('production environment validation', () => {
  const validProductionConfig = {
    NODE_ENV: 'production',
    JWT_SECRET: 'a-secure-production-secret-with-32-characters',
    DB_HOST: 'postgres',
    DB_USERNAME: 'autoflow',
    DB_PASSWORD: 'database-password',
    DB_DATABASE: 'autoflow',
    DB_SYNCHRONIZE: 'false',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-password',
  }

  it('accepts a complete production configuration', () => {
    expect(validateEnvironment({ ...validProductionConfig })).toMatchObject(validProductionConfig)
  })

  it('rejects production schema synchronization', () => {
    expect(() =>
      validateEnvironment({ ...validProductionConfig, DB_SYNCHRONIZE: 'true' }),
    ).toThrow('DB_SYNCHRONIZE')
  })

  it('requires explicit bootstrap credentials when bootstrap is enabled', () => {
    expect(() =>
      validateEnvironment({ ENABLE_ADMIN_BOOTSTRAP: 'true' }),
    ).toThrow('ADMIN_BOOTSTRAP_EMAIL')
  })

  it('allows the Alibaba 1688 provider to remain disabled without credentials', () => {
    expect(validateEnvironment({ ALIBABA_1688_ENABLED: 'false' })).toMatchObject({
      ALIBABA_1688_ENABLED: 'false',
    })
  })

  it('requires server credentials and an access token when Alibaba 1688 is enabled', () => {
    expect(() =>
      validateEnvironment({ ALIBABA_1688_ENABLED: 'true' }),
    ).toThrow('ALIBABA_1688_APP_KEY')

    expect(() =>
      validateEnvironment({
        ALIBABA_1688_ENABLED: 'true',
        ALIBABA_1688_APP_KEY: 'app-key',
        ALIBABA_1688_APP_SECRET: 'app-secret',
      }),
    ).toThrow('ALIBABA_1688_ACCESS_TOKEN')
  })

  it('requires the Alibaba 1688 gateway to use HTTPS', () => {
    expect(() =>
      validateEnvironment({
        ALIBABA_1688_ENABLED: 'true',
        ALIBABA_1688_APP_KEY: 'app-key',
        ALIBABA_1688_APP_SECRET: 'app-secret',
        ALIBABA_1688_ACCESS_TOKEN: 'access-token',
        ALIBABA_1688_GATEWAY_URL: 'http://gw.open.1688.com/openapi',
      }),
    ).toThrow('ALIBABA_1688_GATEWAY_URL must use HTTPS')
  })
})
