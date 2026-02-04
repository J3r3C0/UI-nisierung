# Forensics Snapshot Bundles (Causal Timeline Export)

This document describes how to export, validate, and archive **Causal Snapshot Bundles** produced by the Causal Inspector.

A snapshot bundle is a **ZIP evidence pack** that lets an auditor reproduce and verify a causal state **offline** without running the live simulation.

---

## What is a Snapshot Bundle?

A snapshot bundle is a ZIP file named like:

`causal_snapshot_[metric]_t[time].zip`

It contains a standardized set of files:

- `metadata.json`  
  Audit context: timestamp, target metric, spec/breakdown versions, app/build identifiers, optional seed/prng info.

- `manifest.json`  
  Hash ledger for each file in the bundle (sha256 + byte size). This makes the bundle **tamper-evident**.

- `coupling-graph.json`  
  Full capture of the causal coupling graph active at export time.

- `breakdown.json`  
  The **v1.1 forensic breakdown** payload used by the UI panel (normalized, audit-ready).

- `state.json`  
  Snapshot of all metric values (or targeted subset) at the export time `t`.

---

## Exporting a Snapshot (UI)

1. Open the Causal Inspector (click any metric timeline).
2. Optional: enable **Freeze Frame** to lock inspection at the current timestamp.
3. Click **Export SNAPSHOT (ZIP)**.

The UI will download a ZIP evidence pack.

---

## Validating a Snapshot (CLI)

### Prerequisites

Install dependencies once:

```bash
npm ci
```

### Validate a snapshot ZIP

```bash
npm run validate:snapshot audit_exports/causal_snapshot_theta_t12500.zip -- --pretty
```

Expected output:

```
✅ VALID SNAPSHOT — bundle hashes + schemas OK
```

### Strict mode

Strict mode fails when **soft-policy warnings** are detected:

```bash
npm run validate:snapshot audit_exports/causal_snapshot_theta_t12500.zip -- --pretty --strict
```

Use strict mode in CI when you want to reject “technically valid but incomplete” evidence.

---

## Validating Breakdown JSON Alone

If you only want to validate `breakdown.json`:

```bash
npm run validate:breakdown tests/forensics/complex_regression_v1.1.json -- --pretty
```

---

## Bundle Integrity Model

Snapshot bundles are designed for **audit-grade integrity**:

### 1) Schema Verification

* `metadata.json` validates against `causal_snapshot_metadata_v1.0.schema.json`
* `manifest.json` validates against `causal_snapshot_manifest_v1.0.schema.json`
* `breakdown.json` validates against `causal_breakdown_v1.1.schema.json`

### 2) Hash Ledger (Tamper Evidence)

`manifest.json` lists **every file** in the ZIP with:

* `sha256` (hex)
* `bytes`

The validator re-hashes files from inside the ZIP and compares them to the manifest.

If any mismatch occurs, the snapshot is invalid.

---

## Soft Policy Rules (v1.1.1)

Soft policies are warnings that improve forensic completeness without breaking compatibility.

Examples:

* If `blocked.reason = MAX_SKEW_EXCEEDED` then `skew_ms` and `max_skew_ms` should be present.
* If `blocked.reason = SUPPRESSED_BY_REPLACE` then `message` should be present.

Soft policies are warnings by default, but can be elevated to errors with `--strict`.

---

## Recommended Archiving Strategy

### Folder layout

* `tests/forensics/`
  Regression samples committed to repo.

* `audit_exports/`
  Real-world evidence packs (may be large).

### Naming conventions

Use metric + timestamp + optional issue tag:

`causal_snapshot_theta_t12500_issue-342.zip`

### Version tags

Metadata should include at least:

* `app.version`
* `app.git_commit` or `build_id`
* `breakdown_version`
* `spec_version`

This makes snapshots comparable across releases.

---

## Regression Workflow (Recommended)

1. Generate a snapshot from the UI at a known scenario.
2. Save the ZIP under `tests/forensics/` (small) or `audit_exports/` (large).
3. CI automatically validates:

   * all JSON regression samples
   * all snapshot ZIPs (optional)

This prevents “forensic drift”.

---

## FAQ

### Why store both `state.json` and `breakdown.json`?

* `breakdown.json` explains the **decision** for one target metric.
* `state.json` gives the **global context** and enables cross-checks.

### Can we reproduce the entire timeline from a single snapshot?

A snapshot is a single point-in-time evidence pack. For full timeline reproduction you would archive multiple snapshots over time (or introduce a “timeline capture” mode later).

### Does this protect against all tampering?

It is **tamper-evident** inside your workflow: any edit breaks hashes. For stronger guarantees, combine with external signing (e.g., GPG, Sigstore) later.

---

## Next Phase Options

After snapshot export is stable, the natural next steps are:

* **Live-Editing for coupling-graph** (with validate-before-apply, undo/redo, diff export)
* **Snapshot signing** (Sigstore/GPG)
* **Timeline capture mode** (multiple snapshots, compressed)
