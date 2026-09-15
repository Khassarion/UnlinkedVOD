/** Generic, stateless helpers shared across the addVod pipeline. */
const fs = require('fs');

/** Trim to string, or '' if empty/nullish. */
function nonEmptyStr(v) {
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

function readJsonArray(filePath, fallback = []) {
  try {
    const list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(list) ? list : fallback;
  } catch (_) {
    return fallback;
  }
}

function readJsonObject(filePath, fallback = {}) {
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

/** debug ? logs prefixed with [DEBUG] : no-op */
function makeDebugLogger(debug) {
  return debug ? (...args) => console.error('[DEBUG]', ...args) : () => {};
}

/**
 * @param {string} url - e.g. "https://vod.sooplive.com/player/189435111" or .co.kr, optional ?query #hash
 * @returns {{ videoId: string } | null}
 */
function parseVodUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const base = url.trim().split(/[#]/)[0].split('?')[0].replace(/\/+$/, '');
  const m =
    base.match(/vod\.sooplive\.co\.kr\/player\/(\d+)/i) ||
    base.match(/vod\.sooplive\.com\/player\/(\d+)/i);
  return m ? { videoId: m[1] } : null;
}

function normalizeSoopUserId(id) {
  return String(id == null ? '' : id).trim().toLowerCase();
}

/** 파싱된 가수 문자열을 콤마 기준으로 나눈다. */
function splitArtistNames(rawArtist) {
  return String(rawArtist || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  nonEmptyStr,
  readJsonArray,
  readJsonObject,
  writeJsonData,
  makeDebugLogger,
  parseVodUrl,
  normalizeSoopUserId,
  splitArtistNames,
};
