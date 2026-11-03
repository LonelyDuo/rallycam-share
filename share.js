// Decodes (and, for the tests, encodes) the share link's fragment: `m=<base64url(JSON)>`.
// Mirrors RallyKit's MatchShare: same fields, same checks, same canonical JSON text.

import { stateFromShare } from './rules.js';

export const INCOMPLETE = 'This link is incomplete.';
export const VERSION = 1;

export class ShareError extends Error {
  /// reason: 'unsupportedVersion' | 'malformed'
  constructor(reason, detail = '') {
    super(INCOMPLETE);
    this.name = 'ShareError';
    this.reason = reason;
    this.detail = detail;
  }
}

const malformed = (detail) => new ShareError('malformed', detail);

/// Keys sorted, no whitespace, "/" and non-ASCII left alone: the text the app produces.
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toBase64URL(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function encodeFragment(payload) {
  return `m=${toBase64URL(canonicalJSON(payload))}`;
}

export function encodeCollectionFragment(payload) {
  validateCollection(payload);
  return `c=${toBase64URL(canonicalJSON(payload))}`;
}

export function decodeCollectionFragment(fragment) {
  let text = String(fragment).trim().replace(/^#/, '');
  if (!text.startsWith('c=') || text.length > 1000000) throw malformed('collection fragment');
  let payload;
  try { payload = JSON.parse(fromBase64URL(text.slice(2))); }
  catch { throw malformed('collection JSON'); }
  validateCollection(payload);
  return payload;
}

export function validateCollection(payload) {
  if (!payload || payload.v !== 1 || typeof payload.t !== 'string'
      || !Array.isArray(payload.m) || !payload.m.length || payload.m.length > 500) throw malformed('collection');
  for (const match of payload.m) {
    if (!match || match.v !== VERSION) throw malformed('collection match version');
    validate(match);
  }
}

function fromBase64URL(text) {
  // Chat apps wrap long links and some add padding; both are harmless. Accept the
  // standard alphabet too.
  const cleaned = text.replace(/\s+/g, '').replace(/=+$/, '').replaceAll('-', '+').replaceAll('_', '/');
  if (!cleaned || !/^[A-Za-z0-9+/]+$/.test(cleaned) || cleaned.length % 4 === 1) throw malformed('not base64url');
  let binary;
  try {
    binary = atob(cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4));
  } catch {
    throw malformed('not base64url');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw malformed('not utf-8');
  }
}

const isInt = Number.isInteger;
const isStrings = (a) => Array.isArray(a) && a.every((s) => typeof s === 'string');

/// Takes the fragment with or without its leading `#`. Returns the payload object or throws ShareError.
export function decodeFragment(fragment) {
  if (typeof fragment !== 'string') throw malformed('no fragment');
  let text = fragment.trim();
  if (text.startsWith('#')) text = text.slice(1).trimStart();
  if (!text.startsWith('m=')) throw malformed('missing m=');

  let payload;
  try {
    payload = JSON.parse(fromBase64URL(text.slice(2)));
  } catch (e) {
    if (e instanceof ShareError) throw e;
    throw malformed('not json');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isInt(payload.v)) {
    throw malformed('not a share payload');
  }
  // The version comes first: a newer page's JSON needn't look like this one.
  if (payload.v !== VERSION) throw new ShareError('unsupportedVersion', String(payload.v));
  validate(payload);
  return payload;
}

function validate(p) {
  if (typeof p.t !== 'string' || typeof p.d !== 'string') throw malformed('t/d');
  if (p.vid !== undefined && typeof p.vid !== 'string') throw malformed('vid');
  if (p.f !== 's' && p.f !== 'd') throw malformed('f');
  const perSide = p.f === 'd' ? 2 : 1;
  for (const names of [p.l, p.r]) {
    if (!isStrings(names) || !(names.length === 0 || names.length === perSide)) throw malformed('names');
  }
  for (const pair of [p.fs, p.fr]) {
    if (!Array.isArray(pair) || pair.length !== 2 || !isInt(pair[0]) || !isInt(pair[1])
        || pair[0] < 0 || pair[0] > 1 || pair[1] < 0 || pair[1] >= perSide) throw malformed('server');
  }
  if (typeof p.p !== 'string' || !/^[LRlr]*$/.test(p.p)) throw malformed('p');
  if ((p.st === undefined) !== (p.o === undefined)) throw malformed('st/o');
  if (p.st !== undefined && !isInt(p.st)) throw malformed('st');
  if (p.o !== undefined) {
    if (!Array.isArray(p.o) || !p.o.every(isInt) || p.o.length !== p.p.length) throw malformed('o');
  }
  if (!isInt(p.n) || p.n < -30 || p.n > 30) throw malformed('n');
  if (typeof p.e !== 'boolean') throw malformed('e');
  // A game stops at its winner, so extra points would silently vanish on rebuild.
  if (stateFromShare(p).points.length !== p.p.length) throw malformed('points after the win');
}
