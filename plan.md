UI zuerst.Dokumentation danach(kurz, “locked spec + how to read”)
        .Begründung : Dein Engine
    - Kernel ist jetzt **geschlossen und stabil **;
der höchste ROI kommt jetzt aus **Forensik / Erklärbarkeit im Frontend **,
    weil du damit(a) Bugs sofort siehst, (b) Audit-Story “one click” lieferst, (c) jede spätere Erweiterung (Curve-Blend etc.) automatisch transparent bleibt.

Dein Commit zeigt außerdem, dass du genau dafür schon die richtigen Haken gesetzt hast: `blend_normalize` als Default-Flag, `mul`/`add` funktions-spezifisch, Clamp im Impact, plus Aggregation/Guardrails-Blöcke für spätere UI-Erklärungen. ([GitHub][1])

---

## Nächster Schritt: “Causal Breakdown” Panel (Forensic UI)

### 1) Was das Panel pro Target-Metric anzeigen soll (minimal, aber brutal nützlich)

**A. Summary (oben, 1 Zeile)**

* `t = …ms` (aktueller Timestamp)
* `base → afterReplace → afterBlend → afterClamp` (als kleine Pipeline)
* `replaceActive: yes/no`, `blendCount: N`, `blocked: N`

**B. Replace Section**

* **Winner** (wenn vorhanden): `edge_id`, `priority`, `t_trigger`, `t_effective`, `skew`, `hold window`
* **Candidates** (expandable): alle Replace-Impacts, inkl. Tie-Break-Begründung (“priority”, “edge_id”)

**C. Blend Section**

* `Δ_add` (Summe) + Liste der Terme (je Term: edge_id, gain, weight, src, contribution)
* `Δ_mul` (Produkt) + Liste der Faktoren (edge_id, gain, weight, src, factor)
* `blend_normalize` Status + ggf. `sumWeight`

**D. Gate/Blocks**

* Liste geblockter Impacts: `edge_id`, `reason`, `skew`, `max_skew_ms source` (edge.gate vs edge.alignment vs defaults)

Damit kannst du jede Zahl im Graph **forensisch** bis zur Ursache zurückführen.

---

### 2) Welche Daten du dafür aus der Engine exportierst

Ein sauberer “UI-Payload” pro Target und Tick, z.B.:

```ts
type CausalBreakdown = {
  t: number;
target : string;

base : number;
after_replace : number;
after_blend : number;
after_clamp : number;

replace : {
active:
  boolean;
  winner ?: {
  edge_id:
    string;
  priority:
    number;
  t_trigger:
    number;
  t_effective:
    number;
  skew:
    number
  };
candidates:
  Array < {
  edge_id:
    string;
  priority:
    number;
  t_trigger:
    number;
  t_effective:
    number;
  skew:
    number;
  passes_gate:
    boolean
  }
  > ;
};

blend : {
enabled:
  boolean;
normalize:
  boolean;
add_terms:
  Array < {
  edge_id:
    string;
  src:
    number;
  gain:
    number;
  weight:
    number;
  contribution:
    number
  }
  > ;
mul_terms:
  Array < {
  edge_id:
    string;
  src:
    number;
  gain:
    number;
  weight:
    number;
  factor:
    number
  }
  > ;
delta_add:
  number;
delta_mul:
  number;
};

blocked : Array < {
edge_id:
  string;
reason:
  string;
skew:
  number;
max_skew_ms:
  number;
source:
  "edge.gate" | "edge.alignment" | "defaults"
}
> ;
}
;
```

Das ist bewusst **UI-first** und nicht “Engine intern”.

---

### 3) UX: Wo das hingehört

* Rechts als **Inspector Drawer** (wie DevTools): Klick auf Metric-Line → Breakdown Panel öffnet
* Zusätzlich ein Toggle “Show causal markers” (hast du schon für fired/history, das ergänzt sich perfekt)

---

### 4) Quick Wins, die du sofort einbauen solltest

1. **Hover-Explain** auf jeder Marker-Line: “why active” / “why blocked”
2. **Copy as JSON** (für Audit / Bugreports)
3. **Freeze frame** (pausiert timebase; Breakdown bleibt stabil)

---

## Danach: Dokumentation finalisieren (klein, aber scharf)

Nur 3 Dateien (nicht mehr):

1. `docs/causal++_spec_v1.md`

   * exakt die Regeln (Replace>Blend, Sorting, ADD then MUL, Gate precedence, set-forbidden)
2. `docs/forensics_ui.md`

   * “How to read the Causal Breakdown”
3. `docs/coupling_graph_authoring.md`

   * “How to write edges” + Beispiele (mul/add, clamp, normalize)

Der Commit-Text und die neuen Schema/Validator-Alignments legen dafür bereits den Grundstein. ([GitHub][1])

---

## Kleine Empfehlung zu deinem aktuellen Graph (aus dem Diff ersichtlich)

* `blend_normalize: false` als Default ist gut (weniger Magie). ([GitHub][1])
* Du hast bei `mul` eine sehr kleine `gain` (0.002) und `clamp: [0,100]` ergänzt – das ist UI-forensisch super, weil du “Faktor” und “Clamp” sofort sehen wirst. ([GitHub][1])
* Die neuen `aggregation.when_multiple_edges` + `guardrails` Blöcke solltest du im Panel **sichtbar** machen (selbst wenn sie zunächst “passiv” sind), damit die Engine später nicht “heimlich” Regeln ändert. ([GitHub][1])

