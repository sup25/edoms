import request from "supertest";
import express from "express";
import * as service from "../service";
import { adminRegisterController } from "../controller";

jest.mock("../service");
const mockedService = jest.mocked(service);

describe("POST /api/v1/admins", () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.post("/api/v1/admins", adminRegisterController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should register an admin", async () => {
    const requestBody = {
      email: "test@example.com",
      password: "hello_world123",
    };

    const mockToken = "mocked_jwt_token";
    mockedService.adminRegisterService.mockResolvedValue(mockToken);

    const response = await request(app)
      .post("/api/v1/admins")
      .send(requestBody)
      .set("Accept", "application/json");

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      message: "Admin registered successfully",
      data: mockToken,
    });

    expect(mockedService.adminRegisterService).toHaveBeenCalledWith({
      email: requestBody.email,
      password: requestBody.password,
    });
  });

  it("should handle existing email error", async () => {
    const requestBody = {
      email: "existinFDg@example.com",
      password: "hello_world123",
    };

    mockedService.adminRegisterService.mockRejectedValue(
      new Error("Email already registered")
    );

    const response = await request(app)
      .post("/api/v1/admins")
      .send(requestBody)
      .set("Accept", "application/json");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Email already registered",
      data: null,
    });
  });

  it("should handle Internal server error", async () => {
    const requestBody = {
      email: "testg@example.com",
      password: "hello_world123",
    };

    mockedService.adminRegisterService.mockRejectedValue(
      new Error("Unexpected error")
    );

    const response = await request(app)
      .post("/api/v1/admins")
      .send(requestBody)
      .set("Accept", "application/json");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Something went wrong. Please try again later.",
      data: null,
    });

    expect(mockedService.adminRegisterService).toHaveBeenCalledWith({
      email: requestBody.email,
      password: requestBody.password,
    });
  });
});
