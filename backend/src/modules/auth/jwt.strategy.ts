import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { UserRole } from '../users/user.entity'
import { getJwtSecret } from './jwt.config'

function extractSessionCookie(cookieHeader?: string): string | null {
  if (!cookieHeader) return null
  const cookie = cookieHeader.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('autoflow_session='))
  if (!cookie) return null
  return decodeURIComponent(cookie.slice('autoflow_session='.length)) || null
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => extractSessionCookie(request?.headers?.cookie),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(configService),
    })
  }

  async validate(payload: { userId: string; email: string; role: UserRole }) {
    return { userId: payload.userId, email: payload.email, role: payload.role }
  }

}