---

Perfekt. Unten ist **eine konkrete, baubare Panel-Layout-Skizze** (inkl. **exakter Labels & Tooltips**) **plus DoD** mit **5 klaren UI-Acceptance-Tests**.
Das ist so formuliert, dass du es direkt als Issue / Spec / PR-Checklist nutzen kannst.

---

# 🧩 Causal Breakdown Panel — UI Spec v1

**Ziel:**
Forensische, zeitpunktgenaue Erklärung *warum* ein Metric-Wert so ist, wie er ist — **ohne** Engine-Log-Lesen.

---

## 0) Einbindung & Verhalten

* **Panel-Typ:** Right-Side Inspector Drawer
* **Öffnen:** Click auf Metric-Line *oder* Marker
* **Scope:** exakt **ein Target-Metric + ein Zeitpunkt `t`**
* **Freeze:** Öffnen friert den Timecursor ein (kein Drift)
* **Read-only:** keinerlei Mutation, nur Erklärung

---

## 1) Header Section — „Snapshot“

**Layout (1 Zeile + Subline):**

```
Causal Breakdown · theta_intent
t = 12 500 ms   |   Replace: ACTIVE   |   Blend: 2   |   Blocked: 1
```

### Felder & Labels

* **Target Metric:** `theta_intent`
* **Timestamp:** `t = 12 500 ms`
* **Replace:** `ACTIVE` / `none`
* **Blend:** `N active`
* **Blocked:** `N`

### Tooltips

* **Replace:**
  *“At this timestamp, a replace-impact dominates the target. All blend impacts are ignored.”*
* **Blend:**
  *“Number of active blend impacts passing the skew gate.”*
* **Blocked:**
  *“Impacts rejected by temporal gating or validation rules.”*

---

## 2) Value Pipeline — „What happened to the value“

**Visual:** horizontal pipeline (read left → right)

```
Base        Replace        Blend        Clamp        Final
 42.00  →   80.00   →   (skipped) →   [0–100] →   80.00
```

### Labels

* `Base`
* `After Replace`
* `After Blend`
* `Clamp`
* `Final`

### Tooltip (Pipeline Block)

* **Base:**
  *“Deterministic source value at time t (seeded PRNG / input stream).”*
* **After Replace:**
  *“Value after applying the winning replace impact (if any).”*
* **After Blend:**
  *“Value after applying all blend contributions (ADD → MUL).”*
* **Clamp:**
  *“Final value constrained to the metric’s clamp range.”*
* **Final:**
  *“Rendered metric value at this timestamp.”*

---

## 3) Replace Section — „Dominant Impact“

### 3.1 Winner Card (only if active)

```
Replace Winner
Edge: e_delta_spike_replace_theta
Priority: 10
Trigger → Effective: 11 900 → 12 000 ms
Skew: 100 ms (≤ 250 ms ✔)
Hold Window: [12 000 – 12 500]
```

**Tooltips**

* **Priority:**
  *“Higher priority replace impacts override lower ones.”*
* **Skew:**
  *“|t_effective − t_trigger| must not exceed max_skew_ms.”*
* **Hold Window:**
  *“Replace impact is active only within this time window.”*

---

### 3.2 Replace Candidates (collapsible)

```
Replace Candidates (2)
• e_delta_spike_replace_theta  (priority 10)  ✔ winner
• e_manual_override_theta     (priority 5)   lower priority
```

**Tooltip (Candidates Header)**
*“All replace impacts active at time t, sorted deterministically.”*

---

## 4) Blend Section — „Modulation Layer“

> **Hidden entirely if Replace is active**
> (show a grey note instead)

```
Blend suppressed because Replace is active.
```

Tooltip:
*“Blend impacts are ignored when a replace impact dominates the target.”*

---

### 4.1 Blend Settings

```
Blend Settings
Normalize Weights: OFF
Execution Order: ADD → MUL
```

**Tooltips**

* **Normalize Weights:**
  *“If enabled, blend weights are normalized to sum to 1.”*
* **Execution Order:**
  *“Additive deltas are applied before multiplicative scaling.”*

---

### 4.2 ADD Contributions

```
ADD Contributions   Δ_add = +6.00
• e_theta_blend_delta_add
  src: 3.00  gain: 1.0  weight: 1.0  → +3.00
• e_sigma_blend_delta_add
  src: 3.00  gain: 1.0  weight: 1.0  → +3.00
```

Tooltip (Section):
*“Additive contributions shift the base value linearly.”*

---

### 4.3 MUL Contributions

```
MUL Contributions   Δ_mul = ×1.20
• e_sigma_blend_delta_mul
  src: 1.00  gain: 0.2  weight: 1.0  → ×1.20
```

Tooltip:
*“Multiplicative impacts scale the value relatively (1 + gain × weight × src).”*

---

## 5) Blocked / Gated Impacts

```
Blocked Impacts (1)
• e_long_delay_experiment
  Reason: max_skew_ms exceeded
  Skew: 480 ms  >  250 ms
  Gate Source: edge.gate
```

