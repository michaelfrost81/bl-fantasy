import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../data/fiba-games.json', import.meta.url);
const existing = await readFile(path, 'utf8').then(JSON.parse).catch(() => ({ games: [] }));
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const ids = new Set([...app.matchAll(/fibaId:"(\d+)"/g)].map(match => match[1]));
for (const game of existing.games || []) ids.add(game.gameId);
const games = new Map((existing.games || []).map(game => [game.gameId, game]));
let fetched = 0;
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
const next = {ok:true,provider:'FIBA LiveStats',games:[...games.values()].sort((a,b)=>Number(a.gameId)-Number(b.gameId))};
const output = JSON.stringify(next, null, 2) + '\n';
if (output !== await readFile(path, 'utf8').catch(() => '')) await writeFile(path, output);
console.log(`Checked ${fetched}/${ids.size}; stored ${next.games.length} games`);
