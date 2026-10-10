# Design export

The Claude Design project "Mock" (`86b9cf0c-3d30-4544-b5c0-f8e775ffb2c9`), exported 2026-10-10.
Boards (`*.dc.html`) render in a browser with `support.js` (the design tool's runtime, which
loads React and Babel from unpkg) and the Aladdin design system under `_ds/`. `ios-frame.jsx`
is the phone bezel used by the artboards. `mock-*.js` are the prototype's logic modules, kept
for reference (see `docs/design-inventory.md` for what was reused or replaced).

Not included: the Exponent exports under `uploads/` (18 MB + 4 MB; `public/exponent-bank.json`
is the distilled bank) and the 877 KB bundled analysis-card page.

`npm run refs` renders every artboard, light and dark, to `tests/design-refs/` for screenshot
comparison (git-ignored).
