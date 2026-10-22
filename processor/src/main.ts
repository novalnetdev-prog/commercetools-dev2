import * as dotenv from "dotenv";
dotenv.config();
import { setupFastify } from "./server/server";
import { log } from "./libs/logger";

(async () => {
  log.info("[startup] Initializing Novalnet processor service");
  const server = await setupFastify();
  const HOST = "0.0.0.0";
  const PORT = 8080;
  try {
    await server.listen({ port: PORT, host: HOST });
    log.info(`[startup] Server listening on ${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    log.error("[startup] Failed to start server", err);
    process.exit(1);
  }
})();
