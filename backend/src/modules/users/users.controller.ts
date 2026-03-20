import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { extname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Request as ExpressRequest } from 'express'

// 确保上传目录存在
const uploadDir = './uploads/avatars'
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true })
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: ExpressRequest) {
    const user = await this.usersService.findById(req.user!.userId)
    if (!user) return null
    const { password: _, ...result } = user
    return result
  }

  @UseGuards(JwtAuthGuard)
  @Put('profile')
  async updateProfile(
    @Request() req: ExpressRequest,
    @Body() updateData: { username?: string; avatarUrl?: string },
  ) {
    const user = await this.usersService.update(req.user!.userId, updateData)
    const { password: _, ...result } = user
    return result
  }

  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: uploadDir,
        filename: (_req, file, callback) => {
          const uniqueName = uuidv4() + extname(file.originalname)
          callback(null, uniqueName)
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          callback(
            new BadRequestException('只支持图片文件 (jpg, jpeg, png, gif, webp)'),
            false,
          )
        } else {
          callback(null, true)
        }
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  async uploadAvatar(
    @Request() req: ExpressRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的图片')
    }

    const avatarUrl = `/uploads/avatars/${file.filename}`
    const user = await this.usersService.update(req.user!.userId, { avatarUrl })
    const { password: _, ...result } = user
    return { ...result, avatarUrl }
  }
}
