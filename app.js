// The share page: rebuilds a match from the link's fragment and shows it like the app's
// match page. `renderMatch` is a pure payload -> HTML string function (so it is tested
// without a DOM); everything below `boot` touches the page.
import { decodeFragment, decodeCollectionFragment, validateCollection, INCOMPLETE } from './share.js?v=short-links-4';
import {
  stateFromShare, analyse, scoresheetItems, isHighlight, teamName, resultLine,
  pointWindow, matchWindow, prefix,
} from './rules.js?v=short-links-4';

const LEFT = '#FFD23F';
const RIGHT = '#5AA9FF';
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

export function renderCollection(payload, index = 0) {
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
      + `${selected ? ' aria-current="true"' : ''} aria-label="${esc(label)}">`
      + `<span class="picker-number">${selected ? '✓' : i + 1}</span><span class="picker-choice-content">`
      + `<span class="picker-choice-meta">Match ${i + 1} · ${esc(prettyDate(match.d))}<span>${selected ? 'Selected' : validVideoID(match.vid) ? 'Video' : 'Stats only'}</span></span>`
      + `<span class="picker-teams">${matchRows(match)}</span></span></button>`;
  }).join('');
  return `<main class="collection"><header class="collection-top"><p class="eyebrow">RallyCam · Match collection</p>`
    + `<h1>${esc(payload.t)}</h1><p class="collection-count">${payload.m.length} matches · one link</p></header>`
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
  let dispose;
  function show(index = 0) {
    dispose?.();
    root.innerHTML = collection ? renderCollection(payload, index) : renderMatch(payload);
    const match = collection ? payload.m[index] : payload;
    document.title = `${payload.t} · RallyCam`;
    dispose = wire(collection ? root.querySelector('#collection-match') : root, validVideoID(match.vid));
  }
  show();
  if (collection) {
    root.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-browse]');
      if (button && !button.disabled) {
        if (button.hasAttribute('aria-current')) {
          root.querySelector('#match-picker').open = false;
        } else {
          show(Number(button.dataset.browse));
          window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }
        root.querySelector('#match-picker summary').focus({ preventScroll: true });
      }
    });
  }
  // A different link pasted into the same tab.
  window.addEventListener('hashchange', () => location.reload());
}

function wire(root, vid) {
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

  function showNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function embedURL(start, end) {
    const q = new URLSearchParams({
      enablejsapi: '1', playsinline: '1', autoplay: '1', rel: '0', modestbranding: '1',
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
    wrap.hidden = false;
    showNote('');
    activeRow?.classList.remove('playing');
    activeRow = el.classList.contains('row') ? el : null;
    activeRow?.classList.add('playing');
    if (!frameHolder.firstChild) create(start, end);
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
  return () => { disposed = true; player?.destroy?.(); };
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
