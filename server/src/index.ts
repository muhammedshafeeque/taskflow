import http from "http";
import app from "./app";
import { connectDb } from "./config/db";
import { env, validateRuntimeConfig } from "./config/env";
import { initWebSocket } from "./websocket";
import { startAdoAutoSyncScheduler } from "./modules/integrations/ado/adoAutoSync.scheduler";
import { startMonitorUptimeScheduler } from "./modules/monitor/uptime.scheduler";
import { startReminderScheduler } from "./modules/reminders/reminders.scheduler";
import { startSupportMailPoller } from "./modules/service-desk/emailInbound";
import { monitorError, monitorLog } from "./shared/monitorClient";

async function startServer() {
  try {
    validateRuntimeConfig();
    await connectDb();

    const server = http.createServer(app);

    initWebSocket(server);
    startAdoAutoSyncScheduler();
    startMonitorUptimeScheduler();
    startReminderScheduler();
    startSupportMailPoller();

    process.on("uncaughtException", (err) => {
      monitorError(err, "crash");
    });
    process.on("unhandledRejection", (reason) => {
      monitorError(reason);
    });

    server.listen(env.port, () => {
      console.log(`Server running on port ${env.port}`);
      monitorLog(`API started on port ${env.port}`, "info", { nodeEnv: env.nodeEnv });
    });

  } catch (err) {
    console.error("Server startup failed:", err);
    monitorError(err, "crash");
    process.exit(1);
  }
}

startServer();