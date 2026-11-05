import {renderMatchups,matchIndices} from './matchup-ui.js?v=day-ui-1';
import {ReplayControls} from './replay-controls.js?v=day-ui-1';
import './tracking-player.js?v=tracking-1';
// The share page: rebuilds a match from the link's fragment and shows it like the app's
// match page. `renderMatch` is a pure payload -> HTML string function (so it is tested
// without a DOM); everything below `boot` touches the page.
import { decodeFragment, decodeCollectionFragment, validateCollection, INCOMPLETE } from './share.js?v=collection-stats-6';
import {
  stateFromShare, analyse, scoresheetItems, isHighlight, teamName, resultLine,
  pointWindow, matchWindow, prefix,
  collectionStats, collectionOpponents,
} from './rules.js?v=collection-stats-6';

const LEFT = '#68E8CD';
const RIGHT = '#B9A0FF';
const NO_VIDEO = 'No video for this match — stats only.';
export const PLAYER_ERROR = 'Clips play once YouTube has processed the stream — try again later.';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// MARK: Helpers

/// Every string that came from the link goes through this before it reaches HTML.
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/// YouTube ids are 11 characters of [A-Za-z0-9_-]; anything else is never used.
export function validVideoID(vid) {
  return typeof vid === 'string' && /^[A-Za-z0-9_-]{11}$/.test(vid) ? vid : null;
}

const sideClass = (side) => side;
const colour = (side) => (side === 'left' ? LEFT : RIGHT);

function prettyDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m || +m[2] < 1 || +m[2] > 12) return '';
  return `${MONTHS[+m[2] - 1]} ${+m[3]}`;
}

/// "J&R" for a pair; a single player keeps their name, and a skipped team its side.
function shortName(side, setup) {
  const players = setup[side].players;
  if (players.length < 2) return teamName(side, setup);
  return players.map((p) => prefix(p.name, 1)).filter(Boolean).join('&');
}

// MARK: Rendering

export function renderIncomplete() {
  return `<main class="page"><section class="message" role="alert"><h1>RallyCam</h1><p>${esc(INCOMPLETE)}</p></section></main>`;
}

export function renderAnalysisSummary(state, analysis) {
  if (!state.points.length) return '';
  const names = ['left', 'right'].map(side => esc(teamName(side, state.setup)));
  return `<section id="analysis-summary" style="background:var(--card);border:1px solid var(--line,#293b4d);border-radius:18px;padding:18px;margin-top:18px">`
    + `<p class="eyebrow">GAME REVIEW</p><h2 style="margin:8px 0">The game at a glance</h2>`
    + `<p>Longest scoring runs: ${names[0]} <b>${analysis.longestRun.left}</b> · ${names[1]} <b>${analysis.longestRun.right}</b>.</p>`
    + `<p>Won on serve: ${names[0]} <b>${analysis.wonOnServePercent.left === null ? '—' : analysis.wonOnServePercent.left + '%'}</b> · ${names[1]} <b>${analysis.wonOnServePercent.right === null ? '—' : analysis.wonOnServePercent.right + '%'}</b>.</p>`
    + `<p class="key">Statistics describe the full recorded game, including when only selected clips are shared. Ball tracking and contacts are estimates.</p></section>`;
}

