const fs = require('fs');
const path = require('path');
const { nonEmptyStr, normalizeSoopUserId } = require('./utils');
const { StreamerRepository } = require('./streamerRepository');

/**
 * Soop VOD 메타에는 아직 `writer_id` 필드명으로 오는 스트리머(BJ) 식별자가 들어 있음 → 여기서는 vod_streamer_id 등으로 취급.
 * 아카이브 매칭 후보: config `streamer_id`(선택), 레거시 `soopWriterId`, `comment_author_id`, 레거시 `authorUserId`, 폴더 이름.
 * @param {Record<string, unknown>} cfg
 * @param {string} folderName - songArchives 직하위 폴더명
 * @returns {Set<string>} normalized ids
 */
function collectArchiveStreamerMatchKeys(cfg, folderName) {
  const keys = new Set();
  const add = (v) => {
    const n = normalizeSoopUserId(v);
    if (n) keys.add(n);
  };
  for (const field of ['streamer_id', 'soopWriterId', 'comment_author_id', 'authorUserId']) {
    if (nonEmptyStr(cfg[field])) add(cfg[field]);
  }
  add(folderName);
  return keys;
}

/**
 * Scans `songArchives/` for configured streamer folders and matches a VOD's streamer id
 * (Soop API `writer_id`/`bj_id`) to a {@link StreamerRepository}.
 */
class ArchiveRegistry {
  constructor(songArchivesRoot) {
    this.songArchivesRoot = songArchivesRoot;
  }

  /**
   * List `songArchives/{id}` dirs that have `data/config.json` (excludes `common`).
   * @returns {string[]}
   */
  listConfiguredIds() {
    const ids = [];
    let entries;
    try {
      entries = fs.readdirSync(this.songArchivesRoot, { withFileTypes: true });
    } catch {
      return ids;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'common') continue;
      if (fs.existsSync(path.join(this.songArchivesRoot, e.name, 'data', 'config.json'))) ids.push(e.name);
    }
    return ids;
  }

  /**
   * Soop VOD 응답의 스트리머 id(`writer_id`/`bj_id` 필드 값)로 아카이브 결정.
   * @param {string|number} vodStreamerId
   * @returns {{ repository: StreamerRepository } | { repository: null, reason: 'none'|'ambiguous'|'no_vod_streamer_id', matches: string[], configuredIds: string[] }}
   */
  resolve(vodStreamerId) {
    const w = normalizeSoopUserId(vodStreamerId);
    const configuredIds = this.listConfiguredIds();
    if (!w) {
      return { repository: null, reason: 'no_vod_streamer_id', matches: [], configuredIds };
    }
    const matches = [];
    for (const id of configuredIds) {
      const p = path.join(this.songArchivesRoot, id, 'data', 'config.json');
      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        continue;
      }
      if (collectArchiveStreamerMatchKeys(cfg, id).has(w)) matches.push(id);
    }
    if (matches.length === 1) return { repository: new StreamerRepository(this.songArchivesRoot, matches[0]) };
    if (matches.length === 0) return { repository: null, reason: 'none', matches: [], configuredIds };
    return { repository: null, reason: 'ambiguous', matches, configuredIds };
  }

  /**
   * `--streamer` 로 강제 지정한 id를 실제 폴더명과 대조(대소문자 무관).
   * @param {string} forcedRawId
   * @returns {{ repository: StreamerRepository } | { repository: null, configuredIds: string[] }}
   */
  resolveForced(forcedRawId) {
    const configuredIds = this.listConfiguredIds();
    const normalizedForced = normalizeSoopUserId(forcedRawId);
    const matched = configuredIds.find((id) => normalizeSoopUserId(id) === normalizedForced);
    if (matched) return { repository: new StreamerRepository(this.songArchivesRoot, matched) };
    return { repository: null, configuredIds };
  }
}

module.exports = { ArchiveRegistry };
