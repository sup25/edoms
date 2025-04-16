import request from "supertest";
import { app } from "../index";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { ERole } from "../types";

// Mock the database connection
jest.mock("../config/db", () => ({
  __esModule: true,
  default: {
    authenticate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock the User model
jest.mock("../model", () => {
  const { ERole } = require("../types");
  const mockUserInstance = {
    id: "1",
    email: "test@example.com",
    password_hash: "$2b$10$hashedpassword",
    role: ERole.Admin,
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserModel = class MockUser {
    static create = jest.fn().mockResolvedValue(mockUserInstance);
    static sync = jest.fn().mockResolvedValue(undefined);
    static findByPk = jest.fn().mockResolvedValue(mockUserInstance);
    static findOne = jest.fn().mockResolvedValue(mockUserInstance);
    static destroy = jest.fn().mockResolvedValue(undefined);
  };

  return {
    __esModule: true,
    default: mockUserModel,
  };
});

const mockUser = {
  id: "1",
  email: "test@example.com",
  password_hash: "$2b$10$hashedpassword",
  role: ERole.Admin,
  destroy: jest.fn(),
};

let server: any;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret";

  server = app.listen(5000, () => {
    console.log("Test server running on port 5000");
  });

  // Mock bcrypt with proper typing
  jest
    .spyOn(bcrypt, "hash")
    .mockImplementation(
      async (
        password: string | Buffer,
        salt: string | number
      ): Promise<string> => Promise.resolve(mockUser.password_hash)
    );

  jest
    .spyOn(bcrypt, "compare")
    .mockImplementation(
      async (password: string | Buffer, hash: string): Promise<boolean> =>
        Promise.resolve(true)
    );
});

afterAll(async () => {
  jest.restoreAllMocks();

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });

  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
});

describe("Auth Flow", () => {
  test("POST /api/v1/auth/login - should return access and refresh tokens", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("accessToken");
    expect(response.body.data).toHaveProperty("refreshToken");
    expect(response.body.data).toHaveProperty("expiresAt");
  });

  test("GET /api/v1/protected - should allow access with valid token", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" });

    const accessToken = loginResponse.body.data.accessToken;

    const response = await request(app)
      .get("/api/v1/protected")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe(
      "You have access to this protected route!"
    );
  });

  test("GET /api/v1/protected - should fail when access token expires", async () => {
    const expiredToken = jwt.sign(
      {
        userId: "1",
        email: "test@example.com",
        role: "user",
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      process.env.JWT_SECRET!
    );

    const response = await request(app)
      .get("/api/v1/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid or expired token");
  });

  test("POST /api/v1/auth/refresh - should issue a new access token", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "test@example.com", password: "password123" });

    const refreshToken = loginResponse.body.data.refreshToken;
    expect(refreshToken).toBeDefined();

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("x-refresh-token", refreshToken);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("accessToken");
  });

  test("POST /api/v1/auth/refresh - should fail with invalid refresh token", async () => {
    const invalidRefreshToken = "invalid.token.here";

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("x-refresh-token", invalidRefreshToken);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid or expired refresh token");
  });

  test("POST /api/v1/auth/refresh - should fail when no refresh token is provided", async () => {
    const response = await request(app).post("/api/v1/auth/refresh");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Refresh token not provided");
  });

  test("POST /api/v1/auth/refresh - should fail with empty refresh token header", async () => {
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("x-refresh-token", "");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Refresh token not provided");
  });
});
