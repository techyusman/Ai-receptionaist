// A local stand-in for the few Supabase Auth endpoints the dashboard uses (email one-time code, refresh,
// sign out, and the public signing keys). Development only: every code is 246810 and nothing is emailed.
// The dashboard talks to it exactly as it talks to a real Supabase project, so no dashboard code changes.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from "jose";

export const DEV_CODE = "246810";

/** The same email always gets the same user id, so seeded data and sign-ins line up across restarts. */
export function devUserId(email: string): string {
  const h = createHash("sha256").update(`dev-user:${email.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type AuthStubKeys = { privateJwk: JWK; publicJwk: JWK };

export async function newAuthKeys(): Promise<AuthStubKeys> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { privateJwk: { ...(await exportJWK(privateKey)), kid: "dev", alg: "ES256" }, publicJwk: { ...(await exportJWK(publicKey)), kid: "dev", alg: "ES256", use: "sig" } };
}

export class AuthStub {
  server!: Server;
  url = "";
  readonly #keys: AuthStubKeys;
  readonly #refresh = new Map<string, string>();
  readonly #names = new Map<string, string>();

  constructor(keys: AuthStubKeys, names: Record<string, string> = {}) {
    this.#keys = keys;
    for (const [email, name] of Object.entries(names)) this.#names.set(email.toLowerCase(), name);
  }

  async start(port = 0): Promise<void> {
    this.server = createServer((req, res) => void this.#handle(req, res).catch(() => this.#send(res, 500, { msg: "error" })));
    await new Promise<void>((r) => this.server.listen(port, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  #send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 204 ? "" : JSON.stringify(body));
  }

  async #session(email: string) {
    const key = await importJWK(this.#keys.privateJwk, "ES256");
    const id = devUserId(email);
    const name = this.#names.get(email) ?? null;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = await new SignJWT({ email, role: "authenticated", user_metadata: name ? { name } : {} })
      .setProtectedHeader({ alg: "ES256", kid: "dev" }).setSubject(id).setIssuer(`${this.url}/auth/v1`).setAudience("authenticated")
      .setIssuedAt().setExpirationTime(exp).sign(key);
    const refresh = randomBytes(24).toString("base64url");
    this.#refresh.set(refresh, email);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: { id, email, user_metadata: name ? { name } : {} } };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>) : {};
    const p = url.pathname;
    if (p === "/auth/v1/.well-known/jwks.json") return this.#send(res, 200, { keys: [this.#keys.publicJwk] });
    if (p === "/auth/v1/otp" && req.method === "POST") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email ?? "")) return this.#send(res, 400, { msg: "Invalid email" });
      console.log(`[auth] sign-in code for ${body.email}: ${DEV_CODE}`);
      return this.#send(res, 200, {});
    }
    if (p === "/auth/v1/verify" && req.method === "POST") {
      if (body.token !== DEV_CODE || !body.email) return this.#send(res, 403, { error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return this.#send(res, 200, await this.#session(body.email.toLowerCase()));
    }
    if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const email = this.#refresh.get(body.refresh_token ?? "");
      if (!email) return this.#send(res, 400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      this.#refresh.delete(body.refresh_token!);
      return this.#send(res, 200, await this.#session(email));
    }
    if (p === "/auth/v1/logout") return this.#send(res, 204, null);
    if (p.startsWith("/auth/v1/admin/users/") && req.method === "DELETE") return this.#send(res, 200, {});
    this.#send(res, 404, { msg: "not found" });
  }
}
