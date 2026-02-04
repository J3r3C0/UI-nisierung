/**
 * coupling.js
 * Causal++ Spec v1.1 Engine Implementation.
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

    /**
     * ✅ Causal Breakdown v1.1 Normalizer
     * Ensures old/partial forensic data matches the v1.1 spec.
     */
    normalizeBreakdown(breakdown) {
        const tNow = typeof breakdown?.t === "number" ? breakdown.t : null;
        const DEFAULT_SEVERITY = {
            MAX_SKEW_EXCEEDED: "warn",
            SOURCE_MISSING: "warn",
            VALIDATION_ERROR: "error",
            SUPPRESSED_BY_REPLACE: "info",
            OUT_OF_WINDOW: "info",
            UNKNOWN: "warn",
        };

        function mapReason(raw) {
            const s = String(raw || "").toLowerCase();
            if (s.includes("skew")) return "MAX_SKEW_EXCEEDED";
            if (s.includes("replace") || s.includes("suppress")) return "SUPPRESSED_BY_REPLACE";
            if (s.includes("schema") || s.includes("validation")) return "VALIDATION_ERROR";
            if (s.includes("missing") || s.includes("nan")) return "SOURCE_MISSING";
            if (s.includes("window") || s.includes("hold")) return "OUT_OF_WINDOW";
            return "UNKNOWN";
        }

        function inferLayer(item) {
            if (item?.layer === "replace" || item?.layer === "blend") return item.layer;
            if (item?.impact?.mode === "replace") return "replace";
            if (mapReason(item?.reason) === "SUPPRESSED_BY_REPLACE") return "blend";
            return "blend";
        }

        const blocked = Array.isArray(breakdown?.blocked) ? breakdown.blocked : [];
        const normalized = blocked.map((item) => {
            const reason = mapReason(item?.reason);
            const severity = item?.severity || DEFAULT_SEVERITY[reason] || "warn";
            const layer = inferLayer(item);
            return {
                edge_id: String(item?.edge_id ?? "unknown"),
                layer,
                reason,
                severity,
                t_trigger: item?.t_trigger ?? null,
                t_effective: item?.t_effective ?? null,
                skew_ms: item?.skew_ms ?? null,
                max_skew_ms: item?.max_skew_ms ?? null,
                gate_source: item?.gate_source ?? "unknown",
                window: {
                    start: item?.window?.start ?? null,
                    end: item?.window?.end ?? null,
                    now: item?.window?.now ?? tNow
                },
                impact: item?.impact ?? (item?.edge_id ? { mode: layer, kind: null, gain: null, weight: null } : null),
                src: item?.src ?? null,
                preview: item?.preview ?? null,
                note: item?.note ?? ""
            };
        });

        const result = { ...breakdown, blocked: normalized };
        if (!result.schema_version) result.schema_version = "causal_breakdown_v1.1";
        return result;
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

                if (ev.tMs <= tNowMs) {
                    const maxSkew = edge.gate?.max_skew_ms ?? edge.alignment?.max_skew_ms ?? globalMaxSkew;
                    const skew = Math.abs(tEffective - ev.tMs);
                    const passesGate = skew <= maxSkew && tEffective <= tNowMs + maxSkew;

                    if (tNowMs >= tEffective && tNowMs <= tEnd) {
                        const nakedImpact = this.computeEdgeImpact(valuesById, edge, tNowMs);
                        const layer = (edge.impact?.mode || globalMode) === "replace" ? "replace" : "blend";

                        if (passesGate) {
                            activeImpacts.push({
                                to: edge.to,
                                mode: edge.impact?.mode || globalMode,
                                kind: edge.impact?.function || "add",
                                value: nakedImpact,
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
                                layer: layer,
                                reason: "MAX_SKEW_EXCEEDED",
                                severity: "warn",
                                t_trigger: ev.tMs,
                                t_effective: tEffective,
                                skew_ms: skew,
                                max_skew_ms: maxSkew,
                                gate_source: edge.gate?.max_skew_ms ? "edge.gate" : (edge.alignment?.max_skew_ms ? "edge.alignment" : "defaults"),
                                window: { start: tEffective, end: tEnd, now: tNowMs },
                                impact: {
                                    mode: layer,
                                    kind: edge.impact?.function || "add",
                                    gain: edge.impact?.gain ?? 1.0,
                                    weight: edge.impact?.weight ?? 1.0
                                },
                                src: { metric_id: edge.from, value: nakedImpact / (edge.impact?.gain || 1.0) },
                                preview: {
                                    would_apply: true,
                                    would_add: (layer === "blend" && (edge.impact?.function === "add" || !edge.impact?.function)) ? nakedImpact : null,
                                    would_factor: (layer === "blend" && edge.impact?.function === "mul") ? (1 + nakedImpact) : null,
                                    would_value: (layer === "replace" && edge.impact?.function === "set") ? nakedImpact : null
                                }
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

            const rawBreakdown = {
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

            // Sorting
            impacts.sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));

            // Replace Resolution
            const replaceWinnerIdx = impacts.findIndex(i => i.mode === "replace");
            if (replaceWinnerIdx !== -1) {
                const winner = impacts[replaceWinnerIdx];
                rawBreakdown.replace.active = true;
                rawBreakdown.replace.winner = {
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

                rawBreakdown.after_replace = val;
                const edgeClamp = winner.clamp;
                const finalMin = edgeClamp ? edgeClamp[0] : range.min;
                const finalMax = edgeClamp ? edgeClamp[1] : range.max;
                rawBreakdown.final = Math.max(finalMin, Math.min(finalMax, val));

                rawBreakdown.blend.suppressed_by_replace = true;
                impacts.filter(i => i.mode === "blend").forEach(bi => {
                    rawBreakdown.blocked.push({
                        edge_id: bi.id,
                        layer: "blend",
                        reason: "SUPPRESSED_BY_REPLACE",
                        severity: "info",
                        t_trigger: bi.tTrigger,
                        t_effective: bi.tEffective,
                        skew_ms: bi.skew,
                        max_skew_ms: null,
                        gate_source: "logic",
                        window: { start: bi.tEffective, end: bi.tEnd, now: tNowMs },
                        impact: { mode: "blend", kind: bi.kind, gain: null, weight: bi.weight },
                        preview: { would_apply: true, would_add: bi.kind === "add" ? bi.value : null, would_factor: bi.kind === "mul" ? (1 + bi.value) : null }
                    });
                });
            } else {
                // Blend Resolution
                let deltaAdd = 0;
                let mulFactor = 1.0;
                const totalWeight = impacts.reduce((acc, i) => acc + i.weight, 0);

                impacts.forEach(i => {
                    const edgeIdx = (graph.edges || []).find(e => e.id === i.id);
                    const gain = edgeIdx?.impact?.gain || 1.0;
                    const w = rawBreakdown.blend.normalize_weights ? (i.weight / totalWeight) : i.weight;
                    const contribution = i.value * w;

                    if (i.kind === "add" || i.kind === "linear") {
                        deltaAdd += contribution;
                        rawBreakdown.blend.add_terms.push({
                            edge_id: i.id, src: i.value / gain, gain: gain, weight: i.weight, contribution: contribution
                        });
                    } else if (i.kind === "mul") {
                        const factor = (1 + contribution);
                        mulFactor *= factor;
                        rawBreakdown.blend.mul_terms.push({
                            edge_id: i.id, src: i.value / gain, gain: gain, weight: i.weight, factor: factor
                        });
                    }
                });

                rawBreakdown.blend.delta_add = deltaAdd;
                rawBreakdown.blend.delta_mul = mulFactor;
                let blended = (baseValue + deltaAdd) * mulFactor;
                rawBreakdown.after_blend = blended;
                rawBreakdown.final = Math.max(range.min, Math.min(range.max, blended));
            }

            const normalized = this.normalizeBreakdown(rawBreakdown);
            values[toId] = normalized.final;
            breakdowns[toId] = normalized;
        });

        return { values, breakdowns };
    }
};
