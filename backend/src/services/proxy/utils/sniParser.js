/**
 * SNI (Server Name Indication) parser for TLS ClientHello
 */

/**
 * Parse SNI from TLS ClientHello buffer
 * @param {Buffer} buf - Raw TLS handshake bytes
 * @returns {string|null} Extracted SNI hostname or null
 */
function parseSNI(buf) {
    try {
        if (!buf || buf.length < 43) return null;
        // TLS record must start with 0x16 (handshake)
        if (buf[0] !== 0x16) return null;
        // Skip: record header (5), handshake type (1), length (3), version (2), random (32), session ID length (1)
        let offset = 43;
        // Session ID
        const sessionIdLen = buf[offset];
        offset += 1 + sessionIdLen;
        if (offset + 2 > buf.length) return null;
        // Cipher suites length
        const cipherSuitesLen = buf.readUInt16BE(offset);
        offset += 2 + cipherSuitesLen;
        if (offset + 1 > buf.length) return null;
        // Compression methods length
        const compressionLen = buf[offset];
        offset += 1 + compressionLen;
        if (offset + 2 > buf.length) return null;
        // Extensions length
        const extensionsLen = buf.readUInt16BE(offset);
        offset += 2;
        const extensionsEnd = offset + extensionsLen;
        // Parse extensions
        while (offset + 4 <= extensionsEnd && offset + 4 <= buf.length) {
            const extType = buf.readUInt16BE(offset);
            const extLen = buf.readUInt16BE(offset + 2);
            offset += 4;
            if (extType === 0x00) {
                // SNI extension
                if (offset + 2 > buf.length) return null;
                const listLen = buf.readUInt16BE(offset);
                offset += 2;
                if (offset + 3 > buf.length) return null;
                const nameType = buf[offset];
                const nameLen = buf.readUInt16BE(offset + 1);
                offset += 3;
                if (nameType === 0x00 && offset + nameLen <= buf.length) {
                    return buf.toString('utf8', offset, offset + nameLen);
                }
                return null;
            }
            offset += extLen;
        }
        return null;
    } catch (e) {
        return null;
    }
}

module.exports = { parseSNI };
