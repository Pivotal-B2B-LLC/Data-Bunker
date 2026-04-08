/**
 * Caching utility for API responses
 * Reduces API calls and improves performance
 */

const NodeCache = require('node-cache');

class CacheManager {
  constructor(stdTTL = 3600) { // Default 1 hour TTL
    this.cache = new NodeCache({ stdTTL });
  }

  /**
   * Generate cache key from parameters
   */
  generateKey(service, params) {
    const paramsStr = JSON.stringify(params).replace(/\s/g, '');
    return `${service}:${paramsStr}`;
  }

  /**
   * Get cached value
   */
  get(service, params) {
    const key = this.generateKey(service, params);
    const value = this.cache.get(key);
    if (value) {
      console.log(`[CACHE HIT] ${key}`);
    }
    return value;
  }

  /**
   * Set cached value
   */
  set(service, params, value, ttl = 3600) {
    const key = this.generateKey(service, params);
    this.cache.set(key, value, ttl);
    console.log(`[CACHE SET] ${key} (TTL: ${ttl}s)`);
    return value;
  }

  /**
   * Clear all cache
   */
  flush() {
    this.cache.flushAll();
    console.log('[CACHE] Flushed all');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }
}

module.exports = new CacheManager();
