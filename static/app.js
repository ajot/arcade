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
// State
// ---------------------------------------------------------------------------

let currentDefinition = null;
let polling = false;
let lastSentRequest = null;
let lastResponse = null;
let logEntryCount = 0;

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
        // Reset count
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
// Definition switching
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
    stopPolling();
    hideModelPicker();
    hideBaseUrl();

    if (!id) {
        playground.classList.add('hidden');
        currentDefinition = null;
        return;
    }

    log(`Loading definition: ${id}`, 'info');

    try {
        const resp = await fetch(`/api/definitions/${id}`);
        currentDefinition = await resp.json();

        // Populate model picker if definition has a model param
        populateModelPicker(currentDefinition);
        showBaseUrl(currentDefinition.request.url);

        renderForm(currentDefinition);
        playground.classList.remove('hidden');

        // Auto-fill API key from .env if available
        const provider = currentDefinition.provider;
        const keyInput = document.getElementById('apiKey');
        const hint = document.getElementById('apiKeyHint');
        if (typeof API_KEYS !== 'undefined' && API_KEYS[provider]) {
            keyInput.value = API_KEYS[provider];
            hint.textContent = `Key loaded from environment for ${provider}`;
            hint.classList.remove('hidden');
            // Keep API key input hidden when auto-filled
        } else {
            hint.classList.add('hidden');
            // Show API key input if no key loaded
            document.getElementById('apiKeyWrapper').classList.remove('hidden');
        }

        log(`Loaded: ${currentDefinition.name}`, 'info');
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

    // Include model from config bar picker if visible
    const modelGroup = document.getElementById('modelPickerGroup');
    if (!modelGroup.classList.contains('hidden')) {
        params['model'] = document.getElementById('modelPicker').value;
    }

    const fields = document.querySelectorAll('#formFields [data-param-name]');
    for (const field of fields) {
        const name = field.dataset.paramName;
        if (field.type === 'range') {
            params[name] = field.value;
        } else {
            params[name] = field.value;
        }
    }
    return params;
}

// ---------------------------------------------------------------------------
// Generate (submit)
// ---------------------------------------------------------------------------

async function onGenerate() {
    if (!currentDefinition) return;

    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        showError('Please enter an API key.');
        return;
    }

    const params = collectParams();

    // Validate required params
    for (const param of currentDefinition.request.params) {
        if (param.required && !params[param.name]) {
            showError(`"${param.name}" is required.`);
            return;
        }
    }

    hideError();
    hideResults();
    setGenerating(true);

    const pattern = currentDefinition.interaction.pattern;

    if (pattern === 'streaming') {
        log(`POST /api/stream (${currentDefinition.name})`, 'request');
        log(`Params: ${JSON.stringify(params)}`, 'info');
        startStreaming(apiKey, params);
    } else {
        log(`POST /api/generate (${currentDefinition.name})`, 'request');
        log(`Params: ${JSON.stringify(params)}`, 'info');

        try {
            const resp = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    definition_id: currentDefinition.id,
                    api_key: apiKey,
                    params: params,
                }),
            });

            const data = await resp.json();
            lastSentRequest = data.sent_request;

            log(`Response: ${resp.status}`, resp.ok ? 'response' : 'error');

            if (data.error) {
                showError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
                setGenerating(false);
                return;
            }

            // Polling flow
            if (pattern === 'polling' && data.request_id) {
                log(`Job submitted. request_id: ${data.request_id}`, 'info');
                startPolling(data.request_id, apiKey);
            } else {
                // Sync response
                lastResponse = data.response;
                renderOutputs([{type: 'text', value: [JSON.stringify(data.response, null, 2)]}]);
                setGenerating(false);
            }
        } catch (e) {
            log(`Error: ${e.message}`, 'error');
            showError(e.message);
            setGenerating(false);
        }
    }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

async function startStreaming(apiKey, params) {
    // Prepare the output area with an empty text block
    const container = document.getElementById('renderedOutput');
    container.innerHTML = '';
    const textBlock = document.createElement('pre');
    textBlock.className = 'text-sm text-gray-200 whitespace-pre-wrap leading-relaxed streaming-cursor';
    textBlock.textContent = '';
    container.appendChild(textBlock);
    showResults();

    let fullText = '';

    try {
        const resp = await fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                definition_id: currentDefinition.id,
                api_key: apiKey,
                params: params,
            }),
        });

        if (!resp.ok) {
            const errData = await resp.json();
            showError(errData.error || 'Stream request failed');
            setGenerating(false);
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
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('event: request_info')) {
                    continue;
                }
                if (line.startsWith('event: error')) {
                    continue;
                }
                if (line.startsWith('event: done')) {
                    log('Stream complete.', 'response');
                    continue;
                }
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.token) {
                            fullText += data.token;
                            textBlock.textContent = fullText;
                            // Auto-scroll
                            textBlock.scrollTop = textBlock.scrollHeight;
                        }
                        if (data.error) {
                            showError(data.error);
                        }
                        // Capture request info for JSON toggle
                        if (data.method) {
                            lastSentRequest = data;
                        }
                    } catch (e) {
                        // Skip unparseable chunks
                    }
                }
            }
        }

        lastResponse = { text: fullText };
        log(`Streamed ${fullText.length} characters.`, 'response');

    } catch (e) {
        log(`Stream error: ${e.message}`, 'error');
        showError(e.message);
    }

    textBlock.classList.remove('streaming-cursor');
    setGenerating(false);
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

