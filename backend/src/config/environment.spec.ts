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
})
