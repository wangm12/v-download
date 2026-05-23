# V-Download Settings Redesign Notes

## Direction
The current Settings modal is too linear. It mixes general app preferences, queue behavior, and browser/cookie setup in one vertical list. The redesign uses a Preferences window with a left sidebar and grouped cards.

## Structure
- General: default folder and basic behavior.
- Downloads: concurrency, retry, output format, filename template.
- Browser: Chrome companion, cookie sync, browser profiles, local privacy.
- Sites: per-site profiles and format defaults.
- Advanced: engine path, proxy, bandwidth, logs, reset.

## Compact fallback
If the product must keep the current small modal, use the compact modal mockup. It keeps the same footprint but groups controls into General and Browser sections and removes paragraph-heavy helper text.

## Black and white rules
- White is reserved for the primary action and active nav state.
- Status uses labels and border treatments, not color.
- Use cards, borders, spacing, and typography for hierarchy.
