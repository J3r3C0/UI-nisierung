#!/usr/bin/env node
/**
 * Validate a Causal Breakdown JSON file against v1.1 schema.
 *
 * Usage:
 *   node tools/validate_breakdown.mjs path/to/breakdown.json
 *   node tools/validate_breakdown.mjs path/to/breakdown.json --pretty
 *   node tools/validate_breakdown.mjs path/to/breakdown.json --strict
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import Ajv2020 from "ajv/dist/2020.js";

// ---- paths ----
const SCHEMA_PATH = path.resolve("schemas/causal_breakdown_v1.1.schema.json");
const NORMALIZER_PATH = path.resolve("src/forensics/normalizeBreakdown.js");

// ---- args ----
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("-"));
const PRETTY = args.includes("--pretty");
const STRICT = args.includes("--strict");

if (!file) {
    console.error("Usage: validate_breakdown.mjs <file.json> [--pretty] [--strict]");
    process.exit(2);
}

// ---- load helpers ----
let normalizeBreakdown;
try {
    const mod = await import(pathToFileURL(NORMALIZER_PATH));
    normalizeBreakdown = mod.normalizeBreakdown;
} catch (e) {
    console.warn("⚠ normalizeBreakdown not found; continuing without normalization.");
}

// ---- read input ----
let raw;
try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
    console.error("❌ Failed to read or parse JSON:", e.message);
    process.exit(2);
}

// ---- normalize (legacy-safe) ----
let breakdown = raw;
if (typeof normalizeBreakdown === "function") {
    if (!raw.breakdown_version) {
        console.warn(`[Audit] ⚠ Legacy payload detected in ${path.basename(file)} (missing breakdown_version). Normalizing to v1.1...`);
    }
    try {
        breakdown = normalizeBreakdown(raw);
    } catch (e) {
        console.error("❌ Normalization failed:", e.message);
        process.exit(2);
    }
}

// ---- load schema ----
let schema;
try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
} catch (e) {
    console.error("❌ Failed to load schema:", e.message);
    process.exit(2);
}

// ---- validate ----
const ajv = new Ajv2020({
    allErrors: true,
    strict: false,          // forward-compat
    allowUnionTypes: true,
});

const validate = ajv.compile(schema);
const ok = validate(breakdown);

// ---- Soft Policy Checks (Warn only) ----
const softWarnings = [];
if (breakdown.blocked) {
    breakdown.blocked.forEach((b, idx) => {
        const isMissing = (val) => val === null || val === undefined;

        if (b.reason === "MAX_SKEW_EXCEEDED") {
            if (isMissing(b.skew_ms)) softWarnings.push(`blocked[${idx}]: Reason is MAX_SKEW_EXCEEDED but skew_ms is missing/null.`);
            if (isMissing(b.max_skew_ms)) softWarnings.push(`blocked[${idx}]: Reason is MAX_SKEW_EXCEEDED but max_skew_ms is missing/null.`);
            if (isMissing(b.gate_source) || b.gate_source === "unknown") softWarnings.push(`blocked[${idx}]: Reason is MAX_SKEW_EXCEEDED but gate_source is unknown/missing.`);
        }
        if (b.reason === "SUPPRESSED_BY_REPLACE" && (!b.message || b.message.trim() === "")) {
            softWarnings.push(`blocked[${idx}]: Reason is SUPPRESSED_BY_REPLACE but message is empty.`);
        }
    });
}

// ---- output ----
if (ok && softWarnings.length === 0) {
    console.log(`✅ VALID — ${path.basename(file)} conforms to v1.1`);
    if (!raw.breakdown_version) console.log("   (Success after normalization)");
    process.exit(0);
}

if (!ok) {
    console.error(`❌ INVALID — Schema validation failed for ${path.basename(file)}`);
    const errors = validate.errors || [];
    if (PRETTY) {
        for (const e of errors) {
            console.error(`  • ${e.instancePath || "/"} ${e.message} ${e.params ? JSON.stringify(e.params) : ""}`);
        }
    } else {
        console.error(JSON.stringify(errors, null, 2));
    }
}

if (softWarnings.length > 0) {
    console.warn(`⚠ POLICY — Issues found in ${path.basename(file)} (v1.1 Soft Policy):`);
    softWarnings.forEach(w => console.warn(`  • ${w}`));
    if (STRICT && ok) {
        console.error("⛔ Strict mode: failing due to policy warnings.");
        process.exit(1);
    }
}

process.exit(ok ? 0 : 1);
