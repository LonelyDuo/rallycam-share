// The app's match rules, ported from RallyKit (Serving, Analysis, Scoresheet, Playback,
// MatchShare.state()). The shared JSON fixtures keep this file and the Swift in step:
// change a rule in one place and `swift test` or `node --test` fails.
//
// Sides are 'left' / 'right'. Times are seconds. A state is
// { setup, points, score, winner, isEnded } like Swift's MatchState.

const other = (side) => (side === 'left' ? 'right' : 'left');
const POINTS_TO_WIN = 11;
const WIN_BY = 2;

// Collection records are based only on selected games. Each doubles partner gets
// the team's result; only people on opposite sides are head-to-head opponents.
export function collectionStats(matches) {
  const players = new Map();
  const pairs = new Map();
  const nameKey = name => name.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US');
  let completed = 0;
  let earlyEnded = 0;
  for (const match of matches) {
    const state = stateFromShare(match);
    const winner = state.winner ?? (state.isEnded && state.score.left !== state.score.right
      ? (state.score.left > state.score.right ? 'left' : 'right') : null);
    if (state.isEnded && !state.winner) earlyEnded += 1;
    const sides = ['left', 'right'].map(side => {
      const entries = new Map();
      for (const player of state.setup[side].players) {
        const name = player.name.trim().replace(/\s+/g, ' ');
        const key = nameKey(name);
        if (key) entries.set(key, name);
      }
      return entries;
    });
    // An ambiguous name on both teams cannot be credited with both a win and loss.
    for (const key of [...sides[0].keys()]) {
      if (sides[1].has(key)) { sides[0].delete(key); sides[1].delete(key); }
    }
    if (winner) completed += 1;
    for (const [index, side] of ['left', 'right'].entries()) {
      for (const [key, name] of sides[index]) {
        const record = players.get(key) ?? { key, name, wins: 0, losses: 0, unfinished: 0, pointsFor: 0, pointsAgainst: 0 };
        record.name = name;
        if (!winner) record.unfinished += 1;
        else if (winner === side) record.wins += 1;
        else record.losses += 1;
        record.pointsFor += state.score[side];
        record.pointsAgainst += state.score[other(side)];
        players.set(key, record);
      }
    }
    for (const left of sides[0].keys()) for (const right of sides[1].keys()) {
      const [a, b] = [left, right].sort();
      const key = JSON.stringify([a, b]);
      const pair = pairs.get(key) ?? { a, b, aWins: 0, bWins: 0, unfinished: 0, aPoints: 0, bPoints: 0, hasDoubles: false };
      const aSide = a === left ? 'left' : 'right';
      if (!winner) pair.unfinished += 1;
      else if (winner === aSide) pair.aWins += 1;
      else pair.bWins += 1;
      pair.aPoints += state.score[aSide];
      pair.bPoints += state.score[other(aSide)];
      pair.hasDoubles ||= state.setup.format === 'doubles';
      pairs.set(key, pair);
    }
  }
  const records = [...players.values()].map(player => ({ ...player,
    played: player.wins + player.losses + player.unfinished,
    winRate: player.wins + player.losses ? player.wins / (player.wins + player.losses) : null,
  })).sort((a, b) => b.played - a.played || b.wins - a.wins || a.key.localeCompare(b.key, 'en'));
  return { total: matches.length, completed, earlyEnded, unfinished: matches.length - completed, players: records, faceoffs: [...pairs.values()] };
}

export function collectionOpponents(stats, playerKey) {
  const names = new Map(stats.players.map(player => [player.key, player.name]));
  return stats.faceoffs.filter(pair => pair.a === playerKey || pair.b === playerKey).map(pair => {
    const first = pair.a === playerKey;
    const wins = first ? pair.aWins : pair.bWins;
    const losses = first ? pair.bWins : pair.aWins;
    const key = first ? pair.b : pair.a;
    return { key, name: names.get(key), wins, losses, unfinished: pair.unfinished,
      played: wins + losses + pair.unfinished, winRate: wins + losses ? wins / (wins + losses) : null,
      pointsFor: first ? pair.aPoints : pair.bPoints, pointsAgainst: first ? pair.bPoints : pair.aPoints,
      hasDoubles: pair.hasDoubles };
  }).sort((a, b) => b.played - a.played || a.key.localeCompare(b.key, 'en'));
}

