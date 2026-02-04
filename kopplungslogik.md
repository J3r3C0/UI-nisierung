Alles klar: **Default = `video` als Master-Clock**, `system` nur als vorbereitete Option (ohne dass du sie jetzt anfassen musst).

Unten bekommst du ein **komplettes Coupling-Logic v1 Paket** als Spezifikation, das du 1:1 in dein Setup integrieren kannst:

* `coupling-schema.json` (Validator-Contract für Coupling Graph)
* `coupling-graph.sample.json` (Beispielgraph Delta → Theta)
* `coupling.js` (Engine: resampling + causal/event + guardrails + aggregation)
* kleine Integrationsnotiz (wie du es in den Video-Loop hängst)

> Ich halte das bewusst **deterministisch** und **auditierbar**.

---

# 1) `coupling-schema.json` (Contract)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "coupling-schema.json",
  "title": "CouplingGraph v1",
  "type": "object",
  "required": ["meta", "nodes", "edges"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["id", "version", "timebase"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "version": { "type": "string", "minLength": 1 },
        "timebase": { "type": "string", "enum": ["video", "system"] }
      },
      "additionalProperties": true
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["value_id"],
        "properties": {
          "value_id": { "type": "string", "minLength": 1 }
        },
        "additionalProperties": false
      },
      "minItems": 1
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type", "from", "to", "alignment", "impact", "aggregation", "guardrails"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "enum": ["hard_sync", "soft_sync", "event", "causal"] },
          "from": { "type": "string", "minLength": 1 },
          "to": { "type": "string", "minLength": 1 },

          "alignment": {
            "type": "object",
            "required": ["mode", "offset_ms", "max_skew_ms"],
            "properties": {
              "mode": { "type": "string", "enum": ["hard_sync", "soft_sync"] },
              "offset_ms": { "type": "integer", "minimum": -600000, "maximum": 600000 },
              "max_skew_ms": { "type": "integer", "minimum": 0, "maximum": 60000 }
            },
            "additionalProperties": false
          },

          "impact": {
            "type": "object",
            "required": ["function", "gain", "clamp"],
            "properties": {
              "function": { "type": "string", "enum": ["linear", "add", "mul"] },
              "gain": { "type": "number" },
              "clamp": {
                "type": "array",
                "items": { "type": "number" },
                "minItems": 2,
                "maxItems": 2
              }
            },
            "additionalProperties": false
          },

          "aggregation": {
            "type": "object",
            "required": ["when_multiple_edges"],
            "properties": {
              "when_multiple_edges": { "type": "string", "enum": ["sum_then_clamp", "max", "mean"] }
            },
            "additionalProperties": false
          },

          "guardrails": {
            "type": "object",
            "required": ["enabled", "min_confidence"],
            "properties": {
              "enabled": { "type": "boolean" },
              "min_confidence": { "type": "number", "minimum": 0, "maximum": 1 }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      },
      "minItems": 0
    }
  },
  "additionalProperties": false
}
```

---

# 2) `coupling-graph.sample.json` (Delta → Theta, causal, video-clock)

```json
{
  "meta": {
    "id": "coupling-graph-v1",
    "version": "1.0",
    "timebase": "video"
  },
  "nodes": [
    { "value_id": "delta_resonance" },
    { "value_id": "theta_intent" }
  ],
  "edges": [
    {
      "id": "e_delta_to_theta",
      "type": "causal",
      "from": "delta_resonance",
      "to": "theta_intent",
      "alignment": { "mode": "soft_sync", "offset_ms": 2000, "max_skew_ms": 250 },
      "impact": { "function": "linear", "gain": 0.35, "clamp": [0, 1] },
      "aggregation": { "when_multiple_edges": "sum_then_clamp" },
      "guardrails": { "enabled": true, "min_confidence": 0.6 }
    }
  ]
}
```

---

# 3) `coupling.js` (Engine)

```js
// coupling.js
// Deterministic coupling engine (v1). Master clock defaults to video-time (ms).

function clamp(x, mn, mx) { return Math.max(mn, Math.min(mx, x)); }
function clamp01(x) { return clamp(x, 0, 1); }
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * series: [{t:ms, v:number}] sorted by t
 * returns sampled value at tMs via linear interpolation
 */
function sampleAt(series, tMs) {
  if (!series || series.length === 0) return null;

  const first = series[0];
  const last = series[series.length - 1];

  if (tMs <= first.t) return first.v;
  if (tMs >= last.t) return last.v;

  // NOTE: linear scan is ok for small series; swap to binary search later if needed
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i], b = series[i + 1];
    if (tMs >= a.t && tMs <= b.t) {
      const denom = (b.t - a.t);
      if (denom <= 0) return a.v;
      const u = (tMs - a.t) / denom;
      return lerp(a.v, b.v, u);
    }
  }
  return null;
}

