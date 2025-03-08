import { subscribeToProductEvents } from "./rabbitmq/subscriber";

async function startService() {
  await subscribeToProductEvents();
  console.log("Inventory service started");
}

startService();
