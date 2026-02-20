export function start<T extends unknown[], R>(fn: (...args: T) => Promise<R> | R, args?: T): Promise<{ started: boolean }>;
