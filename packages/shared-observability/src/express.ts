/**
 * The smallest slice of express this package actually touches.
 *
 * It deliberately does NOT import from `express` or `@types/express`. Each
 * service installs its own copy, and two copies of `@types/express` produce
 * two structurally distinct `RequestHandler` types - their generic defaults
 * reach into separate `@types/qs` and `@types/serve-static` installs, so a
 * handler typed against this package's copy fails to match `app.use()` in a
 * service. Declaring the shape here means these handlers fit any express
 * version without the two trees ever having to agree.
 *
 * These are supertypes of the real express interfaces (fewer members), so a
 * handler written against them accepts a real `Request`/`Response` - which is
 * exactly what assignability to `RequestHandler` requires.
 */

export interface ObsRequest {
  method: string;
  path: string;
  originalUrl: string;
  baseUrl: string;
  route?: { path?: string | RegExp } | undefined;
  header(name: string): string | undefined;
}

export interface ObsResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  status(code: number): ObsResponse;
  json(body: unknown): unknown;
  send(body: string): unknown;
  on(event: "finish", listener: () => void): unknown;
}

export type ObsNext = (error?: unknown) => void;

export type ObsHandler = (
  req: ObsRequest,
  res: ObsResponse,
  next: ObsNext
) => void;
