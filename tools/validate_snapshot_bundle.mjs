#!/usr/bin/env node
/**
 * validate_snapshot_bundle.mjs
 *
 * Validates a Causal Snapshot ZIP bundle:
 * 1) Unzips bundle
 * 2) Validates manifest.json structure (light check) and verifies file SHA256 hashes
 * 3) Validates breakdown.json against causal_breakdown v1.1 schema (AJV)
 * 4) Validates metadata.json against causal_snapshot_metadata v1.0 schema (AJV)
 *
 * Usage:
 *   node tools/validate_snapshot_bundle.mjs path/to/causal_snapshot_*.zip --pretty
 *   node tools/validate_snapshot_bundle.mjs path/to/causal_snapshot_*.zip --pretty --strict
 *
 * Exit codes:
 *   0 OK
 *   1 Validation failed
 *   2 File/runtime error
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import Ajv from "ajv";
import JSZip from "jszip";

// ---- paths (adjust if needed) ----
const SCHEMA_BREAKDOWN = path.resolve("schemas/causal_breakdown_v1.1.schema.json");
const SCHEMA_METADATA = path.resolve("schemas/causal_snapshot_metadata_v1.0.schema.json");
const SCHEMA_MANIFEST = path.resolve("schemas/causal_snapshot_manifest_v1.0.schema.json");

// Optional normalizer (same as UI/CLI)
const NORMALIZER_PATH = path.resolve("src/forensics/normalizeBreakdown.js");

// ---- args ----
const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith("-"));
const PRETTY = args.includes("--pretty");
const STRICT = args.includes("--strict");

if (!zipPath) {
    console.error("Usage: validate_snapshot_bundle.mjs <bundle.zip> [--pretty] [--strict]");
    process.exit(2);
}

function readJsonFile(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function sha256Hex(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function prettyAjvErrors(errors) {
    if (!errors || !errors.length) return "";
    return errors
        .map((e) => `  • ${(e.instancePath || "/") + " " + e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`)
        .join("\n");
}

function fail(msg, extra = null) {
    console.error("❌ " + msg);
    if (extra) console.error(extra);
    process.exit(1);
}

function warn(msg) {
    console.warn("⚠ " + msg);
}

function pathToFileUrl(p) {
    return new URL(`file://${path.resolve(p)}`);
}

// ---- load schemas ----
let breakdownSchema, metadataSchema, manifestSchema;
try {
    breakdownSchema = readJsonFile(SCHEMA_BREAKDOWN);
    metadataSchema = readJsonFile(SCHEMA_METADATA);
    manifestSchema = readJsonFile(SCHEMA_MANIFEST);
} catch (e) {
    console.error("❌ Failed to load schemas:", e.message);
    process.exit(2);
}

// ---- ajv setup ----
const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true
});

const validateBreakdownSchema = ajv.compile(breakdownSchema);
const validateMetadataSchema = ajv.compile(metadataSchema);
const validateManifestSchema = ajv.compile(manifestSchema);

// ---- optional normalizer ----
let normalizeBreakdown = null;
try {
    ({ normalizeBreakdown } = await import(pathToFileUrl(NORMALIZER_PATH)));
} catch {
    // ok; normalization will be skipped
}

// ---- read zip ----
let zipBytes;
try {
    zipBytes = fs.readFileSync(zipPath);
} catch (e) {
    console.error("❌ Failed to read zip:", e.message);
    process.exit(2);
}

// ---- parse zip ----
let zip;
try {
    zip = await JSZip.loadAsync(zipBytes);
} catch (e) {
    console.error("❌ Failed to parse zip:", e.message);
    process.exit(2);
}

// ---- required files ----
const REQUIRED = ["metadata.json", "manifest.json", "breakdown.json", "coupling-graph.json", "state.json"];
for (const f of REQUIRED) {
    if (!zip.file(f)) {
        fail(`Missing required file in bundle: ${f}`);
    }
}

// ---- load JSON payloads ----
async function loadZipJson(name) {
    const txt = await zip.file(name).async("string");
    return JSON.parse(txt);
}

let metadata, manifest, breakdown;
try {
    metadata = await loadZipJson("metadata.json");
    manifest = await loadZipJson("manifest.json");
    breakdown = await loadZipJson("breakdown.json");
} catch (e) {
    console.error("❌ Failed to parse JSON from bundle:", e.message);
    process.exit(2);
}

// ---- validate manifest schema ----
const okManifest = validateManifestSchema(manifest);
if (!okManifest) {
    const details = PRETTY ? prettyAjvErrors(validateManifestSchema.errors) : JSON.stringify(validateManifestSchema.errors, null, 2);
    fail("manifest.json schema invalid", details);
}

// ---- verify hashes from manifest ----
const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
const entryByPath = new Map(manifestFiles.map((e) => [e.path, e]));

let hashMismatches = 0;
for (const entry of manifestFiles) {
    const fileObj = zip.file(entry.path);
    if (!fileObj) {
        hashMismatches++;
        warn(`Manifest references missing file: ${entry.path}`);
        continue;
    }
    const buf = await fileObj.async("nodebuffer");
    const actual = sha256Hex(buf);
    if (actual !== entry.sha256) {
        hashMismatches++;
        warn(`Hash mismatch: ${entry.path}\n  expected=${entry.sha256}\n  actual  =${actual}`);
    }
    if (typeof entry.bytes === "number" && entry.bytes !== buf.byteLength) {
        warn(`Byte size mismatch: ${entry.path} expected=${entry.bytes} actual=${buf.byteLength}`);
    }
}

if (hashMismatches > 0) {
    fail(`Manifest hash verification failed (${hashMismatches} mismatches)`);
}

// ---- validate metadata schema ----
const okMeta = validateMetadataSchema(metadata);
if (!okMeta) {
    const details = PRETTY ? prettyAjvErrors(validateMetadataSchema.errors) : JSON.stringify(validateMetadataSchema.errors, null, 2);
    fail("metadata.json schema invalid", details);
}

// ---- validate breakdown (normalize legacy first) ----
if (!breakdown.breakdown_version) {
    warn("[Audit] Legacy breakdown payload detected (missing breakdown_version). Normalizing to v1.1 for validation.");
}
if (typeof normalizeBreakdown === "function") {
    try {
        breakdown = normalizeBreakdown(breakdown);
    } catch (e) {
        console.error("❌ normalizeBreakdown failed:", e.message);
        process.exit(2);
    }
}

const okBreakdown = validateBreakdownSchema(breakdown);
if (!okBreakdown) {
    const details = PRETTY
        ? prettyAjvErrors(validateBreakdownSchema.errors)
        : JSON.stringify(validateBreakdownSchema.errors, null, 2);
    fail("breakdown.json schema invalid", details);
}

// ---- optional strict policy checks (light) ----
let policyWarnings = 0;

function isNil(x) {
    return x === null || x === undefined;
}

if (Array.isArray(breakdown.blocked)) {
    for (const b of breakdown.blocked) {
        if (b?.reason === "MAX_SKEW_EXCEEDED") {
            if (isNil(b.skew_ms) || isNil(b.max_skew_ms)) {
                policyWarnings++;
                warn(`[Policy] MAX_SKEW_EXCEEDED should include skew_ms and max_skew_ms (edge_id=${b.edge_id})`);
            }
        }
        if (b?.reason === "SUPPRESSED_BY_REPLACE") {
            if (isNil(b.message)) {
                policyWarnings++;
                warn(`[Policy] SUPPRESSED_BY_REPLACE should include message (edge_id=${b.edge_id})`);
            }
        }
    }
}

if (STRICT && policyWarnings > 0) {
    fail(`Strict mode: policy warnings encountered (${policyWarnings})`);
}

// ---- success ----
console.log("✅ VALID SNAPSHOT — bundle hashes + schemas OK");
console.log(`   Zip: ${zipPath}`);
console.log(`   Files verified: ${manifestFiles.length}`);
if (policyWarnings > 0) {
    console.log(`   Policy warnings: ${policyWarnings} (non-fatal)`);
}
process.exit(0);
