Gut. Dann lass uns das **Wert-Schema sauber, belastbar und erweiterbar** definieren – nicht als UI-Artefakt, sondern als **konzeptuellen Vertrag**, den *alles* Weitere einhalten muss.

Ich gebe dir **ein normatives Schema**, inkl. Begründung *warum jede Komponente existiert*.
Das ist bewusst **streng**, weil sonst später Unsinn passiert.

---

# 1. Ziel des Wert-Schemas (klar definiert)

Ein Wert soll zu jedem Zeitpunkt eindeutig beantworten können:

1. **Was** ist das?
2. **Woher** kommt es?
3. **Wie** wurde es erzeugt?
4. **Wie** darf es verglichen werden?
5. **Wie lange** ist es gültig?
6. **Wie sicher** ist es?

Alles andere (Charts, Video, Animation) ist **nachgelagert**.

---

# 2. Normatives Wert-Schema (v1)

### 2.1 Top-Level Struktur

```yaml
value:
  meta: {}
  semantics: {}
  provenance: {}
  generation: {}
  modulation: {}
  time: {}
  quality: {}
```

Diese 7 Blöcke sind **minimal notwendig**.
Fehlt einer → Wert ist analytisch unvollständig.

---

# 3. Die einzelnen Blöcke (mit Zweck)

---

## 3.1 `meta` – Identität & Referenz

```yaml
meta:
  id: cpu_load
  label: CPU Load
  version: 1.0
  namespace: system.performance
```

**Warum?**

* `id` → maschinenlesbar
* `label` → menschenlesbar
* `namespace` → verhindert semantische Kollisionen
* `version` → Werte *ändern sich* über Zeit

> Ohne Versionierung kannst du keine historischen Vergleiche trauen.

---

## 3.2 `semantics` – Bedeutung & Dimension

```yaml
semantics:
  dimension: performance
  unit: percent
  scale:
    type: ratio
    min: 0
    max: 100
  interpretation:
    higher_is: worse
```

**Warum?**

* Vergleichbarkeit ist **dimensionsabhängig**
* Prozent ≠ Score ≠ Wahrscheinlichkeit
* „höher = besser“ ist *keine* Selbstverständlichkeit

> Zwei Werte mit gleicher Skala aber anderer Interpretation dürfen **nicht** direkt verglichen werden.

---

## 3.3 `provenance` – Herkunft (entscheidend!)

```yaml
provenance:
  source_type: telemetry        # telemetry | log | human | model | synthetic
  source_id: host_01
  acquisition:
    method: sampling
    endpoint: /proc/stat
```

**Warum?**

* Gemessen ≠ berechnet ≠ geschätzt
* Herkunft beeinflusst **Vertrauen**
* Später extrem wichtig für Debugging & Verantwortung

> Provenance ist kein Nice-to-Have, sondern Audit-Grundlage.

---

## 3.4 `generation` – Wie entsteht der Wert?

```yaml
generation:
  raw_input: cpu_ticks
  transform:
    type: aggregation
    function: average
    window: 1s
```

**Warum?**

* Rohdaten ≠ Wert
* Jeder Transform erzeugt **Verzerrung**
* Ohne Offenlegung entsteht Pseudogenauigkeit

> Wenn du nicht erklären kannst, *wie* ein Wert entsteht, solltest du ihn nicht vergleichen.

---

## 3.5 `modulation` – Vergleichstauglichkeit

```yaml
modulation:
  normalization:
    method: min_max
    range: [0, 1]
  smoothing:
    method: ema
    alpha: 0.3
  weighting:
    factor: 1.0
```

**Warum?**

* Vergleich ohne Normalisierung ist mathematisch falsch
* Glättung verändert **Zeitverhalten**
* Gewichtung verändert **Bedeutung**

> Modulation gehört **vor** die Visualisierung, nicht hinein.

---

## 3.6 `time` – Zeitvertrag

```yaml
time:
  sampling_rate: 1s
  validity_duration: 1s
  latency_model:
    type: instant          # instant | delayed | windowed
    expected_delay: 0ms
  alignment:
    preferred_mode: soft_sync
```

**Warum?**

* Werte leben in Zeit
* Zeit ist **nicht** nur ein Index
* Vergleich ohne Zeitvertrag erzeugt Scheinkorrelationen

> Zeit ist ein *Vertrag*, kein Diagramm.

---

## 3.7 `quality` – Vertrauen & Unsicherheit

```yaml
quality:
  confidence: 0.95
  noise_level: low
  missing_data_policy: interpolate
  last_validated: 2026-02-03T16:40:00Z
```

**Warum?**

* Kein Wert ist perfekt
* Unsicherheit gehört **zum Wert**
* Später extrem wichtig für automatisierte Entscheidungen

> Ein Wert ohne Unsicherheitsangabe ist eine Behauptung, keine Messung.

---

# 4. Minimal-Schema (wenn du es abspecken willst)

Falls du **ultra-lean** starten willst, ist das **absolute Minimum**:

```yaml
value:
  meta: { id, namespace }
  semantics: { dimension, unit }
  provenance: { source_type }
  generation: { transform }
  time: { sampling_rate }
```

Alles darunter → **nicht vergleichbar**.

---

# 5. Wichtigste Regel (bitte merken)

> **Ein Wert ohne explizite Herkunft, Zeitvertrag und Modulation
> ist nicht falsch – aber nicht vergleichbar.**

Das ist der Kern deiner ursprünglichen Intuition.

---

## Nächster sinnvoller Schritt (du entscheidest)

Wir können jetzt:

1. 🔹 **2–3 konkrete Beispielwerte** definieren (System / Agent / Emotion)
2. 🔹 Ein **Vergleichs-Schema** (wie zwei Werte überhaupt verglichen werden dürfen)
3. 🔹 Ein **JSON-Schema / Validator** bauen
4. 🔹 Oder direkt die **Kopplungslogik** (synchron / kausal)

Sag mir **welcher Schritt als nächstes stabilisiert werden soll**.
