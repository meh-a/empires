// ── server/game/accounts.js ──
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const FILE = new URL('../../accounts.json', import.meta.url).pathname;

function _load() {
  if (!existsSync(FILE)) return {};
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function _save(accounts) {
  writeFileSync(FILE, JSON.stringify(accounts, null, 2));
}

function _hash(password, salt) {
  return scryptSync(password, salt, 32, { N: 1024 }).toString('hex');
}

function _verify(password, stored) {
  const [salt, hash] = stored.split(':');
  try {
    return timingSafeEqual(Buffer.from(_hash(password, salt), 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

export function register(username, password) {
  if (!username || username.length < 2 || username.length > 24) return { error: 'Username must be 2–24 chars' };
  if (!password || password.length < 4) return { error: 'Password must be at least 4 chars' };
  const accounts = _load();
  if (accounts[username]) return { error: 'Username already taken' };
  const salt = randomBytes(16).toString('hex');
  accounts[username] = { hash: `${salt}:${_hash(password, salt)}`, balance: 0, tier4Slots: 0, tier5Slots: 0 };
  _save(accounts);
  return _publicData(accounts[username]);
}

export function login(username, password) {
  const accounts = _load();
  const acc = accounts[username];
  if (!acc || !_verify(password, acc.hash)) return { error: 'Invalid username or password' };
  return _publicData(acc);
}

export function purchaseSlot(username, tier) {
  const accounts = _load();
  const acc = accounts[username];
  if (!acc) return { error: 'Not logged in' };
  if (tier !== 4 && tier !== 5) return { error: 'Invalid tier' };
  const current = tier === 4 ? acc.tier4Slots : acc.tier5Slots;
  const cost = (tier === 4 ? 1000 : 1500) + current * 500;
  if (acc.balance < cost) return { error: `Need ${cost} ⚜ (you have ${acc.balance})` };
  acc.balance -= cost;
  if (tier === 4) acc.tier4Slots++;
  else            acc.tier5Slots++;
  _save(accounts);
  return _publicData(acc);
}

export function addGold(username, amount) {
  if (!username || amount <= 0) return 0;
  const accounts = _load();
  if (!accounts[username]) return 0;
  accounts[username].balance += Math.floor(amount);
  _save(accounts);
  return accounts[username].balance;
}

export function getLeaderboard(limit = 20) {
  const accounts = _load();
  return Object.entries(accounts)
    .map(([username, acc]) => ({ username, balance: acc.balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

function _publicData(acc) {
  return { balance: acc.balance, tier4Slots: acc.tier4Slots, tier5Slots: acc.tier5Slots };
}
