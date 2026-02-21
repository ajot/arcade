# arcade UI Refresh — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the arcade frontend as a minimal, single-centered-column layout with collapsed log drawer, refined visuals, and smoother interaction flow.

**Architecture:** Three files change: `templates/index.html` (layout restructure), `static/app.js` (log drawer, progress bar, inline spinner, updated class names), `static/style.css` (new styles for drawer, progress bar, refined colors). Backend is untouched.

**Tech Stack:** Tailwind CDN (already in use), vanilla JS, Jinja2 templates.

---

### Task 1: Restructure HTML layout — top bar + centered column

**Files:**
- Modify: `templates/index.html` (full rewrite of body content)

**Step 1: Rewrite index.html with new layout structure**

Replace the entire body content of `templates/index.html`. The new structure:

```html
<body class="bg-gray-950 text-gray-100 min-h-screen">

    <!-- Top bar -->
    <header class="fixed top-0 left-0 right-0 z-40 bg-gray-950/80 backdrop-blur-sm border-b border-gray-800">
        <div class="max-w-5xl mx-auto flex items-center gap-4 px-6 h-14">
            <span class="text-sm font-semibold text-white tracking-tight mr-4">arcade</span>

            <select id="providerPicker" onchange="onProviderChange()"
                    class="bg-transparent border border-gray-800 rounded-md px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                <option value="">All Providers</option>
            </select>

            <select id="definitionPicker" onchange="onDefinitionChange()"
                    class="bg-transparent border border-gray-800 rounded-md px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                <option value="">Select endpoint...</option>
                {% for d in definitions %}
                <option value="{{ d.id }}">{{ d.name }}</option>
                {% endfor %}
            </select>

            <div id="modelPickerGroup" class="hidden">
                <select id="modelPicker"
                        class="bg-transparent border border-gray-800 rounded-md px-2 py-1 text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                </select>
            </div>

            <div class="ml-auto flex items-center gap-2">
                <button id="apiKeyToggle" onclick="toggleApiKeyInput()" class="text-gray-500 hover:text-gray-300 transition-colors" title="API Key">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                    </svg>
                </button>
                <div id="apiKeyWrapper" class="hidden">
                    <input type="password" id="apiKey" placeholder="API key"
                           class="bg-gray-900 border border-gray-800 rounded-md px-2 py-1 text-sm text-white w-48 focus:outline-none focus:border-blue-500">
                </div>
                <p id="apiKeyHint" class="text-xs text-gray-600 hidden"></p>
            </div>
        </div>
    </header>

    <!-- Progress bar -->
    <div id="progressBar" class="fixed top-14 left-0 right-0 z-30 hidden">
        <div class="h-0.5 bg-blue-500 animate-progress"></div>
    </div>

    <!-- Main centered column -->
    <main class="max-w-[720px] mx-auto px-6 pt-24 pb-24">

        <!-- Endpoint info -->
        <div id="playground" class="hidden">
            <div class="mb-8">
                <h2 id="endpointName" class="text-lg font-light text-white mb-1"></h2>
                <p id="endpointDescription" class="text-sm text-gray-500"></p>
                <p id="baseUrl" class="text-xs text-gray-600 font-mono mt-1 hidden"></p>
            </div>

            <!-- Examples -->
            <div id="examplesRow" class="mb-6 hidden">
                <div id="exampleButtons" class="flex flex-wrap gap-2"></div>
            </div>

            <!-- Form fields -->
            <div id="formFields" class="space-y-5"></div>

            <!-- Generate button -->
            <div class="mt-6">
                <button id="generateBtn" onclick="onGenerate()"
                        class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors">
                    Generate
                </button>
            </div>
        </div>

        <!-- Results -->
        <div id="results" class="hidden mt-10">
            <div class="flex items-center justify-between mb-4">
                <div class="h-px flex-1 bg-gray-800"></div>
                <span class="px-3 text-xs text-gray-600 uppercase tracking-wider">Result</span>
                <div class="h-px flex-1 bg-gray-800"></div>
            </div>
            <!-- Rendered output -->
            <div id="renderedOutput" class="space-y-4"></div>
            <!-- JSON toggle -->
            <div class="mt-4">
                <button id="jsonToggleBtn" onclick="toggleJson()"
                        class="text-xs text-gray-600 hover:text-gray-400 font-mono transition-colors">
                    { }
                </button>
            </div>
            <!-- Raw JSON (hidden by default) -->
            <div id="jsonView" class="hidden mt-3 space-y-3">
                <div>
                    <h4 class="text-xs text-gray-600 mb-1 uppercase tracking-wider">Request</h4>
                    <pre id="jsonRequest" class="bg-gray-900 rounded-md p-3 text-xs text-green-400/80 overflow-x-auto max-h-64 overflow-y-auto"></pre>
                </div>
                <div>
                    <h4 class="text-xs text-gray-600 mb-1 uppercase tracking-wider">Response</h4>
                    <pre id="jsonResponse" class="bg-gray-900 rounded-md p-3 text-xs text-blue-400/80 overflow-x-auto max-h-64 overflow-y-auto"></pre>
                </div>
            </div>
        </div>

        <!-- Error display -->
        <div id="errorDisplay" class="hidden mt-6">
            <div class="border border-red-900/50 rounded-md px-4 py-3">
                <p id="errorMessage" class="text-red-400 text-sm"></p>
            </div>
        </div>

    </main>

    <!-- Log drawer -->
    <div id="logDrawer" class="fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 translate-y-full">
        <div class="bg-gray-950 border-t border-gray-800" style="height: 300px;">
            <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800">
                <span class="text-xs text-gray-500 uppercase tracking-wider">Log</span>
                <div class="flex items-center gap-3">
                    <button onclick="clearLog()" class="text-xs text-gray-600 hover:text-gray-400">Clear</button>
                    <button onclick="toggleLogDrawer()" class="text-xs text-gray-600 hover:text-gray-400">Close</button>
                </div>
            </div>
            <div id="logConsole" class="log-console overflow-y-auto px-4 py-2" style="height: 260px;"></div>
        </div>
    </div>

    <!-- Log drawer toggle pill -->
    <button id="logPill" onclick="toggleLogDrawer()"
            class="fixed bottom-4 right-4 z-40 bg-gray-900 border border-gray-800 rounded-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors">
        Log <span id="logCount" class="ml-1 text-gray-600 hidden">0</span>
    </button>

    <script>
        const API_KEYS = {{ api_keys | tojson }};
        const DEFINITIONS_LIST = {{ definitions | tojson }};
    </script>
    <script src="/static/app.js"></script>
</body>
```

