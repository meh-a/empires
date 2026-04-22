// ── Singleplayer Web Worker ──────────────────────────────────────
// Runs the full server-side game engine in a browser worker thread.
// Communicates with the main thread via postMessage instead of WebSocket.

// Polyfill Node.js Buffer for server game files
globalThis.Buffer = {
  from(v) {
    if (typeof v === 'string') return v;
    return new TextDecoder().decode(v);
  }
};

import { GameRoom } from '/server/game/GameRoom.js';

let room = null;

// Fake WebSocket object — send() posts to main thread instead of over the network
const fakeWs = {
  send(data) { self.postMessage(data); },
  close() {},
  readyState: 1,
};

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg && msg._init) {
    const playerName = msg.playerName || 'Wanderer';
    room = new GameRoom('sp');

    // Override broadcast so loading progress reaches the main thread during world gen
    room._broadcastRaw = (str) => {
      const parsed = JSON.parse(str);
      // Skip the 'ready' broadcast — we'll send a richer 'init' message manually below
      if (parsed.type === 'ready') return;
      self.postMessage(str);
    };

    await room.init();

    // Add the single player
    room.clients.add(fakeWs);
    const kingdom = room.addPlayer(fakeWs, playerName, true);

    // Tell the main thread the game is ready
    self.postMessage(JSON.stringify({
      type:        'init',
      seed:        room.seed,
      myKingdomId: kingdom.id,
      trees:       room.trees,
    }));

    room.start();
    return;
  }

  // Forward any other message to the game room as if it came from the player's WebSocket
  if (room) {
    room.handleMessage(fakeWs, JSON.stringify(msg));
  }
};
