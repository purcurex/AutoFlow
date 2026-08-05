import { getMetadataArgsStorage, type QueryRunner } from 'typeorm'
import { AddAlibaba1688Sourcing1784724000000 } from '../../../database/migrations/1784724000000-AddAlibaba1688Sourcing'
import { AddAlibaba1688SourcingPagination1784728000000 } from '../../../database/migrations/1784728000000-AddAlibaba1688SourcingPagination'
import { AddSourcingOfferProductFingerprint1784729000000 } from '../../../database/migrations/1784729000000-AddSourcingOfferProductFingerprint'
import { AddSourcingResponseCacheMetadata1784730000000 } from '../../../database/migrations/1784730000000-AddSourcingResponseCacheMetadata'
import { AddSourcingResultLimit1784731000000 } from '../../../database/migrations/1784731000000-AddSourcingResultLimit'
import {
  SourcingOfferEntity,
  SourcingSearchPageEntity,
  SourcingSearchEntity,
  SourcingSupplierEntity,
} from './index'

describe('sourcing persistence entities', () => {
  const storage = getMetadataArgsStorage()
  const entities = [SourcingSearchEntity, SourcingSupplierEntity, SourcingOfferEntity]

  it('maps leased sourcing page jobs with pagination and retry fields', () => {
    const table = storage.tables.find((metadata) => metadata.target === SourcingSearchPageEntity)
    const columns = storage.columns
      .filter((metadata) => metadata.target === SourcingSearchPageEntity)
      .map((metadata) => metadata.propertyName)

    expect(table?.name).toBe('sourcing_search_pages')
    expect(columns).toEqual(expect.arrayContaining([
      'searchId', 'ownerUserId', 'pageNumber', 'pageSize', 'status',
      'attempts', 'maxAttempts', 'availableAt', 'leaseOwner', 'leaseExpiresAt',
      'heartbeatAt', 'providerRequestId', 'providerTraceId', 'resultCount',
      'errorCode', 'errorMessage', 'startedAt', 'completedAt',
      'cacheHit', 'cacheSourcePageId',
    ]))
  })

  it.each([
    [SourcingSearchEntity, 'sourcing_searches'],
    [SourcingSupplierEntity, 'sourcing_suppliers'],
    [SourcingOfferEntity, 'sourcing_offers'],
  ])('maps %p to table %s', (entity, tableName) => {
    const table = storage.tables.find((metadata) => metadata.target === entity)

    expect(table?.name).toBe(tableName)
  })

  it.each(entities)('adds owner, workflow, and auditable provider scope to %p', (entity) => {
    const columns = storage.columns
      .filter((metadata) => metadata.target === entity)
      .map((metadata) => metadata.propertyName)

    expect(columns).toEqual(
      expect.arrayContaining(['ownerUserId', 'workflowRunId', 'provider']),
    )
    expect(columns).not.toEqual(
      expect.arrayContaining(['leadId', 'leadContactId', 'contactScore', 'totalScore']),
    )
  })

  it('persists the search lifecycle and request audit fields', () => {
    const columns = storage.columns
      .filter((metadata) => metadata.target === SourcingSearchEntity)
      .map((metadata) => metadata.propertyName)

    expect(columns).toEqual(
      expect.arrayContaining([
        'searchMode',
        'status',
        'requestId',
        'providerRequestId',
        'providerMethod',
        'cacheFingerprint',
        'resultLimit',
        'requestPayload',
        'errorCode',
        'errorMessage',
        'requestedAt',
        'startedAt',
        'completedAt',
      ]),
    )
  })

  it('persists independent offer scoring and supplier sourcing attributes', () => {
    const offerColumns = storage.columns
      .filter((metadata) => metadata.target === SourcingOfferEntity)
      .map((metadata) => metadata.propertyName)
    const supplierColumns = storage.columns
      .filter((metadata) => metadata.target === SourcingSupplierEntity)
      .map((metadata) => metadata.propertyName)

    expect(offerColumns).toEqual(
      expect.arrayContaining([
        'offerId',
        'offerUrl',
        'priceTiers',
        'productFingerprint',
        'sourcingScore',
        'sourcingScoreReasons',
        'rawSnapshot',
      ]),
    )
    expect(supplierColumns).toEqual(
      expect.arrayContaining([
        'memberId',
        'openId',
        'companyName',
        'shopName',
        'supplierRating',
        'yearsInBusiness',
        'capabilities',
      ]),
    )
  })

  it('defines deduplication, scope, and score metadata', () => {
    const uniqueNames = storage.uniques
      .filter((metadata) => entities.includes(metadata.target as typeof entities[number]))
      .map((metadata) => metadata.name)
    const indexNames = storage.indices
      .filter((metadata) => entities.includes(metadata.target as typeof entities[number]))
      .map((metadata) => metadata.name)
    const checkNames = storage.checks
      .filter((metadata) => entities.includes(metadata.target as typeof entities[number]))
      .map((metadata) => metadata.name)

    expect(uniqueNames).toEqual(
      expect.arrayContaining([
        'uq_sourcing_searches_owner_request',
        'uq_sourcing_suppliers_search_provider_key',
        'uq_sourcing_offers_search_provider_offer',
      ]),
    )
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_sourcing_searches_owner_created',
        'idx_sourcing_searches_workflow_status',
        'idx_sourcing_suppliers_owner_rating',
        'idx_sourcing_offers_owner_score',
        'idx_sourcing_offers_provider_offer',
        'uq_sourcing_offers_search_provider_fingerprint',
      ]),
    )
    expect(checkNames).toEqual(
      expect.arrayContaining([
        'chk_sourcing_searches_provider',
        'chk_sourcing_searches_mode',
        'chk_sourcing_searches_status',
        'chk_sourcing_suppliers_rating',
        'chk_sourcing_offers_score',
        'chk_sourcing_offers_repurchase_rate',
      ]),
    )
  })

  it('cascades search and workflow cleanup without lead relations', () => {
    const relations = storage.relations.filter((metadata) =>
      entities.includes(metadata.target as typeof entities[number]),
    )
    const relation = (entity: typeof entities[number], propertyName: string) =>
      relations.find(
        (metadata) => metadata.target === entity && metadata.propertyName === propertyName,
      )

    expect(relation(SourcingSearchEntity, 'workflowRun')?.options.onDelete).toBe('CASCADE')
    expect(relation(SourcingSupplierEntity, 'search')?.options.onDelete).toBe('CASCADE')
    expect(relation(SourcingOfferEntity, 'search')?.options.onDelete).toBe('CASCADE')
    expect(relation(SourcingOfferEntity, 'supplier')?.options.onDelete).toBe('SET NULL')
    expect(relations.map((metadata) => metadata.propertyName)).not.toContain('lead')
  })
})