export function renderMatch(payload, { embedded = false } = {}) {
  const state = stateFromShare(payload);
  const analysis = analyse(state);
  const vid = validVideoID(payload.vid);
  // Times only mean something with a video: they come from `st` and `o`.
  const hasVideo = vid !== null && Number.isInteger(payload.st) && Array.isArray(payload.o);
  const nudge = payload.n ?? 0;
  const windows = hasVideo ? { match: matchWindow(state, 0, nudge) } : { match: null };

  const date = prettyDate(payload.d);
  const parts = [
    `<${embedded ? 'section' : 'main'} class="page">`,
    `<header class="top"><p class="eyebrow">RallyCam${date ? ` · ${esc(date)}` : ''}</p><h1>${esc(payload.t)}</h1></header>`,
    renderHero(state, analysis, hasVideo),
    hasVideo ? renderWatch(vid, windows.match) : `<p class="novideo">${esc(NO_VIDEO)}</p>`,
  ];

  parts.push(renderAnalysisSummary(state, analysis));
  parts.push(`<h2 class="sec">How it went</h2>`, renderChart(state, analysis));
  if (state.points.length) {
    parts.push(`<h2 class="sec">Stats</h2>`, renderTiles(state, analysis));
    parts.push(
      `<div class="sechead"><h2 class="sec">Points</h2>`
      + `<button class="toggle" type="button" aria-pressed="false" data-toggle="hl">★ Highlights only</button></div>`,
      renderSheet(state, analysis, hasVideo ? { nudge } : null),
      `<p class="key"><b>Initials</b> = who served that point${hasVideo ? ' · <b>▶</b> plays the rally' : ''} · <b>★</b> starred on the watch</p>`,
    );
  }
  parts.push(`</${embedded ? 'section' : 'main'}>`);
  return parts.join('\n');
}

