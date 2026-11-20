// Undeclared: subscribed directly, outside createConsumer and systemConsumer.
export const handle = async (delivery: Delivery) => {
  await assess(delivery.body);
  await delivery.complete();
};

subscribe(receiver, handle);