describe('AddSourcingResponseCacheMetadata migration', () => {
  it('adds reversible tenant-scoped cache metadata and lookup indexes', async () => {
    const upRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const downRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const migration = new AddSourcingResponseCacheMetadata1784730000000()

    await migration.up(upRunner)
    await migration.down(downRunner)

    const upSql = (upRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    const downSql = (downRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    expect(upSql).toContain('ADD COLUMN "cache_fingerprint" varchar(64)')
    expect(upSql).toContain('ADD COLUMN "cache_hit" boolean NOT NULL DEFAULT false')
    expect(upSql).toContain('ADD COLUMN "cache_source_page_id" uuid')
    expect(upSql).toContain('idx_sourcing_searches_cache_lookup')
    expect(upSql).toContain('idx_sourcing_pages_cache_lookup')
    expect(upSql).toContain('idx_sourcing_offers_owner_provider_offer_recent')
    expect(upSql).toContain('idx_sourcing_suppliers_owner_provider_open_recent')
    expect(downSql).toContain('DROP COLUMN IF EXISTS "cache_fingerprint"')
    expect(downSql).toContain('DROP COLUMN IF EXISTS "cache_hit"')
    expect(downSql).toContain('DROP COLUMN IF EXISTS "cache_source_page_id"')
  })
})

describe('AddSourcingResultLimit migration', () => {
  it('adds a reversible 100-item result window constraint', async () => {
    const upRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const downRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const migration = new AddSourcingResultLimit1784731000000()

    await migration.up(upRunner)
    await migration.down(downRunner)

    const upSql = (upRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    const downSql = (downRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    expect(upSql).toContain('ADD COLUMN "result_limit" integer NOT NULL DEFAULT 100')
    expect(upSql).toContain('CHECK ("result_limit" >= 100 AND "result_limit" % 100 = 0)')
    expect(downSql).toContain('DROP CONSTRAINT IF EXISTS "chk_sourcing_searches_result_limit"')
    expect(downSql).toContain('DROP COLUMN IF EXISTS "result_limit"')
  })
})

describe('AddSourcingOfferProductFingerprint migration', () => {
  it('adds a nullable fingerprint with a reversible search-scoped unique index', async () => {
    const upRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const downRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const migration = new AddSourcingOfferProductFingerprint1784729000000()

    await migration.up(upRunner)
    await migration.down(downRunner)

    const upSql = (upRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    const downSql = (downRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    expect(upSql).toContain('ADD COLUMN "product_fingerprint" varchar(64)')
    expect(upSql).toContain('"search_id", "provider", "product_fingerprint"')
    expect(upSql).toContain('WHERE "product_fingerprint" IS NOT NULL')
    expect(downSql).toContain('DROP INDEX IF EXISTS "uq_sourcing_offers_search_provider_fingerprint"')
    expect(downSql).toContain('DROP COLUMN IF EXISTS "product_fingerprint"')
  })
})

describe('AddAlibaba1688SourcingPagination migration', () => {
  it('adds the leased page table, precision fields, and a reversible partial state', async () => {
    const upRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const downRunner = { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner
    const migration = new AddAlibaba1688SourcingPagination1784728000000()

    await migration.up(upRunner)
    await migration.down(downRunner)

    const upSql = (upRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    const downSql = (downRunner.query as jest.Mock).mock.calls.map(([sql]) => sql).join('\n')
    expect(upSql).toContain('CREATE TABLE "sourcing_search_pages"')
    expect(upSql).toContain('UNIQUE ("search_id", "page_number")')
    expect(upSql).toContain('"heartbeat_at" timestamptz')
    expect(upSql).toContain("'partial'")
    expect(upSql).toContain('numeric(9,4)')
    expect(downSql).toContain("WHERE \"status\" = 'partial'")
    expect(downSql).toContain('DROP TABLE IF EXISTS "sourcing_search_pages"')
  })
})

describe('AddAlibaba1688Sourcing migration', () => {
  it('creates only independent sourcing tables and reverses them in dependency order', async () => {
    const upQueries: string[] = []
    const downQueries: string[] = []
    const migration = new AddAlibaba1688Sourcing1784724000000()
    const upRunner = {
      query: jest.fn(async (query: string) => {
        upQueries.push(query)
      }),
    } as unknown as QueryRunner
    const downRunner = {
      query: jest.fn(async (query: string) => {
        downQueries.push(query)
      }),
    } as unknown as QueryRunner

    await migration.up(upRunner)
    await migration.down(downRunner)

    const upSql = upQueries.join('\n').toLowerCase()
    expect(upSql).toContain('create table "sourcing_searches"')
    expect(upSql).toContain('create table "sourcing_suppliers"')
    expect(upSql).toContain('create table "sourcing_offers"')
    expect(upSql).toContain('check ("sourcing_score" >= 0 and "sourcing_score" <= 100)')
    expect(upSql).not.toContain('lead_contacts')
    expect(upSql).not.toContain('lead_scores')
    expect(downQueries).toEqual([
      'DROP TABLE IF EXISTS "sourcing_offers"',
      'DROP TABLE IF EXISTS "sourcing_suppliers"',
      'DROP TABLE IF EXISTS "sourcing_searches"',
    ])
  })
})
