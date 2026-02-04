document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const video = document.getElementById('main-video');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playIcon = document.getElementById('play-icon');
    const videoOverlay = document.getElementById('video-overlay');
    const modal = document.getElementById('add-metric-modal');
    const addBtn = document.querySelector('.btn-add-metric');
    const closeBtn = document.getElementById('close-modal');
    const addForm = document.getElementById('add-metric-form');
    const leftMetricList = document.getElementById('metric-list-left');
    const rightMetricList = document.getElementById('active-metrics-list');
    const graphPath = document.getElementById('graph-path');
    const inspectorPanel = document.getElementById('causal-inspector');

    // Runtime state
    const triggerRuntime = new TriggerRuntime();
    let couplingGraph = { meta: {}, nodes: [], edges: [] }; // The current "Applied" Graph

    const editorState = {
        enabled: false,           // UI Toggle
        dirty: false,             // Draft != Master
        draftGraph: null,         // Cloned instance for editing
        validation: { ok: true, errors: [] },
        previewBreakdowns: {}     // Computed from draftGraph
    };

    let lastRenderTimeMs = 0;
    let inspectingMetricId = null;
    let isFrozen = false;
    let currentBreakdowns = {};   // Active breakdowns (Simulation)
    let currentBlockedFilter = 'all';

    try {
        const response = await fetch('coupling-graph.json');
        couplingGraph = await response.json();

        // ✅ Contract Enforcement
        let res = CouplingValidator.validate(couplingGraph);
        if (!res.ok) {
            console.warn("CouplingGraph invalid, trying sample fallback", res.errors);
            const fallback = await fetch('coupling-graph.sample.json').then(r => r.json());
            const res2 = CouplingValidator.validate(fallback);
            couplingGraph = res2.ok ? fallback : { meta: { id: "hard-fallback" }, nodes: [], edges: [] };
        }
    } catch (e) {
        console.warn("Graph load failed, using hard fallback", e);
        couplingGraph = { meta: { id: "hard-fallback" }, nodes: [], edges: [] };
    }

    // ✅ Deterministic PRNG Helpers
    function hashStringToSeed(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
        return h >>> 0;
    }
    function mulberry32(seed) {
        return function () {
            let t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function slugifyId(label) {
        return label.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_.-]/g, "").slice(0, 64);
    }

    // Config for timelines
    let timelineData = [
        {
            ...ValueValidator.createSkeleton('delta_resonance', 'Delta Resonance', 'perception.core'),
            semantics: {
                domain: "perception.core", unit: "%", scale: "percent_0_100", range: { min: 0, max: 100 },
                meaning: "Resonanz zwischen Input-Signal und Core-State"
            },
            provenance: { source_type: "derived", source_ref: "soul_engine_v1.2", method: "cosine_similarity" },
            quality: { confidence: 0.98, latency_ms: 12, stability: 0.64 },
            value: { kind: "scalar", current: 75, series: [] }
        },
        {
            ...ValueValidator.createSkeleton('sigma_movement', 'Sigma Movement', 'perception.spatial'),
            provenance: { source_type: "observed", source_ref: "camera_front_tracking", method: "optical_flow" },
            quality: { confidence: 0.85, latency_ms: 0, stability: 0.9 },
            value: { kind: "scalar", current: 45, series: [] }
        },
        {
            ...ValueValidator.createSkeleton('theta_intent', 'Theta Intent', 'perception.agent'),
            provenance: { source_type: "inferred", source_ref: "intent_core_v4", method: "probabilistic" },
            quality: { confidence: 0.92, latency_ms: 45, stability: 0.8 },
            value: { kind: "scalar", current: 90, series: [] }
        }
    ];

    let selectedMetricName = timelineData[0].label;
    const durationMs = 195000;

    // Seed history
    timelineData.forEach(d => {
        const rnd = mulberry32(hashStringToSeed(d.id));
        for (let i = 0; i <= 200; i++) {
            const t = (i / 200) * durationMs;
            const noise = rnd() * 10;
            const v = 30 + Math.sin(i * 0.1) * 20 + noise;
            d.value.series.push({ t_ms: Math.floor(t), v: v });
        }
    });

    function renderTimelines(viewValues) {
        const timelinesContainer = document.getElementById('timelines');
        timelinesContainer.innerHTML = '';
        timelineData.forEach((data) => {
            const val = viewValues[data.id] ?? data.value.current;
            const item = document.createElement('div');
            item.className = 'timeline-item' + (data.label === selectedMetricName ? ' active' : '');
            item.onclick = () => {
                selectedMetricName = data.label;
                inspectingMetricId = data.id;
                inspectorPanel.classList.add('active');
                renderAll();
            };
            item.innerHTML = `
                <span class="timeline-label">${data.label}</span>
                <div class="timeline-value-container">
                    <div class="timeline-bar" style="height: ${val}%"></div>
                </div>
            `;
            timelinesContainer.appendChild(item);
        });
    }

    function renderAnalysisTags() {
        leftMetricList.innerHTML = `
            <div class="selection-notice">Select a timeline above to analyze</div>
            <div class="active-selection-label">Current: <span>${selectedMetricName}</span></div>
        `;
    }

    function renderActiveTriggers(activeEdgeIds) {
        const container = document.querySelector('.active-selection-label');
        let list = container.querySelector('.trigger-list');
        if (!list) {
            list = document.createElement('div');
            list.className = 'trigger-list';
            container.appendChild(list);
        }
        list.innerHTML = '';
        activeEdgeIds.forEach(id => {
            const edge = couplingGraph.edges.find(e => e.id === id);
            if (edge) {
                const span = document.createElement('span');
                span.className = 'trigger-indicator';
                span.textContent = `⚡ ${edge.id}`;
                list.appendChild(span);
            }
        });
    }

    function drawGraph(label, tNowMs, activeEdgeIds = new Set()) {
        const metric = timelineData.find(m => m.label === label);
        if (!metric) return;
        const existingMarkers = document.querySelectorAll('.event-marker');
        existingMarkers.forEach(m => m.remove());
        const visibleSeries = metric.value.series.filter(p => p.t_ms <= tNowMs);
        let pathData = [];
        if (visibleSeries.length > 0) {
            visibleSeries.forEach((p) => {
                const x = (p.t_ms / durationMs) * 100;
                const y = 100 - p.v;
                pathData.push(`${x},${y}`);
            });
            graphPath.setAttribute('d', `M ${pathData.join(' L ')}`);
            triggerRuntime.fired.filter(ev => ev.tMs <= tNowMs).forEach(ev => {
                const edge = couplingGraph.edges.find(e => e.id === ev.edgeId);
                if (!edge || (edge.from !== metric.id && edge.to !== metric.id)) return;
                const x = (ev.tMs / durationMs) * 100;
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("x1", x); line.setAttribute("y1", "0");
                line.setAttribute("x2", x); line.setAttribute("y2", "100");
                line.setAttribute("class", "event-marker");
                document.getElementById('analysis-graph').appendChild(line);
            });
            couplingGraph.edges.forEach(edge => {
                if ((edge.from === metric.id || edge.to === metric.id) && activeEdgeIds.has(edge.id)) {
                    const xNow = (tNowMs / durationMs) * 100;
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", xNow); line.setAttribute("y1", "0");
                    line.setAttribute("x2", xNow); line.setAttribute("y2", "100");
                    line.setAttribute("class", "event-marker event-marker-active");
                    document.getElementById('analysis-graph').appendChild(line);
                }
            });
        } else { graphPath.setAttribute('d', ''); }
    }

    function renderInspector() {
        if (!inspectingMetricId || !inspectorPanel.classList.contains('active')) return;

        const isDraftMode = editorState.enabled && editorState.draftGraph;
        const rawBreakdown = isDraftMode
            ? (editorState.previewBreakdowns[inspectingMetricId] || {})
            : (currentBreakdowns[inspectingMetricId] || {});

        const breakdown = CouplingEngine.normalizeBreakdown(rawBreakdown);
        if (!breakdown.target && !isDraftMode) return;

        const fmt = (n) => n === null || n === undefined ? '—' : n.toFixed(2);
        const fmtMs = (n) => n === null ? '—' : n.toLocaleString().replace(/,/g, ' ');

        const filteredBlocked = (breakdown.blocked || []).filter(b => {
            if (currentBlockedFilter === 'all') return true;
            return b.severity === currentBlockedFilter;
        });

        inspectorPanel.innerHTML = `
            <div class="inspector-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start">
                    <h2 class="inspector-title">
                        ${isDraftMode ? '<span class="draft-badge">DRAFT PREVIEW</span>' : ''}
                        Causal Breakdown · ${inspectingMetricId}
                    </h2>
                    <button class="icon-btn" onclick="closeInspector()">✕</button>
                </div>
                ${isDraftMode ? `
                    <div style="display:flex; gap:8px; margin-bottom:12px">
                        <div class="draft-badge" style="flex:1; text-align:center">DRAFT PREVIEW</div>
                        <button class="btn-inspector" style="padding:2px 8px; font-size:0.6rem" onclick="editor_show_diff_ui()">View Diff</button>
                    </div>
                ` : ''}
                ${isDraftMode && !editorState.validation.ok ? `
                    <div style="background:rgba(255,0,0,0.1); border:1px solid #ff4444; border-radius:8px; padding:8px; margin-bottom:12px; font-size:0.65rem; color:#ff8888">
                        <strong>⚠️ Validation Error:</strong> ${editorState.validation.errors[0]?.message || 'Invalid Graph Logic'}
                    </div>
                ` : ''}
                <div class="inspector-badges">
                    <span class="badge" title="Current timestamp">t = ${fmtMs(breakdown.t)} ms</span>
                    <span class="badge ${breakdown.replace.active ? 'badge-active' : ''}" title="Replace Priority Overload">Replace: ${breakdown.replace.active ? 'ACTIVE' : 'none'}</span>
                    <span class="badge" title="Active blend impacts">Blend: ${breakdown.blend.suppressed_by_replace ? 0 : breakdown.blend.add_terms.length + breakdown.blend.mul_terms.length}</span>
                    <span class="badge ${breakdown.blocked.length ? 'badge-warn' : ''}" title="Blocked impacts">Blocked: ${breakdown.blocked.length}</span>
                </div>
            </div>

            <div class="section-label">Value Pipeline</div>
            <div class="pipeline-container">
                <div class="pipeline-grid">
                    <div class="pipeline-cell" title="Source value">
                        <div class="cell-label">Base</div>
                        <div class="cell-value">${fmt(breakdown.base)}</div>
                    </div>
                    <div class="pipeline-arrow">→</div>
                    <div class="pipeline-cell" title="Replace winning impact">
                        <div class="cell-label">Replace</div>
                        <div class="cell-value">${breakdown.replace.active ? fmt(breakdown.after_replace) : '—'}</div>
                    </div>
                    <div class="pipeline-arrow">→</div>
                    <div class="pipeline-cell" title="Blend modulation">
                        <div class="cell-label">Blend</div>
                        <div class="cell-value">${breakdown.blend.suppressed_by_replace ? '(skip)' : (breakdown.after_blend !== null ? fmt(breakdown.after_blend) : '—')}</div>
                    </div>
                    <div class="pipeline-arrow">→</div>
                    <div class="pipeline-cell">
                        <div class="cell-label">Final</div>
                        <div class="cell-value" style="color:var(--accent-color)">${fmt(breakdown.final)}</div>
                    </div>
                </div>
            </div>

            <div class="section-label">Replace — Dominant Impact</div>
            <div class="forensic-card">
                ${!breakdown.replace.active ? '<div style="font-size:0.7rem; color:var(--text-secondary)">No active replace impact.</div>' : `
                    <div class="forensic-row"><span class="key">Winner</span><span class="val">${breakdown.replace.winner.edge_id}</span></div>
                    <div class="forensic-row">
                        <span class="key">Priority</span>
                        <span class="val">
                            ${isDraftMode ? `
                                <input type="number" step="1" value="${breakdown.replace.winner.priority}" 
                                    style="width:50px; background:rgba(255,255,255,0.1); border:1px solid var(--accent-color); color:white; font-size:0.75rem; border-radius:4px"
                                    onchange="editor_patch_edge('${breakdown.replace.winner.edge_id}', { priority: parseFloat(this.value) })">
                            ` : breakdown.replace.winner.priority}
                        </span>
                    </div>
                    <div class="forensic-row"><span class="key">Skew</span><span class="val">${fmtMs(breakdown.replace.winner.skew_ms)} ms</span></div>
                    <div class="forensic-row"><span class="key">Window</span><span class="val">[${fmtMs(breakdown.replace.winner.hold_start)} - ${fmtMs(breakdown.replace.winner.hold_end)}]</span></div>
                `}
            </div>

            <div class="section-label">Blend — Modulation Layer</div>
            <div class="forensic-card">
                ${breakdown.blend.suppressed_by_replace ? '<div style="font-size:0.7rem; color:var(--text-secondary)">⚠ Blend suppressed by Replace.</div>' : `
                    <div style="font-size:0.7rem; margin-bottom:8px">Δ_add: ${fmt(breakdown.blend.delta_add)} | Δ_mul: x${fmt(breakdown.blend.delta_mul)}</div>
                    ${breakdown.blend.add_terms.map(t => `
                        <div class="term-item">
                            <div style="display:grid">
                                <span class="term-edge" onclick="openEdgeEditor('${t.edge_id}')" style="cursor:pointer" title="Click to edit advanced parameters">${t.edge_id} ✎</span>
                                <span style="font-size:0.6rem; opacity:0.6; display:flex; gap:8px; align-items:center">
                                    src ${fmt(t.src)}
                                    ${isDraftMode ? `
                                        G <input type="number" step="0.1" value="${t.gain}" style="width:40px; background:none; border:1px solid #444; color:white; font-size:0.6rem" onchange="editor_patch_edge('${t.edge_id}', { gain: parseFloat(this.value) })">
                                        W <input type="number" step="0.1" value="${t.weight}" style="width:40px; background:none; border:1px solid #444; color:white; font-size:0.6rem" onchange="editor_patch_edge('${t.edge_id}', { weight: parseFloat(this.value) })">
                                    ` : `· gain ${fmt(t.gain)} · w ${fmt(t.weight)}`}
                                </span>
                            </div>
                            <span>+${fmt(t.contribution)}</span>
                        </div>
                    `).join('')}
                    ${breakdown.blend.mul_terms.map(t => `
                        <div class="term-item">
                            <div style="display:grid">
                                <span class="term-edge" onclick="openEdgeEditor('${t.edge_id}')" style="cursor:pointer; color:#00ffcc" title="Click to edit advanced parameters">${t.edge_id} ✎</span>
                                <span style="font-size:0.6rem; opacity:0.6; display:flex; gap:8px; align-items:center">
                                    src ${fmt(t.src)}
                                    ${isDraftMode ? `
                                        G <input type="number" step="0.1" value="${t.gain}" style="width:40px; background:none; border:1px solid #444; color:white; font-size:0.6rem" onchange="editor_patch_edge('${t.edge_id}', { gain: parseFloat(this.value) })">
                                        W <input type="number" step="0.1" value="${t.weight}" style="width:40px; background:none; border:1px solid #444; color:white; font-size:0.6rem" onchange="editor_patch_edge('${t.edge_id}', { weight: parseFloat(this.value) })">
                                    ` : `· gain ${fmt(t.gain)} · w ${fmt(t.weight)}`}
                                </span>
                            </div>
                            <span>x${fmt(t.factor)}</span>
                        </div>
                    `).join('')}
                `}
            </div>

            <div class="section-label" style="display:flex; justify-content:space-between; align-items:center">
                Blocked Impacts
                <div class="filter-container">
                    <span class="filter-chip ${currentBlockedFilter === 'all' ? 'active' : ''}" onclick="setBlockedFilter('all')">All</span>
                    <span class="filter-chip ${currentBlockedFilter === 'error' ? 'active' : ''}" onclick="setBlockedFilter('error')">Error</span>
                    <span class="filter-chip ${currentBlockedFilter === 'warn' ? 'active' : ''}" onclick="setBlockedFilter('warn')">Warn</span>
                    <span class="filter-chip ${currentBlockedFilter === 'info' ? 'active' : ''}" onclick="setBlockedFilter('info')">Info</span>
                </div>
            </div>
            
            ${filteredBlocked.map(b => `
                <div class="forensic-card block-card" style="margin-bottom:8px; border-left: 2px solid ${b.severity === 'error' ? '#ff4444' : (b.severity === 'warn' ? '#ffaa00' : '#00f2ff')}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
                        <span class="term-edge" onclick="openEdgeEditor('${b.edge_id}')" style="cursor:pointer; color: ${b.severity === 'error' ? '#ff4444' : '#fff'}" title="Click to edit advanced parameters">${b.edge_id} ✎</span>
                        <span class="badge" style="font-size:0.5rem">${b.reason}</span>
                    </div>
                    ${b.message ? `<div style="font-size:0.7rem; color:var(--text-secondary); margin-bottom:8px">${b.message}</div>` : ''}
                    <div class="forensic-row"><span class="key">Severity</span><span class="val" style="color: ${b.severity === 'error' ? '#ff4444' : (b.severity === 'warn' ? '#ffaa00' : '#00f2ff')}">${b.severity.toUpperCase()}</span></div>
                    
                    ${b.skew_ms !== null ? `
                        <div class="forensic-row">
                            <span class="key">Skew</span>
                            <span class="val">
                                ${fmtMs(b.skew_ms)} ms 
                                (max ${isDraftMode && b.reason === 'MAX_SKEW_EXCEEDED' ? `
                                    <input type="number" step="100" value="${b.max_skew_ms}" 
                                        style="width:50px; background:none; border:1px solid #444; color:white; font-size:0.6rem" 
                                        onchange="editor_patch_edge('${b.edge_id}', { max_skew_ms: parseFloat(this.value) })">
                                ` : b.max_skew_ms})
                            </span>
                        </div>
                    ` : ''}
                    ${b.effect_at_ms !== null ? `<div class="forensic-row"><span class="key">Timing</span><span class="val">Trigger: ${fmtMs(b.fired_at_ms)} | Effect: ${fmtMs(b.effect_at_ms)}</span></div>` : ''}
                    
                    ${b.preview?.would_apply || b.preview?.candidate ? `
                        <div class="forensic-row">
                            <span class="key">Preview Impact</span>
                            <span class="val" style="color:var(--text-secondary)">
                                ${b.preview.would_add ? '+' + fmt(b.preview.would_add) : (b.preview.would_factor ? 'x' + fmt(b.preview.would_factor) : (b.preview.candidate ? 'val: ' + fmt(b.preview.candidate) : '—'))}
                            </span>
        </div>` : ''}
                </div>
            `).join('') || '<div style="font-size:0.7rem; color:var(--text-secondary)">No impacts match filter.</div>'}

            <div class="inspector-footer">
                ${isDraftMode ? `
                    <button class="btn-inspector" onclick="editor_discard()" style="border-color:#ff4444">DISCARD DRAFT</button>
                    <button class="btn-inspector" onclick="editor_apply()" ${!editorState.validation.ok || !editorState.dirty ? 'disabled style="opacity:0.5; cursor:not-allowed"' : 'style="border-color:var(--accent-color); font-weight:bold"'} >APPLY LOGIC</button>
                ` : `
                    <button class="btn-inspector" onclick="editor_enter()" style="border-color:var(--accent-color)">Edit Logic</button>
                    <button class="btn-inspector" onclick="copyBreakdownJSON()">Copy JSON</button>
                    <button class="btn-inspector" onclick="exportCausalSnapshot()">Export Snapshot (ZIP)</button>
                    <button class="btn-inspector" style="margin-left:auto" onclick="toggleFreeze()">${isFrozen ? 'RESUME' : 'FREEZE FRAME'}</button>
                `}
            </div>
        `;
    }

    function renderManagementList() {
        rightMetricList.innerHTML = '';
        timelineData.forEach((data, index) => {
            const item = document.createElement('div');
            item.className = 'metric-config-item';
            item.innerHTML = `
                <div class="metric-info">
                    <span class="metric-name">${data.label}</span>
                    <span class="metric-type">${data.provenance.source_type} | ${data.semantics.domain}</span>
                </div>
                <div class="metric-actions">
                    <button class="action-btn" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="action-btn delete" title="Delete" onclick="deleteMetric(${index})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
            rightMetricList.appendChild(item);
        });
    }

    window.setBlockedFilter = (f) => { currentBlockedFilter = f; renderInspector(); };
    window.exportCausalSnapshot = async () => {
        if (!inspectingMetricId) return;
        const zip = new JSZip();
        const tNow = lastRenderTimeMs;
        const rawBreakdown = currentBreakdowns[inspectingMetricId];
        const breakdown = CouplingEngine.normalizeBreakdown(rawBreakdown);

        // 1. Prepare Content Files
        const graphJson = JSON.stringify(couplingGraph, null, 2);
        const breakdownJson = JSON.stringify(breakdown, null, 2);

        // Detailed State Mapping
        const state = {};
        timelineData.forEach(d => {
            state[d.id] = CouplingEngine.sampleAt(d.value.series, tNow);
        });
        const stateJson = JSON.stringify(state, null, 2);

        // 2. Initial ZIP Assembly
        zip.file("coupling-graph.json", graphJson);
        zip.file("breakdown.json", breakdownJson);
        zip.file("state.json", stateJson);

        // 3. Metadata Preparation (with placeholders for hashes)
        const meta = {
            snapshot_version: "causal_snapshot_v1.0",
            exported_at_iso: new Date().toISOString(),
            target_metric: inspectingMetricId,
            t_ms: tNow,
            breakdown_version: "1.1",
            spec_version: "causal++_spec_v1",
            seed: hashStringToSeed(inspectingMetricId), // Simplified repro-key
            prng: { name: "mulberry32", variant: null },
            app: {
                name: "UI-nisierung",
                version: "1.1.0-audit",
                build_id: "local-dev",
                git_commit: null
            },
            graph: { path: "coupling-graph.json", sha256: await ForensicUtils.sha256HexFromString(graphJson) },
            state: { mode: "full", path: "state.json", sha256: await ForensicUtils.sha256HexFromString(stateJson) }
        };
        zip.file("metadata.json", JSON.stringify(meta, null, 2));

        // 4. README inclusion
        const readmeContent = `SHERATAN CAUSAL SNAPSHOT ${meta.exported_at_iso}
===================================================
Target: ${meta.target_metric}
Time:   ${meta.t_ms} ms

CONTENTS:
- metadata.json: Snapshot context and app parameters.
- manifest.json: Tamper-evident file hashes.
- coupling-graph.json: Logic rules and graph structure.
- breakdown.json: Normalized Causal++ Forensics v1.1.
- state.json: Values of all metrics at time t.

VALIDATION:
$ node tools/validate_breakdown.mjs breakdown.json --pretty
`;
        zip.file("README.txt", readmeContent);

        // 5. Manifest Building (Finalizes filenames and hashes)
        const manifest = await ForensicUtils.buildManifestFromZip(zip);
        zip.file("manifest.json", JSON.stringify(manifest, null, 2));

        // 6. Generate and Download
        const content = await zip.generateAsync({ type: "blob" });
        const bundleSha = await ForensicUtils.sha256HexFromArrayBuffer(await content.arrayBuffer());

        console.log(`[Audit] Bundle generated. SHA256: ${bundleSha}`);

        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = `causal_snapshot_${inspectingMetricId}_t${Math.floor(tNow)}.zip`;
        link.click();

        console.log(`✅ Snapshot exported: ${link.download}`);
    };

    window.closeInspector = () => { inspectorPanel.classList.remove('active'); inspectingMetricId = null; };
    window.toggleFreeze = () => { isFrozen = !isFrozen; renderInspector(); };
    window.copyBreakdownJSON = () => {
        const b = currentBreakdowns[inspectingMetricId];
        if (b) {
            navigator.clipboard.writeText(JSON.stringify(b, null, 2));
            alert("Forensic Breakdown v1.1 copied.");
        }
    };

    // ---- Editor API (Guardrails #1 & #2) ----
    window.editor_enter = () => {
        editorState.enabled = true;
        editorState.draftGraph = JSON.parse(JSON.stringify(couplingGraph));
        editorState.dirty = false;
        renderAll();
    };

    window.editor_discard = () => {
        editorState.enabled = false;
        editorState.draftGraph = null;
        editorState.dirty = false;
        renderAll();
    };

    window.editor_apply = () => {
        const res = CouplingValidator.validate(editorState.draftGraph);
        if (res.ok) {
            couplingGraph = JSON.parse(JSON.stringify(editorState.draftGraph));
            editorState.dirty = false;
            editorState.enabled = false;
            renderAll();
            console.log("✅ Graph Applied to Simulation.");
        } else {
            alert("Cannot apply: Graph validation failed.");
        }
    };

    // ---- Deep Patch Helper ----
    function setDeep(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) current[parts[i]] = {};
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
    }

    window.editor_patch_edge = (edgeId, path, value) => {
        if (!editorState.draftGraph) return;
        const edge = editorState.draftGraph.edges.find(e => e.id === edgeId);
        if (edge) {
            setDeep(edge, path, value);
            editorState.dirty = true;
            editorState.validation = CouplingValidator.validate(editorState.draftGraph);
            renderAll();
        }
    };

    window.editor_get_diff = () => {
        if (!editorState.draftGraph) return null;
        const diff = [];
        editorState.draftGraph.edges.forEach((dEdge, i) => {
            const mEdge = couplingGraph.edges.find(e => e.id === dEdge.id);
            if (!mEdge) {
                diff.push({ op: "add", path: `/edges/${i}`, value: dEdge });
            } else if (JSON.stringify(dEdge) !== JSON.stringify(mEdge)) {
                diff.push({ op: "replace", path: `/edges/${i}`, from: mEdge, to: dEdge });
            }
        });
        return diff;
    };

    window.openEdgeEditor = (edgeId) => {
        if (!editorState.enabled) window.editor_enter();
        const edge = editorState.draftGraph.edges.find(e => e.id === edgeId);
        if (!edge) return;

        const modal = document.getElementById('edge-editor-modal');
        document.getElementById('edit-edge-id').textContent = edge.id;

        // Populate inputs
        document.getElementById('edit-priority').value = edge.priority || 0;
        document.getElementById('edit-gain').value = edge.impact?.gain || 1;
        document.getElementById('edit-weight').value = edge.impact?.weight || 1;
        document.getElementById('edit-skew').value = edge.alignment?.max_skew_ms || 250;

        modal.style.display = 'flex';
        editorState.editingEdgeId = edgeId;
    };

    window.saveEdgeChanges = () => {
        const id = editorState.editingEdgeId;
        const priority = parseFloat(document.getElementById('edit-priority').value);
        const gain = parseFloat(document.getElementById('edit-gain').value);
        const weight = parseFloat(document.getElementById('edit-weight').value);
        const skew = parseFloat(document.getElementById('edit-skew').value);

        editor_patch_edge(id, 'priority', priority);
        editor_patch_edge(id, 'impact.gain', gain);
        editor_patch_edge(id, 'impact.weight', weight);
        editor_patch_edge(id, 'alignment.max_skew_ms', skew);

        document.getElementById('edge-editor-modal').style.display = 'none';
    };

    window.editor_show_diff_ui = () => {
        const diff = editor_get_diff();
        if (!diff || diff.length === 0) { alert("No changes detected."); return; }
        const txt = diff.map(d => `${d.op.toUpperCase()} ${d.path}\n  ${d.op === 'replace' ? 'from ' + JSON.stringify(d.from) : ''}\n  to   ${JSON.stringify(d.to || d.value)}`).join('\n\n');
        alert("DRAFT DIFF:\n\n" + txt);
    };

    function renderAll() {
        const tNowMs = (video.currentTime || 0) * 1000;
        if (tNowMs + 250 < lastRenderTimeMs) triggerRuntime.reset();
        lastRenderTimeMs = tNowMs;

        const valuesById = {};
        timelineData.forEach(d => {
            valuesById[d.id] = { obj: d, series: d.value.series.map(p => ({ t: p.t_ms, v: p.v })) };
        });

        // 1. Simulation Path (Always Master)
        const activeEdgeIds = EventTriggerEngine.computeTriggersAtTime(valuesById, couplingGraph, tNowMs, triggerRuntime);
        const { values, breakdowns } = CouplingEngine.applyCouplingGraph(valuesById, couplingGraph, tNowMs, activeEdgeIds, triggerRuntime);

        if (!isFrozen) currentBreakdowns = breakdowns;

        // 2. Preview Path (Draft Mode Only)
        if (editorState.enabled && editorState.draftGraph && editorState.validation.ok) {
            const draftTriggers = EventTriggerEngine.computeTriggersAtTime(valuesById, editorState.draftGraph, tNowMs, new TriggerRuntime()); // Isolated runtime for preview
            const { breakdowns: db } = CouplingEngine.applyCouplingGraph(valuesById, editorState.draftGraph, tNowMs, draftTriggers, new TriggerRuntime());
            editorState.previewBreakdowns = db;
        }

        renderTimelines(values);
        renderAnalysisTags();
        renderActiveTriggers(activeEdgeIds);
        renderManagementList();
        drawGraph(selectedMetricName, tNowMs, activeEdgeIds);
        renderInspector();
    }

    // Handlers
    addBtn.onclick = () => modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    addForm.onsubmit = (e) => {
        e.preventDefault();
        const label = document.getElementById('metric-label').value;
        const typeStr = document.getElementById('metric-type').value;
        const initVal = parseInt(document.getElementById('metric-init-value').value);
        const id = slugifyId(label);
        const newMetric = {
            ...ValueValidator.createSkeleton(id, label, 'user.defined'),
            provenance: { source_type: typeStr === 'Raw' ? 'observed' : 'derived', method: 'user_defined' },
            value: { kind: "scalar", current: initVal, series: [] }
        };
        const rnd = mulberry32(hashStringToSeed(id));
        for (let i = 0; i <= 200; i++) newMetric.value.series.push({ t_ms: Math.floor((i / 200) * durationMs), v: 10 + rnd() * 80 });
        if (ValueValidator.validate(newMetric).valid) {
            timelineData.push(newMetric); modal.style.display = 'none'; addForm.reset(); renderAll();
        }
    };
    playPauseBtn.onclick = () => {
        if (video.paused) { video.play(); playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; videoOverlay.style.opacity = '0'; }
        else { video.pause(); playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>'; videoOverlay.style.opacity = '1'; }
    };
    video.addEventListener('timeupdate', () => {
        const percentage = (video.currentTime / video.duration) * 100 || 0;
        document.querySelector('.slider-fill').style.width = `${percentage}%`;
        document.querySelector('.slider-thumb').style.left = `${percentage}%`;
        const format = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; }
        document.getElementById('current-time').textContent = format(video.currentTime);
        document.getElementById('total-time').textContent = format(video.duration || 0);
        renderAll();
    });
    function syncLoop() { if (!video.paused) renderAll(); requestAnimationFrame(syncLoop); }
    requestAnimationFrame(syncLoop);
    renderAll();
});
