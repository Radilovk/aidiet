/**
 * Shared Utilities for AIDiet Application
 * Provides caching and optimization utilities to reduce backend load
 */

/**
 * VAPID Key Cache
 * Caches the VAPID public key in localStorage to avoid redundant backend requests
 * Cache duration: 24 hours (VAPID keys rarely change)
 */
const VapidKeyCache = {
    CACHE_KEY: 'aidiet_vapid_key',
    CACHE_TIMESTAMP_KEY: 'aidiet_vapid_key_timestamp',
    CACHE_DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
    
    /**
     * Get VAPID key from cache or fetch from server
     * @param {string} workerUrl - Worker URL
     * @returns {Promise<string|null>} VAPID public key or null if not configured
     */
    async get(workerUrl) {
        try {
            // Check cache first
            const cached = this.getFromCache();
            if (cached) {
                console.log('✅ Using cached VAPID key (reduces backend load)');
                return cached;
            }
            
            // Fetch from server
            console.log('🔄 Fetching VAPID key from server...');
            const vapidResponse = await fetch(`${workerUrl}/api/push/vapid-public-key`);
            const vapidData = await vapidResponse.json();
            
            if (!vapidData.success || vapidData.publicKey === 'VAPID_PUBLIC_KEY_NOT_CONFIGURED') {
                console.warn('❌ VAPID keys not configured on server');
                return null;
            }
            
            // Validate VAPID key format
            if (!vapidData.publicKey || vapidData.publicKey.length < 80) {
                console.error('❌ Invalid VAPID public key format received from server');
                return null;
            }
            
            // Cache the key
            this.saveToCache(vapidData.publicKey);
            console.log('✅ VAPID key fetched and cached for 24 hours');
            
            return vapidData.publicKey;
        } catch (error) {
            console.error('Error fetching VAPID key:', error);
            return null;
        }
    },
    
    /**
     * Get VAPID key from localStorage cache
     * @returns {string|null} Cached key or null if expired/missing
     */
    getFromCache() {
        try {
            const key = localStorage.getItem(this.CACHE_KEY);
            const timestamp = localStorage.getItem(this.CACHE_TIMESTAMP_KEY);
            
            if (!key || !timestamp) {
                return null;
            }
            
            const age = Date.now() - parseInt(timestamp);
            if (age > this.CACHE_DURATION_MS) {
                // Cache expired
                this.clearCache();
                return null;
            }
            
            return key;
        } catch (error) {
            console.error('Error reading VAPID key cache:', error);
            return null;
        }
    },
    
    /**
     * Save VAPID key to cache
     * @param {string} key - VAPID public key
     */
    saveToCache(key) {
        try {
            localStorage.setItem(this.CACHE_KEY, key);
            localStorage.setItem(this.CACHE_TIMESTAMP_KEY, Date.now().toString());
        } catch (error) {
            console.error('Error saving VAPID key to cache:', error);
        }
    },
    
    /**
     * Clear VAPID key cache (useful when keys are rotated)
     */
    clearCache() {
        try {
            localStorage.removeItem(this.CACHE_KEY);
            localStorage.removeItem(this.CACHE_TIMESTAMP_KEY);
        } catch (error) {
            console.error('Error clearing VAPID key cache:', error);
        }
    }
};

/**
 * Request Deduplication
 * Prevents duplicate requests within a short time window
 * Useful for preventing double-clicks and rapid retries
 */
const RequestDeduplicator = {
    pending: new Map(),
    cache: new Map(),
    
    /**
     * Execute a request with deduplication
     * @param {string} key - Unique key for this request
     * @param {Function} requestFn - Function that returns a Promise
     * @param {number} cacheDuration - Cache duration in ms (default: 5000ms)
     * @returns {Promise} The request result
     */
    async execute(key, requestFn, cacheDuration = 5000) {
        // Check if request is already pending
        if (this.pending.has(key)) {
            console.log(`⏳ Request for "${key}" already pending, reusing...`);
            return this.pending.get(key);
        }
        
        // Check if we have a recent cached result
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < cacheDuration) {
            console.log(`✅ Using cached result for "${key}" (reduces backend load)`);
            return cached.result;
        }
        
        // Execute the request
        const promise = requestFn()
            .then(result => {
                // Cache the result
                this.cache.set(key, { result, timestamp: Date.now() });
                this.pending.delete(key);
                return result;
            })
            .catch(error => {
                this.pending.delete(key);
                throw error;
            });
        
        this.pending.set(key, promise);
        return promise;
    },
    
    /**
     * Clear a specific cache entry
     * @param {string} key - Cache key to clear
     */
    clearCache(key) {
        this.cache.delete(key);
    },
    
    /**
     * Clear all cache entries
     */
    clearAllCache() {
        this.cache.clear();
    }
};

/**
 * Debounce function
 * Delays function execution until after a specified wait time has elapsed
 * since the last time it was invoked
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function
 * Ensures function is called at most once per specified time period
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