function scoreWinner(score) {
  for (const side of ['left', 'right']) {
    if (score[side] >= POINTS_TO_WIN && score[side] - score[other(side)] >= WIN_BY) return side;
  }
  return null;
}

/// The side one point from taking the game: at least 10 points, ahead, and not yet won.
function gamePointSide(score) {
  if (scoreWinner(score)) return null;
  for (const side of ['left', 'right']) {
    if (score[side] >= POINTS_TO_WIN - 1 && score[side] > score[other(side)]) return side;
  }
  return null;
}

// Graphemes, as Swift's Character: "É" or an emoji counts once.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
function characters(text) {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}
export function prefix(text, n) {
  return characters(text).slice(0, n).join('');
}

// MARK: Match log -> state

/// Replays entries the way `MatchLog.append` + `MatchState(log:)` do.
/// entries: { type: 'point', side, at } | { type: 'undo' } | { type: 'star' } | { type: 'end' }.
export function buildState({ format, left, right, firstServer, firstReceiver, startedAt, entries }) {
  const team = (names) => ({ players: names.map((name) => ({ name })) });
  const setup = { format, left: team(left), right: team(right), firstServer, firstReceiver, startedAt };
  const points = [];
  let score = { left: 0, right: 0 };
  let isEnded = false;
  for (const entry of entries) {
    if (isEnded) break;
    switch (entry.type) {
      case 'point':
        // A won game takes no more points.
        if (scoreWinner(score)) break;
        score = { ...score, [entry.side]: score[entry.side] + 1 };
        points.push({ number: points.length + 1, winner: entry.side, at: entry.at, isStarred: false, scoreAfter: score });
        break;
      case 'undo':
        if (points.pop()) score = points.length ? points[points.length - 1].scoreAfter : { left: 0, right: 0 };
        break;
      case 'star':
        if (points.length) points[points.length - 1].isStarred = true;
        break;
      case 'end':
        isEnded = true;
        break;
    }
  }
  return { setup, points, score, winner: scoreWinner(score), isEnded };
}

/// Rebuilds a match from a decoded share payload; times count from 0, which plays the
/// part of `goLiveAt` for the window functions.
export function stateFromShare(payload) {
  const names = (list) => list;
  const slot = (pair) => ({ side: pair[0] === 1 ? 'right' : 'left', index: pair.length > 1 ? pair[1] : 0 });
  let clock = payload.st ?? 0;
  const entries = [];
  [...payload.p].forEach((ch, i) => {
    clock += Array.isArray(payload.o) && Number.isFinite(payload.o[i]) ? payload.o[i] : 0;
    entries.push({ type: 'point', side: ch === 'L' || ch === 'l' ? 'left' : 'right', at: clock });
    if (ch === 'l' || ch === 'r') entries.push({ type: 'star', at: clock });
  });
  if (payload.e) entries.push({ type: 'end', at: clock });
  return buildState({
    format: payload.f === 'd' ? 'doubles' : 'singles',
    left: names(payload.l),
    right: names(payload.r),
    firstServer: slot(payload.fs),
    firstReceiver: slot(payload.fr),
    startedAt: payload.st ?? 0,
    entries,
  });
}

// MARK: Serving

/// Two serves each; one each from 10-10. Doubles rotation: X->Y, Y->X2, X2->Y2, Y2->X.
export function serveTurn(setup, pointsPlayed) {
  const x = setup.firstServer;
  const y = setup.firstReceiver;
  let rotation;
  if (setup.format === 'doubles') {
    const x2 = { side: x.side, index: 1 - x.index };
    const y2 = { side: y.side, index: 1 - y.index };
    rotation = [
      { server: x, receiver: y }, { server: y, receiver: x2 },
      { server: x2, receiver: y2 }, { server: y2, receiver: x },
    ];
  } else {
    rotation = [{ server: x, receiver: y }, { server: y, receiver: x }];
  }
  const n = pointsPlayed;
  const turnIndex = n < 20 ? Math.floor(n / 2) : 10 + (n - 20);
  return rotation[turnIndex % rotation.length];
}

