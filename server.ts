// ─── Physics constants (must match client) ───────────────────────────────────
const VW=1280, VH=720, PW=20, PH=140, PS=10, BS=18, BASE_SPEED=8, MAX_SPEED=18;
const TICK_MS = 1000 / 60; // 60 Hz

// ─── Binary protocol ──────────────────────────────────────────────────────────
// Server → Client  13 bytes:
//   [0-1]  Int16BE  ball.x  * 4  (sub-pixel)
//   [2-3]  Int16BE  ball.y  * 4
//   [4-5]  Int16BE  leftPaddle.y  * 4
//   [6-7]  Int16BE  rightPaddle.y * 4
//   [8]    Uint8    leftScore
//   [9]    Uint8    rightScore
//   [10]   Uint8    flags: bit0=isPlaying, bits1-2=countdownIndex
//   [11]   Uint8    shakePower * 255/18
//   [12]   Uint8    flashAlpha * 255
//
// Client → Server  2 bytes (binary):
//   [0]    0xA1     magic
//   [1]    Uint8    flags: bit0=up, bit1=down
//
// Control messages use JSON text (rare, not in hot path).

interface GameState {
  leftPaddle:  { y:number };
  rightPaddle: { y:number };
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
  pkt:Uint8Array; pktView:DataView;
}

const wsRoom = new WeakMap<WebSocket, Room|null>();
const wsRole = new WeakMap<WebSocket, 'left'|'right'|null>();
const rooms  = new Map<string, Room>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = '';
    for(let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  } while(rooms.has(code));
  return code;
}