Tooltip (Reason):
*“This impact was excluded to preserve causal plausibility.”*

---

## 6) Actions Footer

```
[ Copy Breakdown JSON ]    [ Freeze Frame ✔ ]
```

* **Copy Breakdown JSON:** copies the full forensic payload
* **Freeze Frame:** keeps panel locked while timeline moves

---

# ✅ Definition of Done(DoD)

## Functional

* Panel opens on metric click and freezes time
* Shows **Base → Replace → Blend → Clamp → Final** pipeline
* Replace dominance strictly enforced visually and logically
* Blocked impacts always visible with reason

## Data Integrity

* Displayed numbers **exactly match engine output**
* Sorting is deterministic (priority desc, edge_id asc)
* No hidden mutations or recomputation in UI

## UX

* Tooltips on **every non-trivial concept**
* Collapsible sections for density control
* Copy JSON produces valid, schema-stable output

---

# 🧪 UI Acceptance Tests(5)

### **Test 1 — Replace Active**

**Given:** Replace + Blend active
**Expect:**

* Replace Section visible
* Blend Section hidden with “suppressed” notice
* Final value == Replace value

---

### **Test 2 — Gate Block**

**Given:** Impact with skew > max_skew_ms
**Expect:**

* Impact appears in *Blocked Impacts*
* Not counted in Blend or Replace
* Reason = `max_skew_ms exceeded`

---

### **Test 3 — Normalize ON/OFF**

**Given:** Two blend impacts, equal weight
**Toggle Normalize**

* OFF → contributions sum directly
* ON → each weight = 0.5, contributions halved
* UI reflects change immediately

---

### **Test 4 — Clamp Visible**

**Given:** Value exceeds clamp
**Expect:**

* Clamp range displayed in pipeline
* Final value == clamp boundary
* Tooltip explains clamp

---

### **Test 5 — Copy JSON**

**Action:** Click “Copy Breakdown JSON”
**Expect:**

* Clipboard contains valid JSON
* Includes base, replace, blend, blocked, final
* Pasteable into file / console without loss

---

## Abschluss

Mit diesem Panel hast du:

* **Forensik auf Klick**
* **Audit-Readiness**
* **Null Black Boxes**




Alles klar — **beides**.
Unten bekommst du **(A) eine pixelnahe ASCII-Wireframe-Skizze** **und** **(B) ein konkretes TypeScript-Interface + Mock-Payload**, sofort verdrahtbar.

---

#(A) ASCII - Wireframe — * Causal Breakdown Panel *

```
┌───────────────────────────────────────────────────────────────────────┐
│ Causal Breakdown · theta_intent                                       │
│ t = 12 500 ms   | Replace: ACTIVE | Blend: 2 | Blocked: 1             │
├───────────────────────────────────────────────────────────────────────┤
│ VALUE PIPELINE                                                        │
│                                                                       │
│  Base        After Replace        After Blend        Clamp     Final  │
│  42.00   →      80.00        →     (skipped)     →   [0–100] → 80.00  │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ REPLACE — Dominant Impact                                             │
│                                                                       │
│  Winner                                                               │
│  Edge: e_delta_spike_replace_theta                                    │
│  Priority: 10                                                         │
│  Trigger → Effective: 11 900 → 12 000 ms                              │
│  Skew: 100 ms (≤ 250 ms ✔)                                            │
│  Hold Window: [12 000 – 12 500]                                       │
│                                                                       │
│  Candidates (2) ▸                                                     │
│   • e_delta_spike_replace_theta   (priority 10)   ✔ winner            │
│   • e_manual_override_theta       (priority 5)                        │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ BLEND — Modulation Layer                                              │
│                                                                       │
│  ⚠ Blend suppressed because Replace is active.                        │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ BLOCKED / GATED IMPACTS                                               │
│                                                                       │
│  • e_long_delay_experiment                                            │
│    Reason: max_skew_ms exceeded                                       │
│    Skew: 480 ms  >  250 ms                                            │
│    Gate Source: edge.gate                                             │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ ACTIONS                                                               │
│ [ Copy Breakdown JSON ]        [ Freeze Frame ✔ ]                     │
└───────────────────────────────────────────────────────────────────────┘
```

**UX-Notes (implizit im Layout):**

* Klick auf Pipeline-Box zeigt Tooltip mit Definition.
* „Candidates (2) ▸“ ist collapsible.
* Blend-Sektion wird **ersetzt** durch Suppression-Hinweis, wenn Replace aktiv.

---

#(B) TypeScript — Interface + Mock(drop - in)

## 1) Interfaces

