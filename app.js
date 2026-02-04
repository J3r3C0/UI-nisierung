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

    // Runtime state
    const triggerRuntime = new TriggerRuntime();
    let couplingGraph = { meta: {}, nodes: [], edges: [] };
    let lastRenderTimeMs = 0;

    try {
        const response = await fetch('coupling-graph.json');
        couplingGraph = await response.json();

        // ✅ Contract Enforcement: validate graph before first frame
        let res = CouplingValidator.validate(couplingGraph);
        if (!res.ok) {
            console.warn("CouplingGraph invalid, trying sample fallback", res.errors);
            const fallback = await fetch('coupling-graph.sample.json').then(r => r.json());
            const res2 = CouplingValidator.validate(fallback);
            couplingGraph = res2.ok ? fallback : { meta: { id: "hard-fallback" }, nodes: [], edges: [] };
            if (!res2.ok) console.warn("Sample fallback invalid too", res2.errors);
        }
    } catch (e) {
        console.warn("Graph load failed, using hard fallback", e);
        couplingGraph = { meta: { id: "hard-fallback" }, nodes: [], edges: [] };
    }

    // ✅ Deterministic PRNG
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
                domain: "perception.core",
                unit: "%",
                scale: "percent_0_100",
                range: { min: 0, max: 100 },
                meaning: "Resonanz zwischen Input-Signal und Core-State"
            },
            provenance: {
                source_type: "derived",
                source_ref: "soul_engine_v1.2",
                method: "cosine_similarity(windowed_features, core_vector)",
                inputs: ["frame_features", "core_vector"],
                params: { window_ms: 300 }
            },
            quality: { confidence: 0.98, latency_ms: 12, stability: 0.64 },
            value: { kind: "scalar", current: 75, series: [] }
        },
        {
            ...ValueValidator.createSkeleton('sigma_movement', 'Sigma Movement', 'perception.spatial'),
            provenance: {
                source_type: "observed",
                source_ref: "camera_front_tracking",
                method: "optical_flow_magnitude"
            },
            quality: { confidence: 0.85, latency_ms: 0, stability: 0.9 },
            value: { kind: "scalar", current: 45, series: [] }
        },
        {
            ...ValueValidator.createSkeleton('theta_intent', 'Theta Intent', 'perception.agent'),
            provenance: {
                source_type: "inferred",
                source_ref: "intent_core_v4",
                method: "probabilistic_sequence_modeling"
            },
            quality: { confidence: 0.92, latency_ms: 45, stability: 0.8 },
            value: { kind: "scalar", current: 90, series: [] }
        }
    ];

    let selectedMetric = timelineData[0].label;
    const durationMs = 195000;

    // Seed history deterministically
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
            item.className = 'timeline-item' + (data.label === selectedMetric ? ' active' : '');
            item.onclick = () => { selectedMetric = data.label; renderAll(); };
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
            <div class="active-selection-label">Current: <span>${selectedMetric}</span></div>
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

    window.deleteMetric = (index) => {
        const deletedLabel = timelineData[index].label;
        timelineData.splice(index, 1);
        if (selectedMetric === deletedLabel && timelineData.length > 0) selectedMetric = timelineData[0].label;
        renderAll();
    };

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

            // ✅ Draw historical event markers at the real fire time (audit-friendly)
            triggerRuntime.fired
                .filter(ev => ev.tMs <= tNowMs)
                .forEach(ev => {
                    const edge = couplingGraph.edges.find(e => e.id === ev.edgeId);
                    if (!edge) return;
                    if (edge.from !== metric.id && edge.to !== metric.id) return;

                    const x = (ev.tMs / durationMs) * 100;
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", x);
                    line.setAttribute("y1", "0");
                    line.setAttribute("x2", x);
                    line.setAttribute("y2", "100");
                    line.setAttribute("class", "event-marker");
                    document.getElementById('analysis-graph').appendChild(line);
                });

            // ✅ Draw "active now" marker (visual feedback)
            couplingGraph.edges.forEach(edge => {
                if ((edge.from === metric.id || edge.to === metric.id) && activeEdgeIds.has(edge.id)) {
                    const xNow = (tNowMs / durationMs) * 100;
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    line.setAttribute("x1", xNow);
                    line.setAttribute("y1", "0");
                    line.setAttribute("x2", xNow);
                    line.setAttribute("y2", "100");
                    line.setAttribute("class", "event-marker event-marker-active");
                    document.getElementById('analysis-graph').appendChild(line);
                }
            });
        } else { graphPath.setAttribute('d', ''); }
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

    function renderAll() {
        const tNowMs = (video.currentTime || 0) * 1000;

        // Seek detection
        if (tNowMs + 250 < lastRenderTimeMs) {
            triggerRuntime.reset();
        }
        lastRenderTimeMs = tNowMs;

        const valuesById = {};
        timelineData.forEach(d => {
            valuesById[d.id] = { obj: d, series: d.value.series.map(p => ({ t: p.t_ms, v: p.v })) };
        });

        // 1) Compute active triggers
        const activeEdgeIds = EventTriggerEngine.computeTriggersAtTime(valuesById, couplingGraph, tNowMs, triggerRuntime);

        // 2) Apply coupling graph (Causal++ Enhanced)
        const viewValues = CouplingEngine.applyCouplingGraph(valuesById, couplingGraph, tNowMs, activeEdgeIds, triggerRuntime);

        renderTimelines(viewValues);
        renderAnalysisTags();
        renderActiveTriggers(activeEdgeIds);
        renderManagementList();
        drawGraph(selectedMetric, tNowMs, activeEdgeIds);
    }

    // Modal & Video handlers...
    addBtn.onclick = () => modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; };

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
            timelineData.push(newMetric);
            modal.style.display = 'none'; addForm.reset(); renderAll();
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