function startPolling(requestId, apiKey) {
    polling = true;
    const interval = currentDefinition.interaction.poll_interval_ms || 2000;
    log(`Polling every ${interval}ms...`, 'info');
    pollLoop(requestId, apiKey, interval);
}

function stopPolling() {
    polling = false;
}

async function pollLoop(requestId, apiKey, interval) {
    while (polling) {
        try {
            const url = `/api/status?definition_id=${currentDefinition.id}&api_key=${encodeURIComponent(apiKey)}&request_id=${encodeURIComponent(requestId)}`;
            const resp = await fetch(url);
            const data = await resp.json();

            log(`Status: ${data.poll_status}`, 'info');

            if (data.poll_status === 'done') {
                log('Job complete. Fetching result...', 'response');
                await fetchResult(requestId, apiKey);
                stopPolling();
                setGenerating(false);
                return;
            }

            if (data.poll_status === 'failed' || data.poll_status === 'error') {
                log('Job failed.', 'error');
                showError('Generation failed. Check the log for details.');
                stopPolling();
                setGenerating(false);
                return;
            }
        } catch (e) {
            log(`Poll error: ${e.message}`, 'error');
        }

        // Wait before next poll
        await new Promise(r => setTimeout(r, interval));
    }
}

async function fetchResult(requestId, apiKey) {
    try {
        const url = `/api/result?definition_id=${currentDefinition.id}&api_key=${encodeURIComponent(apiKey)}&request_id=${encodeURIComponent(requestId)}`;
        const resp = await fetch(url);
        const data = await resp.json();

        lastResponse = data.response;

        if (data.outputs && data.outputs.length > 0) {
            renderOutputs(data.outputs);
        } else {
            log('No outputs extracted from response.', 'error');
            renderRawFallback(data.response);
        }
    } catch (e) {
        log(`Result fetch error: ${e.message}`, 'error');
        showError('Failed to fetch result.');
    }
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

function renderOutputs(outputs) {
    const container = document.getElementById('renderedOutput');
    container.innerHTML = '';

    for (const output of outputs) {
        const values = Array.isArray(output.value) ? output.value : [output.value];

        for (const val of values) {
            if (!val) continue;

            switch (output.type) {
                case 'image':
                    container.appendChild(createImageRenderer(val, output.downloadable));
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

    showResults();
    log('Result rendered.', 'response');
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

function createAudioRenderer(url, downloadable) {
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

function renderRawFallback(data) {
    const container = document.getElementById('renderedOutput');
    container.innerHTML = '';
    container.appendChild(createTextRenderer(JSON.stringify(data, null, 2)));
    showResults();
}

// ---------------------------------------------------------------------------
// JSON toggle
// ---------------------------------------------------------------------------

function toggleJson() {
    const view = document.getElementById('jsonView');
    const btn = document.getElementById('jsonToggleBtn');
    const isHidden = view.classList.contains('hidden');

    if (isHidden) {
        view.classList.remove('hidden');
        btn.textContent = '[hide]';

        document.getElementById('jsonRequest').textContent =
            lastSentRequest ? JSON.stringify(lastSentRequest, null, 2) : 'No request captured';
        document.getElementById('jsonResponse').textContent =
            lastResponse ? JSON.stringify(lastResponse, null, 2) : 'No response captured';
    } else {
        view.classList.add('hidden');
        btn.textContent = '{ }';
    }
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
    document.getElementById('jsonView').classList.add('hidden');
    document.getElementById('jsonToggleBtn').textContent = '{ }';
}

function showError(msg) {
    document.getElementById('errorMessage').textContent = msg;
    document.getElementById('errorDisplay').classList.remove('hidden');
    log(`Error: ${msg}`, 'error');
}

function hideError() {
    document.getElementById('errorDisplay').classList.add('hidden');
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

    // Update count badge if drawer is closed
    const drawer = document.getElementById('logDrawer');
    if (!drawer.classList.contains('log-drawer-open')) {
        logEntryCount++;
        updateLogCount();
    }
}

function clearLog() {
    document.getElementById('logConsole').innerHTML = '';
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
// Provider filtering
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
        // Hide playground, model picker, and base URL when resetting endpoint selection
        document.getElementById('playground').classList.add('hidden');
        hideModelPicker();
        hideBaseUrl();
        currentDefinition = null;
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
// Initialization
// ---------------------------------------------------------------------------

initProviderPicker();
