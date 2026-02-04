/**
 * coupling-validator.js
 * Browser-compatible simplified validator for CouplingGraph.
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
            if (edge.type === "event" && !edge.trigger) errors.push(`Edge ${edge.id}: Event type requires a trigger`);
        });

        return {
            ok: errors.length === 0,
            errors
        };
    }
};
