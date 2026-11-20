// Straight on the SDK, outside serviceBus.ts: refused.
receiver.subscribe({ processMessage: async (message) => assess(message.body), processError: async () => {} });
