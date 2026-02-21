// ---------------------------------------------------------------------------
// Provider display names
// ---------------------------------------------------------------------------

const PROVIDER_NAMES = {
    baseten: 'Baseten',
    cerebras: 'Cerebras',
    deepinfra: 'DeepInfra',
    deepseek: 'DeepSeek',
    digitalocean: 'DigitalOcean',
    fireworks: 'Fireworks',
    google: 'Google',
    groq: 'Groq',
    huggingface: 'Hugging Face',
    mistral: 'Mistral',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    perplexity: 'Perplexity',
    sambanova: 'SambaNova',
    together: 'Together AI',
};

// ---------------------------------------------------------------------------
// State — slot-based model
// ---------------------------------------------------------------------------

let mode = 'play'; // 'play' | 'compare'
let logEntryCount = 0;

function createSlot() {
    return {
        definition: null,
        polling: false,
        lastSentRequest: null,
        lastResponse: null,
        abortController: null,
    };
}

let slots = {
    play: createSlot(),
    left: createSlot(),
    right: createSlot(),
};

// Backward-compat getter for play slot
function getCurrentDefinition() {
    return mode === 'play' ? slots.play.definition : null;
}

// ---------------------------------------------------------------------------
// DOM helpers — map slot to containers
// ---------------------------------------------------------------------------

function getOutputContainer(slotId) {
    if (slotId === 'play') return document.getElementById('renderedOutput');
    if (slotId === 'left') return document.getElementById('compareLeftOutput');
    if (slotId === 'right') return document.getElementById('compareRightOutput');
    return null;
}

function getMetricsContainer(slotId) {
    if (slotId === 'play') return document.getElementById('metricsRow');
    if (slotId === 'left') return document.getElementById('compareLeftMetrics');
    if (slotId === 'right') return document.getElementById('compareRightMetrics');
    return null;
}

function getJsonView(slotId) {
    if (slotId === 'play') return document.getElementById('jsonView');
    if (slotId === 'left') return document.getElementById('compareLeftJsonView');
    if (slotId === 'right') return document.getElementById('compareRightJsonView');
    return null;
}

function getJsonToggleBtn(slotId) {
    if (slotId === 'play') return document.getElementById('jsonToggleBtn');
    if (slotId === 'left') return document.getElementById('compareLeftJsonBtn');
    if (slotId === 'right') return document.getElementById('compareRightJsonBtn');
    return null;
}

function getErrorContainer(slotId) {
    if (slotId === 'play') return document.getElementById('errorDisplay');
    if (slotId === 'left') return document.getElementById('compareLeftError');
    if (slotId === 'right') return document.getElementById('compareRightError');
    return null;
}

// ---------------------------------------------------------------------------
// Abort helpers
// ---------------------------------------------------------------------------

function abortSlot(slotId) {
    const slot = slots[slotId];
    if (slot.abortController) {
        slot.abortController.abort();
        slot.abortController = null;
    }
    slot.polling = false;
}

function abortAllSlots() {
    abortSlot('play');
    abortSlot('left');
    abortSlot('right');
}

// ---------------------------------------------------------------------------
// API key toggle
// ---------------------------------------------------------------------------

function toggleApiKeyInput() {
    const wrapper = document.getElementById('apiKeyWrapper');
    wrapper.classList.toggle('hidden');
    if (!wrapper.classList.contains('hidden')) {
        document.getElementById('apiKey').focus();
    }
}

// ---------------------------------------------------------------------------
// Log drawer
// ---------------------------------------------------------------------------

function toggleLogDrawer() {
    const drawer = document.getElementById('logDrawer');
    const pill = document.getElementById('logPill');
    drawer.classList.toggle('log-drawer-open');

    if (drawer.classList.contains('log-drawer-open')) {
        pill.classList.add('hidden');
        logEntryCount = 0;
        updateLogCount();
    } else {
        pill.classList.remove('hidden');
    }
}

