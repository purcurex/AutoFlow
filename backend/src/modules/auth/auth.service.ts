import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UsersService } from '../users/users.service'

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(email: string, username: string, password: string) {
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
    const token = this.generateToken(user.id, user.email)

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
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

    const token = this.generateToken(user.id, user.email)

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    }
  }

  private generateToken(userId: string, email: string): string {
    const payload = { userId, email }
    return this.jwtService.sign(payload)
  }
}
