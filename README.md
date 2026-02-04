# 🧶 UI-nisierung (Sheratan Forensic UI)

**Status:** v1.1.3 · Audit-Grade · Hardened CI Baseline

UI-nisierung ist das spezialisierte Frontend-System für das **Sheratan-Ökosystem**, entworfen für die forensische Analyse und Echtzeit-Modifikation von **kausalen Kopplungs-Graphen**. 

Es ermöglicht die visuelle Überprüfung, wie Signale (Metriken) sich gegenseitig beeinflussen, und bietet eine lückenlose Audit-Integrität durch deterministische Snapshots.

---

## 🚀 Key Features

### 🛠️ Live-Editing & Logic Prototyping
Das System verfügt über eine dedizierte Edit-Logic-Engine mit 5 wesentlichen Guardrails:
1. **Ghost Curves**: Echtzeit-Visualisierung der Auswirkungen von Logikänderungen als gestrichelte Vorschau-Kurven.
2. **Draft Preview**: Vollständige Berechnung der kausalen Kette im isolierten Draft-Mode, ohne die Live-Simulation zu beeinflussen.
3. **Undo/Redo System**: Fehlerfreies Experimentieren durch einen integrierten History-Stack.
4. **Logic Diffing**: JSON-Patch basierter Vergleich zwischen Master-Logik und aktuellem Draft.
5. **Auto-Preservation**: Automatischer Auslöser eines forensischen Snapshots vor der Anwendung neuer Logik-Regeln.

### 🕵️ Causal++ Forensics v1.1
Jeder Wert in der Simulation ist bis zu seiner Quelle erklärbar:
* **Replace-Logic**: Identifikation dominanter Overrides basierend auf Priorität.
* **Blend-Logic**: Transparente Darstellung von additiven und multiplikativen Signalmischungen.
* **Temporal Gating**: Forensische Analyse von Blockaden durch Skew-Verletzungen (Zeit-Delta-Validierung).
* **Audit-Snapshots**: Export von fälschungssicheren ZIP-Zertifikaten inklusive Manifest, Metadaten und normalisierten Breakdowns.

---

## 🧪 Validierung & CI

Das Projekt erzwingt eine strikte **deterministic code pipeline**:
* **Schema-Enforcement**: Alle Graphen und Breakdowns werden gegen `v1.1` JSON-Schemas validiert.
* **GitHub Actions**: Automatische Prüfung aller forensic JSONs und ZIP-Bundles bei jedem Push.
* **Test-Suite**: 11/11 PASSED. Deckt Normalisierung, Legacy-Mapping und Gateway-Regeln ab.

**Tests ausführen:**
```bash
npm install
npm test
```

**Forensik-Validierung:**
```bash
# JSON validieren
npm run validate:breakdown tests/forensics/sample_breakdown.json -- --pretty

# ZIP-Bundle validieren
npm run validate:snapshot audit_exports/dein_snapshot.zip -- --pretty
```

---

## 🏗️ Technology Stack

* **Core**: Vanilla Javascript (ESM)
* **Styling**: Modern CSS (Glassmorphism, Dark Mode)
* **Engine**: Custom `CouplingEngine` & `EventTriggerEngine`
* **Validation**: Ajv (JSON Schema 2020-12)
* **Archivierung**: JSZip & Forensic-Utils (SHA-256 Manifeste)

---

## 📂 Projektstruktur

* `/src/forensics`: Normalisierungs-Logik und Asset-Hashing.
* `/tools`: CLI-Validators für CI und lokale Prüfung.
* `/schemas`: Formale Definitionen der Causal++ Spec.
* `/tests`: Forensic Regression Suites und Sample data.
* `coupling.js`: Das mathematische Herz der Simulation.
* `app.js`: Orchestrierung von UI, Editor-State und Video-Synchronisation.

---

## 🛠️ Installation & Start

1. Repository klonen.
2. `npm install` (wichtig für die Synchronisation des Lockfiles).
3. `index.html` über einen lokalen Live-Server öffnen.

---

**Sheratan System Policy (Sheratan):**
*Stability and correctness have priority over novelty. Behauptung, unwiderlegbar beweisen.*
