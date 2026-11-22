// Iterates the SDK's messages outside serviceBus.ts, and a shorthand processMessage handler: refused.
for await (const message of receiver.getMessageIterator()) await assess(message.body);

const processMessage = async (message: Message) => assess(message.body);
receiverOf(queue).listen({ processMessage });
