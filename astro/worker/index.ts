/// <reference types="@cloudflare/workers-types" />

/**
 * Worker entry point. Static pages come from the `ASSETS` binding (Astro's
 * `dist/`); this script exists for the one route that is not a static file.
 *
 * `/img/*` serves image content out of the private R2 bucket at same-origin
 * URLs. Keys map 1:1 to the path:
 *
 *   /img/projects/clearweb.png -> projects/clearweb.png
 *
 * Keys are stable paths that `scripts/assets.mjs` overwrites in place when a
 * file's contents change, so responses are deliberately NOT marked immutable:
 * a replaced image has to be able to propagate. Instead the edge holds a copy
 * for a day and then revalidates against R2's ETag, which is a conditional
 * read rather than a full transfer whenever the image hasn't changed.
 *
 * `run_worker_first` in wrangler.jsonc scopes this Worker to /img/*, so every
 * other request is served from static assets without invoking it at all.
 */

interface Env {
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
}

const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

async function serveImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  const key = pathname
    .slice("/img/".length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");

  // Reject traversal, empty keys, and dot-prefixed segments. The last of
  // those keeps bucket bookkeeping — .manifest.json, written by
  // scripts/assets.mjs — off the public /img/* surface.
  if (
    !key ||
    key.includes("..") ||
    key.split("/").some((segment) => segment.startsWith("."))
  ) {
    return new Response("Not found", { status: 404 });
  }

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const object = await env.IMAGES.get(key, {
    onlyIf: request.headers,
    range: request.headers,
  });

  if (object === null) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", CACHE_CONTROL);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  // R2 returns a bodyless R2Object when the `onlyIf` precondition fails —
  // i.e. the client already holds a current copy.
  if (!("body" in object) || object.body === null) {
    const stillFresh = request.headers.has("if-none-match") ||
      request.headers.has("if-modified-since");
    return new Response(null, { status: stillFresh ? 304 : 412, headers });
  }

  // R2 reports a `range` on every hit, so the client's Range header — not the
  // object — is what decides whether this is a partial response. A 206 must
  // not be written to the shared cache under the full-resource key.
  if (request.headers.has("range") && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set(
      "content-range",
      `bytes ${offset}-${offset + length - 1}/${object.size}`,
    );
    return new Response(object.body, { status: 206, headers });
  }

  const response = new Response(object.body, { status: 200, headers });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/img/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      }
      return serveImage(request, env, ctx);
    }

    // Defensive: `run_worker_first` should keep us off these paths entirely.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
