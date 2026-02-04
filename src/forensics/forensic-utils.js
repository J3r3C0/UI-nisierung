/**
 * forensic-utils.js
 * Browser-side SHA256 and Manifest building helpers for Causal Snapshots.
 */

const ForensicUtils = {
    async sha256HexFromArrayBuffer(buf) {
        const hash = await crypto.subtle.digest("SHA-256", buf);
        return this.toHex(hash);
    },

    async sha256HexFromString(str) {
        const enc = new TextEncoder();
        return this.sha256HexFromArrayBuffer(enc.encode(str).buffer);
    },

    toHex(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let hex = "";
        for (let i = 0; i < bytes.length; i++) {
            hex += bytes[i].toString(16).padStart(2, "0");
        }
        return hex;
    },

    async buildManifestFromZip(zip) {
        const files = [];
        const entries = Object.values(zip.files).filter(f => !f.dir);

        for (const f of entries) {
            const buf = await f.async("arraybuffer");
            const sha256 = await this.sha256HexFromArrayBuffer(buf);

            files.push({
                path: f.name,
                sha256,
                bytes: buf.byteLength,
                content_type: this.guessContentType(f.name)
            });
        }

        files.sort((a, b) => a.path.localeCompare(b.path));

        return {
            manifest_version: "causal_manifest_v1.0",
            created_at_iso: new Date().toISOString(),
            files,
            bundle_sha256: null,
            notes: null
        };
    },

    guessContentType(name) {
        const n = name.toLowerCase();
        if (n.endsWith(".json")) return "application/json";
        if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain";
        return null;
    }
};

if (typeof window !== 'undefined') {
    window.ForensicUtils = ForensicUtils;
}
