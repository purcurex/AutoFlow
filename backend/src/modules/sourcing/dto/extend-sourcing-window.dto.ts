import { Type } from 'class-transformer'
import { IsDivisibleBy, IsInt, Min } from 'class-validator'

/** 前端传目标窗口而不是“增加量”，保证双击或网络重试不会重复扩展。 */
export class ExtendSourcingWindowDto {
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @IsDivisibleBy(100)
  targetLimit: number
}
