const TRUE_VALUES = new Set(['true', '1', 'yes'])

function enabled(value: unknown): boolean {
  return TRUE_VALUES.has(String(value ?? '').toLowerCase())
}

function requireValue(config: Record<string, unknown>, key: string): string {
  const value = String(config[key] ?? '').trim()
  if (!value) throw new Error(`${key} must be configured.`)
  return value
}

function requireHttpsUrl(config: Record<string, unknown>, key: string): string {
  const value = requireValue(config, key)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${key} must be a valid URL.`)
  }
  if (url.protocol !== 'https:') throw new Error(`${key} must use HTTPS.`)
  return value
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = String(config.NODE_ENV ?? 'development')

  if (nodeEnv === 'production') {
    const jwtSecret = requireValue(config, 'JWT_SECRET')
    if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters in production.')

    for (const key of ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
      requireValue(config, key)
    }
    if (enabled(config.DB_SYNCHRONIZE)) {
      throw new Error('DB_SYNCHRONIZE must remain false in production.')
    }
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
      throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured in production.')
    }
  }

  if (enabled(config.ENABLE_ADMIN_BOOTSTRAP)) {
    requireValue(config, 'ADMIN_BOOTSTRAP_EMAIL')
    const password = requireValue(config, 'ADMIN_BOOTSTRAP_PASSWORD')
    if (password.length < 12) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters.')
  }

  if (enabled(config.ALIBABA_1688_ENABLED)) {
    requireValue(config, 'ALIBABA_1688_APP_KEY')
    requireValue(config, 'ALIBABA_1688_APP_SECRET')
    requireValue(config, 'ALIBABA_1688_ACCESS_TOKEN')
    requireHttpsUrl(config, 'ALIBABA_1688_GATEWAY_URL')
  }

  return config
}
