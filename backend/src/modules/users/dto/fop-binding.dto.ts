import { Transform } from 'class-transformer'
import { Allow, ValidateBy } from 'class-validator'

const trimId = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class UpdateFopBindingDto {
  @Transform(trimId)
  @ValidateBy({
    name: 'fopBindingPair',
    validator: {
      validate: (_value, args) => {
        const { tenantId, userId } = args!.object as UpdateFopBindingDto
        return (tenantId === null && userId === null)
          || [tenantId, userId].every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && id === id.trim())
      },
      defaultMessage: () => 'tenantId and userId must both be nonempty IDs of at most 128 characters, or both null',
    },
  })
  tenantId: string | null

  @Allow()
  @Transform(trimId)
  userId: string | null
}
