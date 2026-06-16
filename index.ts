import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { createPongWSS } from "./pong";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = http.createServer(app);
const pongWss = createPongWSS();

server.on("upgrade", (request, socket, head) => {
  const url = request.url ?? "";
  if (url.startsWith("/api/pong")) {
    pongWss.handleUpgrade(request, socket, head, (ws) => {
      pongWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port, (err?: Error) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");
});
