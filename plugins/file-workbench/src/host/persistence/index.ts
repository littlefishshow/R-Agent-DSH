/** Original service identity, with the bundle-owned deletion coordinator. */
export * from '@deepseek-ai/dsh-session-persistence'
export { SessionPersistence as default } from '@deepseek-ai/dsh-session-persistence'
export { PersistenceCoordinator, DEFAULT_PREPARED_SESSION_CACHE_SIZE, DEFAULT_WRITE_BATCH_MAX_DELAY_MS, MAX_WRITE_BATCH_DELAY_MS } from './coordinator.ts'
export type { PersistenceBackend, PersistenceCoordinatorOptions, StoredPrefix, StoredSuffix } from './coordinator.ts'
