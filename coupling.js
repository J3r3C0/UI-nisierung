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
        return sourceVal * gain;
    },

    applyCouplingGraph(valuesById, graph, tNowMs, triggerActiveEdgeIds, triggerRuntime) {
        const values = {};
        const breakdowns = {};
        const activeImpacts = [];
        const blockedImpacts = [];
        const edgesById = {};
        (graph.edges || []).forEach(e => edgesById[e.id] = e);

        const globalMaxSkew = graph.meta?.defaults?.max_skew_ms ?? 250;
        const globalMode = graph.meta?.defaults?.impact_mode || "blend";

        // 1. Gather Candidate & Blocked Impacts
        if (triggerRuntime && triggerRuntime.fired) {
            triggerRuntime.fired.forEach(ev => {
                const edge = edgesById[ev.edgeId];
                if (!edge || edge.type !== "event") return;

                const trig = edge.trigger || {};
                const delay = trig.delay_ms || 0;
                const hold = trig.hold_ms || 0;

                const tEffective = ev.tMs + delay;
                const tEnd = tEffective + hold;

                // Only consider if we are in the playback window for this fire event
                // and it's not a future event (though seek-reset handles most of this)
                if (ev.tMs <= tNowMs) {
                    const maxSkew = edge.gate?.max_skew_ms ?? edge.alignment?.max_skew_ms ?? globalMaxSkew;
                    const skew = Math.abs(tEffective - ev.tMs);
                    const passesGate = skew <= maxSkew && tEffective <= tNowMs + maxSkew;

                    if (tNowMs >= tEffective && tNowMs <= tEnd) {
                        if (passesGate) {
                            activeImpacts.push({
                                to: edge.to,
                                mode: edge.impact?.mode || globalMode,
                                kind: edge.impact?.function || "add",
                                value: this.computeEdgeImpact(valuesById, edge, tNowMs),
                                weight: edge.impact?.weight ?? 1.0,
                                priority: edge.priority || 0,
                                id: edge.id,
                                clamp: edge.impact?.clamp || null,
                                tTrigger: ev.tMs,
                                tEffective: tEffective,
                                tEnd: tEnd,
                                skew: skew
                            });
                        } else {
                            blockedImpacts.push({
                                to: edge.to,
                                edge_id: edge.id,
                                reason: "MAX_SKEW_EXCEEDED",
                                skew_ms: skew,
                                max_skew_ms: maxSkew,
                                source: edge.gate?.max_skew_ms ? "edge.gate" : (edge.alignment?.max_skew_ms ? "edge.alignment" : "defaults")
                            });
                        }
                    }
                }
            });
        }

        // Add constant causal edges
        (graph.edges || []).forEach(edge => {
            if (edge.type === "causal" || edge.type === "soft_sync") {
                activeImpacts.push({
                    to: edge.to,
                    mode: "blend",
                    kind: edge.impact?.function || "add",
                    value: this.computeEdgeImpact(valuesById, edge, tNowMs),
                    weight: edge.impact?.weight ?? 1.0,
                    priority: edge.priority || 0,
                    id: edge.id,
                    clamp: edge.impact?.clamp || null,
                    tTrigger: tNowMs,
                    tEffective: tNowMs,
                    tEnd: Infinity,
                    skew: 0
                });
            }
        });

        // 2. Resolve Impacts per Target
        const targetNodes = new Set((graph.nodes || []).map(n => n.value_id));
        targetNodes.forEach(toId => {
            const impacts = activeImpacts.filter(i => i.to === toId);
            const blocked = blockedImpacts.filter(i => i.to === toId);
            const targetObj = valuesById[toId]?.obj;
            const baseValue = targetObj?.value.current || 0;
            const range = targetObj?.semantics?.range || { min: 0, max: 100 };

            const breakdown = {
                t: tNowMs,
                target: toId,
                base: baseValue,
                after_replace: null,
                after_blend: null,
                clamp: range,
                final: 0,
                replace: { active: false, winner: null, candidates: [] },
                blend: {
                    enabled: true,
                    suppressed_by_replace: false,
                    normalize_weights: graph.meta?.defaults?.blend_normalize || false,
                    delta_add: 0,
                    delta_mul: 1,
                    add_terms: [],
                    mul_terms: []
                },
                blocked: blocked
            };

            if (impacts.length === 0) {
                breakdown.final = Math.max(range.min, Math.min(range.max, baseValue));
                values[toId] = breakdown.final;
                breakdowns[toId] = breakdown;
                return;
            }

            // Sorting
            impacts.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));

            // Replace Resolution
            const replaceCandidates = impacts.filter(i => i.mode === "replace");
            breakdown.replace.candidates = replaceCandidates.map(c => ({
                edge_id: c.id,
                priority: c.priority,
                t_trigger: c.tTrigger,
                t_effective: c.tEffective,
                skew_ms: c.skew,
                passes_gate: true
            }));

            const replaceWinnerIdx = impacts.findIndex(i => i.mode === "replace");
            if (replaceWinnerIdx !== -1) {
                const winner = impacts[replaceWinnerIdx];
                breakdown.replace.active = true;
                breakdown.replace.winner = {
                    edge_id: winner.id,
                    priority: winner.priority,
                    t_trigger: winner.tTrigger,
                    t_effective: winner.tEffective,
                    skew_ms: winner.skew,
                    hold_start: winner.tEffective,
                    hold_end: winner.tEnd
                };

                let val = baseValue;
                if (winner.kind === "set") val = winner.value;
                else if (winner.kind === "mul") val = baseValue * winner.value;
                else val = baseValue + winner.value;

                breakdown.after_replace = val;

                // Final Clamp
                const edgeClamp = winner.clamp;
                const finalMin = edgeClamp ? edgeClamp[0] : range.min;
                const finalMax = edgeClamp ? edgeClamp[1] : range.max;
                breakdown.final = Math.max(finalMin, Math.min(finalMax, val));
                breakdown.blend.suppressed_by_replace = true;
            } else {
                // Blend Resolution
                let deltaAdd = 0;
                let mulFactor = 1.0;
                const totalWeight = impacts.reduce((acc, i) => acc + i.weight, 0);

                impacts.forEach(i => {
                    const w = breakdown.blend.normalize_weights ? (i.weight / totalWeight) : i.weight;
                    const contribution = i.value * w;

                    if (i.kind === "add" || i.kind === "linear") {
                        deltaAdd += contribution;
                        breakdown.blend.add_terms.push({
                            edge_id: i.id,
                            src: i.value / (edge.impact?.gain || 1.0), // reversed for UI src display
                            gain: i.gain, // Wait, gain wasn't in the object, I should add it
                            weight: i.weight,
                            contribution: contribution
                        });
                    } else if (i.kind === "mul") {
                        const factor = (1 + contribution);
                        mulFactor *= factor;
                        breakdown.blend.mul_terms.push({
                            edge_id: i.id,
                            src: 0, // placeholder
                            gain: 0,
                            weight: i.weight,
                            factor: factor
                        });
                    }
                });

                // Correction: let's re-gather impact info properly for the terms
                breakdown.blend.add_terms = [];
                breakdown.blend.mul_terms = [];
                impacts.forEach(i => {
                    const edge = edgesById[i.id];
                    const w = breakdown.blend.normalize_weights ? (i.weight / totalWeight) : i.weight;
                    const contribution = i.value * w;
                    const srcVal = i.value / (edge.impact?.gain || 1.0);

                    if (i.kind === "add" || i.kind === "linear") {
                        breakdown.blend.add_terms.push({
                            edge_id: i.id,
                            src: srcVal,
                            gain: edge.impact?.gain || 1.0,
                            weight: i.weight,
                            contribution: contribution
                        });
                    } else if (i.kind === "mul") {
                        breakdown.blend.mul_terms.push({
                            edge_id: i.id,
                            src: srcVal,
                            gain: edge.impact?.gain || 1.0,
                            weight: i.weight,
                            factor: (1 + contribution)
                        });
                    }
                });

                breakdown.blend.delta_add = deltaAdd;
                breakdown.blend.delta_mul = mulFactor;

                let blended = (baseValue + deltaAdd) * mulFactor;
                breakdown.after_blend = blended;
                breakdown.final = Math.max(range.min, Math.min(range.max, blended));
            }

            values[toId] = breakdown.final;
            breakdowns[toId] = breakdown;
        });

        return { values, breakdowns };
    }
};
