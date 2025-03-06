import { subscribeToEvents } from "./rabbitmq/subscriber";
subscribeToEvents("user_events", async (event) => {
  console.log(`Received: ${event.event}, User: ${event.userId}`);
});