function send(ws:WebSocket, data:unknown) {
  if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function createState(): GameState {
  return {
    leftPaddle:  {y: VH/2-PH/2},
    rightPaddle: {y: VH/2-PH/2},
    ball:        {x: VW/2-BS/2, y: VH/2-BS/2, vx:0, vy:0},
    leftScore:0, rightScore:0,
    phase:'countdown', countdownIndex:0, countdownTimer:0,
    shakePower:0, flashAlpha:0,
  };
}

function resetBall(s:GameState) {
  s.ball.x=VW/2-BS/2; s.ball.y=VH/2-BS/2; s.ball.vx=0; s.ball.vy=0;
}

function startCountdown(s:GameState) {
  s.phase='countdown'; s.countdownIndex=0; s.countdownTimer=0; resetBall(s);
}

function serveBall(s:GameState) {
  const dir = Math.random()>.5?1:-1;
  s.ball.vx = dir*BASE_SPEED;
  s.ball.vy = (Math.random()*1.2-.6)*BASE_SPEED;
  s.phase   = 'playing';
}

function bounceOff(s:GameState, py:number, isLeft:boolean) {
  const hit   = ((s.ball.y+BS/2)-(py+PH/2))/(PH/2);
  const angle = Math.max(-1,Math.min(1,hit))*.9;
  const spd   = Math.min(Math.max(Math.hypot(s.ball.vx,s.ball.vy),BASE_SPEED)*1.06, MAX_SPEED);
  s.ball.vx   = (isLeft?1:-1)*spd*Math.cos(angle);
  s.ball.vy   = spd*Math.sin(angle);
  s.ball.x    = isLeft ? (PW+50)+.5 : (VW-70-BS)-.5;
  s.shakePower = Math.max(s.shakePower, 10);
}

function tick(room:Room) {
  const {state:s, inputs:inp} = room;
  if(s.phase==='countdown') {
    s.countdownTimer++;
    if(s.countdownIndex<3 && s.countdownTimer>=45){ s.countdownIndex++; s.countdownTimer=0; }
    else if(s.countdownIndex===3 && s.countdownTimer>=35) serveBall(s);
  } else {
    if(inp.left.up)    s.leftPaddle.y  -= PS;
    if(inp.left.down)  s.leftPaddle.y  += PS;
    if(inp.right.up)   s.rightPaddle.y -= PS;
    if(inp.right.down) s.rightPaddle.y += PS;
    s.leftPaddle.y  = Math.max(0,Math.min(VH-PH,s.leftPaddle.y));
    s.rightPaddle.y = Math.max(0,Math.min(VH-PH,s.rightPaddle.y));

    s.ball.x += s.ball.vx;
    s.ball.y += s.ball.vy;

    if(s.ball.y<=0)     { s.ball.y=0;     s.ball.vy*=-1; s.shakePower=Math.max(s.shakePower,6); }
    if(s.ball.y+BS>=VH) { s.ball.y=VH-BS; s.ball.vy*=-1; s.shakePower=Math.max(s.shakePower,6); }

    if(s.ball.x<=70 && s.ball.x+BS>=50 && s.ball.y+BS>=s.leftPaddle.y && s.ball.y<=s.leftPaddle.y+PH && s.ball.vx<0)
      bounceOff(s, s.leftPaddle.y, true);

    if(s.ball.x+BS>=1210 && s.ball.x<=1230 && s.ball.y+BS>=s.rightPaddle.y && s.ball.y<=s.rightPaddle.y+PH && s.ball.vx>0)
      bounceOff(s, s.rightPaddle.y, false);

    if(s.ball.x+BS<0)  { s.rightScore++; s.flashAlpha=1; s.shakePower=18; startCountdown(s); }
    if(s.ball.x>VW)    { s.leftScore++;  s.flashAlpha=1; s.shakePower=18; startCountdown(s); }
  }
  s.shakePower *= .9; if(s.shakePower<.1)  s.shakePower=0;
  s.flashAlpha *= .9; if(s.flashAlpha<.01) s.flashAlpha=0;
}

function broadcast(room:Room) {
  const s=room.state, v=room.pktView, p=room.pkt;
  v.setInt16(0, (s.ball.x        *4+.5)|0, false);
  v.setInt16(2, (s.ball.y        *4+.5)|0, false);
  v.setInt16(4, (s.leftPaddle.y  *4+.5)|0, false);
  v.setInt16(6, (s.rightPaddle.y *4+.5)|0, false);
  p[8]  = s.leftScore;
  p[9]  = s.rightScore;
  p[10] = (s.phase==='playing'?1:0) | ((s.countdownIndex&3)<<1);
  p[11] = Math.min(255, (s.shakePower*255/18+.5)|0);
  p[12] = (s.flashAlpha*255+.5)|0;
  const copy = p.slice();
  if(room.host?.readyState  === WebSocket.OPEN) room.host.send(copy);
  if(room.guest?.readyState === WebSocket.OPEN) room.guest.send(copy);
}

function startLoop(room:Room) {
  if(room.gameLoop) clearInterval(room.gameLoop);
  room.gameLoop = setInterval(()=>{ tick(room); broadcast(room); }, TICK_MS);
}

function destroyRoom(room:Room) {
  if(room.gameLoop) clearInterval(room.gameLoop);
  rooms.delete(room.code);
}

function handleWS(ws:WebSocket) {
  wsRoom.set(ws, null);
  wsRole.set(ws, null);

  ws.onmessage = (event:MessageEvent) => {
    if(event.data instanceof ArrayBuffer) {
      const d = new Uint8Array(event.data);
      if(d[0]!==0xA1) return;
      const room = wsRoom.get(ws);
      if(!room) return;
      const side = wsRole.get(ws)==='left' ? 'left' : 'right';
      room.inputs[side].up   = !!(d[1]&1);
      room.inputs[side].down = !!(d[1]&2);
      return;
    }
    let msg:{type:string;code?:string};
    try { msg=JSON.parse(event.data); } catch { return; }
    switch(msg.type) {
      case 'host': {
        if(wsRoom.get(ws)) return;
        if(rooms.size>=200){ send(ws,{type:'error',msg:'Server full.'}); return; }
        const pkt=new Uint8Array(13);
        const room:Room = {
          code:generateCode(), host:ws, guest:null, gameLoop:null,
          state:createState(),
          inputs:{left:{up:false,down:false},right:{up:false,down:false}},
          pkt, pktView:new DataView(pkt.buffer),
        };
        rooms.set(room.code,room);
        wsRoom.set(ws,room);
        wsRole.set(ws,'left');
        send(ws,{type:'hosted',code:room.code});
        break;
      }
      case 'join': {
        if(wsRoom.get(ws)) return;
        const code=String(msg.code||'').toUpperCase().trim();
        const room=rooms.get(code);
        if(!room)      { send(ws,{type:'error',msg:'Room not found.'}); return; }
        if(room.guest) { send(ws,{type:'error',msg:'Room is full.'});   return; }
        room.guest=ws;
        wsRoom.set(ws,room);
        wsRole.set(ws,'right');
        send(ws,{type:'joined'});
        if(room.host) send(room.host,{type:'opponentJoined'});
        startLoop(room);
        break;
      }
    }
  };

  ws.onclose = () => {
    const room=wsRoom.get(ws);
    if(!room) return;
    const other=ws===room.host?room.guest:room.host;
    if(other) send(other,{type:'opponentLeft'});
    destroyRoom(room);
  };
}

async function handler(req:Request): Promise<Response> {
  if(req.headers.get('upgrade')==='websocket' && new URL(req.url).pathname==='/ws') {
    const {socket,response}=Deno.upgradeWebSocket(req);
    handleWS(socket);
    return response;
  }
  try {
    const html=await Deno.readTextFile(new URL('./public/index.html',import.meta.url));
    return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8'}});
  } catch {
    return new Response('Not found',{status:404});
  }
}

Deno.serve(handler);
