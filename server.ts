// ─── Physics constants (must match client) ───────────────────────────────────
const VW=1280, VH=720, PW=20, PH=140, PS=10, BS=18, BASE_SPEED=8, MAX_SPEED=18;
const TICK_RATE = 60;
const COUNTDOWN_TEXTS  = ['3','2','1','GO'];
const COUNTDOWN_COLORS = ['lime','yellow','red','red'];

// ─── Types ────────────────────────────────────────────────────────────────────
interface GameState {
  leftPaddle:  { x:number; y:number };
  rightPaddle: { x:number; y:number };
  ball:        { x:number; y:number; vx:number; vy:number };
  leftScore:number; rightScore:number;
  phase:'countdown'|'playing';
  countdownIndex:number; countdownTimer:number;
  shakePower:number; flashAlpha:number;
}
interface Room {
  code:string;
  host:WebSocket|null; guest:WebSocket|null;
  gameLoop:number|null;
  state:GameState;
  inputs:{ left:{up:boolean;down:boolean}; right:{up:boolean;down:boolean} };
}

// ─── Per-socket metadata (WeakMap so GC can clean up) ────────────────────────
const wsRoom = new WeakMap<WebSocket, Room|null>();
const wsRole = new WeakMap<WebSocket, 'left'|'right'|null>();

// ─── Room store ───────────────────────────────────────────────────────────────
const rooms = new Map<string, Room>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = '';
    for (let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while (rooms.has(code));
  return code;
}

function createState(): GameState {
  return {
    leftPaddle:  {x:50,      y:VH/2-PH/2},
    rightPaddle: {x:VW-70,   y:VH/2-PH/2},
    ball:        {x:VW/2-BS/2, y:VH/2-BS/2, vx:0, vy:0},
    leftScore:0, rightScore:0,
    phase:'countdown', countdownIndex:0, countdownTimer:0,
    shakePower:0, flashAlpha:0,
  };
}

// ─── Game logic ───────────────────────────────────────────────────────────────
function resetBall(s:GameState)      { s.ball.x=VW/2-BS/2; s.ball.y=VH/2-BS/2; s.ball.vx=0; s.ball.vy=0; }
function startCountdown(s:GameState) { s.phase='countdown'; s.countdownIndex=0; s.countdownTimer=0; resetBall(s); }

function serveBall(s:GameState) {
  const dir = Math.random()>.5?1:-1;
  s.ball.vx = dir*BASE_SPEED;
  s.ball.vy = (Math.random()*1.2-.6)*BASE_SPEED;
  s.phase   = 'playing';
}

function bounceOffPaddle(s:GameState, px:number, py:number, isLeft:boolean) {
  const hit   = ((s.ball.y+BS/2)-(py+PH/2))/(PH/2);
  const angle = Math.max(-1,Math.min(1,hit))*.9;
  const spd   = Math.min(Math.max(Math.hypot(s.ball.vx,s.ball.vy),BASE_SPEED)*1.06, MAX_SPEED);
  s.ball.vx   = (isLeft?1:-1)*spd*Math.cos(angle);
  s.ball.vy   = spd*Math.sin(angle);
  s.ball.x    = isLeft ? px+PW+.5 : px-BS-.5;
  s.shakePower = Math.max(s.shakePower, 10);
}

function tick(room:Room) {
  const {state:s, inputs:inp} = room;
  if (s.phase==='countdown') {
    s.countdownTimer++;
    if (s.countdownIndex<3 && s.countdownTimer>=45) { s.countdownIndex++; s.countdownTimer=0; }
    else if (s.countdownIndex===3 && s.countdownTimer>=35) serveBall(s);
  } else {
    if (inp.left.up)    s.leftPaddle.y  -= PS;
    if (inp.left.down)  s.leftPaddle.y  += PS;
    if (inp.right.up)   s.rightPaddle.y -= PS;
    if (inp.right.down) s.rightPaddle.y += PS;
    s.leftPaddle.y  = Math.max(0, Math.min(VH-PH, s.leftPaddle.y));
    s.rightPaddle.y = Math.max(0, Math.min(VH-PH, s.rightPaddle.y));

    s.ball.x += s.ball.vx;
    s.ball.y += s.ball.vy;

    if (s.ball.y<=0)      { s.ball.y=0;      s.ball.vy*=-1; s.shakePower=Math.max(s.shakePower,6); }
    if (s.ball.y+BS>=VH)  { s.ball.y=VH-BS;  s.ball.vy*=-1; s.shakePower=Math.max(s.shakePower,6); }

    const lp=s.leftPaddle;
    if (s.ball.x<=lp.x+PW && s.ball.x+BS>=lp.x && s.ball.y+BS>=lp.y && s.ball.y<=lp.y+PH && s.ball.vx<0)
      bounceOffPaddle(s,lp.x,lp.y,true);

    const rp=s.rightPaddle;
    if (s.ball.x+BS>=rp.x && s.ball.x<=rp.x+PW && s.ball.y+BS>=rp.y && s.ball.y<=rp.y+PH && s.ball.vx>0)
      bounceOffPaddle(s,rp.x,rp.y,false);

    if (s.ball.x+BS<0)  { s.rightScore++; s.flashAlpha=1; s.shakePower=18; startCountdown(s); }
    if (s.ball.x>VW)    { s.leftScore++;  s.flashAlpha=1; s.shakePower=18; startCountdown(s); }
  }
  s.shakePower*=.9; if(s.shakePower<.1)  s.shakePower=0;
  s.flashAlpha*=.9; if(s.flashAlpha<.01) s.flashAlpha=0;
}