```ts
export type GateSource = "edge.gate" | "edge.alignment" | "defaults";

export interface ReplaceCandidate {
edge_id:
  string;
priority:
  number;
t_trigger:
  number;
t_effective:
  number;
skew_ms:
  number;
passes_gate:
  boolean;
}

export interface ReplaceWinner {
edge_id:
  string;
priority:
  number;
t_trigger:
  number;
t_effective:
  number;
skew_ms:
  number;
hold_start:
  number;
hold_end:
  number;
}

export interface BlendAddTerm {
edge_id:
  string;
src:
  number;
gain:
  number;
weight:
  number;
contribution:
  number; // gain * weight * src (or normalized)
}

export interface BlendMulTerm {
edge_id:
  string;
src:
  number;
gain:
  number;
weight:
  number;
factor:
  number; // 1 + gain * weight * src (or normalized)
}

export interface BlockedImpact {
edge_id:
  string;
reason:
  "MAX_SKEW_EXCEEDED" | "VALIDATION_ERROR";
skew_ms:
  number;
max_skew_ms:
  number;
source:
  GateSource;
}

export interface CausalBreakdown {
t:
  number;
target:
  string;

base:
  number;
after_replace:
  number | null;
after_blend:
  number | null;
clamp: {
min:
  number;
max:
  number
}
  | null;
final:
  number;

replace: {
active:
  boolean;
  winner ?: ReplaceWinner;
candidates:
  ReplaceCandidate[];
};

blend: {
enabled:
  boolean;
suppressed_by_replace:
  boolean;
normalize_weights:
  boolean;
delta_add:
  number;
delta_mul:
  number;
add_terms:
  BlendAddTerm[];
mul_terms:
  BlendMulTerm[];
};

blocked:
  BlockedImpact[];
}
```

---

## 2) Mock-Payload (Replace aktiv → Blend unterdrückt)

```ts
export const MOCK_BREAKDOWN_REPLACE_ACTIVE: CausalBreakdown = {
  t: 12500,
  target: "theta_intent",

  base: 42.0,
  after_replace: 80.0,
  after_blend: null,
  clamp: { min: 0, max: 100 },
  final: 80.0,

  replace: {
    active: true,
    winner: {
      edge_id: "e_delta_spike_replace_theta",
      priority: 10,
      t_trigger: 11900,
      t_effective: 12000,
      skew_ms: 100,
      hold_start: 12000,
      hold_end: 12500,
    },
    candidates: [
      {
        edge_id: "e_delta_spike_replace_theta",
        priority: 10,
        t_trigger: 11900,
        t_effective: 12000,
        skew_ms: 100,
        passes_gate: true,
      },
      {
        edge_id: "e_manual_override_theta",
        priority: 5,
        t_trigger: 11850,
        t_effective: 12000,
        skew_ms: 150,
        passes_gate: true,
      },
    ],
  },

  blend: {
    enabled: true,
    suppressed_by_replace: true,
    normalize_weights: false,
    delta_add: 0,
    delta_mul: 1,
    add_terms: [],
    mul_terms: [],
  },

  blocked: [
    {
      edge_id: "e_long_delay_experiment",
      reason: "MAX_SKEW_EXCEEDED",
      skew_ms: 480,
      max_skew_ms: 250,
      source: "edge.gate",
    },
  ],
};
```

---

## 3) Mock-Payload (kein Replace → Blend aktiv, Normalize ON)

```ts
export const MOCK_BREAKDOWN_BLEND_ACTIVE: CausalBreakdown = {
  t: 9800,
  target: "delta_resonance",

  base: 10.0,
  after_replace: null,
  after_blend: 18.0,
  clamp: { min: 0, max: 100 },
  final: 18.0,

  replace: {
    active: false,
    candidates: [],
  },

  blend: {
    enabled: true,
    suppressed_by_replace: false,
    normalize_weights: true,
    delta_add: 2.0,  // normalized contributions
    delta_mul: 1.5,
    add_terms: [
      { edge_id: "e_theta_blend_delta_add", src: 2, gain: 1, weight: 0.5, contribution: 1.0 },
      { edge_id: "e_sigma_blend_delta_add", src: 2, gain: 1, weight: 0.5, contribution: 1.0 },
    ],
    mul_terms: [
      { edge_id: "e_sigma_blend_delta_mul", src: 1, gain: 1, weight: 0.5, factor: 1.5 },
    ],
  },

  blocked: [],
};
```

---

## 4) UI-Verdrahtung (kurz & praktisch)

* **Panel Props:** `breakdown?: CausalBreakdown`
* **Freeze Frame:** speichert `t` lokal;
UI rendert nur dieses Payload.***Suppressionslogik : **
  `if (breakdown.replace.active) showSuppressionNote();
else renderBlend();`
* **Copy JSON:** `navigator.clipboard.writeText(JSON.stringify(breakdown, null, 2))`

---

## 5) Acceptance-Checks (direkt gegen Mock testbar)

1. **Replace active:** `after_blend === null`, Blend-Section zeigt Suppression-Hinweis.
2. **Gate block:** `blocked.length > 0` mit `reason === "MAX_SKEW_EXCEEDED"`.
3. **Normalize ON/OFF:** `normalize_weights` toggelt → `contribution` halbiert/normalisiert.
4. **Clamp sichtbar:** `clamp !== null` → Pipeline zeigt `[min–max]`.
5. **Copy JSON:** Clipboard-Text === `JSON.stringify(payload, null, 2)`.

---

