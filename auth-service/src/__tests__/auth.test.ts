import request from "supertest";
import { app } from "../index";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../model";
import connect from "../config/db";
import { ERole } from "../types";

let server: any;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret";

  server = app.listen(5001, () => {
    console.log("Test server running on port 5001");
  });

  try {
    await connect.authenticate();
    console.log("Database connection successful");
    await User.sync({ force: true }); // Reset table for tests
    const hashedPassword = await bcrypt.hash("password123", 10);
    const testUser = await User.create({
      email: "test@example.com",
      password_hash: hashedPassword,
      role: ERole.Admin,
    });
    console.log("Test user created");
    console.log("Test user created with ID:", testUser.id);
  } catch (error) {
    console.error("Database setup error:", error);
    throw error;
  }
});

afterAll(async () => {
  try {
    await User.destroy({ where: { email: "test@example.com" } });
    await connect.close();
    console.log("Database connection closed");
  } catch (error) {
    console.error("Database cleanup error:", error);
  }

  await new Promise<void>((resolve) => {
    server.close(() => {
      console.log("Test server closed");
      resolve();
    });
  });

  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
});

describe("Auth Flow", () => {
  test("POST /api/v1/login - should return access and refresh tokens", async () => {
    const response = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("accessToken");
    expect(response.body.data).toHaveProperty("refreshToken");
    expect(response.body.data).toHaveProperty("expiresAt");
  });

  test("GET /api/v1/protected - should allow access with valid token", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/login")
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
        exp: Math.floor(Date.now() / 1000) - 60, // Expired 60 seconds ago
      },
      process.env.JWT_SECRET!
    );

    const response = await request(app)
      .get("/api/v1/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid or expired token");
  });

  test("POST /api/v1/refresh - should issue a new access token", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/login")
      .send({ email: "test@example.com", password: "password123" });

    const refreshToken = loginResponse.body.data.refreshToken;
    expect(refreshToken).toBeDefined();

    const response = await request(app)
      .post("/api/v1/refresh")
      .set("x-refresh-token", refreshToken);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("accessToken");
  });

  test("POST /api/v1/refresh - should fail with invalid refresh token", async () => {
    const invalidRefreshToken = "invalid.token.here";

    const response = await request(app)
      .post("/api/v1/refresh")
      .set("x-refresh-token", invalidRefreshToken);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Invalid or expired refresh token");
  });

  test("POST /api/v1/refresh - should fail when no refresh token is provided", async () => {
    const response = await request(app).post("/api/v1/refresh");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Refresh token not provided");
  });

  test("POST /api/v1/refresh - should fail with empty refresh token header", async () => {
    const response = await request(app)
      .post("/api/v1/refresh")
      .set("x-refresh-token", "");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Refresh token not provided");
  });
});
