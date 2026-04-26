import { ConfigService } from '@nestjs/config'

const DEFAULT_DEV_JWT_SECRET = 'autoflow-dev-secret-change-me'

export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')
  const nodeEnv = configService.get<string>('NODE_ENV', 'development')

  if (secret && secret.trim()) {
    return secret
  }

  if (nodeEnv === 'production') {
    throw new Error('JWT_SECRET must be configured in production.')
  }

  return DEFAULT_DEV_JWT_SECRET
}

export function getJwtExpiresIn(configService: ConfigService): string {
  return configService.get<string>('JWT_EXPIRES_IN', '7d')
}