function updateLogCount() {
    const countEl = document.getElementById('logCount');
    if (logEntryCount > 0) {
        countEl.textContent = logEntryCount;
        countEl.classList.remove('hidden');
    } else {
        countEl.classList.add('hidden');
    }
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function showProgress() {
    document.getElementById('progressBar').classList.remove('hidden');
}

function hideProgress() {
    document.getElementById('progressBar').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function toggleSystemPrompt() {
    const input = document.getElementById('systemPromptInput');
    const arrow = document.getElementById('systemPromptArrow');
    const isHidden = input.classList.contains('hidden');
    input.classList.toggle('hidden');
    arrow.innerHTML = isHidden ? '&#9660;' : '&#9654;';
    if (isHidden) input.focus();
}

function showSystemPromptGroup() {
    document.getElementById('systemPromptGroup').classList.remove('hidden');
}

function hideSystemPromptGroup() {
    document.getElementById('systemPromptGroup').classList.add('hidden');
    document.getElementById('systemPromptInput').value = '';
    document.getElementById('systemPromptInput').classList.add('hidden');
    document.getElementById('systemPromptArrow').innerHTML = '&#9654;';
}

function definitionUsesChat(definition) {
    if (!definition) return false;
    return (definition.request?.params || []).some(p => p.body_path === '_chat_message');
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

function setMode(newMode) {
    if (mode === newMode) return;
    abortAllSlots();
    mode = newMode;

    const mainCol = document.getElementById('mainColumn');
    const playPickers = document.getElementById('playPickers');
    const comparePickers = document.getElementById('comparePickers');
    const playResults = document.getElementById('results');
    const compareResults = document.getElementById('compareResults');
    const modePlay = document.getElementById('modePlay');
    const modeCompare = document.getElementById('modeCompare');
    const playground = document.getElementById('playground');

    const compareApiKeys = document.getElementById('compareApiKeys');
    const progressBar = document.getElementById('progressBar');

    if (mode === 'play') {
        mainCol.style.maxWidth = '720px';
        mainCol.style.paddingTop = '6rem';
        progressBar.style.top = '56px';
        playPickers.classList.remove('hidden');
        comparePickers.classList.add('hidden');
        compareResults.classList.add('hidden');
        compareApiKeys.classList.add('hidden');
        document.getElementById('compareSideParams').classList.add('hidden');
        modePlay.classList.add('text-white', 'bg-gray-800/50');
        modePlay.classList.remove('text-gray-600');
        modeCompare.classList.remove('text-white', 'bg-gray-800/50');
        modeCompare.classList.add('text-gray-600');
        // Restore play mode state
        if (slots.play.definition) {
            playground.classList.remove('hidden');
        } else {
            playground.classList.add('hidden');
        }
        // Restore system prompt for play definition
        hideSystemPromptGroup();
        if (definitionUsesChat(slots.play.definition)) {
            showSystemPromptGroup();
        }
    } else {
        mainCol.style.maxWidth = '1100px';
        mainCol.style.paddingTop = '7.5rem';
        progressBar.style.top = '96px';
        playPickers.classList.add('hidden');
        comparePickers.classList.remove('hidden');
        playResults.classList.add('hidden');
        compareApiKeys.classList.remove('hidden');
        playground.classList.remove('hidden');
        modeCompare.classList.add('text-white', 'bg-gray-800/50');
        modeCompare.classList.remove('text-gray-600');
        modePlay.classList.remove('text-white', 'bg-gray-800/50');
        modePlay.classList.add('text-gray-600');
        hideModelPicker();
        hideBaseUrl();
        updateCompareSystemPrompt();
        updateCompareForm();
    }

    hideError();
    setGenerating(false);
}

// ---------------------------------------------------------------------------
// Definition switching (Play mode)
// ---------------------------------------------------------------------------

async function onDefinitionChange() {
    const picker = document.getElementById('definitionPicker');
    const id = picker.value;
    const playground = document.getElementById('playground');
    const results = document.getElementById('results');
    const errorDisplay = document.getElementById('errorDisplay');

    // Reset
    results.classList.add('hidden');
    errorDisplay.classList.add('hidden');
    abortSlot('play');
    hideModelPicker();
    hideBaseUrl();
    hideSystemPromptGroup();

    if (!id) {
        playground.classList.add('hidden');
        slots.play.definition = null;
        return;
    }

    log(`Loading definition: ${id}`, 'info');

    try {
        const resp = await fetch(`/api/definitions/${id}`);
        slots.play.definition = await resp.json();
        const def = slots.play.definition;

        populateModelPicker(def);
        showBaseUrl(def.request.url);

        renderForm(def);
        playground.classList.remove('hidden');

        if (definitionUsesChat(def)) {
            showSystemPromptGroup();
        }

        // Auto-fill API key
        const provider = def.provider;
        const keyInput = document.getElementById('apiKey');
        const hint = document.getElementById('apiKeyHint');
        if (typeof API_KEYS !== 'undefined' && API_KEYS[provider]) {
            keyInput.value = API_KEYS[provider];
            hint.textContent = `Key loaded from environment for ${provider}`;
            hint.classList.remove('hidden');
        } else {
            hint.classList.add('hidden');
            document.getElementById('apiKeyWrapper').classList.remove('hidden');
        }

        log(`Loaded: ${def.name}`, 'info');
    } catch (e) {
        log(`Failed to load definition: ${e.message}`, 'error');
    }
}

// ---------------------------------------------------------------------------
// Dynamic form rendering
// ---------------------------------------------------------------------------

function renderForm(definition) {
    document.getElementById('endpointName').textContent = definition.name;
    document.getElementById('endpointDescription').textContent = definition.description || '';

    const container = document.getElementById('formFields');
    container.innerHTML = '';

    // Example buttons
    const exRow = document.getElementById('examplesRow');
    const exBtns = document.getElementById('exampleButtons');
    exBtns.innerHTML = '';
    if (definition.examples && definition.examples.length > 0) {
        for (const example of definition.examples) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'border border-gray-800 hover:border-gray-600 text-gray-400 hover:text-gray-200 text-xs px-3 py-1 rounded-full transition-colors';
            btn.textContent = example.label;
            btn.onclick = () => fillExample(example.params);
            exBtns.appendChild(btn);
        }
        exRow.classList.remove('hidden');
    } else {
        exRow.classList.add('hidden');
    }

    for (const param of definition.request.params) {
        if (param.name === 'model' && param.ui === 'dropdown') continue;
        const field = createField(param);
        container.appendChild(field);
    }
}

function fillExample(params) {
    for (const [name, value] of Object.entries(params)) {
        if (name === 'model') {
            const modelPicker = document.getElementById('modelPicker');
            if (!document.getElementById('modelPickerGroup').classList.contains('hidden')) {
                modelPicker.value = value;
            }
            continue;
        }
        const fields = document.querySelectorAll(`#formFields [data-param-name="${name}"]`);
        for (const field of fields) {
            field.value = value;
            if (field.type === 'range') {
                field.dispatchEvent(new Event('input'));
            }
        }
    }
}

function createField(param) {
    const wrapper = document.createElement('div');

    const label = document.createElement('label');
    label.className = 'block text-xs text-gray-500 mb-1.5';
    label.textContent = param.name;
    if (param.required) {
        const star = document.createElement('span');
        star.className = 'text-blue-500 ml-0.5';
        star.textContent = '*';
        label.appendChild(star);
    }
    wrapper.appendChild(label);

    let input;

    switch (param.ui) {
        case 'textarea':
            input = document.createElement('textarea');
            input.rows = 3;
            input.placeholder = param.placeholder || '';
            input.className = 'w-full bg-transparent border border-gray-800 rounded-md px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-blue-500 resize-y';
            break;

        case 'dropdown':
            input = document.createElement('select');
            input.className = 'w-full bg-transparent border border-gray-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500';
            for (const opt of (param.options || [])) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                option.className = 'bg-gray-900';
                if (opt === param.default) option.selected = true;
                input.appendChild(option);
            }
            break;

        case 'slider':
            input = document.createElement('div');
            input.className = 'flex items-center gap-3';
            const range = document.createElement('input');
            range.type = 'range';
            range.min = param.min || 0;
            range.max = param.max || 100;
            range.value = param.default || param.min || 0;
            range.step = param.type === 'float' ? '0.1' : '1';
            range.className = 'flex-1 accent-blue-500';
            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'text-xs text-gray-500 w-12 text-right font-mono';
            valueDisplay.textContent = range.value;
            range.oninput = () => { valueDisplay.textContent = range.value; };
            range.dataset.paramName = param.name;
            input.appendChild(range);
            input.appendChild(valueDisplay);
            wrapper.appendChild(label);
            wrapper.appendChild(input);
            return wrapper;

        default:
            input = document.createElement('input');
            input.type = 'text';
            input.placeholder = param.placeholder || '';
            input.className = 'w-full bg-transparent border border-gray-800 rounded-md px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-blue-500';
            break;
    }

    input.dataset.paramName = param.name;
    wrapper.appendChild(input);
    return wrapper;
}

function collectParams() {
    const params = {};

    // Include model from config bar picker if visible (play mode)
    if (mode === 'play') {
        const modelGroup = document.getElementById('modelPickerGroup');
        if (!modelGroup.classList.contains('hidden')) {
            params['model'] = document.getElementById('modelPicker').value;
        }
    }

    const fields = document.querySelectorAll('#formFields [data-param-name]');
    for (const field of fields) {
        const name = field.dataset.paramName;
        params[name] = field.value;
    }

    // Include system prompt if present
    const sysPrompt = document.getElementById('systemPromptInput');
    if (sysPrompt && sysPrompt.value.trim()) {
        params['_system_prompt'] = sysPrompt.value.trim();
    }

    return params;
}

// ---------------------------------------------------------------------------
// Generate (submit) — dispatches to play or compare mode
// ---------------------------------------------------------------------------

async function onGenerate() {
    if (mode === 'compare') {
        onCompareGenerate();
        return;
    }

    const def = slots.play.definition;
    if (!def) return;

    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        showError('Please enter an API key.');
        return;
    }

    const params = collectParams();

    // Validate required params
    for (const param of def.request.params) {
        if (param.required && !params[param.name]) {
            showError(`"${param.name}" is required.`);
            return;
        }
    }

    hideError();
    hideResults();
    setGenerating(true);

    const pattern = def.interaction.pattern;

    if (pattern === 'streaming') {
        log(`POST /api/stream (${def.name})`, 'request');
        log(`Params: ${JSON.stringify(params)}`, 'info');
        startStreaming('play', apiKey, params);
    } else {
        log(`POST /api/generate (${def.name})`, 'request');
        log(`Params: ${JSON.stringify(params)}`, 'info');
        const syncStart = performance.now();

        try {
            slots.play.abortController = new AbortController();
            const resp = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    definition_id: def.id,
                    api_key: apiKey,
                    params: params,
                }),
                signal: slots.play.abortController.signal,
            });

            const data = await resp.json();
            const submitTime = performance.now() - syncStart;
            slots.play.lastSentRequest = data.sent_request;

            log(`Response: ${resp.status}`, resp.ok ? 'response' : 'error');

            if (data.error) {
                showError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
                setGenerating(false);
                return;
            }

            if (pattern === 'polling' && data.request_id) {
                log(`Job submitted in ${submitTime.toFixed(0)}ms. request_id: ${data.request_id}`, 'info');
                startPolling('play', data.request_id, apiKey);
            } else {
                const syncMetrics = { totalTime: performance.now() - syncStart, submitTime };
                slots.play.lastResponse = data.response;
                if (data.outputs && data.outputs.length > 0) {
                    renderOutputs(data.outputs, 'play');
                } else {
                    renderOutputs([{type: 'text', value: [JSON.stringify(data.response, null, 2)]}], 'play');
                }
                renderMetrics(syncMetrics, getMetricsContainer('play'));
                setGenerating(false);
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            log(`Error: ${e.message}`, 'error');
            showError(e.message);
            setGenerating(false);
        }
    }
}

