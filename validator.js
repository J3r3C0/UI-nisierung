/**
 * Sheratan Value Validator
 * Implements the normative contract defined in wert-schema.md
 */
const ValueValidator = {
    validate(value) {
        const errors = [];

        // Minimal required blocks check
        const requiredBlocks = ['meta', 'semantics', 'provenance', 'generation', 'time'];
        requiredBlocks.forEach(block => {
            if (!value[block]) errors.push(`Missing Block: ${block}`);
        });

        if (errors.length > 0) return { valid: false, errors };

        // Semantic Check: Dimension vs Unit
        if (value.semantics.unit === 'percent' && (value.semantics.scale.min !== 0 || value.semantics.scale.max !== 100)) {
            errors.push("Semantic Error: Unit 'percent' requires scale 0-100.");
        }

        // Time Check: Validity vs Sampling
        // (Simplified logic for now)

        return {
            valid: errors.length === 0,
            errors
        };
    },

    // Utility to create a 'Standard compliant' skeleton
    createSkeleton(id, label, namespace) {
        return {
            meta: { id, label, namespace, version: "1.0" },
            semantics: { dimension: "generic", unit: "unitless", scale: { type: "ratio", min: 0, max: 100 }, interpretation: { higher_is: "better" } },
            provenance: { source_type: "telemetry", source_id: "system" },
            generation: { transform: { type: "none" } },
            modulation: {},
            time: { sampling_rate: "1s" },
            quality: { confidence: 1.0 }
        };
    }
};
