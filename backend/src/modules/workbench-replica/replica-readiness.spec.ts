import { replicaReadiness } from './replica-readiness'
const ready = { local: true, mock: false, paused: false, initialized: true, sourceConfigured: true }
it('reports the wired importer separately from dataset readability', () => {
  expect(replicaReadiness(ready)).toEqual({
    historicalImport: { implemented: true, executable: true, blockers: [] },
    incrementalSync: { configured: true, executable: true, blockers: [] },
  })
})
it('reports independent source, pause and initialization blockers', () => {
  const result = replicaReadiness({ ...ready, paused: true, initialized: false, sourceConfigured: false })
  expect(result.historicalImport.blockers).toEqual(['fop_queries_paused','source_adapter_not_configured'])
  expect(result.incrementalSync).toEqual({configured:false,executable:false,blockers:['fop_queries_paused','source_adapter_not_configured','dataset_not_initialized']})
})
it.each([{mock:true},{local:false}])('never advertises source execution in %j', overrides => {
  expect(replicaReadiness({...ready,...overrides}).incrementalSync.executable).toBe(false)
})
