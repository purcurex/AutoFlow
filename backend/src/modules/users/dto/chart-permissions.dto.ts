import { ValidateBy } from 'class-validator'
import { ChartPermissionOverride, validateChartPermissions } from '../chart-permissions'

export class UpdateChartPermissionsDto {
  @ValidateBy({
    name: 'chartPermissions',
    validator: {
      validate: validateChartPermissions,
      defaultMessage: () => 'Chart permissions must contain unique known charts and valid scopes; selected summaries require unique departments.',
    },
  })
  chartPermissions: ChartPermissionOverride[]
}