Key changes from old layout:
- `bg-gray-950` body background (was `bg-gray-900`)
- Fixed slim top bar with inline dropdowns (was a separate card section)
- API key behind a lock icon toggle (was always-visible input)
- Single centered 720px column (was 3-column grid with log taking 1/3)
- No card wrappers on form area (fields float on page)
- Progress bar strip below top bar (replaces status text)
- Result divider line instead of card header
- `{ }` icon button for JSON toggle (was "Show JSON" button)
- Error display is minimal (no red background card, just border)
- Log drawer at bottom, collapsed (was right column, always visible)
- Log pill with count badge at bottom-right

**Step 2: Verify the page loads**

Run: `cd /Users/ajotwani/Dropbox/dev_projects/model-play && python app.py`
Open: `localhost:8080`
Expected: Page loads with slim top bar, empty centered column, log pill at bottom-right.

**Step 3: Commit**

```bash
git add templates/index.html
git commit -m "feat: restructure layout to centered single column with top bar"
```

---

### Task 2: Update CSS — progress bar, log drawer, refined styles

**Files:**
- Modify: `static/style.css` (full rewrite)

**Step 1: Rewrite style.css**

Replace `static/style.css` with:

```css
/* Progress bar animation */
.animate-progress {
    animation: progress 1.5s ease-in-out infinite;
}

@keyframes progress {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
}

/* Log drawer open state */
.log-drawer-open {
    transform: translateY(0) !important;
}

/* Log console */
.log-console {
    font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 11px;
    line-height: 1.6;
}

.log-entry {
    padding: 2px 0;
    word-break: break-all;
}

.log-request { color: #60a5fa; }
.log-response { color: #34d399; }
.log-error { color: #f87171; }
.log-info { color: #6b7280; }

/* Generate button spinner */
.btn-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    margin-right: 6px;
    vertical-align: middle;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Streaming cursor blink */
.streaming-cursor::after {
    content: '\25AE';
    animation: blink 0.8s step-end infinite;
    color: #60a5fa;
}

@keyframes blink {
    50% { opacity: 0; }
}

/* Scrollbar styling for dark theme */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #4b5563; }

/* Form field focus ring */
select:focus, input:focus, textarea:focus {
    outline: none;
    border-color: #3b82f6;
}

/* Tailwind overrides for top bar selects */
header select {
    background-image: none;
}
```

Key changes from old CSS:
- Progress bar sliding animation (new)
- Log drawer open/close transition class (new)
- Log info color changed from purple (`#a78bfa`) to muted gray (`#6b7280`) — less noisy
- Button spinner animation (new — replaces text "Generating...")
- Streaming cursor blink (new — replaces "Streaming..." text)
- Minimal scrollbar styling (new)
- Removed old `.animate-pulse` — replaced by progress bar

**Step 2: Verify styles load**

Run: refresh `localhost:8080`
Expected: Clean dark background, no visual regressions.

**Step 3: Commit**

```bash
git add static/style.css
git commit -m "feat: add progress bar, log drawer, and spinner styles"
```

---

### Task 3: Update app.js — log drawer, progress bar, API key toggle, refined interactions

**Files:**
- Modify: `static/app.js` (update existing functions, add new ones)