// ---------------------------------------------------------------------------
// Streaming — slot-aware
// ---------------------------------------------------------------------------

async function startStreaming(slotId, apiKey, params) {
    const slot = slots[slotId];
    const def = slot.definition;
    const container = getOutputContainer(slotId);
    container.innerHTML = '';
    const textBlock = document.createElement('pre');
    textBlock.className = 'text-sm text-gray-200 whitespace-pre-wrap leading-relaxed streaming-cursor';
    textBlock.textContent = '';
    container.appendChild(textBlock);

    if (slotId === 'play') showResults();

    let fullText = '';
    const metrics = { startTime: performance.now(), ttft: null, tokenCount: 0, totalTime: null, tokensPerSec: null };

    slot.abortController = new AbortController();

    try {
        const resp = await fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                definition_id: def.id,
                api_key: apiKey,
                params: params,
            }),
            signal: slot.abortController.signal,
        });

        if (!resp.ok) {
            const errData = await resp.json();
            showSlotError(slotId, errData.error || 'Stream request failed');
            if (slotId === 'play') setGenerating(false);
            return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('event: request_info')) continue;
                if (line.startsWith('event: error')) continue;
                if (line.startsWith('event: done')) {
                    log(`[${slotId}] Stream complete.`, 'response');
                    continue;
                }
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.token) {
                            if (metrics.ttft === null) {
                                metrics.ttft = performance.now() - metrics.startTime;
                            }
                            metrics.tokenCount++;
                            fullText += data.token;
                            textBlock.textContent = fullText;
                            textBlock.scrollTop = textBlock.scrollHeight;
                        }
                        if (data.error) {
                            showSlotError(slotId, data.error);
                        }
                        if (data.method) {
                            slot.lastSentRequest = data;
                        }
                    } catch (e) {
                        // Skip unparseable chunks
                    }
                }
            }
        }

        metrics.totalTime = performance.now() - metrics.startTime;
        if (metrics.tokenCount > 0 && metrics.totalTime > 0) {
            metrics.tokensPerSec = metrics.tokenCount / (metrics.totalTime / 1000);
        }

        slot.lastResponse = { text: fullText };
        log(`[${slotId}] Streamed ${fullText.length} chars, ${metrics.tokenCount} tokens in ${(metrics.totalTime/1000).toFixed(2)}s`, 'response');
        renderMetrics(metrics, getMetricsContainer(slotId));

    } catch (e) {
        if (e.name === 'AbortError') return;
        log(`[${slotId}] Stream error: ${e.message}`, 'error');
        showSlotError(slotId, e.message);
    }

    textBlock.classList.remove('streaming-cursor');
    if (slotId === 'play') setGenerating(false);
}

