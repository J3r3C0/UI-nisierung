Perfekt — hier sind **(1) `coupling-validator.js`** und **(2) Event-Edges inkl. Trigger-Detektor**, so gebaut, dass es **Contract-first, deterministisch und auditierbar** bleibt.

---

## 1) `coupling-validator.js`

* lädt `coupling-schema.json`
* `validateCouplingGraph(graph)` → `{ ok, errors }`
* `createCouplingSkeleton()` → gültiges Grundgerüst
* `assertCouplingOrThrow(graph)` → harte Enforcement-Variante

```js
// coupling-validator.js
// Requires: npm i ajv
// Usage:
//   const { validateCouplingGraph, createCouplingSkeleton } = require("./coupling-validator");
//   const res = validateCouplingGraph(graph);
//   if (!res.ok) console.error(res.errors);

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatAjvErrors(errors) {
  if (!errors || !errors.length) return [];
  return errors.map(e => ({
    path: e.instancePath || "",
    schemaPath: e.schemaPath || "",
    keyword: e.keyword || "",
    message: e.message || "",
    params: e.params || {}
  }));
}

function buildAjv() {
  return new Ajv({
    allErrors: true,
    strict: true,
    allowUnionTypes: true
  });
}

function getSchemaPath(customSchemaPath) {
  return customSchemaPath
    ? customSchemaPath
    : path.resolve(__dirname, "coupling-schema.json");
}

function validateCouplingGraph(graph, schemaPath) {
  const ajv = buildAjv();
  const schema = loadJson(getSchemaPath(schemaPath));
  const validate = ajv.compile(schema);

  const ok = validate(graph);
  return {
    ok: !!ok,
    errors: ok ? [] : formatAjvErrors(validate.errors)
  };
}

function assertCouplingOrThrow(graph, schemaPath) {
  const res = validateCouplingGraph(graph, schemaPath);
  if (!res.ok) {
    const msg = res.errors
      .map(e => `${e.path} ${e.message} (${e.keyword})`)
      .join("\n");
    const err = new Error(`CouplingGraph validation failed:\n${msg}`);
    err.validation = res.errors;
    throw err;
  }
  return true;
}

function createCouplingSkeleton({ timebase = "video" } = {}) {
  // Produces a graph that passes the schema (no edges required)
  return {
    meta: {
      id: "coupling-graph-v1",
      version: "1.0",
      timebase
    },
    nodes: [],
    edges: []
  };
}

module.exports = {
  validateCouplingGraph,
  assertCouplingOrThrow,
  createCouplingSkeleton
};
```

---

## 2) Event-Edges + Trigger-Detektor

### 2.1 Erweiterung am Coupling Graph (Event-Edge Format)

Du kannst deine `edges[]` um `trigger` erweitern (ohne deinen bisherigen Causal-Teil zu brechen).
Für Event-Edges gilt: **Impact wird nur ausgelöst, wenn ein Trigger aktiv ist.**

Beispiel-Edge:

```json
{
  "id": "e_delta_spike_boost_theta",
  "type": "event",
  "from": "delta_resonance",
  "to": "theta_intent",
  "alignment": { "mode": "soft_sync", "offset_ms": 0, "max_skew_ms": 250 },
  "impact": { "function": "add", "gain": 0.15, "clamp": [0, 1] },
  "aggregation": { "when_multiple_edges": "sum_then_clamp" },
  "guardrails": { "enabled": true, "min_confidence": 0.6 },
  "trigger": {
    "kind": "threshold_crossing",
    "direction": "rising",
    "threshold": 0.8,
    "hold_ms": 400
  }
}
```

> `hold_ms` bedeutet: wenn Event ausgelöst wird, bleibt es für N ms “aktiv” (sauber fürs Video).

---

### 2.2 `event-triggers.js` (Trigger Engine)

* `computeTriggersAtTime(...)` → gibt aktive Events zurück
* unterstützt:

  * `threshold_crossing` (rising/falling)
  * `spike` (delta zwischen Samples)
  * `window_mean_above` (stabiler Zustand)

