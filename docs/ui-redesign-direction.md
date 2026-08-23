# RoleAtlas editorial redesign brief

Status: direction locked 2026-08-23 (D-024). This document is the design source of truth for the Phase 5 rebuild. The previous signal-console brief (all-black surfaces, telemetry labels, decision red) is retired; its CSS is removed in Phase 5, not layered over.

## Product subject

RoleAtlas is a qualification-first career companion for people who need evidence, eligibility, and follow-through — not another inspirational job board. The interface's single job is to turn a noisy market into a calm, readable sequence of credible opportunities and next actions.

## Design principles

1. **Editorial, not instrumental.** Pages read like a well-set magazine: a strong headline voice, clear article-like hierarchy, generous margins. No system-monitor vocabulary, no dense control panels.
2. **Simplicity first.** Every primary surface shows a handful of clear actions. Anything advanced is one deliberate step away ("Show filters", "Edit strategy", "Advanced") and never competes with the primary path.
3. **Progressive disclosure over option walls.** Defaults are good enough to use immediately. Power users opt into density; the product never assumes it.
4. **Evidence is content, not chrome.** Eligibility, provenance, and uncertainty are written as readable sentences with real typographic treatment — not badges, chips, or terminal readouts.
5. **Calm motion.** Transitions exist for orientation only. No decorative animation.

## Typography

- Display/headlines: a high-contrast serif (self-hosted variable font), used for page titles, section heads, and job titles. Tight leading, large sizes, no all-caps.
- Body/UI: a quiet humanist sans for body copy, controls, and metadata. Comfortable measure (~60–70 characters).
- Mono: reserved for IDs, URLs, and code-like evidence only.
- Hierarchy is carried by size and weight, never by letter-spacing tricks or uppercase shouting.

## Color

Light theme is the default; dark theme is an equal citizen.

- **Paper** — warm off-white canvas (light) / deep warm ink (dark). Never pure black-on-pure-white.
- **Ink** — near-black text with AA+ contrast at body sizes.
- **Secondary** — muted grey-brown for supporting copy; still ≥4.5:1 against paper.
- **Accent** — one restrained accent (deep editorial red or forest green, final value chosen during Phase 5 implementation and contrast-checked) for links, active states, and the save/apply path only. Accent is never decoration.
- **Semantic states** — eligibility (confirmed/unclear/excluded) and freshness get distinct, accessible treatments that do not rely on color alone (icon + text).

No legacy color-token aliases survive the migration.

## Layout and spacing

- An 8px spacing scale with a visible rhythm of wide outer margins and narrower gutters; whitespace is the primary grouping device, borders secondary.
- Content column max-width ~72rem with reading-measure sub-columns where prose appears.
- Cards become "clippings": title-led entries separated by hairline rules rather than boxed grids of identical tiles. At most two visual weights per view.
- One elevation language: flat by default; dialogs get a single soft shadow. No stacked drop shadows.

## Components

A single component library under `app/components/` replaces per-feature styling:

- Buttons (primary = accent fill, secondary = hairline outline, tertiary = text link), inputs, selects, disclosure sections, dialogs with focus trapping, tabs, toasts, empty states, skeleton loading.
- Job clipping, eligibility note, evidence list, timeline entry, agent activity entry as domain components with fixed typography contracts.
- Icons: one consistent stroke set, 16–20px, always paired with a label or accessible name.

## Progressive-disclosure rules

- Discover defaults to search + results + one sort control. Filters, source detail, and query evidence collapse behind labelled disclosures.
- Profile separates confirmed facts (always visible) from preferences and hard constraints (edit-in-place, collapsed groups).
- Settings groups account/security, notifications, AI providers, privacy, data; each group opens to a focused form. Provider configuration includes the request preview but sits behind "AI providers".
- Operator/admin surfaces are entirely outside the candidate shell.

## Accessibility

WCAG 2.2 AA on both themes: visible focus, keyboard paths through every disclosure, dialog focus traps, semantic headings in document order, skip link, 200% zoom and text-scaling tolerance, reduced-motion support. Contrast decisions are recorded with measured values in Phase 5 evidence.

## Per-workspace intent

Onboarding reads like a short magazine feature (progress rail, one question per screen). Home is a daily briefing front page: strong headline, three to five items, one clear next action. Discover is the classifieds section done well: fast, scannable clippings, honest counts. Job detail is the feature article: role facts up top, evidence and unknowns in prose, actions pinned. Searches, Saved, Applications, Profile, Sources, Settings each reduce to their essential question with everything else disclosed on demand.

## Migration rules

- Retire compatibility overrides and the signal-console stylesheet in the same series of commits that introduces tokens; no dual-theme period survives a phase boundary.
- Do not rewrite trustworthy domain logic while restyling; extract components around tested behavior.
- Visual regression baselines are captured per workspace at desktop and mobile sizes before old CSS is deleted.
