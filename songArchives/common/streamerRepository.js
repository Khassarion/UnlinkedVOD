const fs = require('fs');
const path = require('path');
const { nonEmptyStr, readJsonObject, writeJsonData } = require('./utils');
const { DEFAULT_PARSE_CONFIG } = require('./timelineCommentParser');

/** 제목 키만 가나다순(ko) 정렬. 레거시 `__default__` 키는 제거한다. */
function reorderDefaultArtistMapping(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const rest = { ...obj };
  delete rest.__default__;
  const sortedKeys = Object.keys(rest).sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  const out = {};
  for (const k of sortedKeys) out[k] = rest[k];
  return out;
}

/**
 * Represents one streamer's data folder: songArchives/{streamerId}/.
 * Owns access to config.json, parseConfig.json, defaultArtistMapping.json, source.json.
 */
class StreamerRepository {
  constructor(repoRoot, streamerId) {
    this.repoRoot = repoRoot;
    this.streamerId = streamerId;
    const dataDir = path.join(repoRoot, streamerId, 'data');
    this.configPath = path.join(dataDir, 'config.json');
    this.parseConfigPath = path.join(dataDir, 'parseConfig.json');
    this.defaultArtistMappingPath = path.join(dataDir, 'defaultArtistMapping.json');
    this.sourcePath = path.join(dataDir, 'source.json');
    this._defaultArtistMapping = null;
  }

  /**
   * config.json: comment_author_id(댓글 작성자) / debug.
   * 파일 키: `comment_author_id` 우선, 없으면 레거시 `authorUserId`.
   * 환경 변수: `CHURAHEE_COMMENT_AUTHOR_ID` 또는 `CHURAHEE_AUTHOR_USER_ID`(및 `{STREAMER}_*`).
   * @returns {{ commentAuthorId: string, debug: boolean }}
   */
  getConfig() {
    const su = this.streamerId.toUpperCase();
    let commentAuthorId = '';
    for (const n of ['CHURAHEE_COMMENT_AUTHOR_ID', `${su}_COMMENT_AUTHOR_ID`, 'CHURAHEE_AUTHOR_USER_ID', `${su}_AUTHOR_USER_ID`]) {
      if (process.env[n]) {
        commentAuthorId = process.env[n];
        break;
      }
    }
    let debug = !!(process.env.CHURAHEE_DEBUG || process.env.DEBUG);
    try {
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      commentAuthorId = nonEmptyStr(config.comment_author_id) || nonEmptyStr(config.authorUserId) || commentAuthorId;
      if (config.debug != null) debug = !!config.debug;
    } catch (_) {}
    return { commentAuthorId, debug };
  }

  /**
   * parseConfig.json. Missing → defaults (츄라희 스타일).
   * - legacy: linePrefix + parts + regexSequence
   * - extended: linePrefixRules([{ linePrefix, regexSequence?, parts?, staticFields? }]) + global parts fallback
   */
  getParseConfig() {
    try {
      const c = JSON.parse(fs.readFileSync(this.parseConfigPath, 'utf8'));
      return {
        linePrefix: typeof c.linePrefix === 'string' ? c.linePrefix : DEFAULT_PARSE_CONFIG.linePrefix,
        linePrefixRules: Array.isArray(c.linePrefixRules) && c.linePrefixRules.length > 0 ? c.linePrefixRules : null,
        parts:
          c.parts && typeof c.parts === 'object'
            ? { ...DEFAULT_PARSE_CONFIG.parts, ...c.parts }
            : DEFAULT_PARSE_CONFIG.parts,
        regexSequence: typeof c.regexSequence === 'string' ? c.regexSequence : DEFAULT_PARSE_CONFIG.regexSequence,
      };
    } catch (_) {
      return { ...DEFAULT_PARSE_CONFIG };
    }
  }

  /** Per-streamer default artist per song title (제목 문자열 키만), lazy-loaded + cached. */
  getDefaultArtistMapping() {
    if (this._defaultArtistMapping === null) {
      this._defaultArtistMapping = readJsonObject(this.defaultArtistMappingPath, {});
    }
    return this._defaultArtistMapping;
  }

  /** defaultArtistMapping 에서 해당 제목 키의 가수만 조회. */
  getDefaultArtist(canonicalTitle) {
    const t = (canonicalTitle || '').trim();
    if (!t) return '';
    return nonEmptyStr(this.getDefaultArtistMapping()[t]);
  }

  /** defaultArtistMapping.json에 title → artist 기록(정렬 유지). */
  setDefaultArtist(titleKey, artistStr) {
    const mapping = { ...this.getDefaultArtistMapping(), [titleKey]: artistStr };
    const reordered = reorderDefaultArtistMapping(mapping);
    writeJsonData(this.defaultArtistMappingPath, reordered);
    this._defaultArtistMapping = reordered;
  }

  /**
   * source.json에 VOD 항목 병합: videoId로 교체하거나 추가.
   * @param {object} historyEntry - { title, date, url, thumbnail, songInfo }
   * @returns {{ replaced: boolean, index: number }}
   */
  mergeVod(historyEntry) {
    const videoId = historyEntry.url.match(/\/player\/(\d+)/)?.[1];
    if (!videoId) throw new Error('Invalid history entry: no videoId in url');

    const data = JSON.parse(fs.readFileSync(this.sourcePath, 'utf8'));
    const idx = data.history.findIndex((e) => (e.url || '').match(/\/player\/(\d+)/)?.[1] === videoId);

    if (idx >= 0) {
      data.history[idx] = historyEntry;
      writeJsonData(this.sourcePath, data);
      return { replaced: true, index: idx };
    }
    data.history.push(historyEntry);
    writeJsonData(this.sourcePath, data);
    return { replaced: false, index: data.history.length - 1 };
  }
}

module.exports = { StreamerRepository };
