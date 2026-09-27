import amqplib from "amqplib";
import { BrokerConfig } from "../config/brokerConfig";
import logger from "../utils/logger";

/**
 * Shared AMQP connection manager.
 *
 * One long-lived connection per process, shared by the publisher and every
 * consumer. Replaces the previous behaviour of opening a TCP connection and
 * channel per publish, which was expensive and dropped messages because the
 * channel was closed before the broker had accepted them.
 *
 * On an unexpected close the connection is re-established with exponential
 * backoff and every registered consumer is re-attached.
 *
 * NOTE: this file is currently duplicated per service. Phase 2 extracts it
 * into a shared `packages/shared-events` workspace package.
 */

// Inferred from amqplib itself so this keeps compiling across amqplib versions
// that renamed the connection type (Connection -> ChannelModel in 0.11).
type Conn = Awaited<ReturnType<typeof amqplib.connect>>;
type ConfirmCh = Awaited<ReturnType<Conn["createConfirmChannel"]>>;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

let connectionPromise: Promise<Conn> | null = null;
let publishChannelPromise: Promise<ConfirmCh> | null = null;
let shuttingDown = false;

/** Callbacks that re-attach consumers after a reconnect. */
const resubscribers = new Set<() => Promise<void>>();

export function registerResubscriber(fn: () => Promise<void>): void {
  resubscribers.add(fn);
}

async function createConnection(): Promise<Conn> {
  const connection = await amqplib.connect(BrokerConfig.amqpUrl);

  connection.on("error", (error: unknown) => {
    logger.error("AMQP connection error", error);
  });

  connection.on("close", () => {
    publishChannelPromise = null;
    connectionPromise = null;

    if (shuttingDown) {
      logger.info("AMQP connection closed during shutdown");
      return;
    }

    logger.warn("AMQP connection closed unexpectedly, reconnecting");
    scheduleReconnect(0);
  });

  logger.info("AMQP connection established");
  return connection;
}

function scheduleReconnect(attempt: number): void {
  if (shuttingDown) return;

  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);

  setTimeout(async () => {
    if (shuttingDown) return;
    try {
      await getConnection();
      // Re-attach consumers; each resubscriber re-asserts its own topology.
      for (const resubscribe of resubscribers) {
        await resubscribe();
      }
      logger.info("AMQP reconnected and consumers re-attached");
    } catch (error: unknown) {
      logger.warn(
        `AMQP reconnect attempt ${attempt + 1} failed, retrying in ${delay}ms`,
        error
      );
      connectionPromise = null;
      scheduleReconnect(attempt + 1);
    }
  }, delay).unref?.();
}

export async function getConnection(): Promise<Conn> {
  if (!connectionPromise) {
    connectionPromise = createConnection().catch((error) => {
      // Do not cache a rejected promise, otherwise every later call fails.
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

/**
 * Confirm channel used for all publishing, so the broker acknowledges every
 * message before `publishEvent` resolves.
 */
export async function getPublishChannel(): Promise<ConfirmCh> {
  if (!publishChannelPromise) {
    publishChannelPromise = (async () => {
      const connection = await getConnection();
      const channel = await connection.createConfirmChannel();

      channel.on("error", (error: unknown) => {
        logger.error("AMQP publish channel error", error);
      });
      channel.on("close", () => {
        publishChannelPromise = null;
      });

      return channel;
    })().catch((error) => {
      publishChannelPromise = null;
      throw error;
    });
  }
  return publishChannelPromise;
}

/** Fresh channel for a consumer, so one bad consumer cannot kill the others. */
export async function createConsumerChannel() {
  const connection = await getConnection();
  return connection.createChannel();
}

/** Drains in-flight work and closes the connection. Call on SIGTERM/SIGINT. */
export async function closeBroker(): Promise<void> {
  shuttingDown = true;
  resubscribers.clear();

  try {
    if (publishChannelPromise) {
      const channel = await publishChannelPromise;
      await channel.close();
    }
  } catch (error: unknown) {
    logger.warn("Error closing AMQP publish channel", error);
  }

  try {
    if (connectionPromise) {
      const connection = await connectionPromise;
      await connection.close();
    }
  } catch (error: unknown) {
    logger.warn("Error closing AMQP connection", error);
  }

  publishChannelPromise = null;
  connectionPromise = null;
  logger.info("AMQP connection closed");
}
