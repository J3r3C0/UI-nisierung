/**
 * event-triggers.js
 * Deterministic trigger detection for event edges.
 */

class TriggerRuntime {
    constructor() {
        this.lastSampleByValueId = new Map();
        this.activeUntilByEdgeId = new Map();

        // ✅ NEW: event fire history (audit-friendly)
        this.fired = []; // [{edgeId, tMs}]
        this.maxFired = 2000;
    }

    getLast(valueId) { return this.lastSampleByValueId.get(valueId) || null; }
    setLast(valueId, sample) { this.lastSampleByValueId.set(valueId, sample); }
    setHold(edgeId, untilMs) { this.activeUntilByEdgeId.set(edgeId, untilMs); }
    isHeld(edgeId, tNowMs) {
        const until = this.activeUntilByEdgeId.get(edgeId);
        return typeof until === "number" && tNowMs <= until;
    }

    // ✅ NEW: record event fire time
    logFire(edgeId, tMs) {
        this.fired.push({ edgeId, tMs });
        if (this.fired.length > this.maxFired) {
            this.fired.splice(0, this.fired.length - this.maxFired);
        }
    }

    // ✅ NEW: reset runtime state (used on seek/rewind)
    reset() {
        this.lastSampleByValueId.clear();
        this.activeUntilByEdgeId.clear();
        this.fired.length = 0;
    }
}

const EventTriggerEngine = {
    meanInWindow(series, t0, t1) {
        if (!series || series.length === 0) return null;
        let sum = 0, n = 0;
        for (const p of series) {
            if (p.t >= t0 && p.t <= t1) { sum += p.v; n += 1; }
        }
        return n === 0 ? null : sum / n;
    },

    isEdgeTriggered(valuesById, edge, tNowMs, runtime) {
        if (runtime.isHeld(edge.id, tNowMs)) return true;

        const trig = edge.trigger;
        if (!trig || !trig.kind) return false;

        const from = valuesById[edge.from];
        if (!from) return false;

        const vNow = CouplingEngine.sampleAt(from.series, tNowMs);
        if (vNow == null) return false;

        const last = runtime.getLast(edge.from);
        const vPrev = last ? last.v : null;

        let fired = false;

        switch (trig.kind) {
            case "threshold_crossing": {
                const thr = trig.threshold;
                const dir = trig.direction || "rising";
                if (typeof thr !== "number" || vPrev == null) break;
                if (dir === "rising" && vPrev < thr && vNow >= thr) fired = true;
                else if (dir === "falling" && vPrev >= thr && vNow < thr) fired = true;
                else if (dir === "both" && ((vPrev < thr && vNow >= thr) || (vPrev >= thr && vNow < thr))) fired = true;
                break;
            }
            case "spike": {
                const delta = trig.delta;
                if (typeof delta !== "number" || vPrev == null) break;
                if (Math.abs(vNow - vPrev) >= delta) fired = true;
                break;
            }
            case "window_mean_above": {
                const windowMs = trig.window_ms;
                const thr = trig.threshold;
                if (typeof windowMs !== "number" || typeof thr !== "number") break;
                const mean = this.meanInWindow(from.series, tNowMs - windowMs, tNowMs);
                if (mean != null && mean >= thr) fired = true;
                break;
            }
            case "scene_boundary": {
                const scene = trig.scene;
                if (scene && scene.mode === "timeline_marks") {
                    const marks = scene.marks_ms || [];
                    const eps = 30;
                    for (const m of marks) {
                        if (Math.abs(tNowMs - m) <= eps) { fired = true; break; }
                    }
                }
                break;
            }
        }

        runtime.setLast(edge.from, { t: tNowMs, v: vNow });

        if (fired) {
            // ✅ Log Fire
            runtime.logFire(edge.id, tNowMs);
            const hold = typeof trig.hold_ms === "number" ? trig.hold_ms : 0;
            if (hold > 0) runtime.setHold(edge.id, tNowMs + hold);
            return true;
        }
        return false;
    },

    computeTriggersAtTime(valuesById, graph, tNowMs, runtime) {
        const active = new Set();
        for (const edge of (graph.edges || [])) {
            if (edge.type === "event" && this.isEdgeTriggered(valuesById, edge, tNowMs, runtime)) {
                active.add(edge.id);
            }
        }
        return active;
    }
};