// MARK: Analysis

export function analyse(state) {
  const points = state.points;

  const runs = [];
  for (const p of points) {
    const last = runs[runs.length - 1];
    if (last && last.side === p.winner) last.length += 1;
    else runs.push({ side: p.winner, firstPoint: p.number, length: 1 });
  }
  const longest = (side) => Math.max(0, ...runs.filter((r) => r.side === side).map((r) => r.length));
  const longestRun = { left: longest('left'), right: longest('right') };

  const leads = points.map((p) => p.scoreAfter.left - p.scoreAfter.right);
  const biggestLead = {
    left: Math.max(0, ...leads),
    right: Math.max(0, ...leads.map((l) => -l)),
  };

  const servers = points.map((_, i) => serveTurn(state.setup, i));
  const served = { left: 0, right: 0 };
  const won = { left: 0, right: 0 };
  points.forEach((p, i) => {
    const side = servers[i].server.side;
    served[side] += 1;
    if (p.winner === side) won[side] += 1;
  });
  // Schoolbook rounding (.5 up), as Swift's .toNearestOrAwayFromZero; the values are never negative.
  const percent = (side) => (served[side] > 0 ? Math.round((100 * won[side]) / served[side]) : null);
  const wonOnServePercent = { left: percent('left'), right: percent('right') };

  const emptyStats = () => ({ left: { won: 0, total: 0 }, right: { won: 0, total: 0 } });
  const wonReceiving = emptyStats();
  const gamePointsSaved = emptyStats();
  const gamePointsConverted = emptyStats();
  let scoreBefore = { left: 0, right: 0 };
  points.forEach((p, i) => {
    const receiver = servers[i].server.side === 'left' ? 'right' : 'left';
    wonReceiving[receiver].total += 1;
    if (p.winner === receiver) wonReceiving[receiver].won += 1;
    const side = gamePointSide(scoreBefore);
    if (side) {
      const opponent = side === 'left' ? 'right' : 'left';
      gamePointsConverted[side].total += 1;
      gamePointsSaved[opponent].total += 1;
      if (p.winner === side) gamePointsConverted[side].won += 1;
      else gamePointsSaved[opponent].won += 1;
    }
    scoreBefore = p.scoreAfter;
  });
  for (const stats of [wonReceiving, gamePointsSaved, gamePointsConverted]) {
    for (const stat of Object.values(stats)) {
      stat.percent = stat.total > 0 ? Math.round(100 * stat.won / stat.total) : null;
    }
  }

  const reachedDeuce = points.some((p) => p.scoreAfter.left >= 10 && p.scoreAfter.right >= 10);

  const gamePointStarts = [];
  for (const p of points) {
    const side = gamePointSide(p.scoreAfter);
    if (side && !gamePointStarts.some((g) => g.side === side)) gamePointStarts.push({ point: p.number, side });
  }

  const duration = points.length >= 2 ? points[points.length - 1].at - points[0].at : null;

  return { runs, leads, servers, longestRun, biggestLead, wonOnServePercent, wonReceiving, gamePointsSaved, gamePointsConverted, reachedDeuce, gamePointStarts, duration };
}

// MARK: Names, scoresheet, summary

export function teamName(side, setup) {
  const players = setup[side].players;
  if (players.length === 0) return side === 'left' ? 'Left' : 'Right';
  return players.map((p) => p.name).join(' & ');
}

