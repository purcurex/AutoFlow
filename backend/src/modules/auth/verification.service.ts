import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'

interface VerificationCode {
  code: string
  expiresAt: Date
}

@Injectable()
export class VerificationService {
  private codes = new Map<string, VerificationCode>()
  private transporter: nodemailer.Transporter | null = null

  constructor(private configService: ConfigService) {
    this.initTransporter()
  }

  private initTransporter() {
    const smtpHost = this.configService.get<string>('SMTP_HOST')
    const smtpPort = this.configService.get<number>('SMTP_PORT')
    const smtpUser = this.configService.get<string>('SMTP_USER')
    const smtpPass = this.configService.get<string>('SMTP_PASS')

    if (smtpHost && smtpUser && smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort || 587,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      })
    }
  }

  /**
   * 生成6位数字验证码
   */
  generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /**
   * 发送验证码到邮箱
   */
  async sendVerificationCode(email: string): Promise<{ success: boolean; message: string }> {
    // 检查是否配置了邮件服务
    if (!this.transporter) {
      // 开发环境：直接返回验证码（不发送邮件）
      const code = this.generateCode()
      this.storeCode(email, code)
      console.log(`[DEV] 验证码 for ${email}: ${code}`)
      return { success: true, message: `验证码已发送（开发模式：${code}）` }
    }

    // 生产环境：发送邮件
    const code = this.generateCode()
    this.storeCode(email, code)

    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER'),
        to: email,
        subject: 'NoteFlow 邮箱验证码',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #667eea;">NoteFlow 邮箱验证</h2>
            <p>您好！</p>
            <p>您正在注册 NoteFlow 账号，请使用以下验证码完成验证：</p>
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px;">${code}</span>
            </div>
            <p style="color: #666;">验证码有效期为 5 分钟，请尽快使用。</p>
            <p style="color: #999; font-size: 12px;">如果您没有请求此验证码，请忽略此邮件。</p>
          </div>
        `,
      })
      return { success: true, message: '验证码已发送到您的邮箱' }
    } catch (error) {
      console.error('发送邮件失败:', error)
      return { success: false, message: '验证码发送失败，请稍后重试' }
    }
  }

  /**
   * 存储验证码
   */
  private storeCode(email: string, code: string): void {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5分钟后过期
    this.codes.set(email, { code, expiresAt })
  }

  /**
   * 验证验证码
   */
  verifyCode(email: string, code: string): { valid: boolean; message: string } {
    const stored = this.codes.get(email)

    if (!stored) {
      return { valid: false, message: '验证码不存在或已过期，请重新获取' }
    }

    if (new Date() > stored.expiresAt) {
      this.codes.delete(email)
      return { valid: false, message: '验证码已过期，请重新获取' }
    }

    if (stored.code !== code) {
      return { valid: false, message: '验证码错误' }
    }

    // 验证成功后删除验证码
    this.codes.delete(email)
    return { valid: true, message: '验证成功' }
  }
}
