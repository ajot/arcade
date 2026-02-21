# arcade UI Refresh — Design

> Approved 2026-02-20. Full UI refresh: minimal/invisible vibe, single centered column.

## Context

The MVP is feature-complete (polling, streaming, image/audio/text rendering, JSON toggle, 19 definitions). The UI works but feels like a developer prototype — gray card boxes, two-column layout with a log console eating 1/3 of the screen, utilitarian spacing. Before adding the chat interface, we're doing a ground-up visual refresh.

## Design Principles

- **Minimal & invisible.** The UI should disappear. Content (form + result) is everything.
- **Single centered column.** Sets up naturally for the chat UI coming next.
- **Monochrome + one accent.** Blue for interactive elements, everything else is shades of gray.

## Layout

Single centered column, max-width ~720px. Three zones stacked vertically:

1. **Top bar** — slim, fixed. "arcade" wordmark left, provider + endpoint + model dropdowns inline right. API key behind a lock icon (inline input / popover). No separate config card.
2. **Main area** — scrollable. Form fields float directly on the page (no card wrapper). Results appear below the form.
3. **Bottom drawer** — log console. Collapsed by default. Small pill at bottom-right with entry count badge. Slides up ~300px over content.

## Visual Design

- **Background:** `gray-950` (near-black) instead of `gray-900`.
- **Surfaces:** No card backgrounds for form area. Results get subtle `gray-900` surface only when populated.
- **Typography:** System font stack. Larger, lighter-weight headings. Small, muted labels.
- **Color:** Monochrome. Blue accent for Generate button and active states.
- **Borders:** `gray-800`, softer than current `gray-600`. No card outlines.
- **Spacing:** Generous vertical breathing room between fields and between form/results.

## Interaction Flow

- **Generate button:** Inline spinner on the button itself. No separate status indicator text.
- **Polling:** Thin pulsing progress bar at top of main area. No "Generating..." text.
- **Streaming:** Text appears directly in result area with blinking cursor.
- **Results appear below the form** — form stays visible for quick iteration.
- **JSON toggle:** Small `{ }` icon button. Expands inline below result.
- **Examples:** Pill buttons above the first form field. Fill form silently.

## Model Picker

In top bar, next to endpoint dropdown. Appears only when endpoint has models. Gone otherwise.

## Log Drawer

- Collapsed by default. Bottom-right pill: "Log" + count badge.
- Slides up ~300px panel on click.
- Color-coded entries (blue/green/red/purple) on `gray-950` background.
- Clear and Close buttons in drawer header.

## Responsive

- Desktop (>768px): centered 720px column.
- Mobile: full-width with horizontal padding. Top bar dropdowns stack.

## What Does NOT Change

- Flask backend, proxy.py, definition format — all untouched.
- All existing functionality (polling, streaming, output rendering, JSON toggle, examples, validation).
- Only `templates/index.html`, `static/app.js`, and `static/style.css` are modified.
