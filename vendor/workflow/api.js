export async function start(fn, args = []) {
  queueMicrotask(() => {
    void fn(...args);
  });
  return { started: true };
}