/**
 * Aggregation for multiple incoming impacts
 */
function aggregate(base, impacts, mode) {
  if (!impacts || impacts.length === 0) return base;

  if (mode === "max") return Math.max(base, ...impacts);
  if (mode === "mean") {
    const sum = base + impacts.reduce((s, x) => s + x, 0);
    return sum / (impacts.length + 1);
  }

  // default: sum_then_clamp (assumes normalized 0..1)
  const sum = base + impacts.reduce((s, x) => s + x, 0);
  return clamp01(sum);
}

/**
 * Guardrails: confidence gate
 */
function passesGuardrails(fromValueObj, edge) {
  if (!edge.guardrails?.enabled) return true;
  const conf = fromValueObj?.quality?.confidence;
  if (typeof conf !== "number") return false;
  return conf >= edge.guardrails.min_confidence;
}

/**
 * Compute edge impact on target, given current time
 * valuesById: { [value_id]: { obj: valueObject, series: [{t,v}] } }
 */
function computeEdgeImpact(valuesById, edge, tNowMs) {
  const from = valuesById[edge.from];
  const to = valuesById[edge.to];
  if (!from || !to) return null;

  if (!passesGuardrails(from.obj, edge)) return null;

  // causal/event use offset; soft_sync still uses sampling/interpolation
  const offset = edge.alignment?.offset_ms ?? 0;
  const tSource = tNowMs - offset;

  const a = sampleAt(from.series, tSource);
  if (a == null) return null;

  const gain = (typeof edge.impact?.gain === "number") ? edge.impact.gain : 1.0;

  // impact function
  let out;
  switch (edge.impact?.function) {
    case "mul":
      // interpret as multiplicative modulation around 1
      out = a * gain;
      break;
    case "add":
    case "linear":
    default:
      out = a * gain;
      break;
  }

  // clamp
  if (Array.isArray(edge.impact?.clamp) && edge.impact.clamp.length === 2) {
    out = clamp(out, edge.impact.clamp[0], edge.impact.clamp[1]);
  }
  return out;
}

/**
 * Apply coupling graph at time tNowMs.
 * Returns derived view values: { [value_id]: number } (post-coupling)
 *
 * IMPORTANT: This does not mutate base series; it's a read-time view.
 */
function applyCouplingGraph(valuesById, graph, tNowMs) {
  // base samples (each value's own series at time)
  const base = {};
  for (const id of Object.keys(valuesById)) {
    base[id] = sampleAt(valuesById[id].series, tNowMs);
  }

  // collect incoming impacts per target
  const incoming = {};
  for (const edge of (graph.edges || [])) {
    const impact = computeEdgeImpact(valuesById, edge, tNowMs);
    if (impact == null) continue;

    if (!incoming[edge.to]) incoming[edge.to] = [];
    incoming[edge.to].push({ impact, edge });
  }

  // apply aggregation per target
  const out = { ...base };

  for (const [toId, arr] of Object.entries(incoming)) {
    const impacts = arr.map(x => x.impact);

    // assume all edges into same node share same aggregation mode; take first
    const mode = arr[0]?.edge?.aggregation?.when_multiple_edges || "sum_then_clamp";

    const baseVal = (typeof out[toId] === "number") ? out[toId] : 0;
    out[toId] = aggregate(baseVal, impacts, mode);
  }

  return out;
}

module.exports = {
  sampleAt,
  applyCouplingGraph
};
```

---

# 4) Integration in deinen Video-Loop (minimal)

Im Render-Loop (oder `requestAnimationFrame`) machst du:

```js
const tNowMs = video.currentTime * 1000;
const viewValues = applyCouplingGraph(valuesById, couplingGraph, tNowMs);

// UI zeigt viewValues[metricId] statt raw sample
renderMetrics(viewValues);
```

### `valuesById` Erwartung

```js
valuesById = {
  delta_resonance: { obj: DeltaValueObject, series: [{t:0,v:0.2}, ...] },
  theta_intent:    { obj: ThetaValueObject, series: [{t:0,v:0.6}, ...] }
}
```

---

# 5) Zwei wichtige Design-Entscheidungen (die du gerade richtig triffst)

✅ **Read-time coupling** (wie oben):
Kopplung berechnet nur die *View* — Rohwerte bleiben unverändert → auditierbar.

✅ **Graph getrennt von Value Objects**:
Werte bleiben reine Mess-/Score-Definitionen; Beziehungen sind extern → sauber.

---

Wenn du willst, kann ich als nächstes (ohne weitere Fragen) noch liefern:

1. `coupling-validator.js` (analog zu deinem `validator.js`, nur für Couplings)
2. `event`-Edges: Trigger-Detektor (Spike, threshold crossing, scene boundary)
3. `causal offset calibration`: einfache Auto-Schätzung von Δ per Cross-Correlation (optional)

Sag einfach **1, 2 oder 3**.