function broadcast(room:Room) {
  const s = room.state;
  const payload = JSON.stringify({
    type:'state',
    lp:s.leftPaddle, rp:s.rightPaddle,
    ball:{x:s.ball.x, y:s.ball.y},
    ls:s.leftScore, rs:s.rightScore,
    phase:s.phase, ci:s.countdownIndex,
    ct:COUNTDOWN_TEXTS[s.countdownIndex],
    cc:COUNTDOWN_COLORS[s.countdownIndex],
    shake:s.shakePower, flash:s.flashAlpha,
  });
  if (room.host  && room.host.readyState  === WebSocket.OPEN) room.host.send(payload);
  if (room.guest && room.guest.readyState === WebSocket.OPEN) room.guest.send(payload);
}

function startGameLoop(room:Room) {
  if (room.gameLoop) clearInterval(room.gameLoop);
  room.gameLoop = setInterval(() => { tick(room); broadcast(room); }, 1000/TICK_RATE);
}

function destroyRoom(room:Room) {
  if (room.gameLoop) clearInterval(room.gameLoop);
  rooms.delete(room.code);
}

function send(ws:WebSocket, data:unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ─── WebSocket handler ────────────────────────────────────────────────────────
function handleWS(ws:WebSocket) {
  wsRoom.set(ws, null);
  wsRole.set(ws, null);

  ws.onmessage = (event:MessageEvent) => {
    let msg: {type:string; code?:string; up?:boolean; down?:boolean};
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'host': {
        if (wsRoom.get(ws)) return;
        if (rooms.size >= 200) { send(ws,{type:'error',msg:'Server full.'}); return; }
        const code = generateCode();
        const room:Room = {
          code, host:ws, guest:null, gameLoop:null,
          state: createState(),
          inputs: { left:{up:false,down:false}, right:{up:false,down:false} },
        };
        rooms.set(code, room);
        wsRoom.set(ws, room);
        wsRole.set(ws, 'left');
        send(ws, {type:'hosted', code});
        break;
      }
      case 'join': {
        if (wsRoom.get(ws)) return;
        const code = String(msg.code||'').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room)       { send(ws,{type:'error',msg:'Room not found.'}); return; }
        if (room.guest)  { send(ws,{type:'error',msg:'Room is full.'});   return; }
        room.guest = ws;
        wsRoom.set(ws, room);
        wsRole.set(ws, 'right');
        send(ws, {type:'joined'});
        if (room.host) send(room.host, {type:'opponentJoined'});
        startGameLoop(room);
        break;
      }
      case 'input': {
        const room = wsRoom.get(ws);
        if (!room) return;
        const side = wsRole.get(ws)==='left' ? 'left' : 'right';
        room.inputs[side].up   = !!msg.up;
        room.inputs[side].down = !!msg.down;
        break;
      }
    }
  };

  ws.onclose = () => {
    const room = wsRoom.get(ws);
    if (!room) return;
    const other = ws===room.host ? room.guest : room.host;
    if (other) send(other, {type:'opponentLeft'});
    destroyRoom(room);
  };
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────
async function handler(req:Request): Promise<Response> {
  const url = new URL(req.url);

  // WebSocket upgrade
  if (req.headers.get('upgrade')==='websocket' && url.pathname==='/ws') {
    const {socket, response} = Deno.upgradeWebSocket(req);
    handleWS(socket);
    return response;
  }

  // Serve index.html for all other routes
  try {
    const html = await Deno.readTextFile(new URL('./public/index.html', import.meta.url));
    return new Response(html, { headers: {'Content-Type':'text/html; charset=utf-8'} });
  } catch {
    return new Response('Not found', {status:404});
  }
}

Deno.serve(handler);
