const { makeDebugLogger } = require('./utils');

const DEFAULT_PARSE_CONFIG = {
  linePrefix: '🎤',
  linePrefixRules: null,
  parts: {
    songTitle: '(.+?)',
    songArtist: '\\s*\\(([^)]*)\\)',
    time: '(\\d{1,2}:\\d{1,2}(?::\\d{1,2})?)',
  },
  regexSequence: '{songTitle}{songArtist?}\\s*{time}',
};

/** Flag symbols that may trail a parsed timeline line (after parts). */
const TIMELINE_FLAG_SYMBOL_CLASS = '☆★○●□■※?';

/** Decode common HTML entities in text (e.g. API returns "You &amp; I"). */
function decodeHtmlEntities(s) {
  if (!s || typeof s !== 'string') return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Build regex and group order from a single sequence string.
 * Placeholder {name} = required part; {name?} = optional part (wrapped in (?:...)?, one capture when present).
 * @param {string} sequenceStr - e.g. "{songTitle}{songArtist?}\\s*{time}"
 * @param {Record<string, string>} parts - e.g. { songTitle: "(.+?)", ... }
 * @returns {{ regex: RegExp, groupNames: string[] }}
 */
function buildRegexFromSequence(sequenceStr, parts) {
  const groupNames = [];
  const regexStr = sequenceStr.replace(/\{(\w+)(\?)?\}/g, (_, name, optional) => {
    groupNames.push(name);
    const part = parts[name] != null ? parts[name] : '';
    if (optional) return part ? '(?:' + part + ')?' : '';
    return part;
  });
  return { regex: new RegExp(regexStr), groupNames };
}

/**
 * Build line-prefix based parse rules.
 * Legacy config (linePrefix + regexSequence) stays supported.
 * @param {{ linePrefix?: string, linePrefixRules?: Array<Record<string, unknown>>, parts?: Record<string, string>, regexSequence?: string }} parseConfig
 * @returns {Array<{ linePrefix: string, parts: Record<string, string>, regexSequence: string, staticFields: Record<string, unknown> }>}
 */
function getLinePrefixRules(parseConfig) {
  const cfg = parseConfig || DEFAULT_PARSE_CONFIG;
  const defaultParts = cfg.parts || DEFAULT_PARSE_CONFIG.parts;

  if (Array.isArray(cfg.linePrefixRules) && cfg.linePrefixRules.length > 0) {
    const rules = [];
    for (const rule of cfg.linePrefixRules) {
      if (!rule || typeof rule !== 'object') continue;
      const linePrefix = typeof rule.linePrefix === 'string' ? rule.linePrefix : '';
      if (!linePrefix) continue;
      rules.push({
        linePrefix,
        parts: rule.parts && typeof rule.parts === 'object' ? { ...defaultParts, ...rule.parts } : defaultParts,
        regexSequence:
          typeof rule.regexSequence === 'string'
            ? rule.regexSequence
            : typeof cfg.regexSequence === 'string'
              ? cfg.regexSequence
              : DEFAULT_PARSE_CONFIG.regexSequence,
        staticFields:
          rule.staticFields && typeof rule.staticFields === 'object' && !Array.isArray(rule.staticFields)
            ? rule.staticFields
            : {},
      });
    }
    if (rules.length > 0) return rules;
  }

  return [
    {
      linePrefix: typeof cfg.linePrefix === 'string' ? cfg.linePrefix : DEFAULT_PARSE_CONFIG.linePrefix,
      parts: defaultParts,
      regexSequence: typeof cfg.regexSequence === 'string' ? cfg.regexSequence : DEFAULT_PARSE_CONFIG.regexSequence,
      staticFields: {},
    },
  ];
}

/**
 * Parses one streamer's comment HTML into raw song entries (title/time/artist/flags),
 * using that streamer's parseConfig. Does NOT cross-reference title/artist reference data —
 * that's SongResolver's job. A line is recognized if it contains linePrefix (anywhere);
 * all occurrences of linePrefix are removed and the rest is parsed via regexSequence + parts.
 */
class TimelineCommentParser {
  /**
   * @param {object} parseConfig - streamer parseConfig (from StreamerRepository.getParseConfig())
   * @param {boolean} [debug]
   */
  constructor(parseConfig, debug = false) {
    this.parseConfig = parseConfig || DEFAULT_PARSE_CONFIG;
    this.debug = debug;
    this.dbg = makeDebugLogger(debug);
    this.rules = getLinePrefixRules(this.parseConfig);
  }

  /**
   * Parse one line (without linePrefix, already stripped) using one matched rule.
   * @param {string} line
   * @param {{ parts: Record<string, string>, regexSequence: string, staticFields?: Record<string, unknown> }} rule
   * @returns {object|null} { title, time, artist, noMistake?, recommended?, needsReview?, groupMembers? } or null
   */
  parseLine(line, rule) {
    const dbg = this.dbg;
    line = line.replace(/\s+/g, ' ').trim();
    dbg('parseTimelineLine 입력:', JSON.stringify(line));
    if (!line) return null;

    const parts = rule.parts || DEFAULT_PARSE_CONFIG.parts;
    const commentPattern = parts.comment;
    let lineWithoutComment = line;
    if (typeof commentPattern === 'string' && commentPattern.trim() !== '') {
      try {
        lineWithoutComment = lineWithoutComment.replace(new RegExp(commentPattern, 'g'), '').trim();
        if (line !== lineWithoutComment) dbg('  comment 제거 후:', JSON.stringify(lineWithoutComment));
      } catch (err) {
        dbg('  comment 정규식 오류:', err && err.message ? err.message : String(err));
      }
    }
    if (!lineWithoutComment) return null;

    const seq = rule.regexSequence || DEFAULT_PARSE_CONFIG.regexSequence;
    const { regex, groupNames } = buildRegexFromSequence(seq, parts);
    // `$` 로 끝나는 시퀀스도 뒤에 오는 flag 심볼을 허용해 파트 매칭이 되도록 한다.
    const matchRegex = regex.source.endsWith('$')
      ? new RegExp(regex.source.slice(0, -1) + '[\\s' + TIMELINE_FLAG_SYMBOL_CLASS + ']*$')
      : regex;
    dbg('  regexSequence:', seq, '→ 정규식:', matchRegex.source);

    const m = lineWithoutComment.match(matchRegex);
    if (!m) {
      dbg('  매칭 실패');
      return null;
    }

    const result = {};
    groupNames.forEach((name, i) => {
      result[name] = (m[i + 1] || '').trim();
    });
    dbg('  캡처:', result);

    // 파싱된 파트 값을 모두 제거한 나머지에서만 flag를 찾는다.
    let remainder = lineWithoutComment;
    const partValues = groupNames
      .map((name) => result[name])
      .filter((v) => v)
      .sort((a, b) => b.length - a.length);
    for (const value of partValues) {
      const idx = remainder.indexOf(value);
      if (idx !== -1) remainder = remainder.slice(0, idx) + remainder.slice(idx + value.length);
    }
    remainder = remainder.trim();

    const needsReview = remainder.includes('?');
    const recommended = /[☆★]/.test(remainder);
    const noMistake = /[○●]/.test(remainder);
    dbg('  파트 제거 후 나머지:', JSON.stringify(remainder));
    dbg('  심볼 → noMistake:', noMistake, 'recommended:', recommended, 'needsReview:', needsReview);

    const title = decodeHtmlEntities((result.songTitle || '').replace(/\\:/g, ':'));
    const artist = (result.songArtist || '').trim();
    const timeStr = (result.time || '').trim();
    if (!title || !timeStr) {
      dbg('  제목/시간 없음 → 스킵');
      return null;
    }

    const info = {
      title,
      time: timeStr,
      artist: artist || null,
      ...(noMistake ? { noMistake: true } : {}),
      ...(recommended ? { recommended: true } : {}),
      ...(needsReview ? { needsReview: true } : {}),
    };
    const groupMembers = (result.groupMembers || '').trim();
    if (groupMembers) info.groupMembers = groupMembers;
    if (rule.staticFields && typeof rule.staticFields === 'object') Object.assign(info, rule.staticFields);

    dbg('  결과(raw):', info);
    return info;
  }

  /**
   * @param {string} commentHtml - e.g. "🎤 Square 3:25:43 <br />\\n..."
   * @returns {Array<object>} raw parsed entries (with `rawLine` kept, no reference-resolve, no dedup)
   */
  parseComment(commentHtml) {
    const dbg = this.dbg;
    if (!commentHtml || typeof commentHtml !== 'string') return [];

    const lines = commentHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (this.debug) {
      dbg('parseComment: linePrefixes=', JSON.stringify(this.rules.map((r) => r.linePrefix)), '줄 수=', lines.length);
    }

    const items = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matchedRule = this.rules.find((rule) => line.includes(rule.linePrefix));
      if (!matchedRule) {
        if (line.length < 80) dbg('  줄', i + 1, '→ linePrefix 없음, 스킵:', JSON.stringify(line.slice(0, 60)));
        continue;
      }
      const lineWithoutPrefix = line.split(matchedRule.linePrefix).join('').trim();
      dbg(
        '  줄',
        i + 1,
        `→ linePrefix(${JSON.stringify(matchedRule.linePrefix)}) 제거 후:`,
        JSON.stringify(lineWithoutPrefix.slice(0, 80))
      );
      const info = this.parseLine(lineWithoutPrefix, matchedRule);
      // 원본 줄(prefix 포함, 파싱 전 원문) 보존 — source.json에만 남기고 songs.js엔 안 실림
      if (info) {
        info.rawLine = line;
        items.push(info);
      }
    }
    return items;
  }
}

module.exports = { TimelineCommentParser, DEFAULT_PARSE_CONFIG };
