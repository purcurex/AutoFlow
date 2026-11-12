import { collectReplicaPages } from './collect-replica-pages'

const proof = { readMode: 'local' as const, datasetId: 'dataset-1', revision: 'company:7' }
describe('replica export page collection', () => {
  it('collects complete pages only from the same dataset and published revision', async () => {
    const result = await collectReplicaPages(async page => ({ items: page === 1 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }], total: 3, page, pageSize: 2, replica: proof }))
    expect(result.items.map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(result.replica).toEqual(proof)
  })
  it.each(['dataset', 'revision', 'missing', 'count', 'duplicate', 'truncated'])('rejects %s drift without delivering a partial export', async drift => {
    await expect(collectReplicaPages(async page => ({ items: page === 1 ? [{ id: 'a' }, { id: 'b' }] : drift === 'truncated' ? [] : [{ id: drift === 'duplicate' ? 'a' : 'c' }],
      total: drift === 'count' && page === 2 ? 4 : 3, page, pageSize: 2,
      replica: drift === 'missing' ? undefined : { ...proof, datasetId: drift === 'dataset' && page === 2 ? 'other' : proof.datasetId, revision: drift === 'revision' && page === 2 ? 'company:8' : proof.revision } }))).rejects.toThrow()
  })
})
