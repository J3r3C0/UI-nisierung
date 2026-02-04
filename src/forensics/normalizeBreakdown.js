/**
 * normalizeBreakdown.js
 * Causal++ Spec v1.1 Forensic Normalizer.
 * Upgrades legacy/partial forensic data to the strict v1.1 Spec.
 */

export function normalizeBreakdown(breakdown) {
    const tNow = typeof breakdown?.t === "number" ? breakdown.t : null;

    const DEFAULT_SEVERITY = {
        MAX_SKEW_EXCEEDED: "warn",
        NEGATIVE_TIME_JUMP_SEEK: "info",
        MISSING_SOURCE_METRIC: "warn",
        VALIDATION_REJECTED: "error",
        MODE_KIND_MISMATCH: "error",
        SUPPRESSED_BY_REPLACE: "info",
        UNKNOWN: "warn"
    };

    function mapReason(raw) {
        const s = String(raw || "").toUpperCase();
        if (s.includes("SKEW")) return "MAX_SKEW_EXCEEDED";
        if (s.includes("REPLACE") || s.includes("SUPPRESS")) return "SUPPRESSED_BY_REPLACE";
        if (s.includes("VALIDATION") || s.includes("SCHEMA")) return "VALIDATION_REJECTED";
        if (s.includes("MISSING") || s.includes("NAN")) return "MISSING_SOURCE_METRIC";
        if (s.includes("WINDOW") || s.includes("HOLD")) return "OUTSIDE_HOLD_WINDOW";
        if (s.includes("SEEK") || s.includes("JUMP")) return "NEGATIVE_TIME_JUMP_SEEK";
        return "UNKNOWN";
    }

    const blocked = Array.isArray(breakdown?.blocked) ? breakdown.blocked : [];
    const normalized = blocked.map((item) => {
        // Handle legacy string items
        if (typeof item === 'string') {
            const parts = item.split(':');
            return {
                edge_id: parts[0]?.trim() || "unknown",
                reason: "UNKNOWN",
                severity: "info",
                ts_ms: tNow,
                message: item
            };
        }

        const reason = mapReason(item?.reason);
        const severity = item?.severity || DEFAULT_SEVERITY[reason] || "warn";

        const previewRaw = item.preview || {};
        const preview = {
            mode: previewRaw.mode ?? item.layer ?? item.impact?.mode ?? null,
            kind: previewRaw.kind ?? item.impact?.kind ?? item.impact?.function ?? null,
            priority: previewRaw.priority ?? item.priority ?? null,
            weight: previewRaw.weight ?? item.impact?.weight ?? null,
            gain: previewRaw.gain ?? item.impact?.gain ?? null,
            src: previewRaw.src ?? item.src?.value ?? null,
            would_add: previewRaw.would_add ?? null,
            would_factor: previewRaw.would_factor ?? null
        };

        return {
            edge_id: String(item?.edge_id ?? "unknown"),
            target_id: item?.target_id || item?.to || null,
            src_id: item?.src_id || null,
            reason: reason,
            severity: severity,
            ts_ms: item.ts_ms ?? tNow,
            fired_at_ms: item.fired_at_ms ?? item.t_trigger ?? null,
            effect_at_ms: item.effect_at_ms ?? item.t_effective ?? null,
            delay_ms: item.delay_ms ?? ((item.t_effective && item.t_trigger) ? (item.t_effective - item.t_trigger) : null),
            max_skew_ms: item.max_skew_ms ?? null,
            skew_ms: item.skew_ms ?? (item.skew_ms === undefined ? null : item.skew_ms),
            gate_source: item.gate_source ?? "unknown",
            message: item.message || (item.note ?? ""),
            window: item.window ? {
                start: item.window.start ?? null,
                end: item.window.end ?? null,
                now: item.window.now ?? tNow
            } : null,
            preview: preview
        };
    });

    const result = { ...breakdown, blocked: normalized };
    if (!result.breakdown_version) result.breakdown_version = "1.1";
    if (!result.schema_version) result.schema_version = "causal_breakdown_v1.1";
    return result;
}
