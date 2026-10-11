# Spend tracker

Every Gemini call reports how many tokens it used, and Mock adds them up.

- The **Spent** pill shows the total: top-right on phone, in the sidebar on desktop, and in the
  header during a live session. Tap it for the split per area.
- Live tokens count toward the area of the question being asked, analysis cards toward the
  answer's area. Session reports, question tagging, embeddings and PDF reading go under
  "Reports & other".

## Prices

Settings → **Budget** has one row per model, in USD per 1M tokens, with text and audio input
and output priced separately. It comes filled with Google's published prices (checked
2026-10-11; Gemini 3.8 Flash doubles on 2027-01-01, so edit the row then).

| Model | Input | Output | Audio in | Audio out |
|---|---|---|---|---|
| `gemini-3.8-live` | 0.75 | 4.50 | 3.00 | 12.00 |
| `gemini-3.8-flash` | 0.75 | 3.75 | 0.75 | 3.75 |
| `gemini-embedding-001` | 0.15 | – | – | – |

Mock stores token counts, not dollars, so a new price re-prices everything already spent.
A model without a row uses the first row. *Reset spend* sets the counter back to $0.

The counts live in settings, so backups and [sync](/guide/sync) carry them.
