import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, ValidateIf, Matches, IsString, Max, MaxLength, Min } from 'class-validator'
export class AllocationInventoryQueryDto {
  @IsIn(['selected', 'search']) mode!: 'selected' | 'search'
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(120, { each: true }) @Matches(/\S/, { each: true }) orderIds?: string[]
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(100) search?: string
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['HZ', 'SZ']) warehouseCode?: 'HZ' | 'SZ'
  @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1
  @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsIn([20, 50, 100]) pageSize = 50
}
