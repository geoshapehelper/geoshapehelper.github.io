// Session-local id generators for features, layers and pipeline operations.
let g = 0;
let l = 0;
let o = 0;

export const newGid = (): string => `g${++g}`;
export const newLayerId = (): string => `L${++l}`;
export const newOpId = (): string => `op${++o}`;
