# Forensic UI · Guide

The Causal Inspector is designed for deep auditability of any metric point in time.

## 1. Opening the Inspector
Click on any **Timeline Item** (top) or select a metric in the **Analysis Sidebar** (left). The drawer will appear on the right.

## 2. Key Components

### A. Value Pipeline
Visualizes the deterministic transformation sequence:
- **Base**: The value from the data series/PRNG at time `t`.
- **Replace**: If active, shows the value *after* the priority winner takes over.
- **Blend**: Shows the modulated value after `add` and `mul` terms.
- **Final**: The value rendered in the graphs.

### B. Winner & Candidates
- If `Replace` is active, the **Winner** card identifies the edge ID and its priority.
- **Skew** and **Window** are shown to prove the impact is logically valid.

### C. Terms & Factors
- **ADD Contributions**: Shows linear shifts.
- **MUL Contributions**: Shows relative factors (e.g., `x1.10` for a 10% increase).
- **Inference**: Click info badges to see normalization status.

### D. Blocked Impact Filters
Use the filter chips (`All`, `Error`, `Warn`, `Info`) to find why a specific causal edge isn't active:
- **Red (Error)**: Validation failed.
- **Orange (Warn)**: Temporal skew too high.
- **Cyan (Info)**: Suppressed by a `Replace` impact.

### Causal Timeline Export (ZIP)
The inspector provides a **"Export Snapshot (ZIP)"** feature that generates a point-in-time audit bundle. This ZIP contains:
- `metadata.json`: Contextual info (timestamp, target metric, app version).
- `coupling-graph.json`: The layout and logic rules active during the snapshot.
- `breakdown.json`: The v1.1 Causal Breakdown for the inspected metric.
- `state.json`: A mapping of all metrics to their exact values at that timestamp.

This bundle is ideal for offline auditing, regression testing, and bug reporting.

## 3. Advanced Tools
- **Freeze Frame**: Pauses the forensic view on the selected `t`. Useful for investigating spikes while the video plays.
- **Copy JSON**: Dumps the raw forensic payload (`causal_breakdown_v1.1`) for bug reports or data science analysis.
