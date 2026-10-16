// Mock — a story written large: title, a decisive headline, the key numbers as big tiles, then
// situation, action, result and learning. Role swap shows it on the live screen and the canvas
// while Mock tells the story as the candidate.

import type { StoryCard } from '../live/controller.ts';
import '../styles/screens/story-board.css';

/** "41 min to mitigate" → 41 min, big · "to mitigate", small. A labelled number stays as it is. */
export function bigNumber(n: { label: string; value: string }): { value: string; label: string } {
  if (n.label) return n;
  const m = /^([~≈<>+\-−]?[$€£]?\d[\d,.]*\s?(?:%|×|x\b|[kKmMbB]\b|TB\b|GB\b|ms\b|min\b|hrs?\b|h\b|s\b|days?\b|weeks?\b|months?\b|yrs?\b|years?\b)?)\s+(.+)$/.exec(n.value.trim());
  return m ? { value: m[1].trim(), label: m[2] } : n;
}

/** Role swap: the story on screen, decisive headline first and the numbers large. */
export default function StoryBoard({ card, label = 'The story Mock is telling as you' }: { card: StoryCard; label?: string }) {
  const rows: [string, string][] = ([['Situation', card.situation], ['What I did', card.action], ['Result', card.result], ['Learning', card.learning]] as [string, string][]).filter(([, t]) => t);
  return (
    <section className="live-story" aria-label={label}>
      <div className="stack g4">
        <span className="label">{[card.lp, card.source].filter(Boolean).join(' · ') || 'Your story'}</span>
        <h2 className="live-story-title">{card.title}</h2>
      </div>
      {card.headline && <p className="live-story-headline">{card.headline}</p>}
      {card.numbers.length > 0 && (
        <div className="live-story-nums">
          {card.numbers.slice(0, 4).map((n, i) => {
            const m = bigNumber(n);
            return <div key={i} className={'live-story-num' + (m.value.length > 9 ? ' long' : '')}><span className="v">{m.value}</span>{m.label && <span className="l">{m.label}</span>}</div>;
          })}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="live-story-star">
          {rows.map(([k, t]) => <div key={k}><dt>{k}</dt><dd>{t}</dd></div>)}
        </dl>
      )}
    </section>
  );
}
