![terminui](https://raw.githubusercontent.com/AhmadAwais/terminui/main/.github/terminui.png)

# terminui

A fast, functional TypeScript library for building terminal user interfaces.

## Features

- **Pure functional** — no classes, no `this`, no mutation. Plain objects in, plain objects out.
- **Double-buffered rendering** — only changed cells are flushed to the terminal between frames.
- **Rich layout system** — split any rect with constraints: `Length`, `Percentage`, `Ratio`, `Min`, `Max`, `Fill`.
- **Full style system** — 16 ANSI colors, 256-color indexed, 24-bit RGB, modifiers (bold, italic, underline, etc.).
- **Wide character support** — CJK and fullwidth characters are measured and rendered correctly.
- **10+ built-in widgets** — Block, Paragraph, List, Table, Gauge, Tabs, Sparkline, BarChart, Scrollbar, Clear.
- **Stateful widgets** — List and Table selection, Scrollbar position with offset management.
- **Pluggable backends** — test backend included; bring your own Node.js terminal backend.
- **TypeScript strict mode** — `strict: true`, `noUncheckedIndexedAccess: true`, zero `any`.

## Install

```bash
pnpm add terminui
```

## Quick Start

```typescript
import {
  createTestBackendState,
  createTestBackend,
  testBackendToString,
  createTerminal,
  terminalDraw,
  frameRenderWidget,
  createRect,
  createLayout,
  lengthConstraint,
  fillConstraint,
  splitLayout,
  blockBordered,
  createTitle,
  createParagraph,
  renderParagraph,
} from 'terminui';

// Set up a test backend (swap for a real terminal backend in production)
const state = createTestBackendState(60, 10);
const backend = createTestBackend(state);
const terminal = createTerminal(backend);

terminalDraw(terminal, (frame) => {
  const paragraph = createParagraph('Hello, terminui!', {
    block: blockBordered({ titles: [createTitle('Greeting')] }),
  });
  frameRenderWidget(frame, renderParagraph(paragraph), frame.area);
});

console.log(testBackendToString(state));
```

Output:

```
┌Greeting──────────────────────────────────────────────┐
│Hello, terminui!                                      │
│                                                      │
│                                                      │
│                                                      │
│                                                      │
│                                                      │
│                                                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Architecture

terminui follows a functional architecture with zero classes:

```
Backend → Terminal → Frame → Buffer → Cells
                       ↑
                    Widgets (pure render functions)
                       ↑
                    Layout (constraint solver)
```

**Everything is a function.** Widgets are functions that take config and return a `WidgetRenderer` — a function `(area: Rect, buf: Buffer) => void`. Compose them however you want.

## Layout System

Split any rectangle using constraints:

```typescript
import { createLayout, lengthConstraint, fillConstraint, percentageConstraint, splitLayout, createRect } from 'terminui';

const layout = createLayout([
  lengthConstraint(3),       // exactly 3 rows
  percentageConstraint(50),  // 50% of remaining
  fillConstraint(1),         // fill the rest
]);

const area = createRect(0, 0, 80, 24);
const [header, body, footer] = splitLayout(layout, area);
```

### Constraint Types

| Constraint | Description |
|---|---|
| `lengthConstraint(n)` | Exactly `n` cells |
| `percentageConstraint(n)` | `n`% of available space |
| `ratioConstraint(num, den)` | `num/den` of available space |
| `minConstraint(n)` | At least `n` cells |
| `maxConstraint(n)` | At most `n` cells |
| `fillConstraint(weight)` | Fill remaining space (weighted) |

### Directions

```typescript
// Vertical (default) — splits into rows
const vLayout = createLayout([...constraints]);

// Horizontal — splits into columns
const hLayout = createLayout([...constraints], { direction: 'horizontal' });
```

## Style System

```typescript
import { createStyle, styleFg, styleBg, styleAddModifier, Color, Modifier, patchStyle } from 'terminui';

const bold = styleAddModifier(createStyle(), Modifier.BOLD);
const warning = styleFg(styleBg(createStyle(), Color.Yellow), Color.Black);
const merged = patchStyle(bold, warning); // combines both
```

### Colors

```typescript
Color.Reset, Color.Black, Color.Red, Color.Green, Color.Yellow,
Color.Blue, Color.Magenta, Color.Cyan, Color.Gray, Color.White,
Color.DarkGray, Color.LightRed, Color.LightGreen, ...

indexedColor(42)           // 256-color palette
rgbColor(255, 128, 0)     // 24-bit true color
```

### Modifiers

```typescript
Modifier.BOLD, Modifier.DIM, Modifier.ITALIC, Modifier.UNDERLINED,
Modifier.SLOW_BLINK, Modifier.RAPID_BLINK, Modifier.REVERSED,
Modifier.HIDDEN, Modifier.CROSSED_OUT, Modifier.DOUBLE_UNDERLINED,
Modifier.OVERLINED
```

## Widgets

### Block

Container with borders, titles, and padding:

```
┌Header────────────────────────────────────────────────┐
│                                                      │
│  Content goes here with padding and borders         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

```typescript
import { blockBordered, createTitle, renderBlock, Borders } from 'terminui';

const block = blockBordered({
  titles: [
    createTitle('Header'),
    createTitle('Footer', { position: 'bottom', alignment: 'center' }),
  ],
  borderType: 'rounded',  // 'plain' | 'rounded' | 'double' | 'thick'
  padding: uniformPadding(1),
});

frameRenderWidget(frame, renderBlock(block), area);
```

### Paragraph

Text display with wrapping, alignment, and scrolling:

```
┌Paragraph─────────────────────────────────────────────┐
│  Long text that wraps automatically to fit the      │
│  available width. Supports alignment and scrolling  │
│  for content larger than the viewport.              │
└──────────────────────────────────────────────────────┘
```

```typescript
import { createParagraph, renderParagraph } from 'terminui';

const p = createParagraph('Long text that wraps...', {
  block: blockBordered({ titles: [createTitle('Paragraph')] }),
  wrap: { trim: true },
  alignment: 'center',
  scroll: [2, 0],  // skip first 2 lines
});

frameRenderWidget(frame, renderParagraph(p), area);
```

### List

Vertical scrollable list with selection:

```
┌Menu──────────────────────────────────────────────────┐
│ ▶ Item 1                                             │
│   Item 2                                             │
│   Item 3                                             │
│   Item 4                                             │
│   Item 5                                             │
└──────────────────────────────────────────────────────┘
```

```typescript
import { createList, createListState, renderStatefulList } from 'terminui';

const list = createList(['Item 1', 'Item 2', 'Item 3'], {
  block: blockBordered({ titles: [createTitle('Menu')] }),
  highlightStyle: styleFg(createStyle(), Color.Yellow),
  highlightSymbol: '▶ ',
});

const state = createListState(0); // selected index
frameRenderStatefulWidget(frame, renderStatefulList(list), area, state);

// Navigate: state.selected = 1;
```

### Table

Grid data with column constraints:

```
┌Users─────────────────────────────────────────────────┐
│ Name       Age  Role                                 │
│ Alice      42   admin                                │
│ Bob        37   user                                 │
│ Charlie    29   user                                 │
└──────────────────────────────────────────────────────┘
```

```typescript
import { createTable, createRow, renderTable, lengthConstraint, fillConstraint } from 'terminui';

const table = createTable(
  [
    createRow(['Alice', '42', 'admin']),
    createRow(['Bob', '37', 'user']),
  ],
  [lengthConstraint(10), lengthConstraint(5), fillConstraint(1)],
  {
    header: createRow(['Name', 'Age', 'Role']),
    block: blockBordered({ titles: [createTitle('Users')] }),
  },
);

frameRenderWidget(frame, renderTable(table), area);
```

### Gauge

Progress bars — unicode block characters or ASCII:

```
┌Progress──────────────────────────────────────────────┐
│ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ 67%                                                  │
└──────────────────────────────────────────────────────┘
```

```typescript
import { gaugePercent, renderGauge } from 'terminui';

const gauge = gaugePercent(67, {
  block: blockBordered({ titles: [createTitle('Progress')] }),
  useUnicode: true,
  gaugeStyle: styleFg(createStyle(), Color.Green),
});

frameRenderWidget(frame, renderGauge(gauge), area);
```

### Tabs

Horizontal tab selection:

```
 Dashboard  Logs  Settings
 ─────────────────────────────────────────────────────
 Dashboard content displayed here
```

```typescript
import { createTabs, renderTabs } from 'terminui';

const tabs = createTabs(['Dashboard', 'Logs', 'Settings'], {
  selected: 0,
  highlightStyle: styleFg(createStyle(), Color.Yellow),
});

frameRenderWidget(frame, renderTabs(tabs), area);
```

### Sparkline

Tiny inline data visualization:

```
┌CPU───────────────────────────────────────────────────┐
│ ▁▄▂█▅▃▇▆                                             │
└──────────────────────────────────────────────────────┘
```

```typescript
import { createSparkline, renderSparkline } from 'terminui';

const spark = createSparkline([1, 4, 2, 8, 5, 3, 7, 6], {
  block: blockBordered({ titles: [createTitle('CPU')] }),
  style: styleFg(createStyle(), Color.Cyan),
});

frameRenderWidget(frame, renderSparkline(spark), area);
```

### BarChart

Grouped bar charts (vertical or horizontal):

```
┌Chart─────────────────────────────────────────────────┐
│                                                      │
│   ███   ███   ███                                    │
│   ███   ███   ███                                    │
│   ███   ███   ███                                    │
│   ███   ███   ███                                    │
│  Group A Group B Group C                            │
└──────────────────────────────────────────────────────┘
```

```typescript
import { createBar, createBarGroup, createBarChart, renderBarChart } from 'terminui';

const chart = createBarChart(
  [createBarGroup([createBar(5), createBar(8), createBar(3)], 'Group A')],
  { barWidth: 3, direction: 'vertical' },
);

frameRenderWidget(frame, renderBarChart(chart), area);
```

### Scrollbar

Scrollbar overlay for any area:

```
┌Content────────────────────────────────────────────┐ █
│ Line 1                                            │ █
│ Line 2                                            │ ░
│ Line 3                                            │ ░
│ Line 4                                            │ ░
│ Line 5                                            │ ░
│ ...                                               │ ░
└────────────────────────────────────────────────────┘ █
```

```typescript
import { createScrollbar, createScrollbarState, renderStatefulScrollbar } from 'terminui';

const sb = createScrollbar('verticalRight');
const sbState = createScrollbarState(100, 25);
sbState.viewportContentLength = 20;

frameRenderStatefulWidget(frame, renderStatefulScrollbar(sb), area, sbState);
```

## Rendering Modes

### Primary Screen

Renders directly to the terminal's primary screen. Good for one-shot output or piped commands:

```typescript
const state = createTestBackendState(80, 24);
const backend = createTestBackend(state);
const terminal = createTerminal(backend);

terminalDraw(terminal, (frame) => {
  // render widgets to frame
});

console.log(testBackendToString(state));
```

### Alternate Screen

For full-screen TUI apps (like vim, htop). In production you'd use a backend that:
1. Enters the alternate screen (`\x1b[?1049h`)
2. Renders frames in a loop with diff-based updates
3. Exits the alternate screen on cleanup (`\x1b[?1049l`)

```typescript
// Pseudo-code for a real alternate screen app:
const backend = createNodeBackend(); // your Node.js backend
const terminal = createTerminal(backend);

// Enter alternate screen
process.stdout.write('\x1b[?1049h');

// Main loop
while (running) {
  terminalDraw(terminal, (frame) => {
    // render your UI
  });
  await waitForInput();
}

// Exit alternate screen
process.stdout.write('\x1b[?1049l');
```

The double-buffered architecture ensures only changed cells are written between frames — minimal I/O for maximum performance.

## Examples

Run the included examples:

```bash
# Dashboard rendered to primary screen
npx tsx examples/primary-screen.ts

# Multi-frame alternate screen simulation
npx tsx examples/alternate-screen.ts

# Live weather dashboard (Open-Meteo)
npx tsx examples/weather-dashboard.ts --city "New York"

# One-shot weather snapshot (non-animated)
npx tsx examples/weather-dashboard.ts --city "New York" --once
```

## Dev

```bash
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check
pnpm build       # tsup
```

## Stack

- TypeScript (strict mode)
- Biome (lint + format)
- Vitest (tests)
- tsup (bundling)
- pnpm (package manager)

## License

Apache-2.0 - [Ahmad Awais](https://x.com/MrAhmadAwais)
