import { Request } from "express";

declare module "express" {
  interface Request {
    user?: { userId: string; email: string; role: string } | any;
  }
}
