import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../data/fiba-games.json', import.meta.url);
const existing = await readFile(path, 'utf8').then(JSON.parse).catch(() => ({ games: [] }));
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const ids = new Set([...app.matchAll(/fibaId:"(\d+)"/g)].map(match => match[1]));
for (const game of existing.games || []) ids.add(game.gameId);
const games = new Map((existing.games || []).map(game => [game.gameId, game]));
let fetched = 0;
// Discovery belongs in the scheduled job, so phones do not have to scan hundreds
// of unrelated game IDs before they can show the latest results.
const discoveryFrom = Number(existing.nextDiscoveryId) || Math.max(2868128, ...ids) + 1;
const discoveryCount = 160;
let nextDiscoveryId = discoveryFrom;
let lastDiscoveryAt = existing.lastDiscoveryAt || null;
if (!lastDiscoveryAt || Date.now() - Date.parse(lastDiscoveryAt) >= 2 * 3600000 || process.env.FORCE_DISCOVERY === '1') {
try {
  const response = await fetch(`https://bl-fantasy-api.onrender.com/api/fiba/discover?from=${discoveryFrom}&count=${discoveryCount}`, {signal: AbortSignal.timeout(180000)});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const discovery = await response.json();
  if (!discovery.ok || !Array.isArray(discovery.games)) throw Error('Invalid discovery response');
  for (const game of discovery.games) {
    if (!game.ok || !game.gameId || game.teams?.length !== 2) continue;
    const id = String(game.gameId);
    ids.add(id);
    games.set(id, game);
  }
  nextDiscoveryId += discoveryCount;
  lastDiscoveryAt = new Date().toISOString();
  console.log(`Discovered ${discovery.games.length} Basketligaen games in IDs ${discoveryFrom}-${nextDiscoveryId - 1}`);
} catch (error) {
  console.warn(`Discovery at ${discoveryFrom}: ${error.message}; retrying next run`);
}
}
for (const id of ids) {
  try {
    const response = await fetch(`https://bl-fantasy-api.onrender.com/api/fiba/game/${id}`, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const game = await response.json();
    if (!game.ok || game.teams?.length !== 2) throw Error('Incomplete boxscore');
    const previous = games.get(id);
    const comparable = ({syncedAt, ...data}) => JSON.stringify(data);
    if (!previous || comparable(previous) !== comparable(game)) games.set(id, game);
    fetched++;
  } catch (error) {
    console.warn(`${id}: ${error.message}`);
  }
}
if (!fetched) throw Error('No FIBA boxscores available; keeping previous snapshot');
const next = {ok:true,provider:'FIBA LiveStats',nextDiscoveryId,lastDiscoveryAt,games:[...games.values()].sort((a,b)=>Number(a.gameId)-Number(b.gameId))};
const output = JSON.stringify(next, null, 2) + '\n';
if (output !== await readFile(path, 'utf8').catch(() => '')) await writeFile(path, output);
console.log(`Checked ${fetched}/${ids.size}; stored ${next.games.length} games`);
