/**
 * coupling.js
 * Causal++ Enhanced Engine.
 */

const CouplingEngine = {
    sampleAt(series, tMs) {
        if (!series || series.length === 0) return null;
        if (tMs <= series[0].t) return series[0].v;
        if (tMs >= series[series.length - 1].t) return series[series.length - 1].v;

        // Binary search for efficiency
        let low = 0, high = series.length - 1;
        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (series[mid].t === tMs) return series[mid].v;
            if (series[mid].t < tMs) low = mid + 1;
            else high = mid - 1;
        }

        // Interpolate
        const p1 = series[high];
        const p2 = series[low];
        const ratio = (tMs - p1.t) / (p2.t - p1.t);
        return p1.v + ratio * (p2.v - p1.v);
    },

    computeEdgeImpact(valuesById, edge, tNowMs) {
        const from = valuesById[edge.from];
        if (!from) return 0;

        const offsetMs = edge.alignment?.offset_ms || 0;
        const sourceVal = this.sampleAt(from.series, tNowMs - offsetMs);
        if (sourceVal === null) return 0;

        const gain = edge.impact?.gain ?? 1.0;
        let out = sourceVal * gain;

        // Custom impact functions
        const fn = edge.impact?.function || "linear";
        if (fn === "add") out = sourceVal * gain;
        else if (fn === "mul") out = sourceVal * gain;

        return out;
    },

    applyCouplingGraph(valuesById, graph, tNowMs, triggerActiveEdgeIds, triggerRuntime) {
        const result = {};
        const incoming = {};

        // 1. Identify all active impacts (including Causal++ logic)
        const activeImpacts = []; // { to, mode, kind, value, weight, priority, id }

        // Map edges for quick lookup
        const edgesById = {};
        (graph.edges || []).forEach(e => edgesById[e.id] = e);

        // Process fired events from runtime
        if (triggerRuntime && triggerRuntime.fired) {
            const globalMaxSkew = graph.meta?.defaults?.max_skew_ms ?? 250;

            triggerRuntime.fired.forEach(ev => {
                const edge = edgesById[ev.edgeId];
                if (!edge || edge.type !== "event") return;

                const trig = edge.trigger || {};
                const delay = trig.delay_ms || 0;
                const hold = trig.hold_ms || 0;

                const tEffective = ev.tMs + delay;
                const tEnd = tEffective + hold;

                // Gate: is it currently active and within window?
                if (tNowMs >= tEffective && tNowMs <= tEnd) {
                    const maxSkew = edge.gate?.max_skew_ms ?? globalMaxSkew;

                    // Gate check: skew and future leakage
                    if (Math.abs(tEffective - ev.tMs) <= maxSkew && tEffective <= tNowMs + maxSkew) {
                        activeImpacts.push({
                            to: edge.to,
                            mode: edge.impact?.mode || graph.meta?.defaults?.impact_mode || "blend",
                            kind: edge.impact?.function || "add",
                            value: this.computeEdgeImpact(valuesById, edge, tNowMs),
                            weight: edge.impact?.weight ?? 1.0,
                            priority: edge.priority || 0,
                            id: edge.id,
                            clamp: edge.impact?.clamp || [0, 100]
                        });
                    }
                }
            });
        }

        // Process constant causal/sync edges (baseline coupling)
        (graph.edges || []).forEach(edge => {
            if (edge.type === "causal" || edge.type === "soft_sync" || edge.type === "hard_sync") {
                activeImpacts.push({
                    to: edge.to,
                    mode: "blend", // baseline causal edges always blend in this model
                    kind: edge.impact?.function || "linear",
                    value: this.computeEdgeImpact(valuesById, edge, tNowMs),
                    weight: edge.impact?.weight ?? 1.0,
                    priority: edge.priority || 0,
                    id: edge.id,
                    clamp: edge.impact?.clamp || [0, 100]
                });
            }
        });

        // 2. Resolve Impacts for each target node
        const targetNodes = new Set((graph.nodes || []).map(n => n.value_id));
        targetNodes.forEach(toId => {
            const impacts = activeImpacts.filter(i => i.to === toId);
            const baseValue = valuesById[toId]?.obj.value.current || 0;

            if (impacts.length === 0) {
                result[toId] = baseValue;
                return;
            }

            // Priority Arbitration for Replace
            const replaceImpacts = impacts.filter(i => i.mode === "replace");
            if (replaceImpacts.length > 0) {
                // Winner: 1) Priority 2) Latest ID (lexical tie break)
                replaceImpacts.sort((a, b) => (b.priority - a.priority) || b.id.localeCompare(a.id));
                const winner = replaceImpacts[0];

                if (winner.kind === "set") result[toId] = winner.value;
                else if (winner.kind === "mul") result[toId] = baseValue * winner.value;
                else result[toId] = baseValue + winner.value;

                // Clamp replace result
                result[toId] = Math.max(winner.clamp[0], Math.min(winner.clamp[1], result[toId]));
            } else {
                // Blend mode: Sum weight-based additions
                let sumAdd = 0;
                let mulFactor = 1.0;
                let clampRange = [0, 100];

                impacts.forEach(i => {
                    if (i.kind === "add" || i.kind === "linear") sumAdd += (i.value * i.weight);
                    else if (i.kind === "mul") mulFactor *= (1 + i.value * i.weight);
                    clampRange = i.clamp; // taking the last one defined or default
                });

                let blended = (baseValue + sumAdd) * mulFactor;
                result[toId] = Math.max(clampRange[0], Math.min(clampRange[1], blended));
            }
        });

        return result;
    }
};
