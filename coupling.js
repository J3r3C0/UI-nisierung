/**
 * coupling.js
 * Deterministic coupling engine (v1). Master clock defaults to video-time (ms).
 * Browser-compatible version.
 */

const CouplingEngine = {
    clamp(x, mn, mx) { return Math.max(mn, Math.min(mx, x)); },
    clamp01(x) { return this.clamp(x, 0, 1); },
    lerp(a, b, t) { return a + (b - a) * t; },

    sampleAt(series, tMs) {
        if (!series || series.length === 0) return null;
        const first = series[0];
        const last = series[series.length - 1];
        if (tMs <= first.t) return first.v;
        if (tMs >= last.t) return last.v;
        for (let i = 0; i < series.length - 1; i++) {
            const a = series[i], b = series[i + 1];
            if (tMs >= a.t && tMs <= b.t) {
                const denom = (b.t - a.t);
                if (denom <= 0) return a.v;
                return this.lerp(a.v, b.v, (tMs - a.t) / denom);
            }
        }
        return null;
    },

    aggregate(base, impacts, mode) {
        if (!impacts || impacts.length === 0) return base;
        if (mode === "max") return Math.max(base, ...impacts);
        if (mode === "mean") return (base + impacts.reduce((s, x) => s + x, 0)) / (impacts.length + 1);
        return this.clamp(base + impacts.reduce((s, x) => s + x, 0), 0, 100);
    },

    passesGuardrails(fromValueObj, edge) {
        if (!edge.guardrails?.enabled) return true;
        const conf = fromValueObj?.quality?.confidence;
        return typeof conf === "number" && conf >= edge.guardrails.min_confidence;
    },

    computeEdgeImpact(valuesById, edge, tNowMs) {
        const from = valuesById[edge.from];
        if (!from || !this.passesGuardrails(from.obj, edge)) return null;

        const tSource = tNowMs - (edge.alignment?.offset_ms || 0);
        const a = this.sampleAt(from.series, tSource);
        if (a == null) return null;

        const gain = edge.impact?.gain ?? 1.0;
        let out = a * gain;

        if (Array.isArray(edge.impact?.clamp)) {
            out = this.clamp(out, edge.impact.clamp[0], edge.impact.clamp[1]);
        }
        return out;
    },

    applyCouplingGraph(valuesById, graph, tNowMs, triggerActiveEdgeIds = null) {
        const base = {};
        for (const id of Object.keys(valuesById)) {
            base[id] = this.sampleAt(valuesById[id].series, tNowMs);
        }

        const incoming = {};
        for (const edge of (graph.edges || [])) {
            if (edge.type === "event") {
                if (!triggerActiveEdgeIds || !triggerActiveEdgeIds.has(edge.id)) continue;
            }

            const impact = this.computeEdgeImpact(valuesById, edge, tNowMs);
            if (impact == null) continue;

            if (!incoming[edge.to]) incoming[edge.to] = [];
            incoming[edge.to].push({ impact, edge });
        }

        const out = { ...base };
        for (const [toId, arr] of Object.entries(incoming)) {
            const impacts = arr.map(x => x.impact);
            const mode = arr[0]?.edge?.aggregation?.when_multiple_edges || "sum_then_clamp";
            out[toId] = this.aggregate(out[toId] || 0, impacts, mode);
        }
        return out;
    }
};
