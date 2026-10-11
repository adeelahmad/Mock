# Hints from your files

Mock indexes the prep files you include (resume, notes, past loops, PDFs) so the interviewer
and coach can use them.

## What you get

- **Hints.** In a session, the hint and the story notes show the passage from your files
  closest to the current question, with its heading ("Resume › Payments, 2023: …").
- **The coach can search.** During a session the live coach has a `search_prep` tool to look
  through your files.
- **Build a story together.** When you have no story for a question, the coach helps you build
  one in STAR form and saves it to your library with `save_story`, linked to the area.
- **Test it.** Library → Files shows the index and lets you try a search.

## How it works

Files are split into chunks at headings and paragraphs. With a Gemini key, chunks are embedded
with `gemini-embedding-001` (768 dimensions) and search ranks by similarity. Without a key, or
if embedding fails, search falls back to keyword ranking, so a hint is always there.

A file is re-embedded only when it changes. PDFs are read by Gemini Flash to extract the text;
the original is kept. Embedding and PDF tokens show up in the [spend tracker](/guide/spend).

The index is derived data: it isn't in backups and is rebuilt when needed.