export function initials(slot, setup) {
  const players = setup[slot.side].players;
  const fallback = slot.side === 'left' ? 'L' : 'R';
  if (!(slot.index >= 0 && slot.index < players.length)) return fallback;
  const names = players.map((p) => p.name.toUpperCase());
  const name = names[slot.index];
  if (names.length !== 2) return prefix(name, 2);
  const [a, b] = names;
  // "Sam" and "Samuel", or two Alexes, share every letter one of them has: number them.
  if (a.startsWith(b) || b.startsWith(a)) return (prefix(name, 1) || fallback) + String(slot.index + 1);
  // The shortest prefix that differs, so "Shaun" and "Shuvo" read SHA and SHU.
  let length = 2;
  while (prefix(a, length) === prefix(b, length)) length += 1;
  return prefix(name, length);
}

/// Rows for the match page: each point followed by the markers it triggers.
/// Items: { kind: 'point', number, scoreAfter, winner, serverSide, serverInitials, isStarred }
/// | { kind: 'run', side, length } | { kind: 'gamePoint', side }
/// | { kind: 'won', side, score } | { kind: 'endedEarly', score }.
export function scoresheetItems(state, highlightsOnly = false) {
  const a = analyse(state);
  const points = state.points;
  const items = [];
  points.forEach((p, i) => {
    const turn = a.servers[i].server;
    items.push({
      kind: 'point', number: p.number, scoreAfter: p.scoreAfter, winner: p.winner,
      serverSide: turn.side, serverInitials: initials(turn, state.setup), isStarred: p.isStarred,
    });
    // A run ends here only if a later point went to the other side.
    const run = a.runs.find((r) => r.firstPoint + r.length - 1 === p.number);
    if (run && run.length >= 3 && i + 1 < points.length) items.push({ kind: 'run', side: run.side, length: run.length });
    const start = a.gamePointStarts.find((g) => g.point === p.number);
    if (start) items.push({ kind: 'gamePoint', side: start.side });
  });
  if (state.winner) items.push({ kind: 'won', side: state.winner, score: state.score });
  else if (state.isEnded) items.push({ kind: 'endedEarly', score: state.score });
  if (!highlightsOnly) return items;
  return items.filter((it) => isHighlight(it));
}

/// Starred points and the closing item survive "Highlights only".
export function isHighlight(item) {
  switch (item.kind) {
    case 'point': return item.isStarred;
    case 'won':
    case 'endedEarly': return true;
    default: return false;
  }
}

export function resultLine(state) {
  const s = state.score;
  if (state.winner) {
    const verb = state.setup[state.winner].players.length === 2 ? 'win' : 'wins';
    return `${teamName(state.winner, state.setup)} ${verb} ${s[state.winner]}–${s[other(state.winner)]}`;
  }
  if (state.isEnded) return `Ended at ${s.left}–${s.right}`;
  return `In progress · ${s.left}–${s.right}`;
}

export function highlight(state) {
  const a = analyse(state);
  if (a.reachedDeuce) return 'deuce';
  const n = Math.max(a.longestRun.left, a.longestRun.right);
  return n >= 3 ? `longest run ${n}` : null;
}

// MARK: Playback

// Before the match start; after the previous tap, which comes once that rally is over.
const LEAD = 1;
const AFTER_TAP = 1;
const TAIL = 2;

function windowBetween(from, to, goLiveAt, nudge) {
  const start = Math.max(0, from - goLiveAt + nudge);
  // The end can't fall before the clamped start.
  const end = Math.max(start, to - goLiveAt + TAIL + nudge);
  return [start, end];
}

/// [start, end] seconds into the video, or null for an index with no point.
export function pointWindow(state, index, goLiveAt, nudgeSeconds) {
  if (!(index >= 0 && index < state.points.length)) return null;
  const from = index === 0 ? state.setup.startedAt - LEAD : state.points[index - 1].at + AFTER_TAP;
  return windowBetween(from, state.points[index].at, goLiveAt, nudgeSeconds);
}

export function matchWindow(state, goLiveAt, nudgeSeconds) {
  if (!state.points.length) return null;
  return windowBetween(state.setup.startedAt - LEAD, state.points[state.points.length - 1].at, goLiveAt, nudgeSeconds);
}
