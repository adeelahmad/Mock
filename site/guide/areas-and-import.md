<script setup>
import { withBase } from 'vitepress'
</script>

# Areas and CSV import

**Areas** are what the interview assesses: competencies, values, or a company's principles.
Questions, stories, readiness, spend and the Game are all organised by area.

## Start from a preset or your own

- **AWS interview defaults:** the 16 Leadership Principles as areas, plus sample stories,
  questions, files and sessions. From first-run setup, or Settings → Library & data.
- **Your own:** import an areas CSV, then stories and questions that refer to those areas.

## CSV import

Library → Upload (or the first-run drop zone) takes a CSV and tells from its header what it
holds: STAR columns mean **stories**, a `name` column without a question means **areas**,
anything else is **questions**. Each import shows a review before anything is saved, and
offers the matching sample to download.

Cells with several values use `;` between items. Headers are matched case-insensitively, and
the alternatives in brackets work too.

### Areas

Download: <a :href="withBase('/samples/mock-areas-sample.csv')" download>mock-areas-sample.csv</a>

| Column | |
|---|---|
| `name` (`area`, `title`) | required |
| `short` (`code`, `abbreviation`) | a 2–3 letter tag |
| `description` (`details`) | what the area means; the interviewer and coach read it |
| `id` | optional stable id |

### Stories

Download: <a :href="withBase('/samples/mock-stories-sample.csv')" download>mock-stories-sample.csv</a>

| Column | |
|---|---|
| `title` (`story`, `name`) | required |
| `summary` | one line |
| `situation`, `task`, `action`, `result`, `learning` | the STAR parts |
| `areas` (`area`, `principles`) | `Primary; Secondary`; the first is the primary area |
| `numbers` (`key numbers`, `metrics`) | `Label: value; Label: value` |

### Questions

Download: <a :href="withBase('/samples/mock-questions-sample.csv')" download>mock-questions-sample.csv</a>

| Column | |
|---|---|
| `question` (`text`, `prompt`) | required |
| `area` (`areas`, `competency`) | area name, short tag or id |
| `source` | `common`, `previous`, `custom`… |
| `difficulty` (`level`) | 1–3 |
| `tags` (`company`) | `;`-separated |
| `sample` (`answer`) | an optional model answer |

Questions without an area are tagged by keyword, and with a Gemini key the unsure ones go to
Gemini Flash for a second opinion.

## Other formats

Markdown story files (`**Situation:** …` sections), question lists in markdown or text, and
Exponent `.zst` exports also import. CSV is the format the story import screen offers.
