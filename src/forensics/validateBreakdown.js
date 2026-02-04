import Ajv from "ajv";

/**
 * Validate Causal Breakdown payload (v1.1) with AJV.
 * This is designed for environments where the schema can be loaded (Node/CLI/ESM).
 */

export function createValidator(schema) {
    const ajv = new Ajv({
        allErrors: true,
        strict: false,          // keep lenient for forward-compat
        allowUnionTypes: true,
    });
    return ajv.compile(schema);
}

export function validateBreakdown(breakdown, validator) {
    const ok = validator(breakdown);
    return {
        ok: Boolean(ok),
        errors: ok ? [] : (validator.errors || []),
    };
}
