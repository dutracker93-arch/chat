import { useEffect, useRef } from "react";

const VW = 1280, VH = 720;
const PW = 20, PH = 140, BS = 18;

interface GameState {
  lp: { x: number; y: number };
  rp: { x: number; y: number };
  ball: { x: number; y: number };
  ls: number;
  rs: number;
  phase: string;
  ci: number;
  ct: string;
  cc: string;
  shake: number;
  flash: number;
}

export default function PongGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const overlay = overlayRef.current!;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    let ws: WebSocket | null = null;
    let myRole: "left" | "right" | null = null;
    let inGame = false;
    let gs: GameState | null = null;

    let cdScale = 1, cdRot = 0, cdAlpha = 1;
    let lastCi = -1;
    let lPop = 1, rPop = 1;
    let lShk = 0, rShk = 0;
    let lastLS = 0, lastRS = 0;
    let shakeX = 0, shakeY = 0;

    const demo = {
      bx: VW / 2, by: VH / 2,
      bvx: 5.2, bvy: 3.8,
      ly: VH / 2 - PH / 2,
      ry: VH / 2 - PH / 2,
    };

    const keys: Record<string, boolean> = {};
    let sentUp = false, sentDn = false;

    function sendInput() {
      if (!ws || ws.readyState !== 1 || !inGame) return;
      const up = !!(myRole === "left" ? keys["w"] : keys["arrowup"]);
      const down = !!(myRole === "left" ? keys["s"] : keys["arrowdown"]);
      if (up !== sentUp || down !== sentDn) {
        ws.send(JSON.stringify({ type: "input", up, down }));
        sentUp = up;
        sentDn = down;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = true;
      sendInput();
    }
    function onKeyUp(e: KeyboardEvent) {
      keys[e.key.toLowerCase()] = false;
      sendInput();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    function showScreen(id: string | null) {
      overlay.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
      if (id) {
        const el = overlay.querySelector(`#screen-${id}`);
        if (el) el.classList.add("active");
        overlay.style.pointerEvents = "";
        inGame = false;
      } else {
        overlay.style.pointerEvents = "none";
        inGame = true;
      }
    }

    function connect(onOpen: () => void) {
      if (ws && ws.readyState < 2) ws.close();
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/api/pong`);
      ws.onopen = onOpen;
      ws.onmessage = ({ data }) => {
        let msg: { type: string; code?: string; msg?: string; ls?: number; rs?: number; ci?: number };
        try { msg = JSON.parse(data); } catch { return; }
        handleMsg(msg);
      };
      ws.onclose = handleClose;
      ws.onerror = () => {};
    }

    function handleClose() {
      if (inGame) {
        inGame = false;
        showScreen("disconnected");
      }
      ws = null;
    }

    function handleMsg(msg: Record<string, unknown>) {
      switch (msg.type) {
        case "hosted":
          (overlay.querySelector("#display-code") as HTMLElement).textContent = msg.code as string;
          showScreen("hosting");
          break;
        case "opponentJoined":
          beginGame("left");
          break;
        case "joined":
          beginGame("right");
          break;
        case "state":
          processState(msg as unknown as GameState & { type: string });
          break;
        case "opponentLeft":
          inGame = false;
          showScreen("disconnected");
          break;
        case "error":
          (overlay.querySelector("#join-err") as HTMLElement).textContent = (msg.msg as string) || "Something went wrong.";
          break;
      }
    }

    function beginGame(role: "left" | "right") {
      myRole = role;
      gs = null;
      sentUp = false;
      sentDn = false;
      cdScale = 2.5; cdRot = 0; cdAlpha = 0; lastCi = -1;
      lPop = 1; rPop = 1; lShk = 0; rShk = 0;
      lastLS = 0; lastRS = 0;
      showScreen(null);
    }

    function processState(msg: GameState & { type: string }) {
      if (msg.ci !== lastCi) {
        cdScale = 2.5;
        cdRot = (Math.random() - 0.5) * 0.25;
        cdAlpha = 0;
        lastCi = msg.ci;
      }
      if (msg.ls > lastLS) { lPop = 2.2; lShk = 0.35; lastLS = msg.ls; }
      if (msg.rs > lastRS) { rPop = 2.2; rShk = -0.35; lastRS = msg.rs; }
      gs = msg;
    }

    function doJoin() {
      const input = overlay.querySelector("#code-input") as HTMLInputElement;
      const errEl = overlay.querySelector("#join-err") as HTMLElement;
      const code = input.value.toUpperCase().trim();
      errEl.textContent = "";
      if (code.length !== 4) {
        errEl.textContent = "Code must be 4 characters.";
        return;
      }
      connect(() => ws!.send(JSON.stringify({ type: "join", code })));
    }

    overlay.querySelector("#btn-host")!.addEventListener("click", () => {
      connect(() => ws!.send(JSON.stringify({ type: "host" })));
    });

    overlay.querySelector("#btn-go-join")!.addEventListener("click", () => {
      (overlay.querySelector("#join-err") as HTMLElement).textContent = "";
      (overlay.querySelector("#code-input") as HTMLInputElement).value = "";
      showScreen("joining");
      setTimeout(() => (overlay.querySelector("#code-input") as HTMLInputElement).focus(), 60);
    });

    overlay.querySelector("#btn-join")!.addEventListener("click", doJoin);

    (overlay.querySelector("#code-input") as HTMLInputElement).addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") doJoin();
    });

    overlay.querySelector("#btn-back")!.addEventListener("click", () => {
      showScreen("menu");
      if (ws) { ws.close(); ws = null; }
    });

    overlay.querySelector("#btn-cancel")!.addEventListener("click", () => {
      showScreen("menu");
      if (ws) { ws.close(); ws = null; }
    });

    overlay.querySelector("#btn-menu")!.addEventListener("click", () => {
      showScreen("menu");
      gs = null;
      if (ws) { ws.close(); ws = null; }
    });

    function tickAnimations() {
      cdScale += (1 - cdScale) * 0.12;
      cdRot *= 0.9;
      cdAlpha += (1 - cdAlpha) * 0.12;
      lPop += (1 - lPop) * 0.14;
      rPop += (1 - rPop) * 0.14;
      lShk *= 0.85;
      rShk *= 0.85;
      if (gs) {
        shakeX = (Math.random() - 0.5) * gs.shake;
        shakeY = (Math.random() - 0.5) * gs.shake;
      }
      if (!inGame) {
        demo.bx += demo.bvx;
        demo.by += demo.bvy;
        if (demo.by < 0)              { demo.by = 0;           demo.bvy *= -1; }
        if (demo.by + BS > VH)        { demo.by = VH - BS;     demo.bvy *= -1; }
        if (demo.bx < 70)             { demo.bx = 70;          demo.bvx = Math.abs(demo.bvx); }
        if (demo.bx + BS > VW - 70)   { demo.bx = VW - 70 - BS; demo.bvx = -Math.abs(demo.bvx); }
        const t = demo.by + BS / 2 - PH / 2;
        demo.ly += (t - demo.ly) * 0.045;
        demo.ry += (t - demo.ry) * 0.045;
      }
    }

    function drawScore(score: number, x: number, y: number, scale: number, rot: number) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.font = '90px "Pixelify Sans", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#000";
      ctx.strokeText(String(score), 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillText(String(score), 0, 0);
      ctx.restore();
    }

    function drawCountdown(text: string, color: string) {
      ctx.save();
      ctx.translate(VW / 2, VH / 2 - 20);
      ctx.rotate(cdRot);
      ctx.scale(cdScale, cdScale);
      ctx.globalAlpha = cdAlpha;
      ctx.font = '140px "Pixelify Sans", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 16;
      ctx.strokeStyle = "#000";
      ctx.strokeText(text, 0, 0);
      ctx.shadowBlur = 40;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }

    function drawLobby() {
      const sx = canvas.width / VW;
      const sy = canvas.height / VH;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      for (let y = 0; y < VH; y += 40) ctx.fillRect(VW / 2 - 5, y, 10, 20);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(50, demo.ly, PW, PH);
      ctx.fillRect(VW - 70, demo.ry, PW, PH);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(demo.bx, demo.by, BS, BS);
      ctx.restore();
    }

    function drawGameFrame() {
      if (!gs) return;
      const sx = canvas.width / VW;
      const sy = canvas.height / VH;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(sx, 0, 0, sy, shakeX * sx, shakeY * sy);
      ctx.fillStyle = "#fff";
      for (let y = 0; y < VH; y += 40) ctx.fillRect(VW / 2 - 5, y, 10, 20);
      ctx.fillStyle = "#fff";
      ctx.fillRect(gs.lp.x, gs.lp.y, PW, PH);
      ctx.fillRect(gs.rp.x, gs.rp.y, PW, PH);
      ctx.fillStyle = "#fff";
      ctx.fillRect(gs.ball.x, gs.ball.y, BS, BS);
      const lx = VW / 2 - 120 + lShk * 10;
      const rx = VW / 2 + 120 + rShk * 10;
      drawScore(gs.ls, lx, 90, lPop, lShk * 0.03);
      drawScore(gs.rs, rx, 90, rPop, rShk * 0.03);
      ctx.font = '20px "Pixelify Sans", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      if (myRole === "left")  ctx.fillText("YOU", lx, 148);
      if (myRole === "right") ctx.fillText("YOU", rx, 148);
      if (gs.phase === "countdown") drawCountdown(gs.ct, gs.cc);
      ctx.restore();
      if (gs.flash > 0.01) {
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${gs.flash * 0.55})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      ctx.save();
      ctx.font = '15px "Pixelify Sans", monospace';
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.textBaseline = "bottom";
      const hy = canvas.height - 18;
      if (myRole === "left") {
        ctx.textAlign = "left";
        ctx.fillText("W / S", 24, hy);
      } else {
        ctx.textAlign = "right";
        ctx.fillText("↑ / ↓", canvas.width - 24, hy);
      }
      ctx.restore();
    }

    let rafId: number;
    function loop() {
      tickAnimations();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (inGame) drawGameFrame();
      else drawLobby();
      rafId = requestAnimationFrame(loop);
    }

    showScreen("menu");
    loop();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      if (ws) { ws.close(); ws = null; }
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        id="game"
        style={{
          display: "block",
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
      <div
        ref={overlayRef}
        id="overlay"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 20,
          pointerEvents: "none",
        }}
      >
        <div id="screen-menu" className="screen active">
          <h1 className="title">PONG</h1>
          <div className="btn-stack" style={{ marginTop: 12 }}>
            <button className="btn" id="btn-host">HOST GAME</button>
            <button className="btn" id="btn-go-join">JOIN GAME</button>
          </div>
        </div>

        <div id="screen-hosting" className="screen">
          <p className="label">ROOM CODE</p>
          <p className="room-code" id="display-code">----</p>
          <p className="waiting">Waiting for opponent...</p>
          <p className="controls-hint">YOU ARE LEFT PLAYER &nbsp;·&nbsp; W / S TO MOVE</p>
          <button className="btn-ghost" id="btn-cancel">CANCEL</button>
        </div>

        <div id="screen-joining" className="screen">
          <h1 className="title" style={{ fontSize: "clamp(42px, 7vw, 80px)", letterSpacing: 6 }}>JOIN GAME</h1>
          <p className="label" style={{ marginTop: -8 }}>ENTER ROOM CODE</p>
          <input
            className="code-input"
            id="code-input"
            maxLength={4}
            placeholder="XXXX"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <p className="err" id="join-err"></p>
          <div className="btn-stack">
            <button className="btn" id="btn-join">JOIN</button>
            <button className="btn-ghost" id="btn-back">BACK</button>
          </div>
          <p className="controls-hint">YOU ARE RIGHT PLAYER &nbsp;·&nbsp; ↑ / ↓ TO MOVE</p>
        </div>

        <div id="screen-disconnected" className="screen">
          <h1 className="title title-red" style={{ fontSize: "clamp(38px, 6.5vw, 76px)", lineHeight: 1.2 }}>
            OPPONENT<br />LEFT
          </h1>
          <button className="btn" id="btn-menu">MAIN MENU</button>
        </div>
      </div>
    </>
  );
}
