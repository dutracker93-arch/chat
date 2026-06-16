import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { logger } from "./lib/logger";

const VW = 1280;
const VH = 720;
const PW = 20;
const PH = 140;
const PS = 10;
const BS = 18;
const BASE_SPEED = 8;
const MAX_SPEED = 18;
const TICK_RATE = 60;

const COUNTDOWN_TEXTS = ["3", "2", "1", "GO"];
const COUNTDOWN_COLORS = ["lime", "yellow", "red", "red"];

interface PaddleState {
  x: number;
  y: number;
}

interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GameState {
  leftPaddle: PaddleState;
  rightPaddle: PaddleState;
  ball: BallState;
  leftScore: number;
  rightScore: number;
  phase: "countdown" | "playing";
  countdownIndex: number;
  countdownTimer: number;
  shakePower: number;
  flashAlpha: number;
}

interface InputState {
  up: boolean;
  down: boolean;
}

interface Room {
  code: string;
  host: WebSocket | null;
  guest: WebSocket | null;
  gameLoop: ReturnType<typeof setInterval> | null;
  state: GameState;
  inputs: {
    left: InputState;
    right: InputState;
  };
}

interface PongWebSocket extends WebSocket {
  pongRoom: Room | null;
  pongRole: "left" | "right" | null;
}

const rooms = new Map<string, Room>();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code: string;
  do {
    code = "";
    for (let i = 0; i < 4; i++)
      code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createGameState(): GameState {
  return {
    leftPaddle: { x: 50, y: VH / 2 - PH / 2 },
    rightPaddle: { x: VW - 70, y: VH / 2 - PH / 2 },
    ball: { x: VW / 2 - BS / 2, y: VH / 2 - BS / 2, vx: 0, vy: 0 },
    leftScore: 0,
    rightScore: 0,
    phase: "countdown",
    countdownIndex: 0,
    countdownTimer: 0,
    shakePower: 0,
    flashAlpha: 0,
  };
}

function resetBall(state: GameState): void {
  state.ball.x = VW / 2 - BS / 2;
  state.ball.y = VH / 2 - BS / 2;
  state.ball.vx = 0;
  state.ball.vy = 0;
}

function startCountdown(state: GameState): void {
  state.phase = "countdown";
  state.countdownIndex = 0;
  state.countdownTimer = 0;
  resetBall(state);
}

function serveBall(state: GameState): void {
  const dir = Math.random() > 0.5 ? 1 : -1;
  const angle = Math.random() * 1.2 - 0.6;
  state.ball.vx = dir * BASE_SPEED;
  state.ball.vy = angle * BASE_SPEED;
  state.phase = "playing";
}

function bounceOffPaddle(
  state: GameState,
  paddleX: number,
  paddleY: number,
  isLeft: boolean,
): void {
  const paddleCenter = paddleY + PH / 2;
  const ballCenter = state.ball.y + BS / 2;
  const hitPos = (ballCenter - paddleCenter) / (PH / 2);
  const angle = Math.max(-1, Math.min(1, hitPos)) * 0.9;

  const rawSpeed = Math.hypot(state.ball.vx, state.ball.vy);
  const speed = Math.max(rawSpeed, BASE_SPEED);
  const newSpeed = Math.min(speed * 1.06, MAX_SPEED);

  state.ball.vx = (isLeft ? 1 : -1) * newSpeed * Math.cos(angle);
  state.ball.vy = newSpeed * Math.sin(angle);
  state.ball.x = isLeft ? paddleX + PW + 0.5 : paddleX - BS - 0.5;

  state.shakePower = Math.max(state.shakePower, 10);
}

function updateGame(room: Room): void {
  const { state, inputs } = room;

  if (state.phase === "countdown") {
    state.countdownTimer++;
    const STEP = 45;
    const GO_STEP = 35;

    if (state.countdownIndex < 3 && state.countdownTimer >= STEP) {
      state.countdownIndex++;
      state.countdownTimer = 0;
    } else if (state.countdownIndex === 3 && state.countdownTimer >= GO_STEP) {
      serveBall(state);
    }
  } else {
    if (inputs.left.up) state.leftPaddle.y -= PS;
    if (inputs.left.down) state.leftPaddle.y += PS;
    if (inputs.right.up) state.rightPaddle.y -= PS;
    if (inputs.right.down) state.rightPaddle.y += PS;

    state.leftPaddle.y = Math.max(0, Math.min(VH - PH, state.leftPaddle.y));
    state.rightPaddle.y = Math.max(0, Math.min(VH - PH, state.rightPaddle.y));

    state.ball.x += state.ball.vx;
    state.ball.y += state.ball.vy;

    if (state.ball.y <= 0) {
      state.ball.y = 0;
      state.ball.vy *= -1;
      state.shakePower = Math.max(state.shakePower, 6);
    }
    if (state.ball.y + BS >= VH) {
      state.ball.y = VH - BS;
      state.ball.vy *= -1;
      state.shakePower = Math.max(state.shakePower, 6);
    }

    const lp = state.leftPaddle;
    if (
      state.ball.x <= lp.x + PW &&
      state.ball.x + BS >= lp.x &&
      state.ball.y + BS >= lp.y &&
      state.ball.y <= lp.y + PH &&
      state.ball.vx < 0
    ) {
      bounceOffPaddle(state, lp.x, lp.y, true);
    }

    const rp = state.rightPaddle;
    if (
      state.ball.x + BS >= rp.x &&
      state.ball.x <= rp.x + PW &&
      state.ball.y + BS >= rp.y &&
      state.ball.y <= rp.y + PH &&
      state.ball.vx > 0
    ) {
      bounceOffPaddle(state, rp.x, rp.y, false);
    }

    if (state.ball.x + BS < 0) {
      state.rightScore++;
      state.flashAlpha = 1;
      state.shakePower = 18;
      startCountdown(state);
    }
    if (state.ball.x > VW) {
      state.leftScore++;
      state.flashAlpha = 1;
      state.shakePower = 18;
      startCountdown(state);
    }
  }

  state.shakePower *= 0.9;
  if (state.shakePower < 0.1) state.shakePower = 0;

  state.flashAlpha *= 0.9;
  if (state.flashAlpha < 0.01) state.flashAlpha = 0;
}

function broadcastState(room: Room): void {
  const s = room.state;
  const payload = JSON.stringify({
    type: "state",
    lp: s.leftPaddle,
    rp: s.rightPaddle,
    ball: { x: s.ball.x, y: s.ball.y },
    ls: s.leftScore,
    rs: s.rightScore,
    phase: s.phase,
    ci: s.countdownIndex,
    ct: COUNTDOWN_TEXTS[s.countdownIndex],
    cc: COUNTDOWN_COLORS[s.countdownIndex],
    shake: s.shakePower,
    flash: s.flashAlpha,
  });

  if (room.host && room.host.readyState === 1) room.host.send(payload);
  if (room.guest && room.guest.readyState === 1) room.guest.send(payload);
}

function startGameLoop(room: Room): void {
  if (room.gameLoop) clearInterval(room.gameLoop);
  room.gameLoop = setInterval(() => {
    updateGame(room);
    broadcastState(room);
  }, 1000 / TICK_RATE);
}

function destroyRoom(room: Room): void {
  if (room.gameLoop) clearInterval(room.gameLoop);
  rooms.delete(room.code);
}

function send(ws: WebSocket, data: unknown): void {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));
}