```js
// event-triggers.js
// Deterministic trigger detection for event edges.

const { sampleAt } = require("./coupling");

/**
 * Keeps short-lived state (last samples, hold timers) separate from value series.
 * This preserves auditability: raw series unchanged, triggers are ephemeral runtime.
 */
class TriggerRuntime {
  constructor() {
    this.lastSampleByValueId = new Map();     // valueId -> {t, v}
    this.activeUntilByEdgeId = new Map();     // edgeId -> tMs
  }

  getLast(valueId) {
    return this.lastSampleByValueId.get(valueId) || null;
  }

  setLast(valueId, sample) {
    this.lastSampleByValueId.set(valueId, sample);
  }

  setHold(edgeId, untilMs) {
    this.activeUntilByEdgeId.set(edgeId, untilMs);
  }

  isHeld(edgeId, tNowMs) {
    const until = this.activeUntilByEdgeId.get(edgeId);
    return typeof until === "number" && tNowMs <= until;
  }
}

/**
 * Detect event for a single edge at current time.
 * Returns boolean (isTriggeredNowOrHeld).
 */
function isEdgeTriggered(valuesById, edge, tNowMs, runtime) {
  // If already held, still active
  if (runtime.isHeld(edge.id, tNowMs)) return true;

  const trig = edge.trigger;
  if (!trig || !trig.kind) return false;

  const from = valuesById[edge.from];
  if (!from) return false;

  const vNow = sampleAt(from.series, tNowMs);
  if (vNow == null) return false;

  // last sample bookkeeping (per value)
  const last = runtime.getLast(edge.from);
  const vPrev = last ? last.v : null;
  const tPrev = last ? last.t : null;

  let fired = false;

  switch (trig.kind) {
    case "threshold_crossing": {
      const thr = trig.threshold;
      const dir = trig.direction || "rising"; // rising | falling | both
      if (typeof thr !== "number" || vPrev == null) break;

      const wasBelow = vPrev < thr;
      const isAbove = vNow >= thr;

      const wasAbove2 = vPrev >= thr;
      const isBelow2 = vNow < thr;

      if (dir === "rising" && wasBelow && isAbove) fired = true;
      else if (dir === "falling" && wasAbove2 && isBelow2) fired = true;
      else if (dir === "both" && ((wasBelow && isAbove) || (wasAbove2 && isBelow2))) fired = true;
      break;
    }

    case "spike": {
      // spike defined as abs(vNow - vPrev) >= delta
      const delta = trig.delta;
      if (typeof delta !== "number" || vPrev == null) break;
      if (Math.abs(vNow - vPrev) >= delta) fired = true;
      break;
    }

    case "window_mean_above": {
      // mean(series in [tNowMs - window_ms, tNowMs]) >= threshold
      const windowMs = trig.window_ms;
      const thr = trig.threshold;
      if (typeof windowMs !== "number" || typeof thr !== "number") break;
      const t0 = tNowMs - windowMs;
      const mean = meanInWindow(from.series, t0, tNowMs);
      if (mean != null && mean >= thr) fired = true;
      break;
    }

    default:
      // unknown trigger kind
      fired = false;
  }

  // update last sample at end (deterministic, per tick)
  runtime.setLast(edge.from, { t: tNowMs, v: vNow });

  // apply hold if fired
  if (fired) {
    const hold = typeof trig.hold_ms === "number" ? trig.hold_ms : 0;
    if (hold > 0) runtime.setHold(edge.id, tNowMs + hold);
    return true;
  }

  return false;
}

/**
 * Compute all active triggers for event edges at time tNowMs.
 * Returns: Set(edgeId)
 */
function computeTriggersAtTime(valuesById, graph, tNowMs, runtime) {
  const active = new Set();
  for (const edge of (graph.edges || [])) {
    if (edge.type !== "event") continue;
    if (isEdgeTriggered(valuesById, edge, tNowMs, runtime)) {
      active.add(edge.id);
    }
  }
  return active;
}

function meanInWindow(series, t0, t1) {
  if (!series || series.length === 0) return null;
  // naive: sample at existing points in window
  let sum = 0, n = 0;
  for (const p of series) {
    if (p.t >= t0 && p.t <= t1) {
      sum += p.v;
      n += 1;
    }
  }
  if (n === 0) return null;
  return sum / n;
}

module.exports = {
  TriggerRuntime,
  computeTriggersAtTime
};
```

---

### 2.3 Patch für `coupling.js`: Event-Edges berücksichtigen

Du brauchst nur eine kleine Erweiterung:

* `applyCouplingGraph(..., triggerActiveEdgeIds)` optional
* event edge wirkt **nur wenn** `edge.id` in `triggerActiveEdgeIds`

**Drop-in Änderung** (ersetze nur den markierten Block in deinem `applyCouplingGraph`):

