# Schemas

This folder contains stable JSON Schemas used for forensic / audit payloads.

## causal_breakdown_v1.1.schema.json
- Payload emitted by CouplingEngine for the Causal Breakdown Panel.
- UI must treat payloads without `breakdown_version` as legacy (`1.0`) and normalize via `normalizeBreakdown()` before render.
- Validation is recommended in dev/debug mode (AJV).

### Compatibility Rules
- Missing `breakdown_version` ⇒ assume `1.0`
- Missing / partial `blocked[]` entries ⇒ normalize to v1.1 (reason/severity/ts_ms backfilled)