```tsx
import React, { useMemo, useState } from "react";

/**
 * Causal Breakdown Panel — React Skeleton (no external UI libs)
 * - Drop-in component for your inspector drawer/right panel
 * - Deterministic rendering, tooltips via title attributes
 * - Copy JSON button included
 *
 * Integrate:
 * <CausalBreakdownPanel breakdown={data} onClose={() => ...} />
 */

// ---------- Types ----------
export type GateSource = "edge.gate" | "edge.alignment" | "defaults";

export interface ReplaceCandidate {
edge_id:
  string;
priority:
  number;
t_trigger:
  number;
t_effective:
  number;
skew_ms:
  number;
passes_gate:
  boolean;
}

export interface ReplaceWinner {
edge_id:
  string;
priority:
  number;
t_trigger:
  number;
t_effective:
  number;
skew_ms:
  number;
hold_start:
  number;
hold_end:
  number;
}

export interface BlendAddTerm {
edge_id:
  string;
src:
  number;
gain:
  number;
weight:
  number;
contribution:
  number;
}

export interface BlendMulTerm {
edge_id:
  string;
src:
  number;
gain:
  number;
weight:
  number;
factor:
  number;
}

export interface BlockedImpact {
edge_id:
  string;
reason:
  "MAX_SKEW_EXCEEDED" | "VALIDATION_ERROR";
skew_ms:
  number;
max_skew_ms:
  number;
source:
  GateSource;
}

export interface CausalBreakdown {
t:
  number;
target:
  string;

base:
  number;
after_replace:
  number | null;
after_blend:
  number | null;
clamp: {
min:
  number;
max:
  number
}
  | null;
final:
  number;

replace: {
active:
  boolean;
  winner ?: ReplaceWinner;
candidates:
  ReplaceCandidate[];
};

blend: {
enabled:
  boolean;
suppressed_by_replace:
  boolean;
normalize_weights:
  boolean;
delta_add:
  number;
delta_mul:
  number;
add_terms:
  BlendAddTerm[];
mul_terms:
  BlendMulTerm[];
};

blocked:
  BlockedImpact[];
}

// ---------- Props ----------
export interface CausalBreakdownPanelProps {
  breakdown ?: CausalBreakdown | null;
  onClose ?: () = > void;
  onToggleFreeze ?: (frozen : boolean) = > void;
  initiallyFrozen ?: boolean;
}

// ---------- Helpers ----------
function fmt(n : number | null | undefined, digits = 2) : string {
  if (n == = null || n == = undefined || Number.isNaN(n))
    return "—";
  return n.toFixed(digits);
}

function fmtMs(n : number | null | undefined) : string {
  if (n == = null || n == = undefined || Number.isNaN(n))
    return "—";
  // 12 500 style
  return n.toLocaleString("en-US").replaceAll(",", " ");
}

function clampLabel(c: { min: number; max: number } | null): string {
  if (!c)
    return "—";
  return `[$ { fmt(c.min, 0) }–${fmt(c.max, 0)}]`;
}

function badgeStyle(kind : "ok" | "warn" | "muted") {
  const base : React.CSSProperties = {
    display : "inline-flex",
    alignItems : "center",
    gap : 6,
    padding : "2px 8px",
    borderRadius : 999,
    fontSize : 12,
    lineHeight : "16px",
    border : "1px solid rgba(255,255,255,0.12)",
    userSelect : "none",
    whiteSpace : "nowrap",
  };
  if (kind == = "ok")
    return {... base, background : "rgba(0,255,200,0.10)"};
  if (kind == = "warn")
    return {... base, background : "rgba(255,170,0,0.12)"};
  return {... base, background : "rgba(255,255,255,0.06)"};
}

function sectionTitleStyle() : React.CSSProperties {
  return {
    fontSize : 12,
    letterSpacing : 0.9,
    textTransform : "uppercase",
    color : "rgba(255,255,255,0.75)",
    margin : "14px 0 8px",
  };
}

function cardStyle() : React.CSSProperties {
  return {
    background : "rgba(255,255,255,0.04)",
    border : "1px solid rgba(255,255,255,0.10)",
    borderRadius : 12,
    padding : 12,
  };
}

function rowStyle() : React.CSSProperties {
  return {
    display : "grid",
    gridTemplateColumns : "160px 1fr",
    gap : 10,
    alignItems : "baseline",
    margin : "6px 0",
  };
}

function monoStyle() : React.CSSProperties {
  return {
    fontFamily :
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize : 12,
  };
}

function smallStyle() : React.CSSProperties {
  return {fontSize : 12, color : "rgba(255,255,255,0.70)"};
}

// ---------- Component ----------
export function CausalBreakdownPanel({
    breakdown,
    onClose,
    onToggleFreeze,
    initiallyFrozen = true,
} : CausalBreakdownPanelProps) {
  const[frozen, setFrozen] = useState<boolean>(initiallyFrozen);
  const[showCandidates, setShowCandidates] = useState<boolean>(false);
  const[copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");

  const header =
      useMemo(() = >
                   {
                     if (!breakdown)
                       return null;
                     const replaceBadge =
                         breakdown.replace.active ? "ACTIVE" : "none";
                     return {
                       title : `Causal Breakdown · ${breakdown.target}`,
                       meta : `t = ${fmtMs(breakdown.t)} ms`,
                       replace : replaceBadge,
                       blendCount : breakdown.blend.suppressed_by_replace
                           ? 0
                           : breakdown.blend.add_terms.length +
                                 breakdown.blend.mul_terms.length,
                       blocked : breakdown.blocked.length,
                     };
                   },
              [breakdown]);

  const pipeline = useMemo(
      () = >
           {
             if (!breakdown)
               return null;
             const afterReplace = breakdown.after_replace !=
                 = null ? breakdown.after_replace : breakdown.base;
             const afterBlend = breakdown.after_blend !=
                 = null ? breakdown.after_blend
                   : breakdown.replace.active
                       ? null
                       : afterReplace; // if no blend applied, carry through
             return {afterReplace, afterBlend};
           },
      [breakdown]);

  async function copyJson() {
    if (!breakdown)
      return;
    try {
      const text = JSON.stringify(breakdown, null, 2);
      await navigator.clipboard.writeText(text);
      setCopyState("ok");
      window.setTimeout(() = > setCopyState("idle"), 1200);
    } catch {
      setCopyState("err");
      window.setTimeout(() = > setCopyState("idle"), 1600);
    }
  }

  function toggleFreeze() {
    const next = !frozen;
    setFrozen(next);
    onToggleFreeze ?.(next);
  }

  if (!breakdown) {
    return (<div style = {styles.shell}><div style = {styles.topbar}>
            <div style = {styles.hTitle}>
                Causal Breakdown</ div>
            <button style = {styles.iconBtn} onClick = {onClose} title =
                 "Close">
            ✕ </ button></ div>
            <div style = {{... styles.empty, ... smallStyle()}}>
                Select a metric line to inspect causal impact resolution.</ div>
            </ div>);
  }

  const replaceActive = breakdown.replace.active;
  const blendSuppressed =
      breakdown.blend.suppressed_by_replace || replaceActive;

  return (
    <div style={styles.shell}>
      {/* Top Bar */}
      <div style={styles.topbar}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.hTitle}>{header?.title}</div>
          <div style={styles.hMeta}>
            <span style={
    {
      ... badgeStyle("muted")
    }} title="Current timeline timestamp">
              {header?.meta}
            </span>
            <span
              style={
    {
      ... badgeStyle(replaceActive ? "warn" : "muted")
    }}
              title={
                replaceActive
                  ? "Replace impact dominates target; blend ignored."
                  : "No replace impact active."
              }
            >
              Replace: {header?.replace}
            </span>
            <span
              style={
    {
      ... badgeStyle(blendSuppressed ? "muted" : "ok")
    }}
              title="Number of active blend impacts passing gating"
            >
              Blend: {header?.blendCount ?? 0}
            </span>
            <span style={
    { ...badgeStyle(header?.blocked ? "warn" : "muted")
    }} title="Blocked impacts">
              Blocked: {header?.blocked ?? 0}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={styles.btn}
            onClick={toggleFreeze}
            title="Freeze the panel at the current timestamp"
          >
            Freeze {frozen ? "✔" : "—"}
          </button>
          <button
            style={styles.btn}
            onClick={copyJson}
            title="Copy forensic breakdown JSON to clipboard"
          >
            Copy JSON{" "}
            {copyState === "ok" ? "✔" : copyState === "err" ? "✕" : ""}
          </button>
          <button style={styles.iconBtn} onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* VALUE PIPELINE */}
        <div style={sectionTitleStyle()}>Value Pipeline</div>
        <div style={{ ...cardStyle(), display: "grid", gap: 10 }}>
          <div style={styles.pipelineGrid}>
            <PipelineCell
              label="Base"
              value={fmt(breakdown.base)}
              tooltip="Deterministic source value at time t (seeded PRNG / input stream)."
            />
            <Arrow />
            <PipelineCell
              label="After Replace"
              value={replaceActive ? fmt(breakdown.after_replace) : "—"}
              tooltip="Value after applying the winning replace impact (if any)."
              muted={!replaceActive}
            />
            <Arrow />
            <PipelineCell
              label="After Blend"
              value={
                blendSuppressed
                  ? "(skipped)"
                  : breakdown.after_blend !== null
                    ? fmt(breakdown.after_blend)
                    : "—"
              }
              tooltip="Value after applying all blend contributions (ADD → MUL)."
              muted={blendSuppressed}
            />
            <Arrow />
            <PipelineCell
              label="Clamp"
              value={clampLabel(breakdown.clamp)}
              tooltip="Final value constrained to the metric’s clamp range."
              muted={!breakdown.clamp}
            />
            <Arrow />
            <PipelineCell
              label="Final"
              value={fmt(breakdown.final)}
              tooltip="Rendered metric value at this timestamp."
            />
          </div>

          <div style={{ ...smallStyle(), display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span title="The final number shown in the chart for this metric at time t.">
              Final = <span style={monoStyle()}>{fmt(breakdown.final)}</span>
            </span>
            <span title="Replace dominates and suppresses blend when active.">
              Replace &gt; Blend = <span style={monoStyle()}>{replaceActive ? "true" : "false"}</span>
            </span>
          </div>
        </div>

        {/* REPLACE */}
        <div style={sectionTitleStyle()}>Replace — Dominant Impact</div>
        <div style={cardStyle()}>
          {!replaceActive ? (
            <div style={smallStyle()}>No replace impact active at this timestamp.</div>
          ) : (
            <>
              <div style={styles.subTitle}>Winner</div>
              {breakdown.replace.winner ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <KV k="Edge" v={breakdown.replace.winner.edge_id} mono />
                  <KV
                    k="Priority"
                    v={String(breakdown.replace.winner.priority)}
                    tip="Higher priority replace impacts override lower ones."
                  />
                  <KV
                    k="Trigger → Effective"
                    v={`${fmtMs(breakdown.replace.winner.t_trigger)} → ${fmtMs(
                      breakdown.replace.winner.t_effective
                    )} ms`}
                    tip="Effective time is trigger time plus delay."
                  />
                  <KV
                    k="Skew"
                    v={`${fmtMs(breakdown.replace.winner.skew_ms)} ms`}
                    tip="|t_effective − t_trigger| must not exceed max_skew_ms."
                  />
                  <KV
                    k="Hold Window"
                    v={`[${
    fmtMs(breakdown.replace.winner.hold_start)} – ${fmtMs(
                      breakdown.replace.winner.hold_end
                    )}]`}
                    tip="Replace impact is active only within this time window."
                  />
                </div>
              ) : (
                <div style={smallStyle()}>Winner details unavailable.</div>
              )}

              <div style={{ height: 10 }} />

              <button
                style={styles.linkBtn}
                onClick={() => setShowCandidates((s) => !s)}
                title="All replace impacts active at time t, sorted deterministically."
              >
                Candidates ({breakdown.replace.candidates.length}){" "}
                <span style={{ opacity: 0.8 }}>{showCandidates ? "▾" : "▸"}</span>
              </button>

              {showCandidates && (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {breakdown.replace.candidates.map((c) => {
    const isWinner = breakdown.replace.winner ?.edge_id == = c.edge_id;
    return (<div key = {c.edge_id} style = {styles.listRow}>
            <div style = {{display : "flex", gap : 8, alignItems : "center"}}>
            <span style = {{
               ... monoStyle(),
               overflow : "hidden",
               textOverflow : "ellipsis"
             }}>{c.edge_id} < / span >
            {isWinner && (<span style =
                           {
                             {
                               ... badgeStyle("ok")
                             }
                           } title = "Winner">
                              ✔ winner</ span>)} {
                !c.passes_gate && (<span style =
                                    {
                                      {
                                        ... badgeStyle("warn")
                                      }
                                    } title = "Failed gating">
                                       gated</ span>)} < / div >
            <div style = {{... smallStyle(), textAlign : "right"}}> prio {
              c.priority
            } · skew{fmtMs(c.skew_ms)} ms</ div></ div>);
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* BLEND */}
        <div style={sectionTitleStyle()}>Blend — Modulation Layer</div>
        <div style={cardStyle()}>
          {!breakdown.blend.enabled ? (
            <div style={smallStyle()}>Blend is disabled for this target.</div>
          ) : blendSuppressed ? (
            <div style={smallStyle()} title="Blend impacts are ignored when a replace impact dominates the target.">
              ⚠ Blend suppressed because Replace is active.
            </div>
          ) : (
            <>
              <div style={styles.subTitle}>Blend Settings</div>
              <div style={{ display: "grid", gap: 6 }}>
                <KV
                  k="Normalize Weights"
                  v={breakdown.blend.normalize_weights ? "ON" : "OFF"}
                  tip="If enabled, blend weights are normalized to sum to 1."
                />
                <KV k="Execution Order" v="ADD → MUL" tip="Additive deltas are applied before multiplicative scaling." />
              </div>

              <div style={{ height: 12 }} />

              <div style={styles.subTitle} title="Additive contributions shift the base value linearly.">
                ADD Contributions · Δ_add = {fmt(breakdown.blend.delta_add)}
              </div>
              {breakdown.blend.add_terms.length === 0 ? (
                <div style={smallStyle()}>No active ADD terms.</div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {breakdown.blend.add_terms.map((t) => (
                    <TermRow
                      key={t.edge_id}
                      edge={t.edge_id}
                      left={`src ${fmt(t.src)} · gain ${fmt(t.gain)} · w ${fmt(t.weight)}`}
                      right={`→ ${fmt(t.contribution)}`}
                    />
                  ))}
                </div>
              )}

              <div style={{ height: 12 }} />

              <div
                style={styles.subTitle}
                title="Multiplicative impacts scale the value relatively (1 + gain × weight × src)."
              >
                MUL Contributions · Δ_mul = ×{fmt(breakdown.blend.delta_mul)}
              </div>
              {breakdown.blend.mul_terms.length === 0 ? (
                <div style={smallStyle()}>No active MUL terms.</div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {breakdown.blend.mul_terms.map((t) => (
                    <TermRow
                      key={t.edge_id}
                      edge={t.edge_id}
                      left={`src ${fmt(t.src)} · gain ${fmt(t.gain)} · w ${fmt(t.weight)}`}
                      right={`→ ×${fmt(t.factor)}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* BLOCKED */}
        <div style={sectionTitleStyle()}>Blocked / Gated Impacts</div>
        <div style={cardStyle()}>
          {breakdown.blocked.length === 0 ? (
            <div style={smallStyle()}>No blocked impacts at this timestamp.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {
    breakdown.blocked.map(
        (b) = > (<div key = {b.edge_id} style = {styles.blockRow}>
                     <div style = {{
                        ... monoStyle(),
                        overflow : "hidden",
                        textOverflow : "ellipsis"
                      }}>{b.edge_id} < / div >
                     <div style = {{... smallStyle(), marginTop : 4}}>
                     <div title = "This impact was excluded to preserve causal "
                                  "plausibility.">
                         Reason : {" "} < span style =
                     {monoStyle()} > {b.reason == = "MAX_SKEW_EXCEEDED"
                                                        ? "max_skew_ms exceeded"
                                                        : "validation error"} <
                         / span >
                         </ div><div> Skew : <span style = {monoStyle()}>{fmtMs(
                             b.skew_ms)} ms</ span> &
                     nbsp;
                 &gt; &nbsp;
                 <span style = {monoStyle()}>{fmtMs(b.max_skew_ms)} ms</ span>
                 </ div><div>
                     Gate Source : <span style = {monoStyle()}>{b.source} <
                 / span > </ div></ div></ div>))}
            </div>
          )}
        </div>

        {/* Footer spacing */}
        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}

