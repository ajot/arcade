// ---------------------------------------------------------------------------
// Provider display names (derived from server-provided DEFINITIONS_LIST)
// ---------------------------------------------------------------------------

// Populated in init() from DEFINITIONS_LIST entries
let PROVIDER_NAMES = {};

// ---------------------------------------------------------------------------
// Type display names
// ---------------------------------------------------------------------------

const TYPE_NAMES = { text: 'Text', image: 'Image', audio: 'Audio', video: 'Video' };
const OUTPUT_TYPE_ICONS = {
    text:  '<span class="palette-item-type-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>',
    image: '<span class="palette-item-type-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></span>',
    audio: '<span class="palette-item-type-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></span>',
    video: '<span class="palette-item-type-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>',
};

function typeName(type) {
    return TYPE_NAMES[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

// ---------------------------------------------------------------------------
// State — slot-based model
// ---------------------------------------------------------------------------

let mode = 'play'; // 'play' | 'compare'
let logEntryCount = 0;

// Command palette state
let paletteOpen = false;
let paletteHighlightIndex = 0;
let paletteItems = []; // flat list of { type, id, ... } for keyboard nav
let paletteTarget = null; // null = default, 'left' or 'right' for compare side targeting
let paletteStep = 'endpoint'; // 'endpoint' | 'model'
let palettePendingDefId = null; // Definition ID chosen in step 1
let palettePendingDef = null; // Full definition object (fetched)
let palettePendingIsCompare = false; // Whether Shift was held in step 1
let streamEnabled = true; // Toggle for streaming vs sync on streaming-capable endpoints

function createSlot() {
    return {
        definition: null,
        polling: false,
        lastSentParams: null,
        lastResponse: null,
        abortController: null,
    };
}

let slots = {
    play: createSlot(),
    left: createSlot(),
    right: createSlot(),
};

// ---------------------------------------------------------------------------
// DOM helpers — map slot to containers
// ---------------------------------------------------------------------------

const SLOT_ELEMENTS = {
    play:  { output: 'renderedOutput',      metrics: 'metricsRow',           json: 'jsonView',              error: 'errorDisplay' },
    left:  { output: 'compareLeftOutput',    metrics: 'compareLeftMetrics',   json: 'compareLeftJsonView',   error: 'compareLeftError' },
    right: { output: 'compareRightOutput',   metrics: 'compareRightMetrics',  json: 'compareRightJsonView',  error: 'compareRightError' },
};

function getSlotElement(slotId, suffix) {
    return document.getElementById(SLOT_ELEMENTS[slotId]?.[suffix]);
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
// API key validation
// ---------------------------------------------------------------------------

const KEY_STATUS = {}; // provider -> 'valid' | 'invalid' | 'no_key' | 'unknown'

function hasApiKey(provider) {
    return provider && typeof API_KEYS !== 'undefined' && API_KEYS.has(provider);
}

function keyStatusLabel(provider) {
    const status = KEY_STATUS[provider];
    if (status === 'valid') return { text: 'key valid', cls: 'text-green-600' };
    if (status === 'invalid') return { text: 'key invalid', cls: 'text-red-500' };
    if (status === 'no_key') return { text: 'key missing \u2014 add to .env', cls: 'text-amber-500' };
    if (status === 'unknown' && hasApiKey(provider)) return { text: 'key loaded', cls: 'text-green-600' };
    if (hasApiKey(provider)) return { text: 'key loaded', cls: 'text-green-600' };
    return { text: 'key missing \u2014 add to .env', cls: 'text-amber-500' };
}

function showApiKeyStatus(provider) {
    const el = document.getElementById('apiKeyStatus');
    if (!provider) {
        el.classList.add('hidden');
        return;
    }
    const name = PROVIDER_NAMES[provider] || provider;
    const { text, cls } = keyStatusLabel(provider);
    el.textContent = `${name} ${text}`;
    el.className = `text-xs ${cls}`;
    el.classList.remove('hidden');
}

function showCompareKeyStatus(side, provider) {
    const el = document.getElementById(`compare${side}KeyStatus`);
    if (!el) return;
    if (!provider) {
        el.classList.add('hidden');
        return;
    }
    const { text, cls } = keyStatusLabel(provider);
    el.textContent = text;
    el.className = `text-[10px] shrink-0 ${cls}`;
    el.classList.remove('hidden');
}

function validateKeys() {
    fetch('/api/validate-keys')
        .then(r => r.json())
        .then(data => {
            Object.assign(KEY_STATUS, data);
            // Re-render status for currently selected endpoints
            const playDef = slots.play?.definition;
            if (playDef) showApiKeyStatus(playDef.provider);
            const leftDef = slots.left?.definition;
            if (leftDef) showCompareKeyStatus('Left', leftDef.provider);
            const rightDef = slots.right?.definition;
            if (rightDef) showCompareKeyStatus('Right', rightDef.provider);
        })
        .catch(() => {}); // fail silently
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

function showSystemPromptGroup() {
    document.getElementById('systemPromptGroup').classList.remove('hidden');
}

function hideSystemPromptGroup() {
    document.getElementById('systemPromptGroup').classList.add('hidden');
    document.getElementById('systemPromptInput').value = '';
}

// ---------------------------------------------------------------------------
// Settings section (collapsible advanced params + system prompt)
// ---------------------------------------------------------------------------

function toggleSettings() {
    const content = document.getElementById('settingsContent');
    const arrow = document.getElementById('settingsArrow');
    const summary = document.getElementById('settingsSummary');
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        arrow.style.transform = 'rotate(90deg)';
        summary.classList.add('hidden');
    } else {
        collapseSettings();
    }
}

function collapseSettings() {
    const content = document.getElementById('settingsContent');
    const arrow = document.getElementById('settingsArrow');
    const summary = document.getElementById('settingsSummary');
    content.classList.add('hidden');
    arrow.style.transform = '';
    summary.classList.remove('hidden');
    updateSettingsSummaryFromDOM();
}

function updateSettingsSummary(advancedParams) {
    const summary = document.getElementById('settingsSummary');
    if (!summary) return;
    const parts = [];
    for (const p of advancedParams) {
        if (p.default != null) {
            parts.push(`${p.name}: ${p.default}`);
        }
    }
    summary.textContent = parts.length > 0 ? parts.join(' \u00b7 ') : '';
}

function hideSettingsSection() {
    document.getElementById('settingsSection').classList.add('hidden');
    document.getElementById('advancedFields').innerHTML = '';
    document.getElementById('settingsContent').classList.add('hidden');
    document.getElementById('settingsArrow').style.transform = '';
    document.getElementById('settingsSummary').textContent = '';
}

function updateSettingsSummaryFromDOM() {
    const summary = document.getElementById('settingsSummary');
    if (!summary) return;
    const advancedContainer = document.getElementById('advancedFields');
    if (!advancedContainer) return;
    const fields = advancedContainer.querySelectorAll('[data-param-name]');
    const parts = [];
    for (const field of fields) {
        const name = field.dataset.paramName;
        let value;
        if (field.tagName === 'INPUT' && field.type === 'range') {
            value = field.value;
        } else if (field.tagName === 'DIV') {
            // Slider wrapper
            const range = field.querySelector('input[type="range"]');
            if (range) value = range.value;
        } else {
            value = field.value;
        }
        if (value != null && value !== '') {
            parts.push(`${name}: ${value}`);
        }
    }
    summary.textContent = parts.length > 0 ? parts.join(' \u00b7 ') : '';
}

function definitionUsesChat(definition) {
    if (!definition) return false;
    return (definition.request?.params || []).some(p => p.body_path === '_chat_message');
}

// ---------------------------------------------------------------------------
// Command palette
// ---------------------------------------------------------------------------

function openPalette(target, step) {
    paletteTarget = target || null;
    paletteOpen = true;
    paletteHighlightIndex = 0;
    paletteStep = step || 'endpoint';
    const el = document.getElementById('cmdPalette');
    const input = document.getElementById('cmdPaletteInput');
    el.classList.remove('hidden');
    input.value = '';
    input.focus();

    if (paletteStep === 'model' && palettePendingDef) {
        renderPaletteModelList('');
        renderPaletteBreadcrumb();
        updatePaletteFooter();
    } else {
        paletteStep = 'endpoint';
        renderPaletteList('');
        renderPaletteBreadcrumb();
        updatePaletteFooter();
    }
}

function closePalette() {
    paletteOpen = false;
    paletteTarget = null;
    paletteStep = 'endpoint';
    palettePendingDefId = null;
    palettePendingDef = null;
    palettePendingIsCompare = false;
    document.getElementById('cmdPalette').classList.add('hidden');
    document.getElementById('cmdPaletteInput').value = '';
    document.getElementById('cmdPaletteBreadcrumb').classList.add('hidden');
}

function togglePalette() {
    if (paletteOpen) {
        closePalette();
        return;
    }

    // Context-aware: if in play mode with an endpoint loaded that has models, open directly to model step
    if (mode === 'play' && slots.play.definition) {
        const def = slots.play.definition;
        const modelParam = def.request.params.find(p => p.name === 'model' && p.ui === 'dropdown');
        if (modelParam && modelParam.options && modelParam.options.length > 0) {
            palettePendingDefId = def.id;
            palettePendingDef = def;
            palettePendingIsCompare = false;
            openPalette(null, 'model');
            return;
        }
    }

    // Default: open to endpoint step
    openPalette();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderSaveBookmarkRow(list, q) {
    const hasLoadedEndpoint = (mode === 'play' && slots.play.definition)
        || (mode === 'compare' && (slots.left.definition || slots.right.definition));
    if (!hasLoadedEndpoint) return;
    if (q && !'save bookmark'.includes(q)) return;

    const saveIdx = paletteItems.length;
    const saveItem = document.createElement('div');
    saveItem.className = 'palette-item' + (saveIdx === 0 ? ' palette-highlighted' : '');
    saveItem.dataset.index = saveIdx;

    const saveLeft = document.createElement('span');
    saveLeft.innerHTML = '<span style="color:#6b7280;margin-right:6px;">+</span>'
        + '<span class="palette-item-name" style="color:#9ca3af;">Save as bookmark...</span>';

    saveItem.appendChild(saveLeft);
    saveItem.onmouseenter = () => highlightPaletteItem(saveIdx);
    saveItem.onclick = (e) => {
        e.stopPropagation();
        startInlineBookmarkSave(saveItem);
    };
    list.appendChild(saveItem);

    paletteItems.push({ type: 'save-bookmark' });
}

function renderPaletteList(query) {
    const list = document.getElementById('cmdPaletteList');
    list.innerHTML = '';
    paletteItems = [];
    const q = query.toLowerCase().trim();

    // --- Bookmarks section ---
    const filteredBookmarks = bookmarks.filter(bm => {
        if (!q) return true;
        const searchStr = [
            bm.name,
            bm.play?.definitionId,
            bm.compare?.left?.definitionId,
            bm.compare?.right?.definitionId,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchStr.includes(q);
    });

    if (filteredBookmarks.length > 0) {
        const header = document.createElement('div');
        header.className = 'palette-group-header';
        header.textContent = 'Bookmarks';
        list.appendChild(header);

        for (let i = 0; i < filteredBookmarks.length; i++) {
            const bm = filteredBookmarks[i];
            const idx = paletteItems.length;
            const item = document.createElement('div');
            item.className = 'palette-item' + (idx === 0 ? ' palette-highlighted' : '');
            item.dataset.index = idx;

            const left = document.createElement('span');
            left.innerHTML = '<span class="palette-bookmark-star">★</span>'
                + '<span class="palette-item-name">' + escapeHtml(bm.name) + '</span>';

            const right = document.createElement('span');
            right.className = 'flex items-center';
            const subtitle = document.createElement('span');
            subtitle.className = 'palette-item-model';
            subtitle.textContent = generateBookmarkSubtitle(bm);
            right.appendChild(subtitle);

            const bmIndex = bookmarks.indexOf(bm);
            const delBtn = document.createElement('span');
            delBtn.className = 'palette-bookmark-delete';
            delBtn.textContent = '×';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                await deleteBookmark(bmIndex);
                renderPaletteList(document.getElementById('cmdPaletteInput').value);
            };
            right.appendChild(delBtn);

            item.appendChild(left);
            item.appendChild(right);
            item.onmouseenter = () => highlightPaletteItem(idx);
            item.onclick = (e) => selectPaletteItem(idx, e.shiftKey);
            list.appendChild(item);

            paletteItems.push({ type: 'bookmark', index: bmIndex, bookmark: bm });
        }
    }

    renderSaveBookmarkRow(list, q);

    // --- Endpoint sections grouped by output_type, validated first ---
    let filtered = DEFINITIONS_LIST;
    if (q) {
        filtered = filtered.filter(d => {
            const searchStr = [d.name, d.provider, PROVIDER_NAMES[d.provider] || '', d.output_type || ''].join(' ').toLowerCase();
            return searchStr.includes(q);
        });
    }

    // Partition into validated (has key) and noKey
    const validated = [];
    const noKey = [];
    for (const d of filtered) {
        const keyOk = KEY_STATUS[d.provider] === 'valid' || (hasApiKey(d.provider) && KEY_STATUS[d.provider] !== 'invalid');
        if (keyOk) validated.push(d);
        else noKey.push(d);
    }

    const typeOrder = ['text', 'image', 'audio', 'video', 'other'];

    function renderEndpointGroup(endpoints, isNoKey) {
        const groups = {};
        for (const d of endpoints) {
            const t = d.output_type || 'other';
            if (!groups[t]) groups[t] = [];
            groups[t].push(d);
        }
        for (const t of typeOrder) {
            if (!groups[t] || groups[t].length === 0) continue;

            const header = document.createElement('div');
            header.className = 'palette-group-header';
            header.textContent = typeName(t);
            list.appendChild(header);

            for (const d of groups[t]) {
                const idx = paletteItems.length;
                const item = document.createElement('div');
                item.className = 'palette-item' + (idx === 0 ? ' palette-highlighted' : '');
                item.dataset.index = idx;

                if (isNoKey) item.classList.add('palette-item-disabled');

                const left = document.createElement('span');
                left.className = 'palette-item-left';
                const providerName = PROVIDER_NAMES[d.provider] || d.provider;
                let displayName = d.name;
                if (displayName.startsWith(providerName + ' ')) {
                    displayName = displayName.slice(providerName.length + 1);
                }
                const providerUrl = d.provider_url || '';
                const faviconHtml = providerUrl
                    ? '<img class="palette-item-icon" src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(providerUrl) + '&sz=16" alt="" width="16" height="16">'
                    : '';
                const typeIconHtml = OUTPUT_TYPE_ICONS[d.output_type] || '';
                left.innerHTML = typeIconHtml + faviconHtml
                    + '<span class="palette-item-provider">' + escapeHtml(providerName) + '</span>'
                    + '<span class="palette-item-name">' + escapeHtml(displayName) + '</span>';

                const right = document.createElement('span');
                right.className = 'palette-item-model';
                if (isNoKey) {
                    right.textContent = 'no key';
                } else {
                    const mc = d.model_count || 0;
                    right.textContent = mc > 1 ? mc + ' models' : '1 model';
                }

                item.appendChild(left);
                item.appendChild(right);
                item.onmouseenter = () => highlightPaletteItem(idx);
                item.onclick = (e) => selectPaletteItem(idx, e.shiftKey);
                list.appendChild(item);

                paletteItems.push({ type: 'endpoint', id: d.id, definition: d });
            }
        }
    }

    renderEndpointGroup(validated, false);
    renderEndpointGroup(noKey, true);

    // If nothing matched
    if (paletteItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'px-4 py-6 text-center text-xs text-gray-500';
        empty.textContent = 'No matching endpoints';
        list.appendChild(empty);
    }

    paletteHighlightIndex = 0;
}

function renderPaletteModelList(query) {
    const list = document.getElementById('cmdPaletteList');
    list.innerHTML = '';
    paletteItems = [];
    const q = query.toLowerCase().trim();

    if (!palettePendingDef) return;

    const modelParam = palettePendingDef.request.params.find(p => p.name === 'model' && p.ui === 'dropdown');
    if (!modelParam || !modelParam.options) return;

    let options = [...modelParam.options];

    // Filter by query
    if (q) {
        options = options.filter(m => m.toLowerCase().includes(q));
    }

    // Sort default model first
    const defaultModel = modelParam.default;
    options.sort((a, b) => {
        if (a === defaultModel) return -1;
        if (b === defaultModel) return 1;
        return 0;
    });

    const header = document.createElement('div');
    header.className = 'palette-group-header';
    header.textContent = 'Models';
    list.appendChild(header);

    for (const model of options) {
        const idx = paletteItems.length;
        const item = document.createElement('div');
        item.className = 'palette-item' + (idx === 0 ? ' palette-highlighted' : '');
        item.dataset.index = idx;

        const left = document.createElement('span');
        left.className = 'palette-item-left';
        const modelOutputType = (palettePendingDef.response?.outputs?.[0]?.type) || 'text';
        const modelTypeIconHtml = OUTPUT_TYPE_ICONS[modelOutputType] || '';
        left.innerHTML = modelTypeIconHtml + '<span class="palette-item-name">' + escapeHtml(model) + '</span>';

        const right = document.createElement('span');
        right.className = 'palette-item-model';
        right.textContent = model === defaultModel ? 'default' : '';

        item.appendChild(left);
        item.appendChild(right);
        item.onmouseenter = () => highlightPaletteItem(idx);
        item.onclick = () => selectPaletteModelItem(idx);
        list.appendChild(item);

        paletteItems.push({ type: 'model', value: model });
    }

    renderSaveBookmarkRow(list, q);

    if (paletteItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'px-4 py-6 text-center text-xs text-gray-500';
        empty.textContent = 'No matching models';
        list.appendChild(empty);
    }

    paletteHighlightIndex = 0;
}

function renderPaletteLoading() {
    const list = document.getElementById('cmdPaletteList');
    list.innerHTML = '';
    paletteItems = [];
    const loading = document.createElement('div');
    loading.className = 'px-4 py-6 text-center';
    loading.innerHTML = '<span class="palette-spinner"></span>';
    list.appendChild(loading);
}

function renderPaletteBreadcrumb() {
    const el = document.getElementById('cmdPaletteBreadcrumb');
    const input = document.getElementById('cmdPaletteInput');

    if (paletteStep === 'model' && palettePendingDef) {
        el.innerHTML = '';
        const link = document.createElement('span');
        link.className = 'palette-back-link';
        link.innerHTML = '&larr; ' + escapeHtml(palettePendingDef.name);
        link.onclick = () => paletteGoBack();
        el.appendChild(link);
        el.classList.remove('hidden');
        input.placeholder = 'Search models...';
    } else {
        el.classList.add('hidden');
        el.innerHTML = '';
        input.placeholder = 'Search endpoints...';
    }
}

function updatePaletteFooter() {
    const footer = document.getElementById('cmdPaletteFooter');
    if (paletteStep === 'model') {
        footer.innerHTML = '<span><kbd class="px-1 py-0.5 bg-gray-800 rounded text-[10px]">↵</kbd> Select model</span>'
            + '<span><kbd class="px-1 py-0.5 bg-gray-800 rounded text-[10px]">esc</kbd> Back</span>';
    } else {
        const hasActive = mode === 'play' && slots.play.definition;
        footer.innerHTML = '<span><kbd class="px-1 py-0.5 bg-gray-800 rounded text-[10px]">↵</kbd> Select</span>'
            + '<span id="cmdPaletteCompareHint" class="' + (hasActive ? '' : 'hidden') + '"><kbd class="px-1 py-0.5 bg-gray-800 rounded text-[10px]">⇧↵</kbd> Compare</span>'
            + '<span><kbd class="px-1 py-0.5 bg-gray-800 rounded text-[10px]">esc</kbd> Close</span>';
    }
}

function highlightPaletteItem(idx) {
    const list = document.getElementById('cmdPaletteList');
    const prev = list.querySelector('.palette-highlighted');
    if (prev) prev.classList.remove('palette-highlighted');
    paletteHighlightIndex = idx;
    const items = list.querySelectorAll('.palette-item');
    for (const item of items) {
        if (parseInt(item.dataset.index) === idx) {
            item.classList.add('palette-highlighted');
            item.scrollIntoView({ block: 'nearest' });
            break;
        }
    }
}

async function selectPaletteItem(idx, isCompare) {
    if (idx < 0 || idx >= paletteItems.length) return;
    const item = paletteItems[idx];

    if (item.type === 'bookmark') {
        closePalette();
        await restoreBookmark(item.bookmark);
        return;
    }

    if (item.type === 'save-bookmark') {
        // Activate inline save input
        const list = document.getElementById('cmdPaletteList');
        const rowEl = list.querySelector(`.palette-item[data-index="${idx}"]`);
        if (rowEl) startInlineBookmarkSave(rowEl);
        return;
    }

    // item.type === 'endpoint' — transition to model step
    await transitionToModelStep(item.id, isCompare);
}

async function transitionToModelStep(defId, isCompare) {
    palettePendingDefId = defId;
    palettePendingIsCompare = isCompare;
    renderPaletteLoading();

    try {
        const resp = await fetch(`/api/definitions/${defId}`);
        palettePendingDef = await resp.json();
    } catch (e) {
        log(`Failed to load definition: ${e.message}`, 'error');
        closePalette();
        return;
    }

    const modelParam = palettePendingDef.request.params.find(p => p.name === 'model' && p.ui === 'dropdown');
    if (!modelParam || !modelParam.options || modelParam.options.length === 0) {
        closePalette();
        await finalizeSelection(defId, null, isCompare);
        return;
    }

    paletteStep = 'model';
    const input = document.getElementById('cmdPaletteInput');
    input.value = '';
    renderPaletteModelList('');
    renderPaletteBreadcrumb();
    updatePaletteFooter();
    input.focus();
}

async function finalizeSelection(defId, modelValue, isCompare) {
    if (isCompare && mode === 'play' && slots.play.definition) {
        const currentDefId = slots.play.definition.id;
        setMode('compare');
        await loadCompareEndpoint('Left', currentDefId);
        await loadCompareEndpoint('Right', defId);
        if (modelValue) {
            const rightPicker = document.getElementById('compareRightModel');
            if (rightPicker) rightPicker.value = modelValue;
        }
        return;
    }

    if (mode === 'compare') {
        const side = paletteTarget || 'right';
        const capSide = side.charAt(0).toUpperCase() + side.slice(1);
        await loadCompareEndpoint(capSide, defId);
        if (modelValue) {
            const picker = document.getElementById(`compare${capSide}Model`);
            if (picker) picker.value = modelValue;
        }
        return;
    }

    await loadPlayEndpoint(defId);
    if (modelValue) {
        const picker = document.getElementById('modelPicker');
        if (picker) picker.value = modelValue;
    }
}

function selectPaletteModelItem(idx) {
    if (idx < 0 || idx >= paletteItems.length) return;
    const item = paletteItems[idx];

    if (item.type === 'save-bookmark') {
        const list = document.getElementById('cmdPaletteList');
        const rowEl = list.querySelector(`.palette-item[data-index="${idx}"]`);
        if (rowEl) startInlineBookmarkSave(rowEl);
        return;
    }

    if (item.type !== 'model') return;
    const defId = palettePendingDefId;
    const modelValue = item.value;
    const isCompare = palettePendingIsCompare;
    closePalette();
    finalizeSelection(defId, modelValue, isCompare);
}

function paletteGoBack() {
    if (paletteStep === 'model') {
        paletteStep = 'endpoint';
        palettePendingDefId = null;
        palettePendingDef = null;
        palettePendingIsCompare = false;
        const input = document.getElementById('cmdPaletteInput');
        input.value = '';
        renderPaletteList('');
        renderPaletteBreadcrumb();
        updatePaletteFooter();
        input.focus();
    } else {
        closePalette();
    }
}

async function loadPlayEndpoint(defId) {
    const playground = document.getElementById('playground');
    const results = document.getElementById('results');
    const errorDisplay = document.getElementById('errorDisplay');

    results.classList.add('hidden');
    errorDisplay.classList.add('hidden');
    abortSlot('play');
    hideModelPicker();
    hideBaseUrl();
    hideSystemPromptGroup();
    hideSettingsSection();
    showApiKeyStatus(null);

    if (!defId) {
        playground.classList.add('hidden');
        slots.play.definition = null;
        updateEndpointLabel();
        document.getElementById('welcomeState').classList.remove('hidden');
        document.getElementById('playPickers').classList.add('hidden');
        return;
    }

    log(`Loading definition: ${defId}`, 'info');

    try {
        const resp = await fetch(`/api/definitions/${defId}`);
        slots.play.definition = await resp.json();
        const def = slots.play.definition;

        document.getElementById('welcomeState').classList.add('hidden');
        document.getElementById('playPickers').classList.remove('hidden');
        populateModelPicker(def);
        showBaseUrl(def.request.url);
        renderForm(def);
        playground.classList.remove('hidden');

        // System prompt is now rendered inside settings section by renderForm
        if (definitionUsesChat(def)) {
            showSystemPromptGroup();
        }

        showApiKeyStatus(def.provider);
        updateStreamToggle(def);
        updateEndpointLabel();
        log(`Loaded: ${def.name}`, 'info');
    } catch (e) {
        log(`Failed to load definition: ${e.message}`, 'error');
    }
}

async function loadCompareEndpoint(side, defId) {
    const slotId = side.toLowerCase();
    const modelPicker = document.getElementById(`compare${side}Model`);
    modelPicker.innerHTML = '';
    modelPicker.classList.add('hidden');

    if (!defId) {
        slots[slotId].definition = null;
        updateCompareEndpointLabel(side);
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

        showCompareKeyStatus(side, def.provider);
        log(`[${slotId}] Loaded: ${def.name}`, 'info');
    } catch (e) {
        log(`[${slotId}] Failed to load definition: ${e.message}`, 'error');
    }

    updateCompareEndpointLabel(side);
    checkCompareCompatibility();
    updateCompareSystemPrompt();
    updateCompareForm();
}

function getProviderFaviconUrl(def) {
    const providerUrl = def && def.provider_url;
    if (!providerUrl) return null;
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(providerUrl) + '&sz=32';
}

function updateEndpointLabel() {
    const label = document.getElementById('endpointLabelText');
    const btn = document.getElementById('endpointLabelBtn');
    if (!label) return;
    const def = slots.play.definition;
    if (def) {
        const faviconUrl = getProviderFaviconUrl(def);
        // Add favicon before text in the button
        let existingImg = btn.querySelector('.endpoint-label-favicon');
        if (faviconUrl) {
            if (!existingImg) {
                existingImg = document.createElement('img');
                existingImg.className = 'endpoint-label-favicon w-4 h-4 rounded-sm';
                btn.insertBefore(existingImg, label);
            }
            existingImg.src = faviconUrl;
        } else if (existingImg) {
            existingImg.remove();
        }
        label.textContent = def.name;
    } else {
        const existingImg = btn.querySelector('.endpoint-label-favicon');
        if (existingImg) existingImg.remove();
        label.textContent = 'Select an endpoint...';
    }
}

function goHome(e) {
    if (e) e.preventDefault();
    abortAllSlots();
    if (mode === 'compare') setMode('play');
    loadPlayEndpoint(null);
}

function updateCompareEndpointLabel(side) {
    const label = document.getElementById(`compare${side}LabelText`);
    if (!label) return;
    const slotId = side.toLowerCase();
    const def = slots[slotId].definition;
    if (def) {
        label.textContent = def.name;
    } else {
        label.textContent = 'Select endpoint...';
    }
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
    const playground = document.getElementById('playground');
    const progressBar = document.getElementById('progressBar');

    if (mode === 'play') {
        mainCol.style.maxWidth = '720px';
        mainCol.style.paddingTop = '7.5rem';
        progressBar.style.top = '96px';
        comparePickers.classList.add('hidden');
        compareResults.classList.add('hidden');
        document.getElementById('compareSideParams').classList.add('hidden');
        // Restore play mode state
        if (slots.play.definition) {
            playground.classList.remove('hidden');
            playPickers.classList.remove('hidden');
            document.getElementById('welcomeState').classList.add('hidden');
        } else {
            playground.classList.add('hidden');
            playPickers.classList.add('hidden');
            document.getElementById('welcomeState').classList.remove('hidden');
        }
        // Restore system prompt + settings for play definition
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
        document.getElementById('welcomeState').classList.add('hidden');
        // Only show playground if at least one endpoint is loaded
        if (slots.left.definition || slots.right.definition) {
            playground.classList.remove('hidden');
        } else {
            playground.classList.add('hidden');
        }
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

// ---------------------------------------------------------------------------
// Dynamic form rendering
// ---------------------------------------------------------------------------

function renderForm(definition) {
    document.getElementById('endpointDescription').textContent = definition.description || '';

    const container = document.getElementById('formFields');
    container.innerHTML = '';
    const advancedContainer = document.getElementById('advancedFields');
    advancedContainer.innerHTML = '';

    // Example buttons
    const exRow = document.getElementById('examplesRow');
    const exBtns = document.getElementById('exampleButtons');
    exBtns.innerHTML = '';
    if (definition.examples && definition.examples.length > 0) {
        for (const example of definition.examples) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'border border-gray-700/60 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-xs px-3.5 py-1.5 rounded-full transition-all active:scale-95 hover:bg-gray-800/40';
            btn.textContent = example.label;
            btn.onclick = () => fillExample(example.params);
            exBtns.appendChild(btn);
        }
        exRow.classList.remove('hidden');
    } else {
        exRow.classList.add('hidden');
    }

    // Split params into regular and advanced
    const regularParams = [];
    const advancedParams = [];
    for (const param of definition.request.params) {
        if (param.name === 'model' && param.ui === 'dropdown') continue;
        if (param.group === 'advanced') {
            advancedParams.push(param);
        } else {
            regularParams.push(param);
        }
    }

    // Render regular params
    let staggerIndex = 0;
    for (const param of regularParams) {
        const field = createField(param);
        field.classList.add('field-stagger');
        field.style.animationDelay = `${staggerIndex * 50}ms`;
        container.appendChild(field);
        staggerIndex++;
    }

    // Render advanced params into settings section
    const settingsSection = document.getElementById('settingsSection');
    const hasSystemPrompt = definitionUsesChat(definition);
    if (advancedParams.length > 0 || hasSystemPrompt) {
        for (const param of advancedParams) {
            advancedContainer.appendChild(createField(param));
        }
        settingsSection.classList.remove('hidden');
        updateSettingsSummary(advancedParams);
        // Collapse settings by default
        collapseSettings();
    } else {
        settingsSection.classList.add('hidden');
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
        // Search both regular and advanced fields
        const fields = document.querySelectorAll(`#formFields [data-param-name="${name}"], #advancedFields [data-param-name="${name}"]`);
        for (const field of fields) {
            field.value = value;
            if (field.type === 'range') {
                field.dispatchEvent(new Event('input'));
            }
        }
    }
    // Update settings summary after filling
    updateSettingsSummaryFromDOM();
}

function createField(param) {
    const wrapper = document.createElement('div');

    const label = document.createElement('label');
    label.className = 'block text-xs text-gray-400 mb-1.5';
    label.textContent = param.name;
    if (param.required) {
        const star = document.createElement('span');
        star.className = 'text-amber-500 ml-0.5';
        star.textContent = '*';
        label.appendChild(star);
    }
    wrapper.appendChild(label);

    let input;
    const isPrimaryTextarea = param.ui === 'textarea' && param.body_path === '_chat_message';

    switch (param.ui) {
        case 'textarea':
            input = document.createElement('textarea');
            input.rows = isPrimaryTextarea ? 4 : 3;
            input.placeholder = param.placeholder || '';
            input.className = 'w-full bg-transparent border border-gray-800 rounded-md px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-amber-500 resize-y'
                + (isPrimaryTextarea ? ' textarea-primary' : '');
            break;

        case 'dropdown':
            input = document.createElement('select');
            input.className = 'w-full bg-transparent border border-gray-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500';
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
            range.className = 'flex-1 accent-amber-500';
            const valueDisplay = document.createElement('span');
            valueDisplay.className = 'text-xs text-gray-400 w-12 text-right font-brand';
            valueDisplay.textContent = range.value;
            range.oninput = () => { valueDisplay.textContent = range.value; updateSettingsSummaryFromDOM(); };
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
            input.className = 'w-full bg-transparent border border-gray-800 rounded-md px-3 py-2 text-sm text-white placeholder-gray-700 focus:outline-none focus:border-amber-500';
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

    // Collect from regular fields
    const fields = document.querySelectorAll('#formFields [data-param-name]');
    for (const field of fields) {
        const name = field.dataset.paramName;
        params[name] = field.value;
    }

    // Collect from advanced fields (settings section)
    const advancedFields = document.querySelectorAll('#advancedFields [data-param-name]');
    for (const field of advancedFields) {
        const name = field.dataset.paramName;
        if (field.tagName === 'DIV') {
            const range = field.querySelector('input[type="range"]');
            if (range) params[name] = range.value;
        } else {
            params[name] = field.value;
        }
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

    if (!hasApiKey(def.provider)) {
        showError(`API key missing for ${PROVIDER_NAMES[def.provider] || def.provider}. Add it to your .env file.`);
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

    log(`Params: ${JSON.stringify(params)}`, 'info');
    await executeGenerate('play', params);
    setGenerating(false);
}

// ---------------------------------------------------------------------------
// Streaming — slot-aware
// ---------------------------------------------------------------------------

async function startStreaming(slotId, params) {
    const slot = slots[slotId];
    const def = slot.definition;
    slot.lastSentParams = { definitionId: def.id, params };
    const container = getSlotElement(slotId, 'output');
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
        renderMetrics(metrics, getSlotElement(slotId, 'metrics'));

    } catch (e) {
        if (e.name === 'AbortError') return;
        log(`[${slotId}] Stream error: ${e.message}`, 'error');
        showSlotError(slotId, e.message);
    }

    textBlock.classList.remove('streaming-cursor');
    if (slotId === 'play') setGenerating(false);
}

// ---------------------------------------------------------------------------
// Polling — unified, promise-based
// ---------------------------------------------------------------------------

async function pollLoop(slotId, requestId) {
    const slot = slots[slotId];
    slot.polling = true;
    const def = slot.definition;
    const interval = def.interaction.poll_interval_ms || 2000;
    const metrics = { startTime: performance.now(), submitTime: null, pollCount: 0, totalTime: null };
    log(`[${slotId}] Polling every ${interval}ms...`, 'info');

    let consecutiveErrors = 0;
    const MAX_POLL_ERRORS = 10;

    while (slot.polling) {
        try {
            metrics.pollCount++;
            const url = `/api/status?definition_id=${def.id}&request_id=${encodeURIComponent(requestId)}`;
            const resp = await fetch(url);
            const data = await resp.json();
            consecutiveErrors = 0;

            log(`[${slotId}] Status: ${data.poll_status} (poll #${metrics.pollCount})`, 'info');

            if (data.poll_status === 'done') {
                metrics.totalTime = performance.now() - metrics.startTime;
                log(`[${slotId}] Job complete. Fetching result...`, 'response');
                await fetchResult(slotId, requestId);
                renderMetrics(metrics, getSlotElement(slotId, 'metrics'));
                slot.polling = false;
                return;
            }

            if (data.poll_status === 'failed' || data.poll_status === 'error') {
                log(`[${slotId}] Job failed.`, 'error');
                showSlotError(slotId, 'Generation failed. Check the log for details.');
                slot.polling = false;
                return;
            }
        } catch (e) {
            consecutiveErrors++;
            log(`[${slotId}] Poll error: ${e.message}`, 'error');
            if (consecutiveErrors >= MAX_POLL_ERRORS) {
                showSlotError(slotId, 'Polling failed after too many errors.');
                slot.polling = false;
                return;
            }
        }

        await new Promise(r => setTimeout(r, interval));
    }
}

async function fetchResult(slotId, requestId) {
    const slot = slots[slotId];
    const def = slot.definition;

    try {
        const url = `/api/result?definition_id=${def.id}&request_id=${encodeURIComponent(requestId)}`;
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
    const container = getSlotElement(slotId, 'output');
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

function isSafeUrl(url) {
    return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('data:'));
}

function createImageRenderer(url, downloadable) {
    const div = document.createElement('div');
    div.className = 'space-y-3';

    const img = document.createElement('img');
    img.src = isSafeUrl(url) ? url : '';
    img.alt = 'Generated image';
    img.className = 'max-w-full rounded-md';
    div.appendChild(img);

    if (downloadable && isSafeUrl(url)) {
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
    source.src = isSafeUrl(url) ? url : '';
    video.appendChild(source);
    div.appendChild(video);

    if (downloadable && isSafeUrl(url)) {
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
    source.src = isSafeUrl(url) ? url : '';
    audio.appendChild(source);
    div.appendChild(audio);

    if (downloadable && isSafeUrl(url)) {
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
    const container = getSlotElement(slotId, 'output');
    container.innerHTML = '';
    container.appendChild(createTextRenderer(JSON.stringify(data, null, 2)));
    if (slotId === 'play') showResults();
}

// ---------------------------------------------------------------------------
// Curl preview — fetches curl from server-side /api/preview
// ---------------------------------------------------------------------------

let curlIncludeKey = false;

async function fetchCurlPreview(definitionId, params, includeKey = false) {
    const resp = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition_id: definitionId, params, include_key: includeKey }),
    });
    const data = await resp.json();
    return data.curl || '# Error generating curl preview';
}

async function openCurlModal() {
    const panel = document.getElementById('curlModalPanel');
    const playBody = document.getElementById('curlPlayBody');
    const compareBody = document.getElementById('curlCompareBody');
    const playCopyBtn = document.getElementById('curlCopyBtnPlay');
    const toggle = document.getElementById('curlIncludeKeyToggle');
    if (toggle) toggle.checked = curlIncludeKey;

    playBody.classList.add('hidden');
    compareBody.classList.add('hidden');
    playCopyBtn.classList.add('hidden');

    if (mode === 'play') {
        const def = slots.play.definition;
        if (!def) return;
        const params = collectParams();
        document.getElementById('curlPlayContent').textContent = 'Loading...';
        playBody.classList.remove('hidden');
        playCopyBtn.classList.remove('hidden');
        panel.style.maxWidth = '42rem';
        document.getElementById('curlModal').classList.remove('hidden');
        document.getElementById('curlPlayContent').textContent = await fetchCurlPreview(def.id, params, curlIncludeKey);
    } else {
        // Show modal immediately with loading state
        for (const side of ['Left', 'Right']) {
            document.getElementById(`curl${side}Content`).textContent = 'Loading...';
            const copyBtn = document.getElementById(`curlCopyBtn${side}`);
            if (copyBtn) copyBtn.textContent = 'Copy';
        }
        compareBody.classList.remove('hidden');
        panel.style.maxWidth = '64rem';
        document.getElementById('curlModal').classList.remove('hidden');

        // Fetch both sides in parallel
        const sides = [['left', 'Left'], ['right', 'Right']];
        await Promise.all(sides.map(async ([slotId, side]) => {
            const def = slots[slotId].definition;
            const contentEl = document.getElementById(`curl${side}Content`);
            const labelEl = document.getElementById(`curl${side}Label`);
            if (!def) {
                contentEl.textContent = '# (no endpoint selected)';
                if (labelEl) labelEl.textContent = side;
            } else {
                const params = collectCompareParams(slotId);
                contentEl.textContent = await fetchCurlPreview(def.id, params, curlIncludeKey);
                const provider = PROVIDER_NAMES[def.provider] || def.provider;
                const modelPicker = document.getElementById(`compare${side}Model`);
                const modelVal = modelPicker && !modelPicker.classList.contains('hidden') ? modelPicker.value : '';
                if (labelEl) labelEl.textContent = modelVal ? `${provider} · ${modelVal}` : provider;
            }
        }));
    }
}

async function toggleCurlIncludeKey() {
    curlIncludeKey = document.getElementById('curlIncludeKeyToggle').checked;
    // Re-fetch with updated flag — reuse openCurlModal which rebuilds everything
    await openCurlModal();
}

function closeCurlModal() {
    document.getElementById('curlModal').classList.add('hidden');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCurlModal();
});

function showCopySuccess(btn) {
    const original = btn.innerHTML;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;color:#34d399"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
}

function copyJsonPre(btn) {
    const pre = btn.closest('div').nextElementSibling;
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent).then(() => showCopySuccess(btn));
}

function copyCurl(target) {
    let text, btn;
    if (target === 'play') {
        text = document.getElementById('curlPlayContent').textContent;
        btn = document.getElementById('curlCopyBtnPlay');
    } else if (target === 'left') {
        text = document.getElementById('curlLeftContent').textContent;
        btn = document.getElementById('curlCopyBtnLeft');
    } else if (target === 'right') {
        text = document.getElementById('curlRightContent').textContent;
        btn = document.getElementById('curlCopyBtnRight');
    }
    if (!text || !btn) return;
    navigator.clipboard.writeText(text).then(() => showCopySuccess(btn));
}

function collectCompareParams(slotId) {
    const side = slotId === 'left' ? 'Left' : 'Right';
    const sharedParams = collectParams();

    const modelPicker = document.getElementById(`compare${side}Model`);
    if (modelPicker && !modelPicker.classList.contains('hidden') && modelPicker.value) {
        sharedParams.model = modelPicker.value;
    }

    collectSideParams(side, sharedParams);
    return sharedParams;
}

// ---------------------------------------------------------------------------
// Result tabs — switch between Result and JSON panes
// ---------------------------------------------------------------------------

function switchResultTab(context, tab) {
    // context: 'play' or 'compare'
    const container = context === 'play'
        ? document.getElementById('results')
        : document.getElementById('compareResults');
    if (!container) return;

    const resultPane = document.getElementById(context === 'play' ? 'playResultPane' : 'compareResultPane');
    const jsonPane = document.getElementById(context === 'play' ? 'playJsonPane' : 'compareJsonPane');

    // Update tab buttons
    const tabs = container.querySelectorAll('.result-tab');
    for (const t of tabs) {
        if (t.dataset.tab === tab) {
            t.classList.add('result-tab-active');
            t.classList.remove('text-gray-600', 'hover:text-gray-400');
        } else {
            t.classList.remove('result-tab-active');
            t.classList.add('text-gray-600', 'hover:text-gray-400');
        }
    }

    // Show/hide panes
    if (tab === 'result') {
        resultPane.classList.remove('hidden');
        jsonPane.classList.add('hidden');
    } else {
        resultPane.classList.add('hidden');
        jsonPane.classList.remove('hidden');
        // Populate JSON when switching to this tab
        if (context === 'play') {
            populateJson('play');
        } else {
            populateJson('left');
            populateJson('right');
            // Sync labels
            const leftLabel = document.getElementById('compareLeftLabel');
            const leftJsonLabel = document.getElementById('compareLeftJsonLabel');
            const rightLabel = document.getElementById('compareRightLabel');
            const rightJsonLabel = document.getElementById('compareRightJsonLabel');
            if (leftLabel && leftJsonLabel) leftJsonLabel.textContent = leftLabel.textContent;
            if (rightLabel && rightJsonLabel) rightJsonLabel.textContent = rightLabel.textContent;
        }
    }
}

async function populateJson(slotId) {
    const view = getSlotElement(slotId, 'json');
    const slot = slots[slotId];
    if (!view) return;

    const reqEl = view.querySelector('.json-request');
    const resEl = view.querySelector('.json-response');

    // Fetch request preview on demand from /api/preview
    if (reqEl) {
        if (slot.lastSentParams) {
            reqEl.textContent = 'Loading...';
            reqEl.textContent = await fetchCurlPreview(slot.lastSentParams.definitionId, slot.lastSentParams.params);
        } else {
            reqEl.textContent = '';
        }
    }
    if (resEl) resEl.textContent = slot.lastResponse ? JSON.stringify(slot.lastResponse, null, 2) : '';
}

function resetResultTabs(context) {
    const container = context === 'play'
        ? document.getElementById('results')
        : document.getElementById('compareResults');
    if (!container) return;
    // Reset to Result tab
    const tabs = container.querySelectorAll('.result-tab');
    for (const t of tabs) {
        if (t.dataset.tab === 'result') {
            t.classList.add('result-tab-active');
            t.classList.remove('text-gray-600', 'hover:text-gray-400');
        } else {
            t.classList.remove('result-tab-active');
            t.classList.add('text-gray-600', 'hover:text-gray-400');
        }
    }
    const resultPane = document.getElementById(context === 'play' ? 'playResultPane' : 'compareResultPane');
    const jsonPane = document.getElementById(context === 'play' ? 'playJsonPane' : 'compareJsonPane');
    if (resultPane) resultPane.classList.remove('hidden');
    if (jsonPane) jsonPane.classList.add('hidden');
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
    span.className = 'text-[11px] text-gray-500 font-brand';
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
        btn.className = 'flex-1 bg-gray-700 text-gray-400 text-sm font-semibold py-2.5 rounded-md cursor-not-allowed';
        showProgress();
    } else {
        btn.disabled = false;
        btn.textContent = 'Generate';
        btn.className = 'flex-1 bg-amber-500 hover:bg-amber-400 text-gray-950 text-sm font-semibold py-2.5 rounded-md transition-all hover:scale-[1.005] active:scale-[0.99]';
        hideProgress();
    }
}

function showResults() {
    document.getElementById('results').classList.remove('hidden');
}

function hideResults() {
    document.getElementById('results').classList.add('hidden');
    const metricsEl = document.getElementById('metricsRow');
    if (metricsEl) metricsEl.innerHTML = '';
    resetResultTabs('play');
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
    const errEl = getSlotElement(slotId, 'error');
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
        btn.className = 'flex-1 bg-gray-700 text-gray-400 text-sm font-semibold py-2.5 rounded-md cursor-not-allowed';
    } else {
        if (warning) warning.classList.add('hidden');
        btn.disabled = false;
        btn.className = 'flex-1 bg-amber-500 hover:bg-amber-400 text-gray-950 text-sm font-semibold py-2.5 rounded-md transition-all hover:scale-[1.005] active:scale-[0.99]';
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
        document.getElementById('endpointDescription').textContent = `${leftDef.name} vs ${rightDef.name}`;
    } else if (leftDef || rightDef) {
        const def = leftDef || rightDef;
        document.getElementById('endpointDescription').textContent = def.description || '';
    } else {
        // No endpoints selected — hide playground entirely
        document.getElementById('playground').classList.add('hidden');
        return;
    }
    document.getElementById('playground').classList.remove('hidden');
    hideBaseUrl();

    // Compute shared params
    const { shared } = computeSharedParams(leftDef, rightDef);

    const container = document.getElementById('formFields');
    container.innerHTML = '';
    const advancedContainer = document.getElementById('advancedFields');
    advancedContainer.innerHTML = '';

    // Show merged examples from both definitions
    renderCompareExamples(leftDef, rightDef);

    // Split shared params into regular and advanced
    const regularShared = [];
    const advancedShared = [];
    for (const param of shared) {
        if (param.name === 'model' && param.ui === 'dropdown') continue;
        if (param.group === 'advanced') {
            advancedShared.push(param);
        } else {
            regularShared.push(param);
        }
    }

    for (const param of regularShared) {
        container.appendChild(createField(param));
    }

    // Render advanced shared params into settings section
    const settingsSection = document.getElementById('settingsSection');
    const hasSystemPrompt = definitionUsesChat(leftDef) || definitionUsesChat(rightDef);
    if (advancedShared.length > 0 || hasSystemPrompt) {
        for (const param of advancedShared) {
            advancedContainer.appendChild(createField(param));
        }
        settingsSection.classList.remove('hidden');
        updateSettingsSummary(advancedShared);
        collapseSettings();
    } else {
        settingsSection.classList.add('hidden');
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

function renderCompareExamples(leftDef, rightDef) {
    const exRow = document.getElementById('examplesRow');
    const exBtns = document.getElementById('exampleButtons');
    exBtns.innerHTML = '';

    // Collect examples from both definitions, deduplicate by label
    const seen = new Set();
    const examples = [];
    for (const def of [leftDef, rightDef]) {
        if (!def || !def.examples) continue;
        for (const ex of def.examples) {
            if (seen.has(ex.label)) continue;
            seen.add(ex.label);
            examples.push(ex);
        }
    }

    if (examples.length === 0) {
        exRow.classList.add('hidden');
        return;
    }

    for (const example of examples) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'border border-gray-700/60 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-xs px-3.5 py-1.5 rounded-full transition-all active:scale-95 hover:bg-gray-800/40';
        btn.textContent = example.label;
        btn.onclick = () => fillExample(example.params);
        exBtns.appendChild(btn);
    }
    exRow.classList.remove('hidden');
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

    const missing = [];
    if (!hasApiKey(leftDef.provider)) missing.push(`Left (${PROVIDER_NAMES[leftDef.provider] || leftDef.provider})`);
    if (!hasApiKey(rightDef.provider)) missing.push(`Right (${PROVIDER_NAMES[rightDef.provider] || rightDef.provider})`);
    if (missing.length > 0) {
        showError(`API key missing for ${missing.join(' and ')}. Add to .env file.`);
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

    // Update result column labels with provider + model
    function slotLabel(def, modelVal) {
        const provider = PROVIDER_NAMES[def.provider] || def.provider;
        return modelVal ? `${provider} · ${modelVal}` : provider;
    }
    const leftLabelEl = document.getElementById('compareLeftLabel');
    const rightLabelEl = document.getElementById('compareRightLabel');
    if (leftLabelEl) leftLabelEl.textContent = slotLabel(leftDef, leftModel);
    if (rightLabelEl) rightLabelEl.textContent = slotLabel(rightDef, rightModel);

    // Show compare results, clear previous
    const compareResults = document.getElementById('compareResults');
    compareResults.classList.remove('hidden');
    getSlotElement('left', 'output').innerHTML = '';
    getSlotElement('right', 'output').innerHTML = '';
    const leftMetrics = getSlotElement('left', 'metrics');
    const rightMetrics = getSlotElement('right', 'metrics');
    if (leftMetrics) leftMetrics.innerHTML = '';
    if (rightMetrics) rightMetrics.innerHTML = '';
    resetResultTabs('compare');
    // Hide errors
    const leftErr = document.getElementById('compareLeftError');
    const rightErr = document.getElementById('compareRightError');
    if (leftErr) leftErr.classList.add('hidden');
    if (rightErr) rightErr.classList.add('hidden');

    // Execute both sides in parallel
    const results = await Promise.allSettled([
        executeGenerate('left', leftParams),
        executeGenerate('right', rightParams),
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

function updateStreamToggle(def) {
    const toggle = document.getElementById('streamToggle');
    if (!toggle) return;
    if (def && def.interaction.pattern === 'streaming') {
        toggle.classList.remove('hidden');
    } else {
        toggle.classList.add('hidden');
        streamEnabled = true; // reset when switching to non-streaming endpoint
    }
    const checkbox = document.getElementById('streamToggleCheckbox');
    if (checkbox) checkbox.checked = streamEnabled;
}

function toggleStreaming() {
    streamEnabled = document.getElementById('streamToggleCheckbox').checked;
}

async function executeGenerate(slotId, params) {
    const slot = slots[slotId];
    const def = slot.definition;
    const pattern = def.interaction.pattern;

    if (pattern === 'streaming' && streamEnabled) {
        log(`[${slotId}] POST /api/stream (${def.name})`, 'request');
        await startStreaming(slotId, params);
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
                    params: params,
                }),
                signal: slot.abortController.signal,
            });

            const data = await resp.json();
            const submitTime = performance.now() - syncStart;
            slot.lastSentParams = { definitionId: def.id, params };

            if (data.error) {
                showSlotError(slotId, typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
                return;
            }

            if (pattern === 'polling' && data.request_id) {
                log(`[${slotId}] Job submitted in ${submitTime.toFixed(0)}ms. request_id: ${data.request_id}`, 'info');
                await pollLoop(slotId, data.request_id);
            } else {
                const syncMetrics = { totalTime: performance.now() - syncStart, submitTime };
                slot.lastResponse = data.response;
                if (data.outputs && data.outputs.length > 0) {
                    renderOutputs(data.outputs, slotId);
                } else {
                    renderOutputs([{type: 'text', value: [JSON.stringify(data.response, null, 2)]}], slotId);
                }
                renderMetrics(syncMetrics, getSlotElement(slotId, 'metrics'));
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            showSlotError(slotId, e.message);
        }
    }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

let bookmarks = [];

async function loadBookmarks() {
    try {
        const resp = await fetch('/api/bookmarks');
        bookmarks = await resp.json();
    } catch (e) {
        bookmarks = [];
    }
    return bookmarks;
}

async function saveBookmarksToServer(arr) {
    bookmarks = arr;
    try {
        await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(arr),
        });
    } catch (e) {
        log('Failed to save bookmarks: ' + e.message, 'error');
    }
}

function collectFormParams(container) {
    const params = {};
    const fields = container.querySelectorAll('[data-param-name]');
    for (const field of fields) {
        const name = field.dataset.paramName;
        if (field.tagName === 'DIV') {
            // Slider wrapper — read the range input inside
            const range = field.querySelector('input[type="range"]');
            if (range) params[name] = range.value;
        } else {
            params[name] = field.value;
        }
    }
    return params;
}

function captureBookmarkState() {
    const state = {
        timestamp: Date.now(),
        mode: mode,
        play: null,
        compare: null,
    };

    if (mode === 'play') {
        const modelPicker = document.getElementById('modelPicker');
        const modelGroup = document.getElementById('modelPickerGroup');
        const formContainer = document.getElementById('formFields');
        const sysPrompt = document.getElementById('systemPromptInput');

        const advancedContainer = document.getElementById('advancedFields');
        const allParams = { ...collectFormParams(formContainer), ...collectFormParams(advancedContainer) };

        state.play = {
            definitionId: slots.play.definition ? slots.play.definition.id : null,
            model: (!modelGroup.classList.contains('hidden') && modelPicker.value) ? modelPicker.value : null,
            params: allParams,
            systemPrompt: sysPrompt ? sysPrompt.value : '',
        };
    } else {
        const leftModel = document.getElementById('compareLeftModel');
        const rightModel = document.getElementById('compareRightModel');
        const sharedContainer = document.getElementById('formFields');
        const compareAdvancedContainer = document.getElementById('advancedFields');
        const leftParamsContainer = document.getElementById('compareLeftParams');
        const rightParamsContainer = document.getElementById('compareRightParams');
        const sysPrompt = document.getElementById('systemPromptInput');
        const allSharedParams = { ...collectFormParams(sharedContainer), ...collectFormParams(compareAdvancedContainer) };

        state.compare = {
            left: {
                definitionId: slots.left.definition ? slots.left.definition.id : null,
                model: (!leftModel.classList.contains('hidden') && leftModel.value) ? leftModel.value : null,
            },
            right: {
                definitionId: slots.right.definition ? slots.right.definition.id : null,
                model: (!rightModel.classList.contains('hidden') && rightModel.value) ? rightModel.value : null,
            },
            sharedParams: allSharedParams,
            leftParams: leftParamsContainer ? collectFormParams(leftParamsContainer) : {},
            rightParams: rightParamsContainer ? collectFormParams(rightParamsContainer) : {},
            systemPrompt: sysPrompt ? sysPrompt.value : '',
        };
    }

    return state;
}

function fillFormFields(params, container) {
    if (!params || !container) return;
    for (const [name, value] of Object.entries(params)) {
        const els = container.querySelectorAll(`[data-param-name="${name}"]`);
        for (const el of els) {
            if (el.tagName === 'DIV') {
                // Slider wrapper
                const range = el.querySelector('input[type="range"]');
                if (range) {
                    range.value = value;
                    range.dispatchEvent(new Event('input'));
                }
            } else {
                el.value = value;
            }
        }
    }
}

async function restoreBookmark(bookmark) {
    try {
        // 1. Set mode
        if (bookmark.mode && bookmark.mode !== mode) {
            setMode(bookmark.mode);
        }

        if (bookmark.mode === 'play' && bookmark.play) {
            const bp = bookmark.play;
            if (!bp.definitionId) return;

            await loadPlayEndpoint(bp.definitionId);

            // Set model
            if (bp.model) {
                const modelPicker = document.getElementById('modelPicker');
                modelPicker.value = bp.model;
            }

            // Fill form fields (regular + advanced)
            fillFormFields(bp.params, document.getElementById('formFields'));
            fillFormFields(bp.params, document.getElementById('advancedFields'));
            updateSettingsSummaryFromDOM();

            // Set system prompt
            if (bp.systemPrompt) {
                const sysInput = document.getElementById('systemPromptInput');
                sysInput.value = bp.systemPrompt;
            }

        } else if (bookmark.mode === 'compare' && bookmark.compare) {
            const bc = bookmark.compare;

            // Restore each side
            for (const [sideKey, side] of [['left', 'Left'], ['right', 'Right']]) {
                const sideData = bc[sideKey];
                if (!sideData || !sideData.definitionId) continue;

                await loadCompareEndpoint(side, sideData.definitionId);

                // Set model
                if (sideData.model) {
                    const modelPicker = document.getElementById(`compare${side}Model`);
                    modelPicker.value = sideData.model;
                }
            }

            // Fill shared form fields (regular + advanced)
            fillFormFields(bc.sharedParams, document.getElementById('formFields'));
            fillFormFields(bc.sharedParams, document.getElementById('advancedFields'));
            updateSettingsSummaryFromDOM();

            // Fill side-only params
            fillFormFields(bc.leftParams, document.getElementById('compareLeftParams'));
            fillFormFields(bc.rightParams, document.getElementById('compareRightParams'));

            // Set system prompt
            if (bc.systemPrompt) {
                const sysInput = document.getElementById('systemPromptInput');
                sysInput.value = bc.systemPrompt;
            }
        }

        log('Bookmark restored.', 'info');
    } catch (e) {
        log('Bookmark restore error: ' + e.message, 'error');
    }
}

async function addBookmark(name) {
    const state = captureBookmarkState();
    state.name = name;
    bookmarks.push(state);
    await saveBookmarksToServer(bookmarks);
}

async function deleteBookmark(index) {
    bookmarks.splice(index, 1);
    await saveBookmarksToServer(bookmarks);
}

function generateBookmarkSubtitle(bookmark) {
    if (bookmark.mode === 'play' && bookmark.play) {
        const defEntry = DEFINITIONS_LIST.find(d => d.id === bookmark.play.definitionId);
        const provider = defEntry ? (PROVIDER_NAMES[defEntry.provider] || defEntry.provider) : '?';
        const model = bookmark.play.model || '';
        return `play · ${provider}${model ? ' · ' + model : ''}`;
    }
    if (bookmark.mode === 'compare' && bookmark.compare) {
        const leftDef = DEFINITIONS_LIST.find(d => d.id === bookmark.compare.left.definitionId);
        const rightDef = DEFINITIONS_LIST.find(d => d.id === bookmark.compare.right.definitionId);
        const leftProvider = leftDef ? (PROVIDER_NAMES[leftDef.provider] || leftDef.provider) : '?';
        const rightProvider = rightDef ? (PROVIDER_NAMES[rightDef.provider] || rightDef.provider) : '?';
        return `compare · ${leftProvider} vs ${rightProvider}`;
    }
    return bookmark.mode || '';
}

function startInlineBookmarkSave(rowEl) {
    rowEl.innerHTML = '';
    rowEl.onclick = null;
    rowEl.onmouseenter = null;
    rowEl.classList.remove('palette-highlighted');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'palette-bookmark-save-input';
    input.placeholder = 'Bookmark name...';
    rowEl.appendChild(input);
    input.focus();

    // Prevent palette input from stealing keys
    input.addEventListener('keydown', async (e) => {
        e.stopPropagation();
        const rerender = () => {
            const q = document.getElementById('cmdPaletteInput').value;
            if (paletteStep === 'model') renderPaletteModelList(q);
            else renderPaletteList(q);
        };
        if (e.key === 'Enter' && input.value.trim()) {
            await addBookmark(input.value.trim());
            rerender();
        } else if (e.key === 'Escape') {
            rerender();
        }
    });

    input.addEventListener('input', (e) => e.stopPropagation());
}

// ---------------------------------------------------------------------------
// Command palette — event listeners
// ---------------------------------------------------------------------------

document.getElementById('cmdPaletteInput').addEventListener('input', (e) => {
    if (paletteStep === 'model') {
        renderPaletteModelList(e.target.value);
    } else {
        renderPaletteList(e.target.value);
    }
});

document.getElementById('cmdPaletteInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteHighlightIndex < paletteItems.length - 1) {
            highlightPaletteItem(paletteHighlightIndex + 1);
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteHighlightIndex > 0) {
            highlightPaletteItem(paletteHighlightIndex - 1);
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (paletteStep === 'model') {
            selectPaletteModelItem(paletteHighlightIndex);
        } else {
            selectPaletteItem(paletteHighlightIndex, e.shiftKey);
        }
    } else if (e.key === 'Escape') {
        paletteGoBack();
    }
});

document.getElementById('cmdPaletteBackdrop').addEventListener('click', closePalette);

// Global Cmd+K / Ctrl+K
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        togglePalette();
    }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

PROVIDER_NAMES = Object.fromEntries(
    DEFINITIONS_LIST.map(d => [d.provider, d.provider_display_name])
);
loadBookmarks();
validateKeys();

// Populate welcome stats
const endpointCount = DEFINITIONS_LIST.length;
const providerCount = new Set(DEFINITIONS_LIST.map(d => d.provider)).size;
const statsEl = document.getElementById('welcomeStats');
if (statsEl) statsEl.textContent = `${endpointCount} endpoints \u00b7 ${providerCount} providers`;
