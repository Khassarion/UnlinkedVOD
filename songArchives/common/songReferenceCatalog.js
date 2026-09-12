const path = require('path');
const { readJsonArray, readJsonObject, writeJsonData, splitArtistNames } = require('./utils');

/**
 * Find rawValue (or one of its aliases) among list entries, returning the canonical value.
 * @param {Array<Record<string, unknown>>} list
 * @param {string} canonicalKey - e.g. 'title' or 'artist'
 * @param {string[]} aliasKeys - alias array field names, checked in order; first array found wins
 * @returns {string|null}
 */
function findCanonicalMatch(list, canonicalKey, aliasKeys, rawValue) {
  const s = (rawValue || '').trim();
  if (!s || !list || !list.length) return null;
  for (const entry of list) {
    const canonical = (entry[canonicalKey] || '').trim();
    let aliases = [];
    for (const key of aliasKeys) {
      if (Array.isArray(entry[key])) {
        aliases = entry[key];
        break;
      }
    }
    if (s === canonical || aliases.some((a) => String(a).trim() === s)) return canonical;
  }
  return null;
}

/**
 * Global title/artist reference + thumbnail overrides: songArchives/common/data.
 * Shared across all streamers within one process.
 */
class SongReferenceCatalog {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    const dataDir = path.join(repoRoot, 'common', 'data');
    this.titleRefPath = path.join(dataDir, 'titleReference.json');
    this.artistRefPath = path.join(dataDir, 'artistReference.json');
    this.thumbnailOverridesPath = path.join(dataDir, 'thumbnailOverrides.json');
    this._titleRef = null;
    this._artistRef = null;
  }

  /** @returns {Array<Record<string, unknown>>} lazy-loaded, cached until reload() */
  get titleRef() {
    if (this._titleRef === null) this._titleRef = readJsonArray(this.titleRefPath);
    return this._titleRef;
  }

  /** @returns {Array<Record<string, unknown>>} lazy-loaded, cached until reload() */
  get artistRef() {
    if (this._artistRef === null) this._artistRef = readJsonArray(this.artistRefPath);
    return this._artistRef;
  }

  /** Force re-read title/artist reference from disk. */
  reload() {
    this._titleRef = readJsonArray(this.titleRefPath);
    this._artistRef = readJsonArray(this.artistRefPath);
  }

  /** @returns {string|null} canonical title or null */
  resolveTitle(rawTitle) {
    return findCanonicalMatch(this.titleRef, 'title', ['aliases', 'titleAliases'], rawTitle);
  }

  /** artistReference 에서 단일 가수명(별칭 포함) → 캐노니컬. @returns {string|null} */
  resolveOneArtist(rawArtist) {
    return findCanonicalMatch(this.artistRef, 'artist', ['aliases'], rawArtist);
  }

  /**
   * @returns {string|null} 캐노니컬 가수. 콤마로 여러 명이면 각각 조회 후 ", " 로 이어 붙임. 하나라도 없으면 null.
   */
  resolveArtist(rawArtist) {
    const parts = splitArtistNames(rawArtist);
    if (!parts.length || !this.artistRef.length) return null;
    const resolved = [];
    for (const part of parts) {
      const canonical = this.resolveOneArtist(part);
      if (!canonical) return null;
      resolved.push(canonical);
    }
    return resolved.join(', ');
  }

  hasOneArtist(name) {
    return this.resolveOneArtist(name) !== null;
  }

  /** 콤마로 나뉜 가수명이면 전원 artistReference(별칭 포함)에 있어야 true */
  hasArtist(nameOrCombined) {
    const parts = splitArtistNames(nameOrCombined);
    if (!parts.length) return false;
    return parts.every((part) => this.hasOneArtist(part));
  }

  /** titleReference에 신규 제목 추가(정렬 유지, 이미 있으면 no-op). */
  addTitle(rawTitle) {
    const t = (rawTitle || '').trim();
    if (!t) return;
    const list = readJsonArray(this.titleRefPath);
    if (list.some((e) => (e.title || '').trim() === t)) {
      this._titleRef = list;
      return;
    }
    list.push({ title: t, aliases: [] });
    list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
    writeJsonData(this.titleRefPath, list);
    this._titleRef = list;
  }

  /** artistReference에 신규 가수 추가(콤마로 여러 명 가능, 정렬 유지). */
  addArtist(rawArtist) {
    const parts = splitArtistNames(rawArtist);
    if (!parts.length) return;
    const list = readJsonArray(this.artistRefPath);
    let changed = false;
    for (const part of parts) {
      if (findCanonicalMatch(list, 'artist', ['aliases'], part) !== null) continue;
      list.push({ artist: part, aliases: [] });
      changed = true;
    }
    if (!changed) {
      this._artistRef = list;
      return;
    }
    list.sort((a, b) => (a.artist || '').localeCompare(b.artist || '', 'ko'));
    writeJsonData(this.artistRefPath, list);
    this._artistRef = list;
  }

  /**
   * VOD API가 썸네일을 못 내려줄 때 대신 쓰는 매핑.
   * @param {string} videoId
   * @returns {string|undefined}
   */
  getThumbnailOverride(videoId) {
    return readJsonObject(this.thumbnailOverridesPath, {})[videoId];
  }
}

module.exports = { SongReferenceCatalog };
