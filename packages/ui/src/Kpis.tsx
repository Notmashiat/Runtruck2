export interface Kpi {
  label: string;
  value: string;
  note?: string;
  onClick?: () => void;
}

// The row of white stat cards at the top of a screen: label (and optional
// note) bottom-left, the big number bottom-right.
export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <div className="ui-kpis">
      {items.map((k) => (
        <div key={k.label} className={`ui-kpi${k.onClick ? ' is-clickable' : ''}`} onClick={k.onClick}>
          <div>
            <div className="ui-kpi-label">{k.label}</div>
            {k.note && <div className="ui-kpi-note">{k.note}</div>}
          </div>
          <div className="ui-kpi-value">{k.value}</div>
        </div>
      ))}
    </div>
  );
}
