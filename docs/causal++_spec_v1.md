# Causal++ Spec · Forensic v1.1 "Zero Black Box"

This document locks the implementation of the Causal Impact Engine as of February 2026.

## 1. Core Arbitration Rules
The engine processes influences on target metrics using a deterministic multi-layer approach.

### Layer 1: Replace (Dominant)
- **Priority Rules**: Higher `priority` wins.
- **Tie-Breaker**: In case of equal priority, the edge with the lexicographically smaller `id` wins.
- **Exclusion**: If a `replace` impact is active, all `blend` impacts for that target are **suppressed** and moved to the `Blocked` audit log (`reason: SUPPRESSED_BY_REPLACE`).

### Layer 2: Blend (Modulating)
- **Normalization**: If `blend_normalize` is true, weights are scaled to sum to 1.0.
- **Execution Order**: Strictly **ADD before MUL**.
- **Math**:
  - `add`: `base + (val * weight)`
  - `mul`: `accumulated * (1 + (val * weight))` (relative factor)

---

## 2. Gating & Slew (Audit Integrity)
To prevent "ghost events" or implausible influences during video seeking:
1. **Precedence**: `edge.gate.max_skew_ms` > `edge.alignment.max_skew_ms` > `graph.defaults.max_skew_ms`.
2. **The Gate**: $|t_{effective} - t_{trigger}| \leq max\_skew\_ms$.
3. **Reset**: Any backward seek in time clears the `TriggerRuntime` fire history.

---

## 3. Blocked Reasons (Forensic Codes)
| Code | Severity | Description |
| :--- | :--- | :--- |
| `MAX_SKEW_EXCEEDED` | **Warn** | Temporal drift between trigger and impact too large. |
| `SUPPRESSED_BY_REPLACE` | **Info** | High-priority override active; modulation ignored. |
| `SOURCE_MISSING` | **Warn** | The source metric for the impact returned NaN or was not found. |
| `VALIDATION_ERROR` | **Error** | Edge configuration violates schema constraints. |

---

## 4. How to Read the Inspector
1. **Pipeline**: Read left-to-right to see the value journey.
2. **Winner Card**: Identity of the current replace driver.
3. **Term List**: Every active blend influence and its contribution.
4. **Blocked Section**: Explains why certain effects are **not** present in the current signal.
