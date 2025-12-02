const fetch = require('node-fetch');

// Cache for country codes (avoid hitting API repeatedly)
const geoCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getCountryCode(req, res) {
  try {
    const { ip } = req.params;
    
    if (!ip) {
      return res.status(400).json({ error: 'IP address required' });
    }

    // Check if localhost or private IP
    if (ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
      return res.json({ countryCode: 'LOCAL', cached: false });
    }

    // Check cache first
    const cached = geoCache.get(ip);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json({ countryCode: cached.countryCode, cached: true });
    }

    // Use ip-api.com (free, 45 req/min, no key needed)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Nebula-Proxy/1.0'
        }
      });
      
      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[GeoIP] Rate limited for IP ${ip}`);
          return res.json({ countryCode: 'UNKNOWN', cached: false, rateLimited: true });
        }
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();
      const countryCode = data.countryCode || 'UNKNOWN';
      
      // Cache the result
      geoCache.set(ip, {
        countryCode,
        timestamp: Date.now()
      });

      // Clean old cache entries periodically (every 100 requests)
      if (geoCache.size > 1000 && Math.random() < 0.01) {
        const now = Date.now();
        for (const [key, value] of geoCache.entries()) {
          if (now - value.timestamp > CACHE_TTL) {
            geoCache.delete(key);
          }
        }
      }

      return res.json({ countryCode, cached: false });

    } catch (fetchError) {
      clearTimeout(timeout);
      
      if (fetchError.name === 'AbortError') {
        console.warn(`[GeoIP] Timeout for IP ${ip}`);
        return res.json({ countryCode: 'UNKNOWN', cached: false, timeout: true });
      }
      
      throw fetchError;
    }

  } catch (error) {
    console.error('[GeoIP] Error:', error);
    res.json({ countryCode: 'UNKNOWN', cached: false, error: error.message });
  }
}

module.exports = {
  getCountryCode
};
