/**
 * coupling-validator.js
 * Causal++ Spec v1 Compliant Validator
 */

const CouplingValidator = {
    validate(graph) {
        const errors = [];
        if (!graph.meta || !graph.meta.id) errors.push("Missing meta.id");
        if (!Array.isArray(graph.nodes)) errors.push("Missing nodes array");
        if (!Array.isArray(graph.edges)) errors.push("Missing edges array");

        const nodeIds = new Set(graph.nodes.map(n => n.value_id));

        graph.edges.forEach(edge => {
            if (!nodeIds.has(edge.from)) errors.push(`Edge ${edge.id}: Source node ${edge.from} not in nodes list`);
            if (!nodeIds.has(edge.to)) errors.push(`Edge ${edge.id}: Target node ${edge.to} not in nodes list`);

            if (edge.type === "event" && !edge.trigger) {
                errors.push(`Edge ${edge.id}: Event type requires a trigger`);
            }

            // ✅ Causal++ Spec Rule: kind="set" is forbidden in blend mode
            const mode = edge.impact?.mode || graph.meta?.defaults?.impact_mode || "blend";
            const kind = edge.impact?.function || "add";
            if (mode === "blend" && kind === "set") {
                errors.push(`Edge ${edge.id}: Causal++ Violation - 'set' function is forbidden in 'blend' mode`);
            }
        });

        return {
            ok: errors.length === 0,
            errors
        };
    }
};
