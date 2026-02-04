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

    try {
        const response = await fetch('coupling-graph.sample.json');
        couplingGraph = await response.json();
    } catch (e) { console.warn("Graph load failed", e); }

    let timelineData = [
        {
            ...ValueValidator.createSkeleton('delta_resonance', 'Delta Resonance', 'perception.core'),
            semantics: { dimension: 'resonance', unit: 'percent', scale: { min: 0, max: 100 }, interpretation: { higher_is: 'better' } },
            provenance: { source_type: 'model', source_id: 'soul_engine_v1.2' },
            quality: { confidence: 0.98 },
            value: 75,
            history: []
        },
        {
            ...ValueValidator.createSkeleton('sigma_movement', 'Sigma Movement', 'perception.spatial'),
            semantics: { dimension: 'velocity', unit: 'ratio', scale: { min: 0, max: 1 }, interpretation: { higher_is: 'neutral' } },
            provenance: { source_type: 'telemetry', source_id: 'camera_front_tracking' },
            quality: { confidence: 0.85 },
            value: 45,
            history: []
        },
        {
            ...ValueValidator.createSkeleton('theta_intent', 'Theta Intent', 'perception.agent'),
            semantics: { dimension: 'intention', unit: 'percent', scale: { min: 0, max: 100 }, interpretation: { higher_is: 'better' } },
            provenance: { source_type: 'model', source_id: 'intent_core_v4' },
            quality: { confidence: 0.92 },
            value: 90,
            history: []
        }
    ];

    let selectedMetric = timelineData[0].meta.label;
    const durationMs = 195000;

    // Seed history
    timelineData.forEach(d => {
        for (let i = 0; i <= 200; i++) {
            const t = (i / 200) * durationMs;
            const v = 30 + Math.sin(i * 0.1) * 20 + (Math.random() * 10);
            d.history.push({ t, v });
        }
    });

    function renderTimelines(viewValues) {
        const timelinesContainer = document.getElementById('timelines');
        timelinesContainer.innerHTML = '';
        timelineData.forEach((data) => {
            const val = viewValues[data.meta.id] ?? data.value;
            const item = document.createElement('div');
            item.className = 'timeline-item' + (data.meta.label === selectedMetric ? ' active' : '');
            item.onclick = () => { selectedMetric = data.meta.label; renderAll(); };
            item.innerHTML = `
                <span class="timeline-label">${data.meta.label}</span>
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
                    <span class="metric-name">${data.meta.label}</span>
                    <span class="metric-type">${data.provenance.source_type} | ${data.semantics.dimension}</span>
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
        const deletedLabel = timelineData[index].meta.label;
        timelineData.splice(index, 1);
        if (selectedMetric === deletedLabel && timelineData.length > 0) selectedMetric = timelineData[0].meta.label;
        renderAll();
    };

    function drawGraph(label, tNowMs) {
        const metric = timelineData.find(m => m.meta.label === label);
        if (!metric) return;
        const visibleSeries = metric.history.filter(p => p.t <= tNowMs);
        let pathData = [];
        if (visibleSeries.length > 0) {
            visibleSeries.forEach((p) => {
                const x = (p.t / durationMs) * 100;
                const y = 100 - p.v;
                pathData.push(`${x},${y}`);
            });
            graphPath.setAttribute('d', `M ${pathData.join(' L ')}`);
        } else { graphPath.setAttribute('d', ''); }
    }

    function renderAll() {
        const tNowMs = (video.currentTime || 0) * 1000;
        const valuesById = {};
        timelineData.forEach(d => { valuesById[d.meta.id] = { obj: d, series: d.history }; });

        // 1) Compute active triggers (Events)
        const activeEdgeIds = EventTriggerEngine.computeTriggersAtTime(valuesById, couplingGraph, tNowMs, triggerRuntime);

        // 2) Apply coupling graph with event gating
        const viewValues = CouplingEngine.applyCouplingGraph(valuesById, couplingGraph, tNowMs, activeEdgeIds);

        renderTimelines(viewValues);
        renderAnalysisTags();
        renderManagementList();
        drawGraph(selectedMetric, tNowMs);
    }

    // Modal & Video handlers
    addBtn.onclick = () => modal.style.display = 'flex';
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; };

    addForm.onsubmit = (e) => {
        e.preventDefault();
        const label = document.getElementById('metric-label').value;
        const type = document.getElementById('metric-type').value;
        const initVal = parseInt(document.getElementById('metric-init-value').value);
        const newMetric = { ...ValueValidator.createSkeleton(label.toLowerCase().replace(' ', '_'), label, 'user.defined'), provenance: { source_type: type === 'Raw' ? 'telemetry' : 'model', source_id: 'user_defined' }, value: initVal, history: [] };
        for (let i = 0; i <= 200; i++) newMetric.history.push({ t: (i / 200) * durationMs, v: 10 + Math.random() * 80 });
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
