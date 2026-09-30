import Order from "../model/order.model";
import {
  getOrderDetailsByIdService,
  getOrderStatusByIdService,
  Viewer,
} from "../service";

jest.mock("../model/order.model", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));

const mockedFindByPk = Order.findByPk as unknown as jest.Mock;

const OWNER: Viewer = { userId: 7, isPrivileged: false };
const STRANGER: Viewer = { userId: 8, isPrivileged: false };
const ADMIN: Viewer = { userId: 99, isPrivileged: true };

const ORDER = {
  id: 1,
  userId: 7,
  items: [{ productId: 1, quantity: 2, name: "Widget", price: "19.99" }],
  status: "confirmed",
};

/*
 * Defect #18.
 *
 * Both read endpoints took an id and returned whatever it pointed at - no
 * token, no ownership check - so every order in the system was readable by
 * counting upwards. Phase 5 made /orderStatus/:id the way a client learns its
 * own outcome, which turned that from an obscure endpoint into the main read
 * path.
 */
describe("order read ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindByPk.mockResolvedValue(ORDER);
  });

  describe("getOrderStatusByIdService", () => {
    it("lets the owner read their own order", async () => {
      await expect(getOrderStatusByIdService(1, OWNER)).resolves.toBe("confirmed");
    });

    it("refuses someone else's order", async () => {
      await expect(getOrderStatusByIdService(1, STRANGER)).rejects.toThrow(
        "Order not found"
      );
    });

    it("lets an admin read any order", async () => {
      // Support cannot answer "where is my order" otherwise.
      await expect(getOrderStatusByIdService(1, ADMIN)).resolves.toBe("confirmed");
    });
  });

  describe("getOrderDetailsByIdService", () => {
    it("lets the owner read their own order", async () => {
      await expect(getOrderDetailsByIdService(1, OWNER)).resolves.toMatchObject({
        status: "confirmed",
      });
    });

    it("refuses someone else's order", async () => {
      await expect(getOrderDetailsByIdService(1, STRANGER)).rejects.toThrow(
        "Order not found"
      );
    });

    it("does not leak the items of someone else's order", async () => {
      await expect(getOrderDetailsByIdService(1, STRANGER)).rejects.toThrow();
      // The rejection is the assertion, but state it explicitly: the caller
      // must never receive a body built from a row they cannot see.
      await getOrderDetailsByIdService(1, STRANGER).catch((error: Error) => {
        expect(error.message).not.toContain("Widget");
      });
    });
  });

  it("reports someone else's order exactly as a missing one", async () => {
    /*
     * Deliberate: 403 on a real id and 404 on a fake one would confirm which
     * ids exist, which is half of what an enumeration attack is looking for.
     * Both answers must be identical.
     */
    const refused = await getOrderStatusByIdService(1, STRANGER).catch(
      (error: Error) => error.message
    );

    mockedFindByPk.mockResolvedValue(null);
    const missing = await getOrderStatusByIdService(12345, STRANGER).catch(
      (error: Error) => error.message
    );

    expect(refused).toBe(missing);
  });

  it("treats an unauthenticated viewer as owning nothing", async () => {
    // viewerFrom() falls back to userId 0 when a guard did not run, so a
    // missing guard fails closed rather than matching every row.
    await expect(
      getOrderStatusByIdService(1, { userId: 0, isPrivileged: false })
    ).rejects.toThrow("Order not found");
  });
});
