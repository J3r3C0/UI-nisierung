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
     * ✅ Causal Breakdown v1.1 Normalizer (Compat-Gateway)
     * Upgrades legacy/partial forensic data to the strict v1.1 Spec.
     */
    normalizeBreakdown(breakdown) {
        const tNow = typeof breakdown?.t === "number" ? breakdown.t : null;

        const DEFAULT_SEVERITY = {
            MAX_SKEW_EXCEEDED: "warn",
            NEGATIVE_TIME_JUMP_SEEK: "info",
            MISSING_SOURCE_METRIC: "warn",
            VALIDATION_REJECTED: "error",
            MODE_KIND_MISMATCH: "error",
            SUPPRESSED_BY_REPLACE: "info",
            UNKNOWN: "warn"
        };

        function mapReason(raw) {
            const s = String(raw || "").toUpperCase();
            if (s.includes("SKEW")) return "MAX_SKEW_EXCEEDED";
            if (s.includes("REPLACE") || s.includes("SUPPRESS")) return "SUPPRESSED_BY_REPLACE";
            if (s.includes("VALIDATION") || s.includes("SCHEMA")) return "VALIDATION_REJECTED";
            if (s.includes("MISSING") || s.includes("NAN")) return "MISSING_SOURCE_METRIC";
            if (s.includes("WINDOW") || s.includes("HOLD")) return "OUTSIDE_HOLD_WINDOW";
            if (s.includes("SEEK") || s.includes("JUMP")) return "NEGATIVE_TIME_JUMP_SEEK";
            return "UNKNOWN";
        }

        const blocked = Array.isArray(breakdown?.blocked) ? breakdown.blocked : [];
        const normalized = blocked.map((item) => {
            // Handle legacy string items
            if (typeof item === 'string') {
                const parts = item.split(':');
                return {
                    edge_id: parts[0]?.trim() || "unknown",
                    reason: "UNKNOWN",
                    severity: "info",
                    ts_ms: tNow,
                    message: item
                };
            }

            const reason = mapReason(item?.reason);
            const severity = item?.severity || DEFAULT_SEVERITY[reason] || "warn";

            return {
                edge_id: String(item?.edge_id ?? "unknown"),
                target_id: item?.target_id || item?.to || null,
                src_id: item?.src_id || null,
                reason: reason,
                severity: severity,
                ts_ms: item.ts_ms ?? tNow,
                fired_at_ms: item.fired_at_ms ?? item.t_trigger ?? null,
                effect_at_ms: item.effect_at_ms ?? item.t_effective ?? null,
                delay_ms: item.delay_ms ?? ((item.t_effective && item.t_trigger) ? (item.t_effective - item.t_trigger) : null),
                max_skew_ms: item.max_skew_ms ?? null,
                skew_ms: item.skew_ms ?? (item.skew_ms === undefined ? null : item.skew_ms),
                gate_source: item.gate_source ?? "unknown",
                message: item.message || (item.note ?? ""),
                window: item.window ? {
                    start: item.window.start ?? null,
                    end: item.window.end ?? null,
                    now: item.window.now ?? tNow
                } : null,
                preview: item.preview ? {
                    mode: item.preview.mode ?? (item.layer || null),
                    kind: item.preview.kind ?? (item.impact?.kind || null),
                    priority: item.preview.priority ?? null,
                    weight: item.preview.weight ?? (item.impact?.weight || null),
                    gain: item.preview.gain ?? (item.impact?.gain || null),
                    src: item.preview.src ?? (item.src?.value || null),
                    would_add: item.preview.would_add ?? null,
                    would_factor: item.preview.would_factor ?? null
                } : null
            };
        });

        const result = { ...breakdown, blocked: normalized };
        if (!result.breakdown_version) result.breakdown_version = "1.1";
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
                                edge_id: edge.id,
                                target_id: edge.to,
                                src_id: edge.from,
                                reason: "MAX_SKEW_EXCEEDED",
                                severity: "warn",
                                ts_ms: tNowMs,
                                fired_at_ms: ev.tMs,
                                effect_at_ms: tEffective,
                                delay_ms: delay,
                                max_skew_ms: maxSkew,
                                skew_ms: skew,
                                gate_source: edge.gate?.max_skew_ms ? "edge" : (edge.alignment?.max_skew_ms ? "alignment" : "defaults"),
                                message: `Skew ${Math.round(skew)}ms exceeds limit ${maxSkew}ms.`,
                                window: { start: tEffective, end: tEnd, now: tNowMs },
                                preview: {
                                    mode: layer,
                                    kind: edge.impact?.function || "add",
                                    gain: edge.impact?.gain ?? 1.0,
                                    weight: edge.impact?.weight ?? 1.0,
                                    src: nakedImpact / (edge.impact?.gain || 1.0),
                                    would_add: (layer === "blend" && (edge.impact?.function === "add" || !edge.impact?.function)) ? nakedImpact : null,
                                    would_factor: (layer === "blend" && edge.impact?.function === "mul") ? (1 + nakedImpact) : null
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
            const blocked = blockedImpacts.filter(i => i.target_id === toId);
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
                        target_id: toId,
                        reason: "SUPPRESSED_BY_REPLACE",
                        severity: "info",
                        ts_ms: tNowMs,
                        fired_at_ms: bi.tTrigger,
                        effect_at_ms: bi.tEffective,
                        message: `Blend suppressed because replace winner ${winner.id} is active.`,
                        preview: { mode: "blend", kind: bi.kind, weight: bi.weight, candidate: bi.value }
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
