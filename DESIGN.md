---
name: Cognitive Sandtable
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#bbc9cd'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#859397'
  outline-variant: '#3c494c'
  surface-tint: '#2fd9f4'
  primary: '#8aebff'
  on-primary: '#00363e'
  primary-container: '#22d3ee'
  on-primary-container: '#005763'
  inverse-primary: '#006877'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffd6a7'
  on-tertiary: '#472a00'
  tertiary-container: '#ffb147'
  on-tertiary-container: '#704500'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#a2eeff'
  primary-fixed-dim: '#2fd9f4'
  on-primary-fixed: '#001f25'
  on-primary-fixed-variant: '#004e5a'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
    letterSpacing: 0em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: 0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  stat-counter:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.02em
  caption:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sm: 0.5rem
  gutter-lg: 1.5rem
  margin: 1.5rem
  margin-hud: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system drives a cinematic, ultra-refined geospatial intelligence console for district- and county-level digital twin exploration across Jiangsu, Zhejiang, Shanghai, and Anhui (江浙沪皖). 

The visual thesis relies on a high-precision cartographic dark space: a deep obsidian void accented by fine luminescent vectors, micro-HUD overlays, and frosted acrylic glass panels. The user experience channels the command-center authority of an aerospace cockpit mixed with the delicate craft of contemporary cartography. 

Key attributes:
- **Cinematic Void:** High contrast between deep space-black canvas tones and luminous vector linework, avoiding heavy decorative chrome.
- **Geographic Distinction:** Quad-color semantic coding uniquely highlights regional jurisdictions (Shanghai, Jiangsu, Zhejiang, and Anhui) without visual collision.
- **Instrument Precision:** Hairline data grids, monospaced tabular telemetry, tactile micro-pills, and calibrated rim lighting create an environment optimized for macro observation and dense drill-down analysis.

## Colors

The palette establishes an obsidian canvas with targeted luminous accents to denote geographic boundaries, administrative tiers, and operational data states.

### Core Canvas & Surfaces
- **Canvas Base:** `#0a0b10` (Cosmic void, minimal grain texture, faint radial vignette).
- **Surface Floating Deck:** `rgba(18, 22, 34, 0.72)` with 20px backdrop-filter blur.
- **Surface Inset/Elevated:** `rgba(26, 32, 48, 0.65)`.
- **Surface Inactive / Dormant:** `#1e2433`.
- **Border Hairline:** `rgba(255, 255, 255, 0.08)`.
- **Border Active Rim:** `rgba(34, 211, 238, 0.45)`.

### Regional Semantic Tokens
- **Shanghai (海派/核心枢纽):** `#00f2fe` to `#4facfe`. Primary cyan glow for ultra-dense metropolitan nodes.
- **Jiangsu (苏式水乡/科创制造):** `#00c6ff` with subtle gradient shifts toward `#38ef7d`. Tech azure for manufacturing and canal clusters.
- **Zhejiang (数字经济/生态山水):** `#10b981` (Emerald) to `#34d399` (Jade). Clean green signifying digital vitality and ecological belts.
- **Anhui (徽派人文/腹地新兴):** `#f59e0b` (Amber Bronze) to `#fbbf24` (Gold). Warm minerals and historical hinterland nodes.

### Data & State Semantics
- **Active Focus & Selection:** `#22d3ee` with 6px soft outer drop-glow (`rgba(34, 211, 238, 0.35)`).
- **Secondary Alert / Hotspot:** `#f59e0b`.
- **Muted Edge:** `#2d3748`.
- **Text Dominant:** `#f8fafc`.
- **Text Secondary:** `#94a3b8`.
- **Text Micro / Legend:** `#64748b`.

## Typography

Typography prioritizes high information density, optical clarity against dark glass backdrops, and instant differentiation between administrative copy and live telemetry.

- **Headlines & Regional Identifiers:** Space Grotesk provides a crisp, technical edge suitable for geospatial cartography and administrative headers.
- **Interface Copy & Descriptive Data:** Inter guarantees neutral, ultra-clear legibility across dense listings and tooltips.
- **Telemetry, Coordinates, & Metrics:** JetBrains Mono forces strict tabular alignment (`font-variant-numeric: tabular-nums`) for coordinates, economic figures, population stats, and ranking indexes.
- **Chinese Fallback Hierarchy:** Match Inter and Space Grotesk with `PingFang SC`, `Hiragino Sans GB`, and `Microsoft YaHei` in CSS cascades to maintain strict stroke weight parity.

## Layout & Spacing

The viewport operates as a borderless digital twin map canvas. UI elements float as decoupled Heads-Up Display (HUD) modules anchored to viewport perimeters.

### Architectural Layout Structure
- **Viewport Canvas:** Fullscreen (100vw x 100vh) non-scrollingWebGL/GIS runtime.
- **Floating Top Bar (Search & Aggregates):** Centered search pill fixed at `top: 1.5rem` with a constrained max-width of `520px`. Left and right aggregate chips float with `space-md` gaps.
- **Left Telemetry Dock (Jurisdiction Tree & Multi-Dimensional Filters):** Width fixed at `340px`, pinned with `margin-hud` (16px) clearance from the edge.
- **Right Analytic Deck (District Detail, Trajectory Charts):** Width fixed at `380px`, collapsible to `48px` icon ribbon.
- **Bottom Timeline / Layer Matrix:** Compact horizontal drawer spanning up to `840px`, centered along `bottom: 1.5rem`.

