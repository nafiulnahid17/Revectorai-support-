/** Bounded server-only Supabase transport; responses never expose service credentials. */
export class ControlError extends Error {
  constructor(code, status = 400, message = code.replaceAll("_", " ")) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function enabled(env) {
  return Boolean(
    env.SUPABASE_URL || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
export function configured(env) {
  return Boolean(
    env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
export function configuration(env) {
  if (
    !configured(env) ||
    !env.SESSION_SIGNING_KEY ||
    env.SESSION_SIGNING_KEY.length < 32
  )
    throw new ControlError(
      "CONTROL_NOT_CONFIGURED",
      503,
      "Account services are not configured yet.",
    );
  const u = new URL(env.SUPABASE_URL);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new ControlError("CONTROL_NOT_CONFIGURED", 503);
  return u.origin;
}
export async function boundedJSON(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new ControlError("RESPONSE_TOO_LARGE", 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ControlError("INVALID_RESPONSE", 502);
  }
}
export function database(env, transport = fetch) {
  const origin = configuration(env);
  const call = async (
    path,
    { method = "GET", body, token, auth = false, admin = false, prefer } = {},
  ) => {
    const key =
      admin || !auth ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
    const headers = {
      apikey: key,
      Authorization: "Bearer " + (token || key),
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    let r;
    try {
      r = await transport(
        new Request(origin + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        }),
      );
    } catch {
      throw new ControlError(
        "CONTROL_UNAVAILABLE",
        503,
        "Account service could not be reached.",
      );
    }
    if (r.status >= 300 && r.status < 400)
      throw new ControlError("CONTROL_UNAVAILABLE", 503);
    const data = await boundedJSON(r);
    if (!r.ok) {
      const safe = new Set([
        "ACCOUNT_NOT_ACTIVE",
        "ADMIN_REQUIRED",
        "SUPPORT_REQUIRED",
        "INSUFFICIENT_CREDITS",
        "IDEMPOTENCY_CONFLICT",
        "REQUEST_ALREADY_DECIDED",
        "MODEL_UNAVAILABLE",
        "OPERATION_IN_PROGRESS",
        "PRICING_NOT_CONFIGURED",
        "RESERVATION_NOT_FOUND",
      ]);
      const code = safe.has(data?.message)
        ? data.message
        : auth
          ? r.status === 429
            ? "AUTH_RATE_LIMIT"
            : "AUTH_FAILED"
          : "CONTROL_REQUEST_FAILED";
      throw new ControlError(
        code,
        [400, 401, 402, 403, 404, 409, 429].includes(r.status) ? r.status : 503,
        auth
          ? "Sign-in could not be completed. Check your invitation and credentials."
          : code.replaceAll("_", " "),
      );
    }
    return data;
  };
  const table = async (name, query = {}, opts = {}) => {
    if (!/^revector_[a-z_]+$/.test(name))
      throw new ControlError("INVALID_TABLE");
    return call("/rest/v1/" + name + "?" + new URLSearchParams(query), opts);
  };
  return {
    call,
    table,
    rpc: (name, body) => {
      if (!/^rv_[a-z_]+$/.test(name)) throw new ControlError("INVALID_RPC");
      return call("/rest/v1/rpc/" + name, { method: "POST", body });
    },
  };
}
export async function input(request) {
  const data = await boundedJSON(request);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ControlError("INVALID_REQUEST");
  return data;
}
export const uuid = (value) => {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
      value,
    )
  )
    throw new ControlError("INVALID_ID");
  return value;
};
export const text = (value, max = 1000, required = true) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new ControlError("INVALID_FIELD");
  return value.trim();
};
export const number = (value, min = 0, max = 1e6) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ControlError("INVALID_AMOUNT");
  return Math.round(value * 10000) / 10000;
};
export function failure(error) {
  const known = error instanceof ControlError;
  return Response.json(
    {
      success: false,
      error: {
        code: known ? error.code : "CONTROL_UNAVAILABLE",
        message: known
          ? error.message
          : "Account service is temporarily unavailable.",
        recoverable: true,
      },
    },
    { status: known ? error.status : 503 },
  );
}
