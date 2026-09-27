import { UniqueConstraintError } from "sequelize";
import { processOnce } from "../utils/idempotency";
import ProcessedEvent from "../model/processedEvent.model";
import sequelize from "../config/db";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock("../model/processedEvent.model", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedTransaction = sequelize.transaction as unknown as jest.Mock;
const mockedCreate = ProcessedEvent.create as unknown as jest.Mock;

/** Real sequelize.transaction runs the callback and rethrows its errors. */
function realTransactionBehaviour() {
  mockedTransaction.mockImplementation(async (cb: any) => cb({} as any));
}

beforeEach(() => {
  jest.clearAllMocks();
  realTransactionBehaviour();
});

describe("processOnce", () => {
  it("claims the event then runs the work, in that order", async () => {
    const calls: string[] = [];
    mockedCreate.mockImplementation(async () => { calls.push("claim"); });
    const work = jest.fn(async () => { calls.push("work"); });

    const ran = await processOnce("c", "evt", { messageId: "m1", attempt: 1, queue: "q" }, work);

    expect(ran).toBe(true);
    // Claim must come first: if the work commits without the ledger row, a
    // redelivery would apply it a second time.
    expect(calls).toEqual(["claim", "work"]);
  });

  it("namespaces the ledger key by consumer, so fan-out still works", async () => {
    mockedCreate.mockResolvedValue({});
    await processOnce("inventory.payment-failure", "payment_failure",
      { messageId: "abc", attempt: 1, queue: "q" }, async () => {});

    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "inventory.payment-failure:abc" }),
      expect.anything()
    );
  });

  it("returns false and skips the work on a duplicate", async () => {
    mockedCreate.mockRejectedValue(
      new UniqueConstraintError({ errors: [], fields: {} } as any)
    );
    const work = jest.fn();

    const ran = await processOnce("c", "evt", { messageId: "m1", attempt: 2, queue: "q" }, work);

    expect(ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it("rethrows real errors so the subscriber retries", async () => {
    mockedCreate.mockRejectedValue(new Error("connection reset"));
    await expect(
      processOnce("c", "evt", { messageId: "m1", attempt: 1, queue: "q" }, async () => {})
    ).rejects.toThrow("connection reset");
  });

  it("rethrows when the work itself fails, so nothing is marked processed", async () => {
    mockedCreate.mockResolvedValue({});
    await expect(
      processOnce("c", "evt", { messageId: "m1", attempt: 1, queue: "q" }, async () => {
        throw new Error("work failed");
      })
    ).rejects.toThrow("work failed");
  });

  it("runs unprotected when the event has no messageId", async () => {
    const work = jest.fn();
    const ran = await processOnce("c", "evt", { attempt: 1, queue: "q" }, work);

    // Hand-injected events (e.g. the RabbitMQ management UI) have no
    // messageId; there is nothing stable to dedupe on, so the work still runs.
    expect(ran).toBe(true);
    expect(work).toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("runs unprotected when meta is missing entirely", async () => {
    const work = jest.fn();
    const ran = await processOnce("c", "evt", undefined, work);
    expect(ran).toBe(true);
    expect(work).toHaveBeenCalled();
  });
});
