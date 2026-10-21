type ListenerHandle = { remove(): Promise<void> };

// Capacitor registration is asynchronous; unmount can precede its resolution.
export function manageNativeListeners(registrations: Promise<ListenerHandle>[]): () => void {
  let disposed = false;
  const handles = new Set<ListenerHandle>();
  for (const registration of registrations) {
    void registration.then(handle => {
      if (disposed) void handle.remove().catch(() => undefined);
      else handles.add(handle);
    }).catch(() => undefined);
  }
  return () => {
    if (disposed) return;
    disposed = true;
    for (const handle of handles) void handle.remove().catch(() => undefined);
    handles.clear();
  };
}
