/** Deployment capability, separate from whether a local (possibly Mock) dataset is readable. */
export interface ReplicaReadinessInput {
  local: boolean; mock: boolean; paused: boolean; initialized: boolean; sourceConfigured: boolean
}
export function replicaReadiness(input: ReplicaReadinessInput) {
  const runtimeBlockers = [
    ...(!input.local ? ['local_read_mode_required'] : []),
    ...(input.mock ? ['mock_dataset'] : []),
    ...(input.paused ? ['fop_queries_paused'] : []),
    ...(!input.sourceConfigured ? ['source_adapter_not_configured'] : []),
  ]
  return {
    historicalImport: {
      implemented: true, executable: runtimeBlockers.length === 0,
      blockers: runtimeBlockers,
    },
    incrementalSync: {
      configured: input.sourceConfigured,
      executable: runtimeBlockers.length === 0 && input.initialized,
      blockers: [...runtimeBlockers, ...(!input.initialized ? ['dataset_not_initialized'] : [])],
    },
  }
}
