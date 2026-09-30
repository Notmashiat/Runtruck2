import type { CSSProperties, ElementType, ReactNode } from 'react';

export interface BlueprintProps {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onClick?: () => void;
}

// The Industry design system's wireframe frame: a hairline border plus four
// "+" registration marks at the corners (see industry.css `.blueprint`/`.corner`).
export function Blueprint({ as: Element = 'div', className = '', style, children, onClick }: BlueprintProps) {
  return (
    <Element className={`blueprint ${className}`} style={style} onClick={onClick}>
      {children}
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
    </Element>
  );
}
