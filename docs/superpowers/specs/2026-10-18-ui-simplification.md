# UI simplification (design note)

Date: 2026-10-18. Requested by the product owner after manual testing.

**Request:**
- Make the UI "way way way simpler and more intuitive", especially switching between racks and GPUs.
- Keep the clean 3D visualization and the AI chat. They are the favorite parts.
- Buttons get friendly baby-blue / king-blue colors where people expect them.
- The owner skipped questions, so everything below is the builder's call.

## Principles

- **Two places to look.** The 3D scene is the canvas; the right panel is the summary and the agent. Everything else appears only when needed.
- **One obvious action per moment.** Primary actions are king blue, secondary actions are baby blue, and destructive actions are quiet text.
- **Progressive disclosure.** Each layer shows at most five essential controls. Everything else sits behind "More settings", and the catalog facts sit behind a small info toggle.
- **Racks and GPUs are picked visually,** from cards with the few numbers that decide (GPU, GPUs per rack, kW per rack, cooling it needs). They are never picked from long dropdowns.
- **Every behavior stays.** Commands, agent tools, notes, import/export and the all-variables drawer remain reachable. This is a re-layout, not a feature cut.

## Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Default hall   [Site][Workload][Compute][Layout][Cooling][Power][Network]  ↶ ↷  ⋯ │  ← top bar: layer tabs (king blue = active)
├───────────────┬──────────────────────────────────────────┬───────────────┤
│ Layer card    │                                          │ 4 KPI cards   │
│ (≤5 controls, │              3D scene                    │ Issues (n) ▸  │
│  More ▸)      │                                          ├───────────────┤
│ collapsible   │  overlay pills (compact, top-left)       │ Design agent  │
│               │ ┌──────────────────────────────────────┐ │ (chat, more   │
│               │ │ Rack bar: ● Training 48  ● Inference 32  + │ room)  │
│               │ └──────────────────────────────────────┘ │               │
└───────────────┴──────────────────────────────────────────┴───────────────┘
```

- **Top bar.** Plan name, the seven layer tabs as a segmented control, undo/redo as icon buttons with labels for screen readers, and an overflow menu (⋯) holding Catalog, Import and Export plan.
- **Layer card (left, about 300 px, collapsible).**
  - It shows the active layer's essentials only. For Compute and Layout it can be nearly empty, because the rack bar does the work.
  - "More settings" expands the full existing decision fields.
  - Notes stay as a small icon button per field.
- **Rack bar (bottom of scene).**
  - One chip per rack group, showing a color dot, the group name and the rack count, plus a "+ New group" chip.
  - Clicking a chip selects the group and flies the camera to its first rack. The camera rig already supports focus.
  - A popover opens with rack-type cards (GPU name, GPUs, kW per rack, weight, cooling it supports, with the current one marked), cooling-method pills limited to the methods that rack supports, and Rename / Delete.
  - Picking a card sends `setRackType`. A pill sends `setCoolingMethod`.
- **Right panel.**
  - Four KPI cards: usable compute, facility power vs grid cap (thin gauge), PUE, water vs allowance.
  - Then "Issues (n)", collapsed by default. It shows fail and warn checks with status shapes, and clicking one selects it.
  - "All variables" is a link.
  - The agent chat takes all remaining height.
- **Inspector.** It stays as a drawer, opened by clicking objects. It is narrower and opens over the left card rather than over the scene.

## Color tokens (added to the visual direction)

| Token | Hex | Use |
|---|---|---|
| `--action` (king blue) | `#1F4ED8` | primary buttons, active tab and chip, focus accents |
| `--action-hover` | `#183FB0` | primary button hover |
| `--action-soft` (baby blue) | `#E3EEFF` | secondary buttons, selected-card background, hover rows |
| `--action-soft-ink` | `#1A3E9E` | text on baby blue |
| `--action-ring` | `#8DB4FF` | focus ring |

- The physics colors stay as they are: supply, return, heat, OK and warning. The supply-blue pipes move slightly toward cyan (`#1E88C8`) so actions and coolant don't read as the same thing.
- Contrast is AA or better for text on every token.

## Out of scope

No engine, agent or 3D changes, except camera focus calls from the rack bar.