```js
// In coupling.js, inside applyCouplingGraph(...)
// Add a new optional param: triggerActiveEdgeIds = null

function applyCouplingGraph(valuesById, graph, tNowMs, triggerActiveEdgeIds = null) {
  const base = {};
  for (const id of Object.keys(valuesById)) {
    base[id] = sampleAt(valuesById[id].series, tNowMs);
  }

  const incoming = {};
  for (const edge of (graph.edges || [])) {

    // ✅ NEW: event edges only apply if triggered/held
    if (edge.type === "event") {
      if (!triggerActiveEdgeIds || !triggerActiveEdgeIds.has(edge.id)) continue;
    }

    const impact = computeEdgeImpact(valuesById, edge, tNowMs);
    if (impact == null) continue;

    if (!incoming[edge.to]) incoming[edge.to] = [];
    incoming[edge.to].push({ impact, edge });
  }

  const out = { ...base };
  for (const [toId, arr] of Object.entries(incoming)) {
    const impacts = arr.map(x => x.impact);
    const mode = arr[0]?.edge?.aggregation?.when_multiple_edges || "sum_then_clamp";
    const baseVal = (typeof out[toId] === "number") ? out[toId] : 0;
    out[toId] = aggregate(baseVal, impacts, mode);
  }

  return out;
}
```

---

## 2.4 Minimal Integration in deinen Video-Loop

```js
const { applyCouplingGraph } = require("./coupling");
const { TriggerRuntime, computeTriggersAtTime } = require("./event-triggers");

const triggerRuntime = new TriggerRuntime();

function onFrame() {
  const tNowMs = video.currentTime * 1000;

  // 1) compute active event edges (triggered or held)
  const activeEdgeIds = computeTriggersAtTime(valuesById, couplingGraph, tNowMs, triggerRuntime);

  // 2) apply coupling with event gating
  const viewValues = applyCouplingGraph(valuesById, couplingGraph, tNowMs, activeEdgeIds);

  renderMetrics(viewValues);
  requestAnimationFrame(onFrame);
}
```

---

## Wichtig (damit’s wirklich “Temporal Validity” beweist)

* Event-Trigger werden **aus der gleichen Master-Clock** berechnet wie das Rendering (`video.currentTime`).
* Hold-Zeiten sind **ms-genau** und reproduzierbar.
* Coupling ist **read-time**: du veränderst nie Rohwerte → Audit bleibt sauber.

---

hier ist das **Schema-Update**, das `trigger` offiziell validiert, plus **3 saubere Trigger-Presets** (Scene Boundary, Spike Burst, Sustained Intent). So ist dein Coupling-Graph weiterhin **audit-ready** und maschinenprüfbar.

---

# 1) `coupling-schema.json` Update (Trigger offiziell)

