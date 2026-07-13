import http from "http";
import app from "./app";
import { connectDb } from "./config/db";
import { env, validateRuntimeConfig } from "./config/env";
import { initWebSocket } from "./websocket";
import { startAdoAutoSyncScheduler } from "./modules/integrations/ado/adoAutoSync.scheduler";

async function startServer() {
  try {
    validateRuntimeConfig();
    await connectDb();

    const server = http.createServer(app);

    initWebSocket(server);
    startAdoAutoSyncScheduler();

    server.listen(env.port, () => {
      console.log(`Server running on port ${env.port}`);
    });

  } catch (err) {
    console.error("Server startup failed:", err);
    process.exit(1);
  }
}

startServer();