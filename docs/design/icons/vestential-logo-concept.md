**English** ｜ [繁體中文](./vestential-logo-concept_zh.md)

# Vestential Brand Identity — "Accumulation Arc"

> Logo concept master. Output files:
> - `vestential-logo-1024.png` — icon master (1024×1024, transparent background)
> - `vestential-lockup-1200x628.png` — primary lockup (social banner / OG preview)

## Naming Philosophy

**Accumulation Arc.**

Vestential = Vest + Essential. Its visual DNA is a "valley": a smooth arc sinks from the upper left into a rounded valley bottom,
then rises in a higher posture at the upper right — the left hand is the patience of a decline, the right hand is the sublimation of recovery. The valley is not defeat, but the silent entry zone of a value investor.

The arc flows in brand blue (`#4f8cff`) and out as brand green (`#34d399`): from "waiting" it gradually becomes "growth". The green dot at the right end of the arc is the only emphasis mark —
it is at once the target price, the bell that a single identification has completed, and the only note in this system that needs to sound.

The rest is left blank. Like the sky above a line chart, letting the arc itself be the entire narrative.

## Design Decisions

- **Form**: a single continuous arc drawn with cubic Bézier curves (a valley-V), with both ends tapering in round caps (tip 42px → valley 62px).
- **Colour**: a seamless gradient from `#4f8cff` → `#34d399` along the arc length; the target dot at the right end is green `#34d399`.
- **Detail**: a very faint horizontal dashed line above the valley bottom — the "support level" — giving the image a line-chart/coverage metaphor without stealing the show.
- **Type**: Bahnschrift (DIN-family geometric sans), all caps, wide letter spacing; consistent with the arc's engineered feel.
- **Execution**: Python + PIL, 6× supersampling + LANCZOS downsampling, ensuring clean, alias-free edges.

## Finished Images

See `vestential-logo-1024.png` and `vestential-lockup-1200x628.png` in the same directory (for derivative sizes see `README.md` in this directory).
