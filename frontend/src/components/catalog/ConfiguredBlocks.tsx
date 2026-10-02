"use client";

import { Children, isValidElement, type ReactNode } from "react";

export function ConfiguredBlock({children}: {code: string; children: ReactNode}) {
  return <div className="space-y-4">{children}</div>;
}

/** Sort the optional block slots in DOM order while retaining ordinary facts
 * in their original slots. Configuration only selects supported components. */
export function ConfiguredBlocks({blocks,children}: {blocks: readonly string[]; children: ReactNode}) {
  const items = Children.toArray(children);
  const optional = items.filter((item) => isValidElement<{code:string}>(item) &&
    item.type === ConfiguredBlock && blocks.includes(item.props.code))
    .sort((a,b) => blocks.indexOf((a as {props:{code:string}}).props.code)-blocks.indexOf((b as {props:{code:string}}).props.code));
  let next = 0;
  return <div className="space-y-4">{items.flatMap((item) => {
    if (!isValidElement<{code:string}>(item) || item.type !== ConfiguredBlock) return [item];
    if (!blocks.includes(item.props.code)) return [];
    return [optional[next++]];
  })}</div>;
}
