import type { Request } from "express";

/**
 * A request whose identity has been established by a route guard.
 *
 * `user` is set from the verified JWT, or from the peer-service token. It is
 * the ONLY trustworthy identity in a request - the body is whatever the caller
 * typed, which is exactly how an authenticated customer used to be able to
 * place an order as someone else.
 *
 * Declared as a type rather than augmenting express's Request globally:
 * ts-node-dev compiles file by file and does not reliably pick up an ambient
 * .d.ts, so the augmentation typechecked under `tsc -p` and then failed to
 * start the dev server.
 */
export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

import { z } from "zod";
import { CreateOrderRequestSchema } from "../validations/createorder.request.schema";

export type TCreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
