import request from "supertest";
import express from "express";
import { deleteProductController } from "../controller";
import { validate } from "../middleware/validateRequest";
import { DeleteProductParamsSchema } from "../validations";
import * as service from "../service";
import { requireAdmin } from "../middleware/requireAdmin";
import jwt from "jsonwebtoken";

// Mock the service module
jest.mock("../service");
const mockedService = jest.mocked(service);

describe("DELETE /api/v1/deleteproduct/:id", () => {
  const app = express();
  app.use(express.json());
  app.delete(
    "/api/v1/deleteproduct/:id",
    requireAdmin,
    validate(undefined, DeleteProductParamsSchema),
    deleteProductController
  );

  const mockAdminToken = jwt.sign(
    { id: 1, role: "admin" },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "15m" }
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should delete a product successfully and return 200", async () => {
    mockedService.deleteProductService.mockResolvedValue(undefined);

    const response = await request(app)
      .delete("/api/v1/deleteproduct/1")
      .set("Authorization", `Bearer ${mockAdminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Product deleted successfully",
      data: null,
    });
    expect(mockedService.deleteProductService).toHaveBeenCalledWith(1);
  });

  it("should return 500 if service throws an error", async () => {
    mockedService.deleteProductService.mockRejectedValue(
      new Error("Service error")
    );

    const response = await request(app)
      .delete("/api/v1/deleteproduct/1")
      .set("Authorization", `Bearer ${mockAdminToken}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });
  });

  it("should return 400 for invalid product ID", async () => {
    const response = await request(app)
      .delete("/api/v1/deleteproduct/invalid")
      .set("Authorization", `Bearer ${mockAdminToken}`);

    expect(response.status).toBe(400);
  });
});
