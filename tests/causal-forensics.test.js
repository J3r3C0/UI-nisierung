/**
 * tests/causal-forensics.test.js
 * Smoke Test Suite for Causal Breakdown v1.1 Normalizer.
 * Rule: Behauptung, unwiderlegbar beweisen.
 */

const CausalForensicsTest = {
    run() {
        console.log("%c🧪 Starting Causal Forensics Test Suite v1.1", "color: #00ffcc; font-weight: bold; font-size: 1.2rem");

        const results = [
            this.testLegacySkew(),
            this.testSuppressedByReplace(),
            this.testValidationError(),
            this.testExplicitReplaceLayer(),
            this.testGateSourcePreservation(),
            this.testPreviewFields(),
            this.testMissingNumbersToNull(),
            this.testWindowBackfill(),
            this.testUnknownReason(),
            this.testSchemaVersionInjection()
        ];

        const passed = results.filter(r => r === true).length;
        const color = passed === results.length ? "#00ffcc" : "#ff4444";
        console.log(`%c📊 Result: ${passed}/${results.length} tests passed.`, `color: ${color}; font-weight: bold; margin-top: 10px`);
    },

    assert(name, condition, details) {
        if (condition) {
            console.log(`%c✅ PASSED: ${name}`, "color: #00ffcc");
            return true;
        } else {
            console.error(`❌ FAILED: ${name}`, details);
            return false;
        }
    },

    testLegacySkew() {
        const input = { t: 1000, blocked: [{ edge_id: "e1", reason: "max_skew_ms exceeded" }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Legacy Reason String (Skew)",
            item.reason === "MAX_SKEW_EXCEEDED" &&
            item.severity === "warn" &&
            item.layer === "blend" &&
            item.window.now === 1000
        );
    },

    testSuppressedByReplace() {
        const input = { t: 2000, blocked: [{ edge_id: "e2", reason: "suppressed by replace" }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Suppressed by Replace",
            item.reason === "SUPPRESSED_BY_REPLACE" &&
            item.severity === "info" &&
            item.layer === "blend"
        );
    },

    testValidationError() {
        const input = { t: 3000, blocked: [{ edge_id: "e3", reason: "schema validation failed" }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Validation Error mapping",
            item.reason === "VALIDATION_ERROR" &&
            item.severity === "error"
        );
    },

    testExplicitReplaceLayer() {
        const input = { t: 4000, blocked: [{ edge_id: "e4", impact: { mode: "replace" }, reason: "skew" }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Explicit Replace Layer inference",
            item.layer === "replace" &&
            item.reason === "MAX_SKEW_EXCEEDED"
        );
    },

    testGateSourcePreservation() {
        const input = { t: 5000, blocked: [{ edge_id: "e5", reason: "skew", gate_source: "edge.gate", max_skew_ms: 250, skew_ms: 480 }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Gate Source Preservation",
            item.gate_source === "edge.gate" &&
            item.max_skew_ms === 250 &&
            item.skew_ms === 480
        );
    },

    testPreviewFields() {
        const input = { t: 6000, blocked: [{ edge_id: "e6", reason: "skew", preview: { would_factor: 1.2 } }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Preview Fields (Partial)",
            item.preview.would_factor === 1.2 &&
            item.preview.would_add === null
        );
    },

    testMissingNumbersToNull() {
        const input = { t: 7000, blocked: [{ edge_id: "e7", reason: "missing source" }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Missing Numbers -> null",
            item.t_trigger === null &&
            item.skew_ms === null
        );
    },

    testWindowBackfill() {
        const input = { t: 8000, blocked: [{ edge_id: "e8", reason: "skew", window: {} }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Window Backfill",
            item.window.now === 8000 &&
            item.window.start === null
        );
    },

    testUnknownReason() {
        const input = { t: 9000, blocked: [{ edge_id: "e9", reason: "quantum anomaly" }] };
        const out = CouplingEngine.normalizeBreakdown(input);
        const item = out.blocked[0];
        return this.assert("Unknown Reason (Forward Compat)",
            item.reason === "UNKNOWN" &&
            item.severity === "warn"
        );
    },

    testSchemaVersionInjection() {
        const input = { t: 10000, blocked: [] };
        const out = CouplingEngine.normalizeBreakdown(input);
        return this.assert("Schema Version Injection",
            out.schema_version === "causal_breakdown_v1.1" &&
            Array.isArray(out.blocked)
        );
    }
};

// Auto-run if triggered via console or specific script load
if (typeof window !== 'undefined') {
    window.runCausalTests = () => CausalForensicsTest.run();
}
