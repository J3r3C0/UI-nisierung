#!/usr/bin/env node
/**
 * validate_snapshot_bundle.mjs
 *
 * Validates a Causal Snapshot ZIP bundle:
 * 1) Unzips bundle
 * 2) Validates manifest.json structure and verifies file SHA256 hashes
 * 3) Validates breakdown.json against causal_breakdown v1.1 schema (AJV)
 * 4) Validates metadata.json against causal_snapshot_metadata v1.0 schema (AJV)
 *
 * Usage:
 *   node validate_snapshot_bundle.mjs path/to/bundle.zip --pretty
 *   node validate_snapshot_bundle.mjs path/to/bundle.zip --pretty --strict
 *
 * Exit codes:
 *   0 OK
 *   1 Validation failed
 *   2 File/runtime error
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Ajv from 'ajv';
import JSZip from 'jszip';

// --- Paths to schemas ---
const SCHEMA_BREAKDOWN = path.resolve('schemas/causal_breakdown_v1.1.schema.json');
const SCHEMA_METADATA = path.resolve('schemas/causal_snapshot_metadata_v1.0.schema.json');
const SCHEMA_MANIFEST = path.resolve('schemas/causal_snapshot_manifest_v1.0.schema.json');

// Optional normalizer
const NORMALIZER_PATH = path.resolve('src/forensics/normalizeBreakdown.js');

// Parse CLI args
const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith('-'));
const PRETTY = args.includes('--pretty');
const STRICT = args.includes('--strict');

if (!zipPath) {
  console.error('Usage: validate_snapshot_bundle.mjs <bundle.zip> [--pretty] [--strict]');
  process.exit(2);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function prettyAjvErrors(errors) {
  return errors
    .map((e) => `  • ${(e.instancePath || '/') + ' ' + e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`)
    .join('\n');
}

function fail(msg, details) {
  console.error('❌ ' + msg);
  if (details) console.error(details);
  process.exit(1);
}

function warn(msg) {
  console.warn('⚠ ' + msg);
}

// Load schemas
let breakdownSchema, metadataSchema, manifestSchema;
try {
  breakdownSchema = readJSON(SCHEMA_BREAKDOWN);
  metadataSchema = readJSON(SCHEMA_METADATA);
  manifestSchema = readJSON(SCHEMA_MANIFEST);
} catch (e) {
  console.error('❌ Failed to load schemas:', e.message);
  process.exit(2);
}

// Set up AJV
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const validateBreakdown = ajv.compile(breakdownSchema);
const validateMetadata = ajv.compile(metadataSchema);
const validateManifest = ajv.compile(manifestSchema);

// Load optional normalizer
let normalizeBreakdown = null;
try {
  normalizeBreakdown = (await import(pathToFileURL(NORMALIZER_PATH).toString())).normalizeBreakdown;
} catch {
  // Normalizer optional
}

function pathToFileURL(p) {
  return new URL('file://' + path.resolve(p));
}

// Read zip bytes
let zipBytes;
try {
  zipBytes = fs.readFileSync(zipPath);
} catch (e) {
  console.error('❌ Failed to read zip:', e.message);
  process.exit(2);
}

// Parse zip
let zip;
try {
  zip = await JSZip.loadAsync(zipBytes);
} catch (e) {
  console.error('❌ Failed to parse zip:', e.message);
  process.exit(2);
}

// Required files
const REQUIRED = ['metadata.json', 'manifest.json', 'breakdown.json', 'coupling-graph.json', 'state.json'];
for (const f of REQUIRED) {
  if (!zip.file(f)) fail(`Missing required file: ${f}`);
}

async function loadZipJSON(name) {
  const txt = await zip.file(name).async('string');
  return JSON.parse(txt);
}

let metadata, manifest, breakdown;
try {
  metadata = await loadZipJSON('metadata.json');
  manifest = await loadZipJSON('manifest.json');
  breakdown = await loadZipJSON('breakdown.json');
} catch (e) {
  console.error('❌ Failed to parse JSON from zip:', e.message);
  process.exit(2);
}

// Validate manifest schema
if (!validateManifest(manifest)) {
  const details = PRETTY ? prettyAjvErrors(validateManifest.errors) : JSON.stringify(validateManifest.errors);
  fail('manifest.json schema invalid', details);
}

// Verify file hashes
const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
let hashMismatches = 0;
for (const entry of manifestFiles) {
  const fileObj = zip.file(entry.path);
  if (!fileObj) {
    hashMismatches++;
    warn(`Manifest references missing file: ${entry.path}`);
    continue;
  }
  const buf = await fileObj.async('nodebuffer');
  const actual = sha256Hex(buf);
  if (actual !== entry.sha256) {
    hashMismatches++;
    warn(`Hash mismatch: ${entry.path}\n  expected=${entry.sha256}\n  actual  =${actual}`);
  }
  if (typeof entry.bytes === 'number' && entry.bytes !== buf.byteLength) {
    warn(`Byte size mismatch: ${entry.path} expected=${entry.bytes} actual=${buf.byteLength}`);
  }
}
if (hashMismatches > 0) fail(`Manifest hash verification failed (${hashMismatches} mismatches)`);

// Validate metadata
if (!validateMetadata(metadata)) {
  const details = PRETTY ? prettyAjvErrors(validateMetadata.errors) : JSON.stringify(validateMetadata.errors);
  fail('metadata.json schema invalid', details);
}

// Normalize breakdown if needed
if (!breakdown.breakdown_version) warn('[Audit] Legacy breakdown (missing version). Normalizing to 1.1');
if (typeof normalizeBreakdown === 'function') {
  try {
    breakdown = normalizeBreakdown(breakdown);
  } catch (e) {
    console.error('❌ normalizeBreakdown failed:', e.message);
    process.exit(2);
  }
}

// Validate breakdown
if (!validateBreakdown(breakdown)) {
  const details = PRETTY ? prettyAjvErrors(validateBreakdown.errors) : JSON.stringify(validateBreakdown.errors);
  fail('breakdown.json schema invalid', details);
}

// Optional soft policy checks
let policyWarnings = 0;
function isNil(x) {
  return x === null || x === undefined;
}
if (Array.isArray(breakdown.blocked)) {
  for (const b of breakdown.blocked) {
    if (b.reason === 'MAX_SKEW_EXCEEDED') {
      if (isNil(b.skew_ms) || isNil(b.max_skew_ms)) {
        policyWarnings++;
        warn(`[Policy] MAX_SKEW_EXCEEDED should include skew_ms and max_skew_ms (edge_id=${b.edge_id})`);
      }
    }
    if (b.reason === 'SUPPRESSED_BY_REPLACE') {
      if (isNil(b.message)) {
        policyWarnings++;
        warn(`[Policy] SUPPRESSED_BY_REPLACE should include message (edge_id=${b.edge_id})`);
      }
    }
  }
}

if (STRICT && policyWarnings > 0) fail(`Strict mode: policy warnings encountered (${policyWarnings})`);

console.log('✅ VALID SNAPSHOT — bundle hashes + schemas OK');
console.log(`   Zip: ${zipPath}`);
console.log(`   Files verified: ${manifestFiles.length}`);
if (policyWarnings > 0) console.log(`   Policy warnings: ${policyWarnings} (non-fatal)`);
