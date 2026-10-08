type IngressTrace = {
  firstReceivedAt: number;
  lastReceivedAt: number;
  deliveries: number;
  offline: boolean;
};

// Diagnostic state only: expiring/evicting a trace never drops a WhatsApp message.
// Keep ciphertext stubs until a later successfully decrypted delivery consumes it.
export class WhatsAppIngressTiming {
  private readonly traces = new Map<string, IngressTrace>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly lifetimeMs = 10 * 60_000,
    private readonly now = Date.now,
  ) {}

  private key(chatId: string, messageId: string) { return `${chatId}|${messageId}`; }

  record(chatId: string, messageId: string, offline: boolean) {
    if (!chatId || !messageId) return;
    const now = this.now();
    for (const [key, trace] of this.traces) {
      if (now - trace.firstReceivedAt < this.lifetimeMs) break;
      this.traces.delete(key);
    }
    const key = this.key(chatId, messageId);
    const trace = this.traces.get(key);
    if (trace) {
      trace.lastReceivedAt = now;
      trace.deliveries += 1;
      trace.offline ||= offline;
    } else {
      this.traces.set(key, { firstReceivedAt: now, lastReceivedAt: now, deliveries: 1, offline });
    }
    while (this.traces.size > this.maxEntries) {
      this.traces.delete(this.traces.keys().next().value!);
    }
  }

  consume(chatId: string, messageId: string) {
    const key = this.key(chatId, messageId);
    const trace = this.traces.get(key);
    this.traces.delete(key);
    return trace && this.now() - trace.firstReceivedAt < this.lifetimeMs ? trace : undefined;
  }
}