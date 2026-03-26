/**
 * Replay protection store for MPP challenge IDs.
 *
 * `consume` atomically checks whether an ID is valid and marks it as
 * used, preventing TOCTOU races in concurrent settlement attempts.
 */
export interface ReplayStore {
  consume(id: string): Promise<boolean>;
  add(id: string, expiresAt?: number): Promise<void>;
}

export function createInMemoryReplayStore(): ReplayStore {
  const store = new Map<string, number>();

  function prune() {
    const now = Date.now();
    for (const [id, expiresAt] of store) {
      if (expiresAt > 0 && expiresAt <= now) {
        store.delete(id);
      }
    }
  }

  return {
    async add(id, expiresAt) {
      prune();
      store.set(id, expiresAt ?? 0);
    },
    async consume(id) {
      prune();
      if (!store.has(id)) return false;
      store.delete(id);
      return true;
    },
  };
}
