export type AgedLRUCacheOpts = {
  capacity?: number;
  maxAge?: number;
  now?: () => number;
};

export class AgedLRUCache<K, V> {
  private maxAge: number;
  private capacity: number;
  private cache: Map<K, { birth: number; value: V }>;
  private now: () => number;

  constructor(opts: AgedLRUCacheOpts = {}) {
    this.capacity = opts.capacity ?? 256;
    this.maxAge = opts.maxAge ?? 30 * 1000;
    this.now = opts.now ?? Date.now;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);

    if (value === undefined) {
      return undefined;
    }

    this.cache.delete(key);

    if (this.now() - value.birth >= this.maxAge) {
      return undefined;
    }

    this.cache.set(key, value);
    return value.value;
  }

  put(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }
    this.cache.set(key, { birth: this.now(), value });
  }

  public get size() {
    return this.cache.size;
  }
}