// ---------- Subcomponents ----------
function Arrow() {
  return <div style = {{opacity : 0.6, textAlign : "center"}}>→</ div>;
}

function PipelineCell({
    label,
    value,
    tooltip,
    muted,
} : {
label:
  string;
value:
  string;
tooltip:
  string;
  muted ?: boolean;
}) {
  return (<div style = { {display : "grid", gap : 4} } title = {tooltip}>
          <div style = {{... smallStyle(), opacity : muted ? 0.55 : 0.9}}>{
              label} < / div >
          <div style =
               {{... monoStyle(), fontSize : 13, opacity : muted ? 0.55 : 1}}>{
              value} < / div >
          </ div>);
}

function KV({k, v, tip, mono} : {
k:
  string;
v:
  string;
  tip ?: string;
  mono ?: boolean
}) {
  return (
    <div style={rowStyle()} title={tip ?? ""}>
      <div style={smallStyle()}>{k}</div>
      <div style={mono ? monoStyle() : {}}>{v}</div>
    </div>
  );
}

function TermRow({edge, left, right} : {
edge:
  string;
left:
  string;
right:
  string
}) {
  return (
      <div style = {styles.listRow}>
      <div style = {{display : "grid", gap : 2, minWidth : 0}}>
      <div style =
           {{... monoStyle(), overflow : "hidden", textOverflow : "ellipsis"}}>{
          edge} < / div >
      <div style = {smallStyle()}>{left} < / div > </ div>
      <div style = {{... monoStyle(), textAlign : "right"}}>{right} < / div >
      </ div>);
}

