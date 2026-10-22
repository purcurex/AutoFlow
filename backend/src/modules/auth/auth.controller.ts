import { AllowWithoutBusinessData } from './management-access.decorator'
import { Controller, Post, Body, UseGuards, Request, Get, Res } from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { RegisterDto, LoginDto, SendCodeDto } from './dto/auth.dto'
import { Request as ExpressRequest, Response } from 'express'
import { Throttle } from '@nestjs/throttler'

@AllowWithoutBusinessData()
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
  async register(@Body() registerDto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.register(
      registerDto.email,
      registerDto.username,
      registerDto.password,
      registerDto.verificationCode
    )
    this.setSessionCookie(response, result.token)
    return { user: result.user }
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(loginDto.email, loginDto.password)
    this.setSessionCookie(response, result.token)
    return { user: result.user }
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('autoflow_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
    })
    return { success: true }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: ExpressRequest) {
    return this.authService.getProfile(req.user!.userId)
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie('autoflow_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
  }
}
