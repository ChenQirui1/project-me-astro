import fs from "node:fs";
import path from "node:path";
import { contentTypeFor } from "../scripts/mime.mjs";

/**
 * In production /img/* is served by worker/index.ts straight out of R2. The
 * Worker doesn't run under `astro dev`, so this integration wires an
 * equivalent route into the dev server, reading from the local `assets/` mirror.
 *
 * The result is that the same `/img/...` URL works in dev, under `wrangler dev`,
 * and in production — no environment-conditional markup anywhere.
 */
export default function devAssets({ dir = "assets", base = "/img" } = {}) {
  return {
    name: "dev-assets",
    hooks: {
      "astro:config:setup": ({ command, config, updateConfig, logger }) => {
        if (command !== "dev") return;

        const root = path.resolve(new URL(config.root).pathname, dir);

        updateConfig({
          vite: {
            plugins: [
              {
                name: "dev-assets-middleware",
                configureServer(server) {
                  server.middlewares.use((req, res, next) => {
                    const url = (req.url ?? "").split("?")[0];
                    if (!url.startsWith(`${base}/`)) return next();

                    const key = decodeURIComponent(url.slice(base.length + 1));
                    const file = path.resolve(root, key);

                    // Keep the dev server from serving anything outside assets/.
                    if (!file.startsWith(root + path.sep)) {
                      res.statusCode = 403;
                      return res.end("Forbidden");
                    }

                    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
                      logger.warn(
                        `missing local asset "${key}" — run \`pnpm assets:pull\` if it only exists in R2`,
                      );
                      res.statusCode = 404;
                      return res.end("Not found");
                    }

                    res.setHeader("content-type", contentTypeFor(key));
                    res.setHeader("cache-control", "no-cache");
                    fs.createReadStream(file).pipe(res);
                  });
                },
              },
            ],
          },
        });
      },
    },
  };
}
