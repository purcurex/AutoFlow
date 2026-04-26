import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UsersService } from '../users/users.service'
import { UserRole } from '../users/user.entity'
import { VerificationService } from './verification.service'

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private verificationService: VerificationService,
  ) {}

  async sendVerificationCode(email: string) {
    // 检查邮箱是否已注册
    const existingEmail = await this.usersService.findByEmail(email)
    if (existingEmail) {
      throw new ConflictException('该邮箱已被注册')
    }

    return this.verificationService.sendVerificationCode(email)
  }

  async register(email: string, username: string, password: string, verificationCode: string) {
    // 验证验证码
    const verification = this.verificationService.verifyCode(email, verificationCode)
    if (!verification.valid) {
      throw new BadRequestException(verification.message)
    }

    // 检查邮箱是否已存在
    const existingEmail = await this.usersService.findByEmail(email)
    if (existingEmail) {
      throw new ConflictException('邮箱已被注册')
    }

    // 检查用户名是否已存在
    const existingUsername = await this.usersService.findByUsername(username)
    if (existingUsername) {
      throw new ConflictException('用户名已被使用')
    }

    // 创建用户
    const user = await this.usersService.create(email, username, password)

    // 生成token
    const token = this.generateToken(user.id, user.email, user.role)

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    }
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email)
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误')
    }

    const isPasswordValid = await this.usersService.validatePassword(password, user.password)
    if (!isPasswordValid) {
      throw new UnauthorizedException('邮箱或密码错误')
    }

    const token = this.generateToken(user.id, user.email, user.role)

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    }
  }

  private generateToken(userId: string, email: string, role: UserRole): string {
    const payload = { userId, email, role }
    return this.jwtService.sign(payload)
  }
}
