export const isOfSize: (_: number) => <A>(_: Set<A>) => boolean = size => set => set.size === size;

export const isEmpty: <A>(_: Set<A>) => boolean = isOfSize(0);

export const isNonEmpty: <A>(_: Set<A>) => boolean = set => set.size > 0;
