/** product WS URL matching the HTTP scheme: http→ws, https→wss. */
export const liveUrl = (apiUrl: string) => `${apiUrl.replace(/^http/, 'ws')}/v1/live`;

export interface LiveSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}
export interface LiveOptions {
  url: string;
  createSocket(url: string): LiveSocket;
  /** Called for every change hint (debounced) and after every (re)connect: hints are never authoritative. */
  onChange(): void;
  onStatus?(connected: boolean): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  random(): number;
  debounceMs?: number;
}
export const reconnectDelayMs = (failures: number, random: number) => Math.min(30_000, 1000 * 2 ** failures) * (0.5 + random / 2);

/** Reconnecting change-hint subscription. Returns dispose, which closes the socket and cancels timers. */
export function connectLive(options: LiveOptions): () => void {
  const { debounceMs = 500 } = options;
  let socket: LiveSocket | undefined;
  let debounce: unknown, retry: unknown;
  let failures = 0;
  let disposed = false;

  function hint() {
    if (debounce !== undefined) options.clearTimer(debounce);
    debounce = options.setTimer(() => { debounce = undefined; if (!disposed) options.onChange(); }, debounceMs);
  }
  function open() {
    retry = undefined;
    const current = options.createSocket(options.url);
    socket = current;
    current.onopen = () => {
      if (disposed || socket !== current) return;
      failures = 0; options.onStatus?.(true);
      options.onChange(); // anything missed while disconnected
    };
    current.onmessage = event => {
      if (disposed || socket !== current) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message?.type === 'hazards.changed') hint();
      } catch { /* malformed hints are ignored */ }
    };
    const lost = () => {
      if (disposed || socket !== current) return;
      socket = undefined; options.onStatus?.(false);
      retry = options.setTimer(open, reconnectDelayMs(failures++, options.random()));
    };
    current.onclose = lost;
    current.onerror = lost;
  }
  open();
  return () => {
    disposed = true;
    if (debounce !== undefined) options.clearTimer(debounce);
    if (retry !== undefined) options.clearTimer(retry);
    const closing = socket; socket = undefined;
    closing?.close();
  };
}