// ---------- Styles ----------
const styles : Record<string, React.CSSProperties> = {
  shell : {
    height : "100%",
    display : "grid",
    gridTemplateRows : "auto 1fr",
    background : "rgba(10,10,12,1)",
    color : "rgba(255,255,255,0.92)",
    borderLeft : "1px solid rgba(255,255,255,0.10)",
  },
  topbar : {
    display : "flex",
    justifyContent : "space-between",
    gap : 10,
    padding : 12,
    borderBottom : "1px solid rgba(255,255,255,0.10)",
    background : "rgba(16,16,20,1)",
  },
  hTitle : {
    fontSize : 14,
    fontWeight : 700,
    whiteSpace : "nowrap",
    overflow : "hidden",
    textOverflow : "ellipsis",
  },
  hMeta : {
    marginTop : 6,
    display : "flex",
    gap : 8,
    flexWrap : "wrap",
    alignItems : "center",
  },
  body : {
    overflow : "auto",
    padding : 12,
  },
  btn : {
    padding : "8px 10px",
    borderRadius : 10,
    border : "1px solid rgba(255,255,255,0.12)",
    background : "rgba(255,255,255,0.06)",
    color : "rgba(255,255,255,0.9)",
    cursor : "pointer",
    fontSize : 12,
    whiteSpace : "nowrap",
  },
  iconBtn : {
    width : 34,
    height : 34,
    borderRadius : 10,
    border : "1px solid rgba(255,255,255,0.12)",
    background : "rgba(255,255,255,0.06)",
    color : "rgba(255,255,255,0.9)",
    cursor : "pointer",
    fontSize : 14,
    lineHeight : "14px",
  },
  linkBtn : {
    border : "none",
    background : "transparent",
    color : "rgba(0,255,200,0.95)",
    cursor : "pointer",
    padding : 0,
    fontSize : 12,
    textAlign : "left",
  },
  subTitle : {
    fontSize : 13,
    fontWeight : 700,
    marginBottom : 8,
  },
  pipelineGrid : {
    display : "grid",
    gridTemplateColumns : "1fr auto 1fr auto 1fr auto 1fr auto 1fr",
    gap : 10,
    alignItems : "center",
  },
  listRow : {
    display : "grid",
    gridTemplateColumns : "1fr auto",
    gap : 10,
    padding : "8px 10px",
    borderRadius : 10,
    border : "1px solid rgba(255,255,255,0.10)",
    background : "rgba(255,255,255,0.03)",
    alignItems : "center",
    minWidth : 0,
  },
  blockRow : {
    padding : "10px 10px",
    borderRadius : 10,
    border : "1px solid rgba(255,255,255,0.10)",
    background : "rgba(255,170,0,0.06)",
    minWidth : 0,
  },
  empty : {
    padding : 12,
  },
};
```