export function createPongWSS(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (rawWs: WebSocket) => {
    const ws = rawWs as PongWebSocket;
    ws.pongRoom = null;
    ws.pongRole = null;

    ws.on("message", (raw) => {
      let msg: { type: string; code?: string; up?: boolean; down?: boolean };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "host": {
          if (ws.pongRoom) return;
          if (rooms.size >= 200) {
            send(ws, { type: "error", msg: "Server full, try again later." });
            return;
          }
          const code = generateCode();
          const room: Room = {
            code,
            host: ws,
            guest: null,
            gameLoop: null,
            state: createGameState(),
            inputs: {
              left: { up: false, down: false },
              right: { up: false, down: false },
            },
          };
          rooms.set(code, room);
          ws.pongRoom = room;
          ws.pongRole = "left";
          send(ws, { type: "hosted", code });
          logger.info({ code }, "Pong room created");
          break;
        }

        case "join": {
          if (ws.pongRoom) return;
          const code = String(msg.code || "")
            .toUpperCase()
            .trim();
          const room = rooms.get(code);

          if (!room) {
            send(ws, { type: "error", msg: "Room not found." });
            return;
          }
          if (room.guest) {
            send(ws, { type: "error", msg: "Room is full." });
            return;
          }

          room.guest = ws;
          ws.pongRoom = room;
          ws.pongRole = "right";

          send(ws, { type: "joined" });
          if (room.host) send(room.host, { type: "opponentJoined" });

          startGameLoop(room);
          logger.info({ code }, "Pong game started");
          break;
        }

        case "input": {
          const room = ws.pongRoom;
          if (!room) return;
          const side = ws.pongRole === "left" ? "left" : "right";
          room.inputs[side].up = !!msg.up;
          room.inputs[side].down = !!msg.down;
          break;
        }
      }
    });

    ws.on("close", () => {
      const room = ws.pongRoom;
      if (!room) return;
      const other = ws === room.host ? room.guest : room.host;
      if (other) send(other, { type: "opponentLeft" });
      destroyRoom(room);
      logger.info("Pong room destroyed on disconnect");
    });

    ws.on("error", () => {});
  });

  return wss;
}
