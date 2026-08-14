type Listener = (activeCount: number) => void;

let activeCount = 0;
const listeners = new Set<Listener>();

export function startLoading(): void {
  activeCount += 1;
  emit();
}

export function stopLoading(): void {
  if (activeCount > 0) activeCount -= 1;
  emit();
}

export function onLoadingChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(activeCount);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener(activeCount);
}