Ersetze dein bisheriges `coupling-schema.json` durch diese Version (oder merge die `trigger`-Sektion in `edges.items.properties` + `required` entsprechend deiner Policy).
Ich mache `trigger` **optional**, aber **wenn vorhanden**, dann strikt validiert.

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
          },

          "trigger": {
            "type": "object",
            "required": ["kind"],
            "properties": {
              "kind": {
                "type": "string",
                "enum": ["threshold_crossing", "spike", "window_mean_above", "scene_boundary"]
              },

              "direction": { "type": "string", "enum": ["rising", "falling", "both"] },
              "threshold": { "type": "number" },

              "delta": { "type": "number", "minimum": 0 },

              "window_ms": { "type": "integer", "minimum": 1, "maximum": 600000 },

              "hold_ms": { "type": "integer", "minimum": 0, "maximum": 600000 },

              "scene": {
                "type": "object",
                "required": ["mode"],
                "properties": {
                  "mode": { "type": "string", "enum": ["timeline_marks", "frame_index_mod", "manual_flag"] },
                  "marks_ms": {
                    "type": "array",
                    "items": { "type": "integer", "minimum": 0 },
                    "minItems": 1
                  },
                  "every_n_frames": { "type": "integer", "minimum": 1, "maximum": 100000 }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false,

            "allOf": [
              {
                "if": { "properties": { "kind": { "const": "threshold_crossing" } } },
                "then": { "required": ["threshold", "direction"] }
              },
              {
                "if": { "properties": { "kind": { "const": "spike" } } },
                "then": { "required": ["delta"] }
              },
              {
                "if": { "properties": { "kind": { "const": "window_mean_above" } } },
                "then": { "required": ["window_ms", "threshold"] }
              },
              {
                "if": { "properties": { "kind": { "const": "scene_boundary" } } },
                "then": { "required": ["scene"] }
              }
            ]
          }
        },
        "additionalProperties": false,

        "allOf": [
          {
            "if": { "properties": { "type": { "const": "event" } } },
            "then": { "required": ["trigger"] },
            "else": {
              "not": { "required": ["trigger"] }
            }
          }
        ]
      },
      "minItems": 0
    }
  },
  "additionalProperties": false
}
```

**Wichtig:**

* `type="event"` → `trigger` **muss** vorhanden sein
* alle anderen Edge-Typen → `trigger` **darf nicht** vorhanden sein (damit keine “stillen” Missverständnisse passieren)

---

# 2) Trigger-Presets (drop-in Edges)

Du kannst diese Edges direkt in `coupling-graph.json` unter `edges` einfügen.

## 2.1 Preset A — Scene Boundary (Video-Marks)

Ideal, wenn du “Schnitt/Abschnittswechsel” als semantische Ereignisse hast.

```json
{
  "id": "e_scene_boundary_pulse_theta",
  "type": "event",
  "from": "delta_resonance",
  "to": "theta_intent",
  "alignment": { "mode": "soft_sync", "offset_ms": 0, "max_skew_ms": 250 },
  "impact": { "function": "add", "gain": 0.12, "clamp": [0, 1] },
  "aggregation": { "when_multiple_edges": "sum_then_clamp" },
  "guardrails": { "enabled": true, "min_confidence": 0.6 },
  "trigger": {
    "kind": "scene_boundary",
    "hold_ms": 350,
    "scene": {
      "mode": "timeline_marks",
      "marks_ms": [0, 15000, 32000, 48000, 70000]
    }
  }
}
```

**Interpretation:** Bei jedem Mark wird ein kurzer “Impuls” ausgelöst (hold macht das sichtbar/stabil).

---

## 2.2 Preset B — Spike Burst (Delta-Sprung)

Für “plötzliche Änderung” (z.B. Delta springt stark).

```json
{
  "id": "e_spike_burst_boost_theta",
  "type": "event",
  "from": "delta_resonance",
  "to": "theta_intent",
  "alignment": { "mode": "soft_sync", "offset_ms": 0, "max_skew_ms": 250 },
  "impact": { "function": "add", "gain": 0.18, "clamp": [0, 1] },
  "aggregation": { "when_multiple_edges": "sum_then_clamp" },
  "guardrails": { "enabled": true, "min_confidence": 0.6 },
  "trigger": {
    "kind": "spike",
    "delta": 0.22,
    "hold_ms": 400
  }
}
```

**Interpretation:** Wenn |v_now − v_prev| ≥ 0.22 → Event feuert.

---

## 2.3 Preset C — Sustained Intent (Window Mean Above)

Für “stabiler Zustand” statt Noise. Sehr gut für Intent, Fokus, Stabilität.

```json
{
  "id": "e_sustained_theta_lockin",
  "type": "event",
  "from": "theta_intent",
  "to": "theta_intent",
  "alignment": { "mode": "soft_sync", "offset_ms": 0, "max_skew_ms": 250 },
  "impact": { "function": "add", "gain": 0.08, "clamp": [0, 1] },
  "aggregation": { "when_multiple_edges": "sum_then_clamp" },
  "guardrails": { "enabled": true, "min_confidence": 0.6 },
  "trigger": {
    "kind": "window_mean_above",
    "window_ms": 1200,
    "threshold": 0.75,
    "hold_ms": 600
  }
}
```

**Interpretation:** Wenn Mittelwert(Theta im letzten 1.2s) ≥ 0.75 → “Lock-in” Impuls.

> Ja, das ist eine Self-Edge (to==from). Das ist erlaubt und nützlich, solange es read-time ist (keine Rohwerte mutieren).

---

# 3) Mini-Update für `event-triggers.js` (Scene Boundary support)

Falls du `scene_boundary` nutzen willst, ergänze in `isEdgeTriggered()` einen Case:

```js
case "scene_boundary": {
  const scene = trig.scene;
  if (!scene || !scene.mode) break;

  // 1) timeline_marks: fire when tNowMs hits a mark (within epsilon)
  if (scene.mode === "timeline_marks") {
    const marks = Array.isArray(scene.marks_ms) ? scene.marks_ms : [];
    const eps = 30; // ms tolerance for frame stepping
    for (const m of marks) {
      if (Math.abs(tNowMs - m) <= eps) { fired = true; break; }
    }
  }

  // 2) frame_index_mod (optional): needs frameIndex from caller; skip if not provided
  // 3) manual_flag: caller can set a flag; skip here unless you wire it
  break;
}
```

(Die anderen Modi sind im Schema drin, aber du musst sie nur implementieren, wenn du willst.)

---

# 4) Optional: Validator-Sicherheitsregel (empfohlen)

Wenn du “contract enforcement” weiter hochziehen willst, ergänze in deinem Coupling-Validator eine logische Prüfung:

* `edges[].from` und `edges[].to` müssen in `nodes[].value_id` existieren

Das ist **nicht** im JSON-Schema (weil Cross-reference), aber perfekt als Runtime-Check.

Wenn du willst, schreib ich dir dafür den kleinen Zusatzblock.

---

Wenn du mir jetzt den Pfad/Dateinamen gibst, wie du aktuell `value-schema.json`/`validator.js` einbindest (nur die Namen reichen), kann ich dir die **exakte require/import-Stelle** für `coupling-validator.js` + `event-triggers.js` im gleichen Stil skizzieren.