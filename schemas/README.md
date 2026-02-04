# Schemas

This folder contains stable JSON Schemas used for forensic / audit payloads.

## causal_breakdown_v1.1.schema.json
- Payload emitted by CouplingEngine for the Causal Breakdown Panel.
- UI must treat payloads without `breakdown_version` as legacy (`1.0`) and normalize via `normalizeBreakdown()` before render.
- Validation is recommended in dev/debug mode (AJV).

### Compatibility Rules
- Missing `breakdown_version` ⇒ assume `1.0`
- Missing / partial `blocked[]` entries ⇒ normalize to v1.1 (reason/severity/ts_ms backfilled)

### Soft Policy (Audit Grade)
- **MAX_SKEW_EXCEEDED**: Must include `skew_ms`, `max_skew_ms`, and `gate_source`.
- **SUPPRESSED_BY_REPLACE**: Must include a descriptive `message` explaining the override.
- **Preview Fields**: Recommended to show "what would have happened" (e.g., `would_add` for blend-add, `would_factor` for blend-mul).
