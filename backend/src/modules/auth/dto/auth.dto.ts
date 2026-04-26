import { IsEmail, IsString, MinLength, IsNotEmpty, Length } from 'class-validator'

export class SendCodeDto {
  @IsEmail()
  email: string
}

export class RegisterDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(2)
  username: string

  @IsString()
  @MinLength(6)
  password: string

  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  @Length(6, 6, { message: '验证码必须是6位' })
  verificationCode: string
}

export class LoginDto {
  @IsEmail()
  email: string

  @IsString()
  password: string
}
