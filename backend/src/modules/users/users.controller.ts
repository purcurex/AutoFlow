import { AllowWithoutBusinessData } from '../auth/management-access.decorator'
import {
  Controller,
  Get,
  Header,
  Put,
  Post,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { existsSync, mkdirSync } from 'fs'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Request as ExpressRequest } from 'express'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { WorkbenchAccessService } from './workbench-access.service'
import { ListWorkbenchAccountsDto, UpdateWorkbenchRolesDto } from './dto/workbench.dto'
import { UpdateBusinessScopeDto } from './dto/business-scope.dto'
import { UpdateFopBindingDto } from './dto/fop-binding.dto'
import { UpdateManagementRoleDto } from './dto/management-role.dto'

// 确保上传目录存在
const uploadDir = './uploads/avatars'
const avatarExtensionByMime: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true })
}

@AllowWithoutBusinessData()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly workbenchAccess: WorkbenchAccessService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('workbench-accounts')
  @Header('Cache-Control', 'private, no-store')
  listWorkbenchAccounts(@Request() req: ExpressRequest, @Query() query: ListWorkbenchAccountsDto) {
    return this.workbenchAccess.listAccounts(req.user!.userId, query)
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/workbench-roles')
  @Header('Cache-Control', 'private, no-store')
  updateWorkbenchRoles(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkbenchRolesDto,
  ) {
    return this.workbenchAccess.updateRoles(req.user!.userId, id, body.workbenchRoles)
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/management-role')
  @Header('Cache-Control', 'private, no-store')
  async updateManagementRole(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateManagementRoleDto) {
    await this.workbenchAccess.requireAdmin(req.user!.userId)
    return this.usersService.updateManagementRole(req.user!.userId, id, body.role)
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/business-scope')
  @Header('Cache-Control', 'private, no-store')
  async updateBusinessScope(@Request() req: ExpressRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateBusinessScopeDto) {
    await this.workbenchAccess.requireAdmin(req.user!.userId)
    return this.usersService.updateBusinessScope(id, body)
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/fop-binding')
  @Header('Cache-Control', 'private, no-store')
  async updateFopBinding(
    @Request() req: ExpressRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateFopBindingDto,
  ) {
    await this.workbenchAccess.requireAdmin(req.user!.userId)
    return this.usersService.updateFopBinding(id, body.tenantId, body.userId)
  }

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
    @Body() updateData: UpdateProfileDto,
  ) {
    const user = await this.usersService.updateProfile(req.user!.userId, updateData)
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
          const uniqueName = uuidv4() + avatarExtensionByMime[file.mimetype]
          callback(null, uniqueName)
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!avatarExtensionByMime[file.mimetype]) {
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
    const user = await this.usersService.updateAvatar(req.user!.userId, avatarUrl)
    const { password: _, ...result } = user
    return { ...result, avatarUrl }
  }
}
