// Declared: the consumer wrapper's handle, and a system consumer with its reason.
const consumers = queues.map((queue) => {
  const consumer = createConsumer({ db, queue, handlers, now, signal });
  return subscribe(receiver, consumer.handle);
});

subscribe(receiver, systemConsumer('scan results, scoped by the blob path', async (delivery: Delivery) => delivery.complete()));
subscribe(receiver, systemConsumer('', async (delivery: Delivery) => delivery.complete()));