// ---------------------------------------------------------------------------
// Polling — slot-aware
// ---------------------------------------------------------------------------

function startPolling(slotId, requestId, apiKey) {
    const slot = slots[slotId];
    slot.polling = true;
    const def = slot.definition;
    const interval = def.interaction.poll_interval_ms || 2000;
    const metrics = { startTime: performance.now(), submitTime: null, pollCount: 0, totalTime: null };
    log(`[${slotId}] Polling every ${interval}ms...`, 'info');
    pollLoop(slotId, requestId, apiKey, interval, metrics);
}

async function pollLoop(slotId, requestId, apiKey, interval, metrics) {
    const slot = slots[slotId];
    const def = slot.definition;
    let consecutiveErrors = 0;
    const MAX_POLL_ERRORS = 10;

    while (slot.polling) {
        try {
            metrics.pollCount++;
            const url = `/api/status?definition_id=${def.id}&api_key=${encodeURIComponent(apiKey)}&request_id=${encodeURIComponent(requestId)}`;
            const resp = await fetch(url);
            const data = await resp.json();
            consecutiveErrors = 0;

            log(`[${slotId}] Status: ${data.poll_status} (poll #${metrics.pollCount})`, 'info');

            if (data.poll_status === 'done') {
                metrics.totalTime = performance.now() - metrics.startTime;
                log(`[${slotId}] Job complete. Fetching result...`, 'response');
                await fetchResult(slotId, requestId, apiKey);
                renderMetrics(metrics, getMetricsContainer(slotId));
                slot.polling = false;
                if (slotId === 'play') setGenerating(false);
                return;
            }

            if (data.poll_status === 'failed' || data.poll_status === 'error') {
                log(`[${slotId}] Job failed.`, 'error');
                showSlotError(slotId, 'Generation failed. Check the log for details.');
                slot.polling = false;
                if (slotId === 'play') setGenerating(false);
                return;
            }
        } catch (e) {
            consecutiveErrors++;
            log(`[${slotId}] Poll error: ${e.message}`, 'error');
            if (consecutiveErrors >= MAX_POLL_ERRORS) {
                showSlotError(slotId, 'Polling failed after too many errors.');
                slot.polling = false;
                if (slotId === 'play') setGenerating(false);
                return;
            }
        }

        await new Promise(r => setTimeout(r, interval));
    }
}

async function fetchResult(slotId, requestId, apiKey) {
    const slot = slots[slotId];
    const def = slot.definition;

    try {
        const url = `/api/result?definition_id=${def.id}&api_key=${encodeURIComponent(apiKey)}&request_id=${encodeURIComponent(requestId)}`;
        const resp = await fetch(url);
        const data = await resp.json();

        slot.lastResponse = data.response;

        if (data.outputs && data.outputs.length > 0) {
            renderOutputs(data.outputs, slotId);
        } else {
            log(`[${slotId}] No outputs extracted from response.`, 'error');
            renderRawFallback(data.response, slotId);
        }
    } catch (e) {
        log(`[${slotId}] Result fetch error: ${e.message}`, 'error');
        showSlotError(slotId, 'Failed to fetch result.');
    }
}

// ---------------------------------------------------------------------------
// Output rendering — slot-aware
// ---------------------------------------------------------------------------

function renderOutputs(outputs, slotId) {
    const container = getOutputContainer(slotId);
    container.innerHTML = '';

    for (const output of outputs) {
        const values = Array.isArray(output.value) ? output.value : [output.value];

        for (const val of values) {
            if (!val) continue;

            switch (output.type) {
                case 'image':
                    container.appendChild(createImageRenderer(val, output.downloadable));
                    break;
                case 'video':
                    container.appendChild(createVideoRenderer(val, output.downloadable));
                    break;
                case 'audio':
                    container.appendChild(createAudioRenderer(val, output.downloadable));
                    break;
                case 'text':
                    container.appendChild(createTextRenderer(val));
                    break;
                default:
                    container.appendChild(createTextRenderer(JSON.stringify(val, null, 2)));
            }
        }
    }

    if (slotId === 'play') showResults();
    log(`[${slotId}] Result rendered.`, 'response');
}

function createImageRenderer(url, downloadable) {
    const div = document.createElement('div');
    div.className = 'space-y-3';

    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Generated image';
    img.className = 'max-w-full rounded-md';
    div.appendChild(img);

    if (downloadable) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'generated-image';
        link.target = '_blank';
        link.className = 'inline-block text-xs text-gray-500 hover:text-gray-300 transition-colors';
        link.textContent = 'Download';
        div.appendChild(link);
    }

    return div;
}

function createVideoRenderer(url, downloadable) {
    const div = document.createElement('div');
    div.className = 'space-y-3';

    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.className = 'max-w-full rounded-md';
    const source = document.createElement('source');
    source.src = url;
    video.appendChild(source);
    div.appendChild(video);

    if (downloadable) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'generated-video';
        link.target = '_blank';
        link.className = 'inline-block text-xs text-gray-500 hover:text-gray-300 transition-colors';
        link.textContent = 'Download';
        div.appendChild(link);
    }

    return div;
}

function createAudioRenderer(url, downloadable) {
    // Convert raw base64 to a playable data URL
    if (url && !url.startsWith('data:') && !url.startsWith('http')) {
        url = `data:audio/wav;base64,${url}`;
    }

    const div = document.createElement('div');
    div.className = 'space-y-3';

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.className = 'w-full';
    const source = document.createElement('source');
    source.src = url;
    audio.appendChild(source);
    div.appendChild(audio);

    if (downloadable) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'generated-audio';
        link.target = '_blank';
        link.className = 'inline-block text-xs text-gray-500 hover:text-gray-300 transition-colors';
        link.textContent = 'Download';
        div.appendChild(link);
    }

    return div;
}

