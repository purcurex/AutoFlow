import type { WorkbenchDataAvailability } from '@/api/workbench-replica'

/** Missing source documents are distinct from a complete query with zero matching rows. */
export function isUncollectedPage(page?: { items: unknown[]; dataAvailability?: WorkbenchDataAvailability }): boolean {
  return page?.dataAvailability?.mode === 'collected' && page.dataAvailability.complete === false
    && !!page.dataAvailability.missingDatasets?.length && page.items.length === 0
}