export function renderCollectionStats(payload, selectedKey = null) {
  const stats = collectionStats(payload.m);
  const focusedName = payload.t?.match(/^(.+)[’']s (?:matches|games)$/i)?.[1];
  const selected = stats.players.find(player => player.key === selectedKey)
    ?? stats.players.find(player => focusedName && player.name.localeCompare(focusedName, 'en', {sensitivity:'base'}) === 0)
    ?? stats.players[0];
  const percent = rate => rate === null ? '—' : `${Math.round(rate * 100)}%`;
  const records = stats.players.map(player => `<button type="button" class="record-row" data-stat-player="${esc(player.key)}"`
    + ` aria-pressed="${player.key === selected?.key}"><span class="record-name">${esc(player.name)}</span>`
    + `<span>${player.wins}–${player.losses}</span><b>${percent(player.winRate)}</b></button>`).join('');
  const opponents = selected ? collectionOpponents(stats, selected.key).map(opponent =>
    `<article class="faceoff"><div class="faceoff-title"><span>vs ${esc(opponent.name)}</span>`
    + `<strong aria-label="${esc(selected.name)} ${opponent.wins} wins, ${esc(opponent.name)} ${opponent.losses} wins">${opponent.wins}<span>–</span>${opponent.losses}</strong></div>`
    + `<div class="faceoff-meta"><span>${percent(opponent.winRate)} win rate · ${opponent.wins + opponent.losses} decided`
    + `${opponent.unfinished ? ` · ${opponent.unfinished} undecided` : ''}</span>`
    + `<span>${opponent.hasDoubles ? 'Team points' : 'Points'} ${opponent.pointsFor}–${opponent.pointsAgainst}</span></div></article>`
  ).join('') : '';
  return `<section class="collection-stats" id="collection-stats" aria-label="Selected match statistics"><details>`
    + `<summary><span>Player stats</span><span>${stats.total} games · ${stats.earlyEnded} ended early <span class="picker-chevron" aria-hidden="true">⌄</span></span></summary>`
    + `<div class="collection-stats-body"><p class="stats-scope">Only the games in this collection</p>`
    + (stats.players.length ? `<div class="record-heading"><span>Player · tap to compare</span><span>W–L</span><span>Win rate</span></div>`
      + `<div class="record-list">${records}</div><h3>${esc(selected.name)} <span>head-to-head</span></h3>`
      + `<p class="faceoff-key">Game wins: ${esc(selected.name)} – opponent</p><div class="faceoff-list">${opponents || '<p class="stats-scope">No named opponents in these games.</p>'}</div>`
      : `<p class="stats-scope">Add player names to compare results.</p>`)
    + `<p class="stats-footnote">Early-ended games count as a win for the side ahead when play stopped. Tied endings and games still in progress are excluded from win rates. Doubles use team results. Point totals include all games.</p></div></details></section>`;
}

export function renderCollection(payload, index = 0, selectedPlayer = null) {
  if (!Number.isInteger(index) || index < 0 || index >= payload.m.length) throw new RangeError('match index');
  function matchRows(match) {
    const state = stateFromShare(match);
    return ['left', 'right'].map((side) => `<span class="picker-team${state.winner === side ? ' is-winner' : ''}">`
      + `<span>${esc(teamName(side, state.setup))}</span><b>${state.score[side]}</b></span>`).join('');
  }
  const choices = payload.m.map((match, i) => {
    const state = stateFromShare(match);
    const selected = index === i;
    const label = `Match ${i + 1}, ${teamName('left', state.setup)} ${state.score.left}–${state.score.right} ${teamName('right', state.setup)}`;
    return `<button class="picker-choice${selected ? ' is-selected' : ''}" type="button" data-browse="${i}"`
      + ` aria-label="${esc(label)}">`
      + `<span class="picker-number">${selected ? '✓' : i + 1}</span><span class="picker-choice-content">`
      + `<span class="picker-choice-meta">Match ${i + 1} · ${esc(prettyDate(match.d))}<span>${selected ? 'Selected' : validVideoID(match.vid) ? 'Video' : 'Stats only'}</span></span>`
      + `<span class="picker-teams">${matchRows(match)}</span></span></button>`;
  }).join('');
  return `<main class="collection"><header class="collection-top"><p class="eyebrow">RallyCam · Match collection</p>`
    + `<h1>${esc(payload.t)}</h1><p class="collection-count">${payload.m.length} match${payload.m.length === 1 ? '' : 'es'} · one link</p></header>`
    + renderCollectionStats(payload, selectedPlayer)
    + renderMatchups(payload, index)
    + `<nav class="collection-nav" aria-label="Browse matches"><details class="match-picker" id="match-picker">`
    + `<summary><span class="picker-current"><span class="picker-current-meta"><span>Match ${index + 1} of ${payload.m.length}</span>`
    + `<span class="picker-change">Change match <span class="picker-chevron" aria-hidden="true">⌄</span></span></span>`
    + `<span class="picker-teams">${matchRows(payload.m[index])}</span></span></summary>`
    + `<div class="picker-panel"><p class="picker-panel-title">Choose a game</p><div class="picker-list">${choices}</div></div></details>`
    + `<div class="collection-buttons">`
    + `<button type="button" data-browse="${index - 1}"${index === 0 ? ' disabled' : ''}>← Previous match</button>`
    + `<button type="button" data-browse="${index + 1}"${index === payload.m.length - 1 ? ' disabled' : ''}>Next match →</button></div></nav>`
    + `<div id="collection-match" aria-live="polite">${renderMatch(payload.m[index], { embedded: true })}</div></main>`;
}

function renderHero(state, analysis, hasVideo) {
  const rows = ['left', 'right'].map((side) => {
    const win = state.winner === side;
    return `<div class="r${win ? ' w' : ''}"><span class="nm ${sideClass(side)}">${esc(teamName(side, state.setup).toUpperCase())}</span>`
      + `<span class="score${win ? ' win' : ''}">${state.score[side]}</span></div>`;
  });
  const n = state.points.length;
  const starred = state.points.filter((p) => p.isStarred).length;
  const meta = [
    state.setup.format === 'doubles' ? 'Doubles' : 'Singles',
    `${n} point${n === 1 ? '' : 's'}`,
    hasVideo && analysis.duration !== null ? `${Math.max(1, Math.round(analysis.duration / 60))} min` : null,
    starred > 0 ? `${starred} starred` : null,
  ].filter(Boolean).join(' · ');
  return `<section class="hero" aria-label="${esc(resultLine(state))}">${rows.join('')}<p class="meta">${esc(meta)}</p></section>`;
}

function renderWatch(vid, window) {
  if (!window) return '';
  const [start, end] = window;
  return `<section class="watch" data-video="${esc(vid)}">`
    + `<button class="btn" type="button" data-play="match" data-start="${start}" data-end="${end}">▶ Watch match</button>`
    + `<a class="ytlink" href="https://youtu.be/${esc(vid)}?t=${Math.floor(start)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>`
    + `<div class="player-wrap" id="player-wrap" hidden><div class="frame" id="player-frame"></div>`
    + `<div id="tracking-controls" style="font-size:13px;padding:8px 0"></div>`
    + `<p class="note" id="player-note" role="status" hidden></p></div></section>`;
}

function renderChart(state, analysis) {
  const { left, right } = ['left', 'right'].reduce((acc, s) => ({ ...acc, [s]: teamName(s, state.setup) }), {});
  const legend = `<div class="lg"><span>▲ ${esc(left)} ahead</span><span>${esc(right)} ahead ▼</span></div>`;
  const n = state.points.length;
  if (!n) return `<div class="chart">${legend}<p class="empty">No points yet</p></div>`;

  const W = 300;
  const H = 130;
  const padX = 6;
  const bound = Math.max(...analysis.leads.map(Math.abs), 3) + 3;
  const mid = H / 2;
  const x = (i) => padX + (i * (W - 2 * padX)) / n;
  const y = (lead) => mid - (lead * (H / 2)) / bound;
  const f = (v) => v.toFixed(1);

  let svg = '';
  for (const run of analysis.runs.filter((r) => r.length >= 3)) {
    const x0 = x(run.firstPoint - 1);
    const x1 = x(run.firstPoint - 1 + run.length);
    const c = colour(run.side);
    svg += `<rect x="${f(x0)}" y="3" width="${f(x1 - x0)}" height="${H - 6}" rx="4" fill="${c}" opacity="0.14"/>`
      + `<text x="${f((x0 + x1) / 2)}" y="${run.side === 'left' ? 14 : H - 6}" fill="${c}" font-size="9" font-weight="700" text-anchor="middle">${run.length} in a row</text>`;
  }
  svg += `<line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="#3A3D45" stroke-dasharray="3 3"/>`;
  const line = [0, ...analysis.leads].map((lead, i) => `${f(x(i))},${f(y(lead))}`).join(' ');
  svg += `<polyline points="${line}" fill="none" stroke="#F2F3F5" stroke-width="2" stroke-linejoin="round"/>`;
  state.points.forEach((p, i) => {
    svg += `<circle cx="${f(x(i + 1))}" cy="${f(y(analysis.leads[i]))}" r="2.4" fill="${colour(p.winner)}"/>`;
  });

  const runs = analysis.runs.filter((r) => r.length >= 3)
    .map((r) => `${teamName(r.side, state.setup)} won ${r.length} in a row from point ${r.firstPoint}`);
  const label = ['Momentum chart', `Biggest lead: ${left} ${analysis.biggestLead.left}, ${right} ${analysis.biggestLead.right}`, ...runs].join('. ');
  return `<div class="chart">${legend}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">${svg}</svg></div>`;
}

function renderTiles(state, analysis) {
  const s = state.setup;
  const both = (value) => `${value('left')} <small>${esc(shortName('left', s))}</small> · ${value('right')} <small>${esc(shortName('right', s))}</small>`;
  const lead = (n) => (n > 0 ? `+${n}` : '0');
  const serve = (side) => (analysis.wonOnServePercent[side] === null ? '–' : `${analysis.wonOnServePercent[side]}%`);
  const tile = (k, v) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<div class="tiles">`
    + tile('Longest run', both((side) => analysis.longestRun[side]))
    + tile('Biggest lead', both((side) => lead(analysis.biggestLead[side])))
    + tile('Won on own serve', `${serve('left')} <small>${esc(shortName('left', s))}</small>`)
    + tile('Won on own serve', `${serve('right')} <small>${esc(shortName('right', s))}</small>`)
    + [['Won receiving', analysis.wonReceiving, true],
       ['Game points saved', analysis.gamePointsSaved, false],
       ['Game points converted', analysis.gamePointsConverted, false]].map(([label, stats, percentage]) =>
      ['left', 'right'].map((side) => {
        const stat = stats[side];
        const value = stat.total > 0 ? `${stat.won}/${stat.total}${percentage ? ` · ${stat.percent}%` : ''}` : '–';
        return tile(label, `${value} <small>${esc(shortName(side, s))}</small>`);
      }).join('')).join('')
    + `</div>`;
}

function renderSheet(state, analysis, video) {
  const s = state.setup;
  const name = (side) => teamName(side, s);
  const head = (side) => esc(name(side).toUpperCase()).replace(' &amp; ', ' &amp;<br>');
  const stars = state.points.filter((p) => p.isStarred).length;

  const rows = scoresheetItems(state, false).map((item) => {
    const hl = isHighlight(item) ? ' hl' : '';
    switch (item.kind) {
      case 'point': return renderRow(item, state, analysis, video, hl);
      case 'run':
        return `<div class="tagrow${hl}"><span class="tag ${item.side}">${esc(name(item.side))} · ${item.length} in a row</span></div>`;
      case 'gamePoint':
        return `<div class="tagrow${hl}"><span class="tag gp">Game point · ${esc(name(item.side))}</span></div>`;
      case 'won': {
        const last = analysis.runs[analysis.runs.length - 1];
        const extra = last && last.length >= 3 ? ` · last ${last.length} in a row` : '';
        return `<div class="tagrow${hl}"><span class="tag win ${item.side}">${esc(resultLine(state) + extra)}</span></div>`;
      }
      case 'endedEarly':
        return `<div class="tagrow${hl}"><span class="tag gp">Ended at ${item.score.left}–${item.score.right}</span></div>`;
      default: return '';
    }
  });

  return `<div class="sheet" id="sheet" data-stars="${stars}">`
    + `<div class="hd"><span></span><span class="tm left">${head('left')}</span><span class="tm right">${head('right')}</span><span></span></div>`
    + `<p class="empty-hl">No starred points. Star a point on the watch right after it.</p>`
    + rows.join('')
    + `</div>`;
}

function renderRow(p, state, analysis, video, hl) {
  const s = state.setup;
  const cell = (side) => {
    const won = p.winner === side;
    const sv = p.serverSide === side ? `<span class="sv">${esc(p.serverInitials)}</span>` : '';
    return `<span class="cell ${side}${won ? ' won' : ''}">${sv}${p.scoreAfter[side]}</span>`;
  };
  const server = s[p.serverSide].players[analysis.servers[p.number - 1].server.index]?.name;
  const label = [
    `Point ${p.number}`, `${teamName(p.winner, s)} won`, `${p.scoreAfter.left}–${p.scoreAfter.right}`,
    server ? `${server} served` : null, p.isStarred ? 'starred' : null,
  ].filter(Boolean).join(', ');

  let attrs = '';
  let act = p.isStarred ? '<span class="st">★</span>' : '';
  if (video) {
    const [start, end] = pointWindow(state, p.number - 1, 0, video.nudge);
    attrs = ` data-play="point" data-start="${start}" data-end="${end}" role="button" tabindex="0"`;
    if (!p.isStarred) act = '<span class="pl">▶</span>';
  }
  return `<div class="row${hl}" id="point-${p.number}"${attrs} aria-label="${esc(label)}">`
    + `<span class="n">${p.number}</span>${cell('left')}${cell('right')}<span class="act">${act}</span></div>`;
}

// Selected clip links preserve the complete score but show only chosen replay rows.
export function selectedClips(search, matchCount, pointCount) {
  const raw = new URLSearchParams(search).get('clips');
  if (!raw || raw.length > 12000) return null;
  const result = new Map(); let total = 0;
  for (const entry of raw.split(';')) {
    if (!/^\d+:\d+(,\d+)*$/.test(entry)) return null;
    const [key, list] = entry.split(':'), index = Number(key) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= matchCount || result.has(index)) return null;
    const points = [...new Set(list.split(',').map(Number))];
    if (points.some(n => !Number.isSafeInteger(n) || n < 1 || n > pointCount(index))) return null;
    total += points.length; if (total > 500) return null;
    result.set(index, new Set(points));
  }
  return result;
}

// MARK: Page

export const SHARE_STORAGE = 'https://rallycam-share-storage.richardisbluehd.chatgpt.site';

export async function loadStoredCollection(id, request = fetch) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw new Error('Invalid collection link.');
  const response = await request(`${SHARE_STORAGE}/api/collections/${id}`, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 404 ? 'This collection is unavailable.' : "Couldn't load this collection. Please try again.");
  const payload = await response.json();
  validateCollection(payload);
  return payload;
}

async function boot() {
  const root = document.getElementById('app');
  let payload;
  const storedID = new URLSearchParams(location.search).get('c');
  const collection = storedID !== null || location.hash.replace(/^#/, '').startsWith('c=');
  try {
    payload = storedID !== null ? await loadStoredCollection(storedID)
      : collection ? decodeCollectionFragment(location.hash) : decodeFragment(location.hash);
  } catch (error) {
    root.innerHTML = storedID !== null
      ? `<main class="page"><section class="message" role="alert"><h1>RallyCam</h1><p>${esc(error.message)}</p><button class="btn" id="retry-share" type="button">Try again</button></section></main>`
      : renderIncomplete();
    root.querySelector('#retry-share')?.addEventListener('click', () => location.reload());
    return;
  }
  const clipSelection = selectedClips(location.search, collection ? payload.m.length : 1, index => (collection ? payload.m[index] : payload).p.length);
  let currentIndex = 0;
  let dispose;
  let selectedStatsPlayer = null;
  let collectionFormat = 'all', collectionQuery = '';
  function show(index = 0) {
    dispose?.();
    currentIndex=index;
    root.innerHTML = collection ? renderCollection(payload, index, selectedStatsPlayer) : renderMatch(payload);
    const match = collection ? payload.m[index] : payload;
    if(collection){
      root.querySelector('#day-library').outerHTML=renderMatchups(payload,index,collectionFormat,collectionQuery);
      const filtered={...payload,m:matchIndices(payload,collectionFormat).map(i=>payload.m[i])};
      root.querySelector('#collection-stats').outerHTML=renderCollectionStats(filtered,selectedStatsPlayer);
    }

    document.title = `${payload.t} · RallyCam`;
    const chosen = clipSelection?.get(index);
    if (chosen) {
      const panel = collection ? root.querySelector('#collection-match') : root;
      panel.querySelectorAll('.row[id^="point-"]').forEach(row => { if (!chosen.has(Number(row.id.slice(6)))) row.style.display = 'none'; });
      const fullGame = panel.querySelector('[data-play="match"]');
      if (fullGame) fullGame.style.display = 'none';
      const note = document.createElement('p'); note.className = 'key';
      note.textContent = chosen.size + ' selected clips · Scores and stats describe the full game.';
      panel.querySelector('#sheet')?.before(note);
    }

    dispose = wire(collection ? root.querySelector('#collection-match') : root, validVideoID(match.vid), match);
  }
  show();
  if (new URLSearchParams(location.search).get('view') === 'analysis') root.querySelector('#analysis-summary')?.scrollIntoView({block:'start'});
  if (collection) {
    root.addEventListener('input',event=>{
      if(event.target.id!=='day-player-search')return;
      collectionQuery=event.target.value;
      const template=document.createElement('template');template.innerHTML=renderMatchups(payload,currentIndex,collectionFormat,collectionQuery);
      root.querySelector('#day-matchups-list').replaceChildren(...template.content.querySelector('#day-matchups-list').childNodes);
      root.querySelector('#day-game-count').textContent=template.content.querySelector('#day-game-count').textContent;
    });
    root.addEventListener('click', (event) => {
      const format=event.target.closest?.('[data-day-format]');
      if(format){collectionFormat=format.dataset.dayFormat;const allowed=matchIndices(payload,collectionFormat,collectionQuery);show(allowed.includes(currentIndex)?currentIndex:allowed[0]??currentIndex);root.querySelector('[data-day-format="'+collectionFormat+'"]')?.focus({preventScroll:true});return;}

      const player = event.target.closest?.('[data-stat-player]');
      if (player) {
        selectedStatsPlayer = player.dataset.statPlayer;
        root.querySelector('#collection-stats').outerHTML = renderCollectionStats({...payload,m:matchIndices(payload,collectionFormat).map(i=>payload.m[i])}, selectedStatsPlayer);
        Array.from(root.querySelectorAll('[data-stat-player]')).find(button => button.dataset.statPlayer === selectedStatsPlayer)?.focus({ preventScroll: true });
        return;
      }
      const button = event.target.closest?.('[data-browse]');
      if (button && !button.disabled) {
        if (button.hasAttribute('aria-current')) {
          root.querySelector('#match-picker').open = false;
        } else {
          show(Number(button.dataset.browse));
          window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }
        root.querySelector('[data-matchup-index="'+currentIndex+'"]')?.focus({ preventScroll: true });
      }
    });
  }
  // A different link pasted into the same tab.
  window.addEventListener('hashchange', () => location.reload());
}

function wire(root, vid, match) {
  const sheet = root.querySelector('#sheet');
  const toggle = root.querySelector('[data-toggle="hl"]');
  toggle?.addEventListener('click', () => {
    const on = sheet.classList.toggle('hl-only');
    toggle.setAttribute('aria-pressed', String(on));
  });

  const wrap = root.querySelector('#player-wrap');
  if (!vid || !wrap) return;
  const note = root.querySelector('#player-note');
  const frameHolder = root.querySelector('#player-frame');
  let player = null;
  let playerReady = false;
  let pending = null;
  let activeRow = null;
  let disposed = false;
  let tracking = null;
  let replayControls = null, activeWindow = null;

  function showNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function embedURL(start, end) {
    const q = new URLSearchParams({
      enablejsapi: '1', playsinline: '1', autoplay: '1', rel: '0', controls: '0', fs: '0',
      start: String(Math.floor(start)), end: String(Math.ceil(end)),
      origin: location.origin,
    });
    return `https://www.youtube.com/embed/${vid}?${q}`;
  }

  function create(start, end) {
    const iframe = document.createElement('iframe');
    iframe.src = embedURL(start, end);
    iframe.title = 'Match video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    // The page sends no referrer, but YouTube refuses to embed without at least the origin.
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frameHolder.replaceChildren(iframe);
    loadYouTubeAPI().then((YT) => {
      if (disposed) return;
      player = new YT.Player(iframe, {
        events: {
          onReady: () => {
            playerReady = true;
            tracking = new window.RallyCamSharedTracking({videoID:vid,player,container:frameHolder,controls:root.querySelector("#tracking-controls")});
            replayControls=new ReplayControls({player,stage:frameHolder,match,points:[...root.querySelectorAll('.row[data-play]')].filter(el=>el.style.display!=='none'),choose:play,tracking:()=>tracking});
            if(activeWindow)replayControls.setWindow(...activeWindow);

            if (pending) { load(pending); pending = null; }
          },
          onError: () => showNote(PLAYER_ERROR),
        },
      });
    }).catch(() => showNote(PLAYER_ERROR));
  }

  function load([start, end]) {
    player.loadVideoById({ videoId: vid, startSeconds: start, endSeconds: end });
  }

  function play(el) {
    const start = Number(el.dataset.start);
    const end = Number(el.dataset.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    activeWindow=[start,end,el];
    replayControls?.setWindow(start,end,el);
    wrap.hidden = false;
    showNote('');
    activeRow?.classList.remove('playing');
    activeRow = el.classList.contains('row') ? el : null;
    activeRow?.classList.add('playing');
    if (!frameHolder.querySelector('iframe')) create(start, end);
    else if (playerReady) load([start, end]);
    else pending = [start, end];
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-play]');
    if (el) play(el);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('.row[data-play]');
    if (el) { e.preventDefault(); play(el); }
  });
  return () => { disposed = true; replayControls?.dispose(); tracking?.dispose(); player?.destroy?.(); };
}

/// Resolves with `YT` once the IFrame API is ready. The only script this page loads.
let youtubeAPIPromise;
function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeAPIPromise) return youtubeAPIPromise;
  youtubeAPIPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('YouTube API failed to load'));
    document.head.append(script);
  }).catch((error) => { youtubeAPIPromise = null; throw error; });
  return youtubeAPIPromise;
}

if (typeof document !== 'undefined') boot();
