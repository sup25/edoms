import request from "supertest";
import express from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import jwt from "jsonwebtoken";

describe("requireAdmin Middleware", () => {
  const app = express();
  app.use(express.json());
  app.get("/protected", requireAdmin, (req, res) => {
    res.status(200).json({ success: true, message: "Access granted" });
  });

  const generateToken = (role: string) =>
    jwt.sign({ id: 1, role }, process.env.JWT_SECRET || "your-secret-key", {
      expiresIn: "15m",
    });

  it("should allow access for admin users", async () => {
    const adminToken = generateToken("admin");

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: "Access granted" });
  });

  it("should return 403 for non-admin users", async () => {
    const userToken = generateToken("user");

    const response = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${userToken}`);

    expect(response.status).toBe(403);
  });

  it("should return 401 if no token is provided", async () => {
    const response = await request(app).get("/protected");

    expect(response.status).toBe(401);
  });

  it("should return 401 for an invalid token", async () => {
    const response = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
  });
});
