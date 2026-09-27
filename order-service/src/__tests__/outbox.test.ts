import { EventType } from "@edoms/shared-events";
import { publishToOutbox, drainOutbox } from "../rabbitmq/outbox";
import { publish } from "../rabbitmq/publisher";
import OutboxEvent from "../model/outbox.model";
import sequelize from "../config/db";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../model/outbox.model", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock("../rabbitmq/publisher", () => ({ publish: jest.fn() }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedCreate = OutboxEvent.create as unknown as jest.Mock;
const mockedQuery = sequelize.query as jest.Mock;
const mockedPublish = publish as jest.Mock;

const TX = {} as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockedCreate.mockResolvedValue({});
});

describe("publishToOutbox", () => {
  const validOrder = {
    orderId: 1,
    items: [{ productId: 2, quantity: 3, price: "19.99" }],
  };

  it("writes the row inside the caller's transaction", async () => {
    await publishToOutbox(EventType.ORDER_CREATED, validOrder, TX, {
      correlationId: "corr-1",
    });

    // The whole point: the event row and the domain row commit together.
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: EventType.ORDER_CREATED,
        correlationId: "corr-1",
        status: "pending",
        attempts: 0,
      }),
      { transaction: TX }
    );
  });

  it("returns a stable eventId that the relay will reuse", async () => {
    const id = await publishToOutbox(EventType.ORDER_CREATED, validOrder, TX);
    expect(id).toHaveLength(36);
    expect(mockedCreate.mock.calls[0][0].eventId).toBe(id);
  });

  it("does NOT publish to the broker directly", async () => {
    await publishToOutbox(EventType.ORDER_CREATED, validOrder, TX);
    // Publishing here would reopen the window this phase exists to close.
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload so the domain change rolls back too", async () => {
    await expect(
      publishToOutbox(EventType.ORDER_CREATED, { orderId: 1, items: [] }, TX)
    ).rejects.toThrow();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("serialises Dates to ISO strings at write time", async () => {
    await publishToOutbox(
      EventType.ORDER_CREATED,
      { ...validOrder, createdAt: new Date("2026-01-01T00:00:00.000Z") },
      TX
    );
    const stored = mockedCreate.mock.calls[0][0].payload as any;
    expect(stored.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("mints a correlationId when the caller gives none", async () => {
    await publishToOutbox(EventType.ORDER_CREATED, validOrder, TX);
    expect(mockedCreate.mock.calls[0][0].correlationId).toHaveLength(36);
  });
});

describe("drainOutbox", () => {
  const row = {
    id: "1",
    event_id: "evt-abc",
    event_type: EventType.ORDER_CREATED,
    payload: { orderId: 1, items: [{ productId: 2, quantity: 3, price: "19.99" }] },
    correlation_id: "corr-1",
    causation_id: null,
    attempts: 0,
  };

  it("publishes a pending row and marks it sent", async () => {
    mockedQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    mockedPublish.mockResolvedValue("evt-abc");

    const sent = await drainOutbox();

    expect(sent).toBe(1);
    expect(mockedPublish).toHaveBeenCalledWith(
      EventType.ORDER_CREATED,
      row.payload,
      expect.objectContaining({ eventId: "evt-abc", correlationId: "corr-1" })
    );
    expect(mockedQuery.mock.calls[1][0]).toMatch(/status = 'sent'/);
  });

  it("republishes with the SAME eventId so consumers can deduplicate", async () => {
    mockedQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    mockedPublish.mockResolvedValue("evt-abc");

    await drainOutbox();

    // A relay retry must not mint a new id, or the Phase 3 ledger cannot
    // recognise the duplicate and the work runs twice.
    expect(mockedPublish.mock.calls[0][2]).toMatchObject({ eventId: "evt-abc" });
  });

  it("claims rows with FOR UPDATE SKIP LOCKED so replicas do not collide", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    await drainOutbox();
    expect(mockedQuery.mock.calls[0][0]).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it("only claims rows that are due", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    await drainOutbox();
    expect(mockedQuery.mock.calls[0][0]).toMatch(/available_at <= NOW\(\)/);
    expect(mockedQuery.mock.calls[0][0]).toMatch(/status = 'pending'/);
  });

  it("keeps a failed row pending and backs off", async () => {
    mockedQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    mockedPublish.mockRejectedValue(new Error("broker down"));

    const sent = await drainOutbox();

    expect(sent).toBe(0);
    const update = mockedQuery.mock.calls[1];
    expect(update[1].replacements).toMatchObject({ attempts: 1, status: "pending" });
    expect(update[1].replacements.error).toContain("broker down");
    // The event is NOT lost - it stays pending for another attempt.
  });

  it("marks a row failed once attempts are exhausted", async () => {
    mockedQuery.mockResolvedValueOnce([{ ...row, attempts: 9 }]).mockResolvedValueOnce([]);
    mockedPublish.mockRejectedValue(new Error("still down"));

    await drainOutbox();

    expect(mockedQuery.mock.calls[1][1].replacements).toMatchObject({
      attempts: 10,
      status: "failed",
    });
  });

  it("keeps going when one row fails, so a poison row cannot block the queue", async () => {
    const good = { ...row, id: "2", event_id: "evt-good" };
    mockedQuery
      .mockResolvedValueOnce([row, good])
      .mockResolvedValue([]);
    mockedPublish
      .mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValueOnce("evt-good");

    const sent = await drainOutbox();

    expect(sent).toBe(1);
    expect(mockedPublish).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there is nothing pending", async () => {
    mockedQuery.mockResolvedValueOnce([]);
    expect(await drainOutbox()).toBe(0);
    expect(mockedPublish).not.toHaveBeenCalled();
  });
});
