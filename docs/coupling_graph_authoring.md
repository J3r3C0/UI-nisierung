# Coupling Graph · Authoring Guide

This guide explains how to define nodes and edges in the `coupling-graph.json` using Causal++ Spec v1.1.

## 1. Node Definition
Every node must map to a `value_id` available in the system.
```json
{ "value_id": "theta_intent" }
```

## 2. Edge types
- `causal`: Continuous modulation (Blend only).
- `event`: Trigger-based impacts (`spike`, `threshold`).
- `soft_sync` / `hard_sync`: Temporal alignment edges.

## 3. Impact Modes
### Replace (Override)
Used for interventions that should "clean" the signal.
```json
"impact": {
  "mode": "replace",
  "function": "set",
  "gain": 1.0,
  "clamp": [0, 100]
}
```

### Blend (Modulate)
Used for additive or multiplicative influences.
```json
"impact": {
  "mode": "blend",
  "function": "mul",
  "gain": 0.05,
  "weight": 1.0
}
```
*Note: `set` is forbidden in `blend` mode.*

## 4. Gating (Safety)
Define `gate.max_skew_ms` to control the temporal "forgiveness" of the engine.
```json
"gate": { "max_skew_ms": 150 }
```
If the impact delay or video seek creates a skew larger than this, the impact is blocked to preserve causal plausibility.

## 5. Triggers
For `event` edges, define the fire conditions:
```json
"trigger": {
  "kind": "spike",
  "delta": 10,
  "hold_ms": 2000,
  "delay_ms": 500
}
```
Impact will start at `t_trigger + delay_ms` and last for `hold_ms`.
