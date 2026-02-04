/**
 * SHA-256 helper functions for browser environment using SubtleCrypto.
 *
 * These functions produce lowercase hex strings. They can be used to compute
 * file and string hashes when building snapshot manifests.
 */

export async function sha256HexFromArrayBuffer(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return toHex(hash);
}

export async function sha256HexFromString(str) {
  const enc = new TextEncoder();
  return sha256HexFromArrayBuffer(enc.encode(str).buffer);
}

export function toHex(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