function createTextRenderer(text) {
    const pre = document.createElement('pre');
    pre.className = 'text-sm text-gray-300 whitespace-pre-wrap leading-relaxed';
    pre.textContent = text;
    return pre;
}

function renderRawFallback(data, slotId) {
    const container = getOutputContainer(slotId);
    container.innerHTML = '';
    container.appendChild(createTextRenderer(JSON.stringify(data, null, 2)));
    if (slotId === 'play') showResults();
}

// ---------------------------------------------------------------------------
// JSON toggle — slot-aware
// ---------------------------------------------------------------------------

function toggleJson(slotId) {
    slotId = slotId || 'play';
    const view = getJsonView(slotId);
    const btn = getJsonToggleBtn(slotId);
    const slot = slots[slotId];
    if (!view || !btn) return;

    const isHidden = view.classList.contains('hidden');

    if (isHidden) {
        view.classList.remove('hidden');
        btn.textContent = '[hide]';

        const reqEl = view.querySelector('.json-request');
        const resEl = view.querySelector('.json-response');
        if (reqEl) reqEl.textContent = slot.lastSentRequest ? JSON.stringify(slot.lastSentRequest, null, 2) : 'No request captured';
        if (resEl) resEl.textContent = slot.lastResponse ? JSON.stringify(slot.lastResponse, null, 2) : 'No response captured';
    } else {
        view.classList.add('hidden');
        btn.textContent = '{ }';
    }
}

// ---------------------------------------------------------------------------
// Metrics rendering
// ---------------------------------------------------------------------------

function renderMetrics(metrics, container) {
    if (!container) return;
    container.innerHTML = '';
    const parts = [];
    if (metrics.ttft != null) parts.push(`TTFT: ${metrics.ttft.toFixed(0)}ms`);
    if (metrics.tokensPerSec != null) parts.push(`${metrics.tokensPerSec.toFixed(1)} tok/s`);
    if (metrics.totalTime != null) parts.push(`Total: ${(metrics.totalTime / 1000).toFixed(2)}s`);
    if (metrics.tokenCount != null) parts.push(`${metrics.tokenCount} tokens`);
    if (metrics.pollCount != null) parts.push(`${metrics.pollCount} polls`);
    if (metrics.submitTime != null) parts.push(`Submit: ${metrics.submitTime.toFixed(0)}ms`);
    if (parts.length === 0) return;
    const span = document.createElement('span');
    span.className = 'text-[11px] text-gray-500 font-mono';
    span.textContent = parts.join('  \u00b7  ');
    container.appendChild(span);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setGenerating(active) {
    const btn = document.getElementById('generateBtn');
    if (active) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span>Generating';
        btn.className = 'bg-gray-700 text-gray-400 text-sm font-medium px-5 py-2 rounded-md cursor-not-allowed';
        showProgress();
    } else {
        btn.disabled = false;
        btn.textContent = 'Generate';
        btn.className = 'bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors';
        hideProgress();
    }
}

function showResults() {
    document.getElementById('results').classList.remove('hidden');
}

function hideResults() {
    document.getElementById('results').classList.add('hidden');
    const jsonView = document.getElementById('jsonView');
    if (jsonView) jsonView.classList.add('hidden');
    const jsonBtn = document.getElementById('jsonToggleBtn');
    if (jsonBtn) jsonBtn.textContent = '{ }';
    const metricsEl = document.getElementById('metricsRow');
    if (metricsEl) metricsEl.innerHTML = '';
}

function showError(msg) {
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('errorDisplay').classList.remove('hidden');
    log(`Error: ${msg}`, 'error');
}

function showSlotError(slotId, msg) {
    if (slotId === 'play') {
        showError(msg);
        return;
    }
    const errEl = getErrorContainer(slotId);
    if (errEl) {
        errEl.querySelector('.slot-error-msg').textContent = msg;
        errEl.classList.remove('hidden');
    }
    log(`[${slotId}] Error: ${msg}`, 'error');
}

function hideError() {
    document.getElementById('errorDisplay').classList.add('hidden');
    // Also hide compare slot errors
    const leftErr = document.getElementById('compareLeftError');
    const rightErr = document.getElementById('compareRightError');
    if (leftErr) leftErr.classList.add('hidden');
    if (rightErr) rightErr.classList.add('hidden');
}

function showBaseUrl(url) {
    const el = document.getElementById('baseUrl');
    el.textContent = url;
    el.classList.remove('hidden');
}

