// Serwer pośredniczący do gry Żużel online.
// Nie liczy żadnej fizyki: tworzy pokoje (kod 4 litery), pilnuje miejsc 0-3
// i przekazuje wiadomości między graczami w tym samym pokoju.
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;
const MAX_NAME = 9;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // bez I i O (mylą się z 1 i 0)
const MAX_MSGS_PER_SEC = 80;      // limit wiadomości od jednego klienta
const ROOM_IDLE_MS = 30 * 60e3;   // pusty/nieaktywny pokój znika po 30 min

const rooms = new Map(); // kod -> { code, slots: [ws|null x4], host: 0, racing: false, last: ms }

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("zuzel-server ok, pokoje: " + rooms.size + "\n");
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });

function cleanName(s) {
  s = String(s || "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().toUpperCase();
  return s.slice(0, MAX_NAME) || "GRACZ";
}

function newCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function playersOf(room) {
  const list = [];
  room.slots.forEach((w, i) => { if (w) list.push({ slot: i, name: w.pname }); });
  return list;
}

function broadcast(room, obj, except) {
  for (const w of room.slots) if (w && w !== except) send(w, obj);
}

function sendPlayers(room) {
  broadcast(room, { t: "players", players: playersOf(room), host: room.host });
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const slot = room.slots.indexOf(ws);
  if (slot < 0) return;
  room.slots[slot] = null;
  if (slot === room.host) {
    // Host (to on liczy boty) wyszedł: zamykamy pokój dla wszystkich
    broadcast(room, { t: "closed", msg: "HOST WYSZEDŁ" });
    for (const w of room.slots) if (w) w.room = null;
    rooms.delete(room.code);
    return;
  }
  broadcast(room, { t: "left", slot });
  sendPlayers(room);
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.pname = "GRACZ";
  ws.count = 0;
  ws.countReset = Date.now();

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    if (now - ws.countReset > 1000) { ws.count = 0; ws.countReset = now; }
    if (++ws.count > MAX_MSGS_PER_SEC) return; // nadmiar po prostu ignorujemy

    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;

    if (m.t === "create") {
      if (ws.room) return;
      const code = newCode();
      if (!code) return send(ws, { t: "error", msg: "BRAK MIEJSCA NA SERWERZE" });
      ws.pname = cleanName(m.name);
      const room = { code, slots: [null, null, null, null], host: 0, racing: false, last: now };
      room.slots[0] = ws;
      ws.room = room;
      rooms.set(code, room);
      send(ws, { t: "joined", code, slot: 0, host: 0, players: playersOf(room) });
      return;
    }

    if (m.t === "join") {
      if (ws.room) return;
      const code = String(m.code || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: "error", msg: "NIE MA TAKIEGO POKOJU" });
      if (room.racing) return send(ws, { t: "error", msg: "WYŚCIG JUŻ TRWA" });
      const slot = room.slots.indexOf(null);
      if (slot < 0) return send(ws, { t: "error", msg: "POKÓJ JEST PEŁNY" });
      ws.pname = cleanName(m.name);
      room.slots[slot] = ws;
      ws.room = room;
      room.last = now;
      send(ws, { t: "joined", code, slot, host: room.host, players: playersOf(room) });
      sendPlayers(room);
      return;
    }

    const room = ws.room;
    if (!room) return;
    const slot = room.slots.indexOf(ws);
    room.last = now;

    if (m.t === "start") {
      // Tylko host; potrzeba co najmniej 2 ludzi
      if (slot !== room.host || room.racing) return;
      if (playersOf(room).length < 2) return send(ws, { t: "error", msg: "POTRZEBNYCH JEST MIN. 2 GRACZY" });
      room.racing = true;
      const lanes = [0, 1, 2, 3];
      for (let i = lanes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
      }
      const delay = 0.5 + Math.random() * 4.5; // jak w grze: 0.5 - 5.0 s do zielonego
      broadcast(room, { t: "go", lanes, delay, players: playersOf(room) });
      return;
    }

    if (m.t === "back") {
      // Host wraca do poczekalni po wyścigu; reszta dostaje to samo
      if (slot !== room.host) return;
      room.racing = false;
      broadcast(room, { t: "lobby" }, ws);
      return;
    }

    if (m.t === "s") {
      // Stan zawodnika. Gość może wysłać tylko własny slot, host także boty.
      const s = Number(m.s);
      if (!Number.isInteger(s) || s < 0 || s >= MAX_PLAYERS) return;
      if (s !== slot && slot !== room.host) return;
      broadcast(room, m, ws);
      return;
    }

    if (m.t === "out") {
      // Zawodnik wykluczony (trawa, falstart)
      const s = Number(m.s);
      if (!Number.isInteger(s) || s < 0 || s >= MAX_PLAYERS) return;
      if (s !== slot && slot !== room.host) return;
      broadcast(room, { t: "out", s }, ws);
      return;
    }

    if (m.t === "leave") { leave(ws); return; }
  });

  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

// Wykrywanie martwych połączeń (też podtrzymuje połączenie za proxy hostingu)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.last > ROOM_IDLE_MS) {
      broadcast(room, { t: "closed", msg: "POKÓJ WYGASŁ" });
      for (const w of room.slots) if (w) w.room = null;
      rooms.delete(code);
    }
  }
}, 20000);

server.listen(PORT, () => console.log("zuzel-server nasłuchuje na porcie " + PORT));
