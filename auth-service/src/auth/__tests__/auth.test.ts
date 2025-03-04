import request from "supertest";
import { app } from "../../index";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../model";
import connect from "../../config/db";

let server: any;

beforeAll(async () => {
  // Set environment variables for testing
  process.env.JWT_SECRET = "test-secret";

  // Start the server explicitly for tests
  server = app.listen(5001, () => {
    console.log("Test server running on port 5001");
  });

  // Ensure database connection and sync
  try {
    await connect.authenticate();
    console.log("Database connection successful");
    await User.sync({ force: true }); // Reset table for tests
    const hashedPassword = await bcrypt.hash("password123", 10);
    await User.create({
      email: "test@example.com",
      password_hash: hashedPassword,
      role: "user",
    });
    console.log("Test user created");
  } catch (error) {
    console.error("Database setup error:", error);
    throw error; // Fail fast if setup fails
  }
});

afterAll(async () => {
  // Cleanup database
  try {
    await User.destroy({ where: { email: "test@example.com" } });
    await connect.close();
    console.log("Database connection closed");
  } catch (error) {
    console.error("Database cleanup error:", error);
  }

  // Stop the server
  await new Promise<void>((resolve) => {
    server.close(() => {
      console.log("Test server closed");
      resolve();
    });
  });
  // Remove all listeners to prevent the server from hanging
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
});

describe("Auth Flow", () => {
  test("POST /api/v1/user/login - should return access and refresh tokens", async () => {
    const response = await request(app)
      .post("/api/v1/user/login")
      .send({ email: "test@example.com", password: "password123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("accessToken");
    expect(response.body.data).toHaveProperty("refreshToken");
    expect(response.body.data).toHaveProperty("expiresAt");
  });

  test("GET /api/v1/user/protected - should allow access with valid token", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/user/login")
      .send({ email: "test@example.com", password: "password123" });

    const accessToken = loginResponse.body.data.accessToken;
    const refreshToken = loginResponse.body.data.refreshToken;

    const response = await request(app)
      .get("/api/v1/user/protected")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-refresh-token", refreshToken);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe(
      "You have access to this protected route!"
    );
  });

  test("GET /api/v1/user/protected - should refresh token when access token expires", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/user/login")
      .send({ email: "test@example.com", password: "password123" });
    const refreshToken = loginResponse.body.data.refreshToken;

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
      .get("/api/v1/user/protected")
      .set("Authorization", `Bearer ${expiredToken}`)
      .set("x-refresh-token", refreshToken);

    expect(response.status).toBe(200);
    expect(response.headers["x-new-access-token"]).toBeDefined();
  });

  test("GET /api/v1/user/protected - should fail without refresh token", async () => {
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
      .get("/api/v1/user/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Refresh token required");
  });
});
