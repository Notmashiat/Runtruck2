// Status chip. Tones are presentation: the API returns status enums and each
// screen maps a status to a tone (architecture §5 — no styling in business data).
export type Tone = 'blue' | 'gray' | 'amber' | 'green';

export function Tag({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`ui-chip ui-chip-${tone}`}>{label}</span>;
}
