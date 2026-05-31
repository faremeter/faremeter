/**
 * Replay protection store for MPP challenge IDs and consumed signatures.
 *
 * `consume` atomically checks whether an ID is valid and marks it as
 * used, preventing TOCTOU races in concurrent settlement attempts.
 * `claim` atomically records an ID only when it has not been seen before.
 * `release` removes a claimed ID when the operation that claimed it did not
 * commit.
 */
export interface ReplayStore {
  consume(id: string): Promise<boolean>;
  add(id: string, expiresAt?: number): Promise<void>;
  claim(id: string, expiresAt?: number): Promise<boolean>;
  release(id: string): Promise<void>;
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
    async claim(id, expiresAt) {
      prune();
      if (store.has(id)) return false;
      store.set(id, expiresAt ?? 0);
      return true;
    },
    async release(id) {
      prune();
      store.delete(id);
    },
    async consume(id) {
      prune();
      if (!store.has(id)) return false;
      store.delete(id);
      return true;
    },
  };
}
