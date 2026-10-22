import { SetMetadata } from '@nestjs/common'

export const ALLOW_WITHOUT_BUSINESS_DATA = 'allowWithoutBusinessData'
/** Only exempts the business-data gate. Authentication and management checks still apply. */
export const AllowWithoutBusinessData = () => SetMetadata(ALLOW_WITHOUT_BUSINESS_DATA, true)