### Scaling & Responsive Reflow
- **Large Command Walls (>= 1920px):** Left and right panels remain fully expanded; spatial canvas automatically recalibrates center focus.
- **Workstations (1280px - 1919px):** Standard operational view. Floating panels utilize translucent blur to avoid obstructing adjacent map vectors.
- **Compact Screens (< 1280px):** Side panels collapse into floating pill triggers; clicking a trigger invokes a focused sheet modal.

## Elevation & Depth

Depth is conveyed through luminous glass tiers, fine physical boundary reflections, and spatial blur rather than standard heavy drop shadows.

### Elevation Levels
- **Level 0 (Map Surface):** Deep slate `#0a0b10` with geo-polygons, ambient coordinate grids, and faint glow vectors.
- **Level 1 (Docked Containers & Passive Chips):** `rgba(18, 22, 34, 0.72)` background, `backdrop-filter: blur(16px)`, border: `1px solid rgba(255, 255, 255, 0.06)`.
- **Level 2 (Active Panels & Inspection Cards):** `rgba(22, 28, 44, 0.82)` background, `backdrop-filter: blur(24px)`, border: `1px solid rgba(255, 255, 255, 0.12)`, shadow: `0 8px 32px rgba(0, 0, 0, 0.5)`.
- **Level 3 (Focused Overlays & Context Menus):** `rgba(26, 34, 54, 0.95)`, border: `1px solid rgba(34, 211, 238, 0.3)`, shadow: `0 12px 48px rgba(0, 0, 0, 0.75), 0 0 12px rgba(34, 211, 238, 0.15)`.

### Optical Glow System
Active county or city boundaries emit an inner and outer optical rim illumination:
- Active Shanghai element: `box-shadow: 0 0 16px rgba(0, 242, 254, 0.25)`.
- Active Jiangsu element: `box-shadow: 0 0 16px rgba(0, 198, 255, 0.25)`.
- Active Zhejiang element: `box-shadow: 0 0 16px rgba(16, 185, 129, 0.25)`.
- Active Anhui element: `box-shadow: 0 0 16px rgba(245, 158, 11, 0.25)`.

## Shapes

The design system adopts a calibrated "Soft" shape profile (Level 1), balancing clean industrial edges with subtle ergonomic rounding to reinforce an advanced instrumentation aesthetic.

- **Base Cards & Control Panels:** `rounded` (0.25rem / 4px) for sharp structural authority.
- **Floating HUD Panels & Detail Windows:** `rounded-lg` (0.5rem / 8px).
- **Search Console & Quick State Pills:** Fully rounded pill style (`9999px`) reserved specifically for spatial search bars, tag badges, and primary state switches.
- **Inner Micro Controls:** `rounded-sm` (2px) on data cells, segmented controls, and tabular selection blocks.

## Components

### 1. Spatial Search Console (Top Deck)
- **Geometry:** Constrained width `520px`, height `42px`, pill shape (`rounded-full`).
- **Surface:** `rgba(18, 22, 34, 0.75)` with `backdrop-filter: blur(20px)`.
- **Border:** `1px solid rgba(255, 255, 255, 0.1)`. Shifts to `1px solid #22d3ee` on focus with an ambient outer glow.
- **Content:** Prefix map-pin micro icon, placeholder `Inter 13px` in `#64748b`, trailing command key shortcut badge (`JetBrains Mono 10px`, `rgba(255, 255, 255, 0.08)` fill).

### 2. Regional Filter Pills (Chips)
- **Default State:** `height: 28px`, padding `0 10px`, background `rgba(255, 255, 255, 0.03)`, border `1px solid rgba(255, 255, 255, 0.06)`, text `#94a3b8`.
- **Active State:** Border and text take the regional accent color (e.g., `#10b981` for Zhejiang), background transitions to a 10% opacity fill of that hue, accompanied by a `2px` left status dot.

### 3. Tactile Buttons
- **Primary Cyber Button:** Height `32px`, padding `0 14px`, `rounded-md` (4px). Background `#22d3ee` with black text (`#0a0b10`, `font-weight: 600`), slight hover brightness increase, active translation `translateY(1px)`.
- **Ghost HUD Button:** Background `rgba(255, 255, 255, 0.04)`, border `1px solid rgba(255, 255, 255, 0.08)`, text `#f8fafc`. Hover: background `rgba(255, 255, 255, 0.08)`, border `rgba(255, 255, 255, 0.16)`.

### 4. Telemetry Cards & Metric Badges
- **Card Surface:** `rgba(18, 22, 34, 0.72)`, backdrop blur `16px`, hairline border `rgba(255, 255, 255, 0.08)`.
- **Header:** Uppercase 11px JetBrains Mono title tracking with subtle color indicator line (2px high) at card top edge.
- **Metric Row:** Label in `Inter 12px (#94a3b8)`, numerical value in `JetBrains Mono 16px (#f8fafc)` with inline micro-sparklines or positive/negative diff delta pills.

### 5. Inputs & Dropdowns
- **Input Fields:** Dark inset fill `rgba(10, 11, 16, 0.6)`, hairline border `rgba(255, 255, 255, 0.1)`, caret color `#22d3ee`.
- **Dropdown List:** Floating glass panel `rgba(22, 28, 44, 0.95)`, item hover state `rgba(34, 211, 238, 0.08)` with a 2px left border accent matching the selected province color.

### 6. Interactive Plate Badges (Sandtable Overlays)
- Pinned anchor pins with a central glowing micro dot (`6px`), connected via ultra-thin vector lead line (`1px solid rgba(255, 255, 255, 0.3)`) to a floating summary pill containing county name, administrative level, and core indicator.