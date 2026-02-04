/**
 * coupling.js
 * Causal++ Spec v1 Engine Implementation.
 */

const CouplingEngine = {
    sampleAt(series, tMs) {
        if (!series || series.length === 0) return null;
        if (tMs <= series[0].t) return series[0].v;
        if (tMs >= series[series.length - 1].t) return series[series.length - 1].v;

        let low = 0, high = series.length - 1;
        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            if (series[mid].t === tMs) return series[mid].v;
            if (series[mid].t < tMs) low = mid + 1;
            else high = mid - 1;
        }

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
        // In Blend Spec v1, computeEdgeImpact returns the naked contribution (gain * src)
        return sourceVal * gain;
    },

    applyCouplingGraph(valuesById, graph, tNowMs, triggerActiveEdgeIds, triggerRuntime) {
        const result = {};
        const activeImpacts = [];
        const edgesById = {};
        (graph.edges || []).forEach(e => edgesById[e.id] = e);

        // 1. Gather Candidate Impacts
        if (triggerRuntime && triggerRuntime.fired) {
            const globalMaxSkew = graph.meta?.defaults?.max_skew_ms ?? 250;
            const globalMode = graph.meta?.defaults?.impact_mode || "blend";

            triggerRuntime.fired.forEach(ev => {
                const edge = edgesById[ev.edgeId];
                if (!edge || edge.type !== "event") return;

                const trig = edge.trigger || {};
                const delay = trig.delay_ms || 0;
                const hold = trig.hold_ms || 0;

                const tEffective = ev.tMs + delay;
                const tEnd = tEffective + hold;

                if (tNowMs >= tEffective && tNowMs <= tEnd) {
                    // ✅ Spec Rule: effective_max_skew precedence
                    const maxSkew = edge.gate?.max_skew_ms ?? edge.alignment?.max_skew_ms ?? globalMaxSkew;

                    // Gate check: skew and future leakage protection
                    if (Math.abs(tEffective - ev.tMs) <= maxSkew && tEffective <= tNowMs + maxSkew) {
                        activeImpacts.push({
                            to: edge.to,
                            mode: edge.impact?.mode || globalMode,
                            kind: edge.impact?.function || "add",
                            value: this.computeEdgeImpact(valuesById, edge, tNowMs),
                            weight: edge.impact?.weight ?? 1.0,
                            priority: edge.priority || 0,
                            id: edge.id,
                            clamp: edge.impact?.clamp || null
                        });
                    }
                }
            });
        }

        // Add constant causal edges to candidates
        (graph.edges || []).forEach(edge => {
            if (edge.type === "causal" || edge.type === "soft_sync") {
                activeImpacts.push({
                    to: edge.to,
                    mode: "blend", // baseline causal always modulates
                    kind: edge.impact?.function || "add",
                    value: this.computeEdgeImpact(valuesById, edge, tNowMs),
                    weight: edge.impact?.weight ?? 1.0,
                    priority: edge.priority || 0,
                    id: edge.id,
                    clamp: edge.impact?.clamp || null
                });
            }
        });

        // 2. Resolve Impacts per Target
        const targetNodes = new Set((graph.nodes || []).map(n => n.value_id));
        targetNodes.forEach(toId => {
            const impacts = activeImpacts.filter(i => i.to === toId);
            const targetObj = valuesById[toId]?.obj;
            const baseValue = targetObj?.value.current || 0;
            const range = targetObj?.semantics?.range || { min: 0, max: 100 };

            if (impacts.length === 0) {
                result[toId] = baseValue;
                return;
            }

            // ✅ Spec Rule: Deterministic Sort (priority desc, id asc)
            impacts.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));

            // ✅ Spec Rule: Replace Wins over Blend
            const replaceWinner = impacts.find(i => i.mode === "replace");
            if (replaceWinner) {
                let val = baseValue;
                if (replaceWinner.kind === "set") val = replaceWinner.value;
                else if (replaceWinner.kind === "mul") val = baseValue * replaceWinner.value;
                else val = baseValue + replaceWinner.value;

                // Clamp Replace result
                const edgeClamp = replaceWinner.clamp;
                const finalMin = edgeClamp ? edgeClamp[0] : range.min;
                const finalMax = edgeClamp ? edgeClamp[1] : range.max;
                result[toId] = Math.max(finalMin, Math.min(finalMax, val));
            } else {
                // ✅ Spec Rule: Blend Resolution
                let deltaAdd = 0;
                let mulFactor = 1.0;

                const blendNormalize = graph.meta?.defaults?.blend_normalize || false;
                const totalWeight = impacts.reduce((acc, i) => acc + i.weight, 0);

                impacts.forEach(i => {
                    const w = blendNormalize ? (i.weight / totalWeight) : i.weight;

                    if (i.kind === "add" || i.kind === "linear") {
                        deltaAdd += (i.value * w);
                    } else if (i.kind === "mul") {
                        // ✅ Spec Rule: Relative multiplication (1 + x)
                        mulFactor *= (1 + i.value * w);
                    }
                });

                // ✅ Spec Rule: ADD before MUL
                let blended = (baseValue + deltaAdd) * mulFactor;

                // Final Clamp
                result[toId] = Math.max(range.min, Math.min(range.max, blended));
            }
        });

        return result;
    }
};
