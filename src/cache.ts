import NodeCache from "node-cache";

// Create a singleton cache instance
const cache = new NodeCache({
    stdTTL: 600, // 10 minutes default TTL
    checkperiod: 120, // Check for expired keys every 2 minutes
});

export const cacheManager = {
    get: <T>(key: string): T | undefined => {
        return cache.get<T>(key);
    },

    set: <T>(key: string, value: T, ttl?: number): boolean => {
        return cache.set(key, value, ttl ?? 600);
    },

    delete: (key: string): number => {
        return cache.del(key);
    },

    has: (key: string): boolean => {
        return cache.has(key);
    },

    clear: (): void => {
        cache.flushAll();
    },
};