function hideBaseUrl() {
    const el = document.getElementById('baseUrl');
    el.textContent = '';
    el.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Log console
// ---------------------------------------------------------------------------

function log(message, type = 'info') {
    const consoleEl = document.getElementById('logConsole');
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${timestamp}] ${message}`;
    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;

    const drawer = document.getElementById('logDrawer');
    if (!drawer.classList.contains('log-drawer-open')) {
        logEntryCount++;
        updateLogCount();
    }
}

function clearLog() {
    document.getElementById('logConsole').innerHTML = '';
    logEntryCount = 0;
    updateLogCount();
}

// ---------------------------------------------------------------------------
// Model picker
// ---------------------------------------------------------------------------

function populateModelPicker(definition) {
    const group = document.getElementById('modelPickerGroup');
    const picker = document.getElementById('modelPicker');
    const modelParam = definition.request.params.find(p => p.name === 'model' && p.ui === 'dropdown');

    if (!modelParam || !modelParam.options || modelParam.options.length === 0) {
        hideModelPicker();
        return;
    }

    picker.innerHTML = '';
    for (const opt of modelParam.options) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (opt === modelParam.default) option.selected = true;
        picker.appendChild(option);
    }

    group.classList.remove('hidden');
}

function hideModelPicker() {
    document.getElementById('modelPickerGroup').classList.add('hidden');
    document.getElementById('modelPicker').innerHTML = '';
}

// ---------------------------------------------------------------------------
// Provider filtering (Play mode)
// ---------------------------------------------------------------------------

function onProviderChange() {
    const providerSlug = document.getElementById('providerPicker').value;
    const picker = document.getElementById('definitionPicker');

    const filtered = providerSlug
        ? DEFINITIONS_LIST.filter(d => d.provider === providerSlug)
        : DEFINITIONS_LIST;

    picker.innerHTML = '';

    if (filtered.length === 1) {
        const opt = document.createElement('option');
        opt.value = filtered[0].id;
        opt.textContent = filtered[0].name;
        picker.appendChild(opt);
        picker.value = filtered[0].id;
        onDefinitionChange();
    } else {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select an endpoint...';
        picker.appendChild(placeholder);
        for (const d of filtered) {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.name;
            picker.appendChild(opt);
        }
        picker.value = '';
        document.getElementById('playground').classList.add('hidden');
        hideModelPicker();
        hideBaseUrl();
        slots.play.definition = null;
    }
}

function initProviderPicker() {
    const providerPicker = document.getElementById('providerPicker');
    const providers = [...new Set(DEFINITIONS_LIST.map(d => d.provider))].sort();

    for (const slug of providers) {
        const opt = document.createElement('option');
        opt.value = slug;
        opt.textContent = PROVIDER_NAMES[slug] || slug;
        providerPicker.appendChild(opt);
    }
}

// ---------------------------------------------------------------------------
// Compare mode — picker handlers
// ---------------------------------------------------------------------------

function initCompareProviderPickers() {
    for (const side of ['Left', 'Right']) {
        const picker = document.getElementById(`compare${side}Provider`);
        if (!picker) continue;
        picker.innerHTML = '<option value="">Provider</option>';
        const providers = [...new Set(DEFINITIONS_LIST.map(d => d.provider))].sort();
        for (const slug of providers) {
            const opt = document.createElement('option');
            opt.value = slug;
            opt.textContent = PROVIDER_NAMES[slug] || slug;
            picker.appendChild(opt);
        }
    }
}

function onCompareProviderChange(side) {
    const providerSlug = document.getElementById(`compare${side}Provider`).value;
    const endpointPicker = document.getElementById(`compare${side}Endpoint`);
    const modelPicker = document.getElementById(`compare${side}Model`);

    endpointPicker.innerHTML = '<option value="">Endpoint</option>';
    modelPicker.innerHTML = '';
    modelPicker.classList.add('hidden');

    const otherSide = side === 'Left' ? 'right' : 'left';
    const otherDef = slots[otherSide].definition;
    const otherType = otherDef ? getOutputTypeFromList(otherDef.id) : null;

    let filtered = providerSlug
        ? DEFINITIONS_LIST.filter(d => d.provider === providerSlug)
        : DEFINITIONS_LIST;

    // Filter to compatible output types if other side has a selection
    if (otherType) {
        filtered = filtered.filter(d => d.output_type === otherType);
    }

    for (const d of filtered) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        endpointPicker.appendChild(opt);
    }

    const slotId = side.toLowerCase();
    slots[slotId].definition = null;

    updateCompareApiKey(side, providerSlug);
    checkCompareCompatibility();
}

function getOutputTypeFromList(defId) {
    const entry = DEFINITIONS_LIST.find(d => d.id === defId);
    return entry ? entry.output_type : null;
}

function filterOtherSideEndpoints(changedSide) {
    const otherSide = changedSide === 'Left' ? 'Right' : 'Left';
    const changedSlot = slots[changedSide.toLowerCase()];
    const otherEndpointPicker = document.getElementById(`compare${otherSide}Endpoint`);
    const otherProviderSlug = document.getElementById(`compare${otherSide}Provider`).value;

    // Preserve current selection
    const currentValue = otherEndpointPicker.value;

    // Determine the output type to filter by
    const filterType = changedSlot.definition
        ? getOutputTypeFromList(changedSlot.definition.id)
        : null;

    // Get base list filtered by provider
    let candidates = otherProviderSlug
        ? DEFINITIONS_LIST.filter(d => d.provider === otherProviderSlug)
        : DEFINITIONS_LIST;

    // Filter to compatible output types
    if (filterType) {
        candidates = candidates.filter(d => d.output_type === filterType);
    }

    otherEndpointPicker.innerHTML = '<option value="">Endpoint</option>';
    for (const d of candidates) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        otherEndpointPicker.appendChild(opt);
    }

    // Restore selection if it's still in the filtered list
    if (candidates.some(d => d.id === currentValue)) {
        otherEndpointPicker.value = currentValue;
    }
}

async function onCompareEndpointChange(side) {
    const endpointPicker = document.getElementById(`compare${side}Endpoint`);
    const modelPicker = document.getElementById(`compare${side}Model`);
    const defId = endpointPicker.value;
    const slotId = side.toLowerCase();

    modelPicker.innerHTML = '';
    modelPicker.classList.add('hidden');

    if (!defId) {
        slots[slotId].definition = null;
        filterOtherSideEndpoints(side);
        checkCompareCompatibility();
        return;
    }

    try {
        const resp = await fetch(`/api/definitions/${defId}`);
        const def = await resp.json();
        slots[slotId].definition = def;

        // Populate model picker
        const modelParam = def.request.params.find(p => p.name === 'model' && p.ui === 'dropdown');
        if (modelParam && modelParam.options && modelParam.options.length > 0) {
            for (const opt of modelParam.options) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (opt === modelParam.default) option.selected = true;
                modelPicker.appendChild(option);
            }
            modelPicker.classList.remove('hidden');
        }

        // Update API key
        updateCompareApiKey(side, def.provider);
        // Filter other side's endpoints to compatible types
        filterOtherSideEndpoints(side);
        log(`[${slotId}] Loaded: ${def.name}`, 'info');
    } catch (e) {
        log(`[${slotId}] Failed to load definition: ${e.message}`, 'error');
    }

    checkCompareCompatibility();
    updateCompareSystemPrompt();
    updateCompareForm();
}

function updateCompareApiKey(side, providerSlug) {
    const keyInput = document.getElementById(`compare${side}ApiKey`);
    if (!keyInput) return;
    if (providerSlug && typeof API_KEYS !== 'undefined' && API_KEYS[providerSlug]) {
        keyInput.value = API_KEYS[providerSlug];
    } else {
        keyInput.value = '';
    }
}

// ---------------------------------------------------------------------------
// Compare mode — output type and compatibility
// ---------------------------------------------------------------------------

function getOutputType(definition) {
    if (!definition) return null;
    const outputs = definition.response && definition.response.outputs;
    if (!outputs || outputs.length === 0) return null;
    return outputs[0].type;
}

function checkCompareCompatibility() {
    const leftDef = slots.left.definition;
    const rightDef = slots.right.definition;
    const warning = document.getElementById('compareWarning');
    const btn = document.getElementById('generateBtn');

    if (!leftDef || !rightDef) {
        if (warning) warning.classList.add('hidden');
        return;
    }

    const leftType = getOutputType(leftDef);
    const rightType = getOutputType(rightDef);

    if (leftType && rightType && leftType !== rightType) {
        if (warning) {
            warning.textContent = `Output type mismatch: ${leftType} vs ${rightType}. Select matching endpoint types.`;
            warning.classList.remove('hidden');
        }
        btn.disabled = true;
        btn.className = 'bg-gray-700 text-gray-400 text-sm font-medium px-5 py-2 rounded-md cursor-not-allowed';
    } else {
        if (warning) warning.classList.add('hidden');
        btn.disabled = false;
        btn.className = 'bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors';
    }
}

// ---------------------------------------------------------------------------
// Compare mode — system prompt visibility
// ---------------------------------------------------------------------------

function updateCompareSystemPrompt() {
    const leftDef = slots.left.definition;
    const rightDef = slots.right.definition;
    if (definitionUsesChat(leftDef) || definitionUsesChat(rightDef)) {
        showSystemPromptGroup();
    } else {
        hideSystemPromptGroup();
    }
}

// ---------------------------------------------------------------------------
// Compare mode — shared form rendering
// ---------------------------------------------------------------------------

function updateCompareForm() {
    const leftDef = slots.left.definition;
    const rightDef = slots.right.definition;

    // Show endpoint info
    if (leftDef && rightDef) {
        document.getElementById('endpointName').textContent = 'Compare';
        document.getElementById('endpointDescription').textContent = `${leftDef.name} vs ${rightDef.name}`;
    } else if (leftDef || rightDef) {
        const def = leftDef || rightDef;
        document.getElementById('endpointName').textContent = def.name;
        document.getElementById('endpointDescription').textContent = def.description || '';
    } else {
        document.getElementById('endpointName').textContent = 'Select endpoints to compare';
        document.getElementById('endpointDescription').textContent = '';
    }
    hideBaseUrl();

    // Compute shared params
    const { shared } = computeSharedParams(leftDef, rightDef);

    const container = document.getElementById('formFields');
    container.innerHTML = '';

    // Hide examples in compare mode
    document.getElementById('examplesRow').classList.add('hidden');

    for (const param of shared) {
        if (param.name === 'model' && param.ui === 'dropdown') continue;
        const field = createField(param);
        container.appendChild(field);
    }

    // Render side-only params
    const hasLeftOnly = renderSideOnlyParams('left', leftDef, shared);
    const hasRightOnly = renderSideOnlyParams('right', rightDef, shared);

    // Show/hide the side-only params container
    const sideParamsContainer = document.getElementById('compareSideParams');
    if (sideParamsContainer) {
        if (hasLeftOnly || hasRightOnly) {
            sideParamsContainer.classList.remove('hidden');
        } else {
            sideParamsContainer.classList.add('hidden');
        }
    }
}

function computeSharedParams(leftDef, rightDef) {
    if (!leftDef && !rightDef) return { shared: [], leftOnly: [], rightOnly: [] };
    if (!leftDef) return { shared: [], leftOnly: [], rightOnly: rightDef.request.params };
    if (!rightDef) return { shared: [], leftOnly: leftDef.request.params, rightOnly: [] };

    const leftParams = leftDef.request.params;
    const rightParams = rightDef.request.params;
    const rightNames = new Set(rightParams.map(p => p.name));
    const leftNames = new Set(leftParams.map(p => p.name));

    const shared = leftParams.filter(p => rightNames.has(p.name));
    const leftOnly = leftParams.filter(p => !rightNames.has(p.name));
    const rightOnly = rightParams.filter(p => !leftNames.has(p.name));

    return { shared, leftOnly, rightOnly };
}

function renderSideOnlyParams(side, def, sharedParams) {
    const capSide = side.charAt(0).toUpperCase() + side.slice(1);
    const container = document.getElementById(`compare${capSide}Params`);
    if (!container) return false;
    container.innerHTML = '';
    // Use invisible (not hidden) so the grid column keeps its space
    const parentCol = container.parentElement;

    if (!def) {
        if (parentCol) { parentCol.classList.add('invisible'); parentCol.classList.remove('visible'); }
        return false;
    }

    const sharedNames = new Set(sharedParams.map(p => p.name));
    const sideOnly = def.request.params.filter(p => !sharedNames.has(p.name) && !(p.name === 'model' && p.ui === 'dropdown'));

    if (sideOnly.length === 0) {
        if (parentCol) { parentCol.classList.add('invisible'); parentCol.classList.remove('visible'); }
        return false;
    }

    if (parentCol) { parentCol.classList.remove('invisible'); parentCol.classList.add('visible'); }
    for (const param of sideOnly) {
        const field = createField(param);
        container.appendChild(field);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Compare mode — generate
// ---------------------------------------------------------------------------

async function onCompareGenerate() {
    const leftDef = slots.left.definition;
    const rightDef = slots.right.definition;

    if (!leftDef || !rightDef) {
        showError('Please select endpoints for both Left and Right.');
        return;
    }

    const leftApiKey = document.getElementById('compareLeftApiKey').value.trim();
    const rightApiKey = document.getElementById('compareRightApiKey').value.trim();

    if (!leftApiKey || !rightApiKey) {
        showError('API keys required for both sides.');
        return;
    }

    // Collect shared params from form
    const sharedParams = collectParams();

    // Collect left-side model
    const leftModelPicker = document.getElementById('compareLeftModel');
    const leftModel = leftModelPicker && !leftModelPicker.classList.contains('hidden') ? leftModelPicker.value : null;

    // Collect right-side model
    const rightModelPicker = document.getElementById('compareRightModel');
    const rightModel = rightModelPicker && !rightModelPicker.classList.contains('hidden') ? rightModelPicker.value : null;

    // Build per-side params
    const leftParams = { ...sharedParams };
    if (leftModel) leftParams['model'] = leftModel;
    collectSideParams('Left', leftParams);

    const rightParams = { ...sharedParams };
    if (rightModel) rightParams['model'] = rightModel;
    collectSideParams('Right', rightParams);

    // Validate
    for (const param of leftDef.request.params) {
        if (param.required && !leftParams[param.name]) {
            showError(`Left: "${param.name}" is required.`);
            return;
        }
    }
    for (const param of rightDef.request.params) {
        if (param.required && !rightParams[param.name]) {
            showError(`Right: "${param.name}" is required.`);
            return;
        }
    }

    hideError();
    setGenerating(true);

    // Show compare results, clear previous
    const compareResults = document.getElementById('compareResults');
    compareResults.classList.remove('hidden');
    getOutputContainer('left').innerHTML = '';
    getOutputContainer('right').innerHTML = '';
    const leftMetrics = getMetricsContainer('left');
    const rightMetrics = getMetricsContainer('right');
    if (leftMetrics) leftMetrics.innerHTML = '';
    if (rightMetrics) rightMetrics.innerHTML = '';
    // Hide errors
    const leftErr = document.getElementById('compareLeftError');
    const rightErr = document.getElementById('compareRightError');
    if (leftErr) leftErr.classList.add('hidden');
    if (rightErr) rightErr.classList.add('hidden');

    // Execute both sides in parallel
    const results = await Promise.allSettled([
        executeSlot('left', leftApiKey, leftParams),
        executeSlot('right', rightApiKey, rightParams),
    ]);

    log('Compare generation complete.', 'info');
    setGenerating(false);
}

function collectSideParams(side, params) {
    const container = document.getElementById(`compare${side}Params`);
    if (!container) return;
    const fields = container.querySelectorAll('[data-param-name]');
    for (const field of fields) {
        params[field.dataset.paramName] = field.value;
    }
}

async function executeSlot(slotId, apiKey, params) {
    const slot = slots[slotId];
    const def = slot.definition;
    const pattern = def.interaction.pattern;

    if (pattern === 'streaming') {
        log(`[${slotId}] POST /api/stream (${def.name})`, 'request');
        await startStreaming(slotId, apiKey, params);
    } else {
        log(`[${slotId}] POST /api/generate (${def.name})`, 'request');
        const syncStart = performance.now();

        try {
            slot.abortController = new AbortController();
            const resp = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    definition_id: def.id,
                    api_key: apiKey,
                    params: params,
                }),
                signal: slot.abortController.signal,
            });

            const data = await resp.json();
            const submitTime = performance.now() - syncStart;
            slot.lastSentRequest = data.sent_request;

            if (data.error) {
                showSlotError(slotId, typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
                return;
            }

            if (pattern === 'polling' && data.request_id) {
                log(`[${slotId}] Job submitted in ${submitTime.toFixed(0)}ms. request_id: ${data.request_id}`, 'info');
                await new Promise((resolve) => {
                    startPollingAsync(slotId, data.request_id, apiKey, resolve);
                });
            } else {
                const syncMetrics = { totalTime: performance.now() - syncStart, submitTime };
                slot.lastResponse = data.response;
                if (data.outputs && data.outputs.length > 0) {
                    renderOutputs(data.outputs, slotId);
                } else {
                    renderOutputs([{type: 'text', value: [JSON.stringify(data.response, null, 2)]}], slotId);
                }
                renderMetrics(syncMetrics, getMetricsContainer(slotId));
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            showSlotError(slotId, e.message);
        }
    }
}

// Async polling that resolves when done (for compare mode Promise.allSettled)
function startPollingAsync(slotId, requestId, apiKey, resolve) {
    const slot = slots[slotId];
    slot.polling = true;
    const def = slot.definition;
    const interval = def.interaction.poll_interval_ms || 2000;
    const metrics = { startTime: performance.now(), submitTime: null, pollCount: 0, totalTime: null };
    log(`[${slotId}] Polling every ${interval}ms...`, 'info');

    (async function loop() {
        let consecutiveErrors = 0;
        const MAX_POLL_ERRORS = 10;

        while (slot.polling) {
            try {
                metrics.pollCount++;
                const url = `/api/status?definition_id=${def.id}&api_key=${encodeURIComponent(apiKey)}&request_id=${encodeURIComponent(requestId)}`;
                const resp = await fetch(url);
                const data = await resp.json();
                consecutiveErrors = 0;

                log(`[${slotId}] Status: ${data.poll_status} (poll #${metrics.pollCount})`, 'info');

                if (data.poll_status === 'done') {
                    metrics.totalTime = performance.now() - metrics.startTime;
                    await fetchResult(slotId, requestId, apiKey);
                    renderMetrics(metrics, getMetricsContainer(slotId));
                    slot.polling = false;
                    resolve();
                    return;
                }

                if (data.poll_status === 'failed' || data.poll_status === 'error') {
                    showSlotError(slotId, 'Generation failed.');
                    slot.polling = false;
                    resolve();
                    return;
                }
            } catch (e) {
                consecutiveErrors++;
                log(`[${slotId}] Poll error: ${e.message}`, 'error');
                if (consecutiveErrors >= MAX_POLL_ERRORS) {
                    showSlotError(slotId, 'Polling failed after too many errors.');
                    slot.polling = false;
                    resolve();
                    return;
                }
            }
            await new Promise(r => setTimeout(r, interval));
        }
        resolve();
    })();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

initProviderPicker();
initCompareProviderPickers();
