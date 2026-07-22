# RoleAtlas signal-console redesign

## Product subject

RoleAtlas is a qualification-first job-search instrument for people who need evidence, eligibility, and follow-through—not another inspirational job board. The interface’s single job is to turn a noisy market into a calm sequence of credible opportunities and next actions.

## Visual plan

### Color

- **Void** `#050505`: the working canvas.
- **Instrument** `#0D0D0D`: navigation, overlays, and dense control surfaces.
- **Panel** `#151515`: secondary rows and selected records.
- **Signal white** `#F2F2F2`: primary text and inverted active controls.
- **Telemetry grey** `#8D8D8D`: supporting copy and labels.
- **Decision red** `#E11D2E`: only for live signals, blocking evidence, or actions requiring attention.

Success and warning colors remain semantic data states, never decoration. Controls invert black and white instead of becoming red.

### Type

- **Geist**: functional headings and body copy.
- **Geist Mono**: navigation, metadata, evidence, filters, timestamps, and control labels.
- **Dot-matrix geometry**: generated from real circular grid cells for the RoleAtlas mark, opportunity radar, counts, and status glyphs. It does not depend on proprietary Nothing fonts.

### Layout

Desktop is a compact instrument rail beside a wide evidence canvas. Home prioritizes today’s signal, Discover prioritizes scanning, and detail surfaces slide over the same context.

```text
┌──────────────┬──────────────────────────────────────────────────────┐
│ RA SIGNAL    │ SYSTEM / INDEX / PROFILE / MODEL                   │
│              ├──────────────────────────────────────────────────────┤
│ Home         │ OPPORTUNITY SIGNAL          [dot radar + count]     │
│ Discover     │ “The next credible move.”                          │
│ Searches     ├──────────────────────┬───────────────────────────────┤
│ Saved        │ matches / actions    │ attention / source evidence  │
│ Applications │                      │                               │
│ Profile      ├──────────────────────┴───────────────────────────────┤
│ Sources      │ recent roles / sessions / application state         │
│ Settings     │                                                      │
│              │                                                      │
│ STACK STATE  │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

At tablet width the rail collapses to icons. At phone width it becomes an off-canvas dialog and every workspace becomes one readable column without horizontal scrolling.

### Signature

The memorable element is the **Opportunity Signal**: a true circular-dot 9×9 radar glyph paired with one evidence count and one red decision dot. The glyph appears in the brand, Home, search progress, and empty states. It represents the product’s real behavior—collecting source observations, evaluating eligibility, and surfacing the few roles that deserve attention.

## Self-critique and revision

A direct clone of the reference would make RoleAtlas look like a generic developer console and would hide the human job-search workflow. The revised direction keeps its industrial monochrome discipline, dot geometry, hairlines, inversion controls, and scarce red signal, but replaces generic CPU/memory telemetry with eligibility evidence, coverage, follow-ups, freshness, and application momentum. It also avoids proprietary branding and fonts.

The old warm-paper/serif/card-shadow design is removed from the visible product. The engine and persisted workflows remain unchanged; this is a deliberate presentation and interaction rebuild, not another data-model rewrite.
