import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { RegisterDto, LoginDto, SendCodeDto } from './dto/auth.dto'
import { Request as ExpressRequest } from 'express'
import { Throttle } from '@nestjs/throttler'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-code')
  @Throttle({ default: { limit: 3, ttl: 5 * 60 * 1000 } })
  async sendCode(@Body() sendCodeDto: SendCodeDto) {
    return this.authService.sendVerificationCode(sendCodeDto.email)
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 5 * 60 * 1000 } })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(
      registerDto.email,
      registerDto.username,
      registerDto.password,
      registerDto.verificationCode
    )
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.email, loginDto.password)
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: ExpressRequest) {
    return req.user
  }
}
