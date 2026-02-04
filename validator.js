/**
 * Sheratan Value Validator v1
 * Implements the normative contract from Wert-Schema v1
 */
const ValueValidator = {
    validate(value) {
        const errors = [];

        // Required top-level fields
        const requiredFields = ["id", "label", "semantics", "timeline", "provenance", "value"];
        requiredFields.forEach(f => {
            if (!value[f]) errors.push(`Missing field: ${f}`);
        });

        if (errors.length > 0) return { valid: false, errors };

        // Scale vs Unit sanity check
        if (value.semantics.scale === "percent_0_100") {
            if (value.semantics.range && (value.semantics.range.min !== 0 || value.semantics.range.max !== 100)) {
                errors.push("Semantic Violation: percent_0_100 requires range 0-100");
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    },

    createSkeleton(id, label, domain) {
        return {
            id: id,
            label: label,
            semantics: {
                domain: domain,
                unit: "%",
                scale: "percent_0_100",
                range: { min: 0, max: 100 },
                meaning: `Default skeleton for ${label}`
            },
            timeline: {
                clock: "video_ms",
                sample_ms: 33,
                validity: { t0_ms: 0, t1_ms: 33 }
            },
            provenance: {
                source_type: "manual",
                method: "initialized_by_user"
            },
            modulation: { pipeline: [] },
            quality: { confidence: 1.0, latency_ms: 0, stability: 1.0 },
            value: {
                kind: "scalar",
                current: 50,
                series: []
            }
        };
    }
};
