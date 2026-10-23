import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import type { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const isProduction = process.env.NODE_ENV === 'production'
  const backendRoot = isProduction ? join(__dirname, '..', '..') : join(__dirname, '..')

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }))

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // 启用CORS（开发环境）
  if (!isProduction) {
    app.enableCors({
      origin: true,
      credentials: true,
    })
  }

  // 上传服务按运行目录写入 uploads；静态读取必须使用同一根目录，避免开发编译目录导致资源 404。
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  })

  // 生产环境：服务前端静态文件
  if (isProduction) {
    const frontendRoot = join(backendRoot, 'dist', 'public')
    app.useStaticAssets(frontendRoot, {
      prefix: '/',
    })
    app.use((req: Request, res: Response, next: NextFunction) => {
      const isFrontendRoute = req.method === 'GET'
        && !req.path.startsWith('/api')
        && !req.path.startsWith('/uploads')
        && !req.path.includes('.')
      if (!isFrontendRoute) return next()
      return res.sendFile(join(frontendRoot, 'index.html'))
    })
  }

  // 设置全局前缀
  app.setGlobalPrefix('api')

  const port = process.env.PORT || 3000
  await app.listen(port)
  console.log(`🚀 Application is running on: http://localhost:${port}/api`)
}

bootstrap()
