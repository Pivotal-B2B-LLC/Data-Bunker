/**
 * Rate limiting utility for API calls
 * Prevents hitting API limits
 */

class RateLimiter {
  constructor(maxRequests = 5, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = {};
  }

  /**
   * Check if request is allowed
   */
  isAllowed(key) {
    const now = Date.now();
    
    if (!this.requests[key]) {
      this.requests[key] = {
        count: 1,
        resetTime: now + this.windowMs
      };
      return true;
    }

    const record = this.requests[key];
    
    // Reset if window has passed
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + this.windowMs;
      return true;
    }

    // Check if limit exceeded
    if (record.count >= this.maxRequests) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Get remaining requests and reset time
   */
  getStatus(key) {
    const now = Date.now();
    const record = this.requests[key];
    
    if (!record) {
      return {
        remaining: this.maxRequests,
        resetTime: now + this.windowMs
      };
    }

    if (now > record.resetTime) {
      return {
        remaining: this.maxRequests,
        resetTime: now + this.windowMs
      };
    }

    return {
      remaining: Math.max(0, this.maxRequests - record.count),
      resetTime: record.resetTime
    };
  }
}

module.exports = RateLimiter;
