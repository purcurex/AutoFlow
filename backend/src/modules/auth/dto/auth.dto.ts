import { IsEmail, IsString, MinLength, IsNotEmpty, Length, Matches, MaxLength } from 'class-validator'

export class SendCodeDto {
  @IsEmail()
  email: string
}

export class RegisterDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username: string

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password: string

  @IsString()
  @IsNotEmpty({ message: '验证码不能为空' })
  @Length(6, 6, { message: '验证码必须是6位' })
  @Matches(/^\d{6}$/, { message: '验证码必须是6位数字' })
  verificationCode: string
}

export class LoginDto {
  @IsEmail()
  email: string

  @IsString()
  @MaxLength(72)
  password: string
}
