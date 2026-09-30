import { Card } from './Card.js';

export interface ComingSoonProps {
  title: string;
  body: string;
  items: string[];
  figure: string;
}

// Stand-in for a sidebar section that is not designed yet: what it is for,
// what it will hold, and a dashed frame where its main view goes.
export function ComingSoon({ title, body, items, figure }: ComingSoonProps) {
  return (
    <>
      <Card>
        <div className="ui-label" style={{ color: 'var(--ui-primary)' }}>
          Coming soon
        </div>
        <h2 className="ui-h2">{title}</h2>
        <p className="ui-p">{body}</p>
        <ul className="ui-bullets">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Card>
      <div className="ui-placeholder">{figure}</div>
    </>
  );
}