**Step 1: Update app.js**

This is the largest change. The JS logic stays the same but the UI interactions change:

**New functions to add:**

```javascript
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

let logEntryCount = 0;

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
```

**Functions to modify:**

`log()` — add entry count tracking:
```javascript
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
```

`setGenerating()` — inline spinner + progress bar:
```javascript
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
```

`renderForm()` — examples as pills above form, no label:
```javascript
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
```

`createField()` — updated classes for the minimal look:
```javascript
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
```

`createTextRenderer()` — cleaner styling:
```javascript
function createTextRenderer(text) {
    const pre = document.createElement('pre');
    pre.className = 'text-sm text-gray-300 whitespace-pre-wrap leading-relaxed';
    pre.textContent = text;
    return pre;
}
```

`createImageRenderer()` — minimal download link:
```javascript
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
```

`createAudioRenderer()` — minimal download link:
```javascript
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
```

`startStreaming()` — use streaming cursor class, no status text:
```javascript
// In startStreaming(), change the textBlock setup:
textBlock.className = 'text-sm text-gray-200 whitespace-pre-wrap leading-relaxed streaming-cursor';
// And at the end when streaming completes:
textBlock.classList.remove('streaming-cursor');
```

`startPolling()` — remove status indicator text (progress bar handles it):
```javascript
function startPolling(requestId, apiKey) {
    polling = true;
    const interval = currentDefinition.interaction.poll_interval_ms || 2000;
    log(`Polling every ${interval}ms...`, 'info');
    pollLoop(requestId, apiKey, interval);
}

function stopPolling() {
    polling = false;
}
```

`onDefinitionChange()` — auto-expand API key if not filled, show base URL inline:
```javascript
// In onDefinitionChange(), after auto-filling the API key:
if (typeof API_KEYS !== 'undefined' && API_KEYS[provider]) {
    keyInput.value = API_KEYS[provider];
    // Keep API key input hidden when auto-filled
} else {
    // Show API key input if no key loaded
    document.getElementById('apiKeyWrapper').classList.remove('hidden');
}
```

`fillExample()` — remove log call (silent fill per design):
```javascript
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
```

Remove `showBaseUrl()` / `hideBaseUrl()` — base URL is now inside the `#playground` div, controlled by showing/hiding:
```javascript
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
```

These stay the same but now target the element in its new location inside `#playground`.

`toggleJson()` — update button text to `{ }` / `[hide]`:
```javascript
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
```

**Step 2: Verify all interactions work**

Run: refresh `localhost:8080`
Test checklist:
- [ ] Provider dropdown filters endpoints
- [ ] Selecting an endpoint shows form with no card wrapper
- [ ] Example pills fill form silently
- [ ] Lock icon toggles API key input
- [ ] API key auto-fills and stays hidden when loaded from env
- [ ] Generate shows spinner on button + progress bar at top
- [ ] Polling works — progress bar animates, result appears below form
- [ ] Streaming works — text streams with blinking cursor, cursor disappears on completion
- [ ] JSON `{ }` toggle expands/collapses inline
- [ ] Error displays as minimal red border box
- [ ] Log pill shows count, clicking opens drawer, Close closes it

**Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: update JS for log drawer, progress bar, inline spinner, minimal styling"
```

---

### Task 4: Verify end-to-end with real API calls

**Files:** None (testing only)

**Step 1: Test polling endpoint (FLUX image generation)**

1. Open `localhost:8080`
2. Select DigitalOcean > FLUX.1 Schnell
3. Click "Space cat" example
4. Hit Generate
5. Verify: spinner on button, progress bar pulses, log pill count increments, image appears, `{ }` toggle works

**Step 2: Test streaming endpoint (OpenAI Chat)**

1. Select OpenAI > OpenAI Chat Completions
2. Click "Write a haiku" example
3. Hit Generate
4. Verify: text streams in with blinking cursor, cursor disappears when done

**Step 3: Test error state**

1. Clear API key, try to generate
2. Verify: minimal error message appears below form

**Step 4: Test log drawer**

1. Open log pill
2. Verify: drawer slides up with entries
3. Click Close
4. Verify: drawer slides down, pill reappears

**Step 5: Test responsive**

1. Resize to mobile width
2. Verify: top bar dropdowns wrap, column goes full-width with padding

**Step 6: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: polish UI after end-to-end testing"
```

---

### Files Modified (summary)

| File | Change |
|---|---|
| `templates/index.html` | Full layout rewrite — top bar, centered column, log drawer |
| `static/style.css` | Full rewrite — progress bar, drawer, spinner, cursor animations |
| `static/app.js` | Update all UI functions for new layout + add drawer/progress/key toggle |

### Files NOT Modified

| File | Why |
|---|---|
| `app.py` | Backend untouched |
| `proxy.py` | Backend untouched |
| `validate.py` | Unrelated |
| `definitions/*.json` | Unrelated |
| `requirements.txt` | No new deps |
