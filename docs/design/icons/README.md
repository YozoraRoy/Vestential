**English** ｜ [繁體中文](./README_zh.md)

# doc/icons — Brand Identity Logo Output Folder

> Goal: produce the Vestential brand identity logo (the source master for social avatars, the site icon and even the app icon).
> The generated image files (`.png`/`.svg`/`.pdf`) are always kept together in this folder.

## Brand Brief (the basis for logo generation)

- **Name**: Vestential = **Vest** (invest) + **Essential** (indispensable)
  → The initial "V"/"Vest" or an "ascending curve / polyline" element can be used for the identity.
- **Positioning**: a Taiwan stock-market AI information platform (post-close/gift forecasts, personal P&L estimation, backtesting, AI analysis).
- **Spirit**: value investing, long-term accumulation, discipline.
- **Colour tokens** (see §1 of `doc/design-guideline.md`):
  - primary brand blue `#4f8cff`
  - secondary green (positive/profit) `#34d399`
  - warning red `#f87171`
  - dark base `#0f1118` / card `#1a1d2e` / `#222639`
- **Fonts**: system fonts mainly (PingFang TC / Noto Sans TC); a neutral sans-serif is recommended for the logo.

## Output Specs

| Purpose | Format | Size |
|---|---|---|
| Social avatar master | PNG (transparent or circular) | 1024×1024 |
| FB cover / X banner derivative | PNG | 1200×628 (FB Page), 1500×500 (X) |
| Site favicon/app icon | PNG + SVG | 512×512, 64×64, 180×180 |
| Vector master | SVG / PDF | — |

## Existing Assets (already produced)

| File | Description |
|---|---|
| `vestential-logo-1024.png` | **Icon master (current)**: a single accumulation arc (valley-V), a blue→green gradient, a green target dot at the right end, transparent background 1024×1024 |
| `vestential-lockup-1200x628.png` | **Primary lockup**: icon + VESTENTIAL wordmark (Bahnschrift) + tagline, dark background 1200×628 (suitable for FB/OG) |
| `vestential-logo-concept.md` | The design rationale "Accumulation Arc" and the design decisions (form/colour/type) |

### 9 Reference Candidate Versions (v1–v9, transparent background 1024×1024)

| File | Direction | Highlights |
|---|---|---|
| `vestential-logo-v1-monogram-1024.png` | Geometric two-colour V | Left arm blue, right arm green, valley bottom tucked in + a target dot at the upper right; extremely minimal |
| `vestential-logo-v2-candle-1024.png` | Candlestick V shape | 7 candles arranged along a V shape, a red candle at the bottom (the entry zone), turning green as it climbs, with a green target dot at the peak |
| `vestential-logo-v3-channel-1024.png` | Dual-track channel arc | An accumulation arc on the outside + a bright thin track embedded inside = the "value accumulation channel"; a blue→green gradient |
| `vestential-logo-v4-orbit-1024.png` | Orbital dial | A ring + a tick bezel, with the arc entering the circle and hugging the bottom, and the green target dot landing on the ring (the two axes of time/price) |
| `vestential-logo-v5-fold-1024.png` | Folded-layers V | Three offset layers (blue→dark blue) creating a folded thickness, with the front layer in a blue→green gradient + a target dot |
| `vestential-logo-v6-sprout-1024.png` | **Proposal B: compounding sprout** | A modern two-leaf geometric V, a small blue seedling on the left and an unfurling green one on the right, a morning-dew target dot; friendly and retail-investor oriented |
| `vestential-logo-v7-mobius-1024.png` | **Proposal C: Möbius strip** | A three-dimensional twisting infinite-cycle V ribbon, flipping and interleaving at the bottom of the valley, looping seamlessly; a premium tech feel |
| `vestential-logo-v8-prism-1024.png` | **Proposal D: intelligent crystal prism** | A multi-faceted isometric 3D crystal V with 3 rays of refraction analysis spectrum radiating to the upper right; AI-tech native |
| `vestential-logo-v9-scales-1024.png` | **Proposal E: Graham's scales** | A geometric scales V, with an intrinsic-value cube in the left pan and a rising growth starburst on the right; for the value-investing school |

> Final-selection flow: pick one direction (or specify a mix) → cut the sizes per the `SOP` → apply to the social accounts.
>
> Note: the originally referenced `doc/social-media-plan.md` does not exist (open a separate document if social scheduling planning is needed), so step 3 of the SOP follows the actual posting schedule instead.

## SOP
1. First use the design skill (`canvas-design`) to produce the master image → save it here.
2. Cut the various sizes per the table above → same name but with the purpose annotated (such as `vestential-logo-1024.png`, `vestential-banner-1500x500.png`).
3. Apply them when the social accounts go live (`doc/social-media-plan.md` Phase A2).
