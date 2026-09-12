const readline = require('readline/promises');
const { parseVodUrl, makeDebugLogger } = require('./utils');
const { TimelineCommentParser } = require('./timelineCommentParser');
const { SongResolver } = require('./songResolver');

/** Extract YYYY-MM-DD from broad_start or write_tm. */
function extractBroadcastDate(vodInfo) {
  const s = vodInfo.broad_start || vodInfo.write_tm || '';
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[0];
  if (typeof s === 'number') return new Date(s * 1000).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Orchestrates one VOD import: fetch VOD info + comments (SoopApi) -> parse (TimelineCommentParser)
 * -> resolve against reference data (SongResolver) -> merge into the streamer's source.json (StreamerRepository).
 */
class VodImportPipeline {
  /**
   * @param {import('./soopApi').SoopApi} soopApi
   * @param {import('./songReferenceCatalog').SongReferenceCatalog} catalog - shared across streamers/VODs in one run
   */
  constructor(soopApi, catalog) {
    this.soopApi = soopApi;
    this.catalog = catalog;
  }

  /**
   * @param {string|number} videoId
   * @returns {Promise<object|null>} - VOD info data or null
   */
  async getVodInfo(videoId) {
    const res = await this.soopApi.getSoopVodInfo(videoId);
    return res && res.result === 1 && res.data ? res.data : null;
  }

  /**
   * @param {string|number} videoId
   * @param {object} vodInfo - from getVodInfo (station_no, bbs_no, board_type, bj_id)
   * @returns {Promise<Array<{ comment: string }>>}
   */
  async _getComments(videoId, vodInfo) {
    const list = await this.soopApi.getSoopParentCommentsInVod(videoId, {
      stationNo: vodInfo.station_no,
      bbsNo: vodInfo.bbs_no,
      bjId: vodInfo.bj_id,
      boardType: vodInfo.board_type,
    });
    return list || [];
  }

  /**
   * Full pipeline: URL -> fetch VOD + comments -> parse (streamer-specific) -> resolve -> merge.
   * @param {string} vodUrl - https://vod.sooplive.com/player/{videoId}
   * @param {import('./streamerRepository').StreamerRepository} repository - target streamer's archive
   * @param {object|null} [preloadedVodInfo] - if set, skip getVodInfo (same object as returned by getVodInfo)
   * @returns {Promise<{ videoId: string, title: string, date: string, songCount: number, replaced: boolean }>}
   */
  async run(vodUrl, repository, preloadedVodInfo = null) {
    const parsed = parseVodUrl(vodUrl);
    if (!parsed) {
      throw new Error('Invalid URL. Use: https://vod.sooplive.com/player/{videoId} or https://vod.sooplive.co.kr/player/{videoId}');
    }

    const { videoId } = parsed;
    const vodInfo = preloadedVodInfo != null ? preloadedVodInfo : await this.getVodInfo(videoId);
    if (!vodInfo) throw new Error(`Failed to fetch VOD info for ${videoId}`);

    const comments = await this._getComments(videoId, vodInfo);
    const config = repository.getConfig();
    const parseConfig = repository.getParseConfig();
    const COMMENT_AUTHOR_ID = config.commentAuthorId;
    const debug = config.debug;
    const dbg = makeDebugLogger(debug);

    dbg('streamer:', repository.streamerId);
    dbg('댓글 총 개수:', comments.length);
    dbg('comment_author_id:', COMMENT_AUTHOR_ID || '(비어 있음)');

    // 같은 프로세스 내 다른 VOD가 방금 등록한 title/artist를 반영하도록 항상 최신 상태로 맞춘다.
    this.catalog.reload();

    const interactive = !!(process.stdin.isTTY && !process.env.ADD_VOD_NON_INTERACTIVE);
    const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

    const parser = new TimelineCommentParser(parseConfig, debug);
    const resolver = new SongResolver({ catalog: this.catalog, repository, rl, interactive, debug });

    let songInfo = [];
    let thumb = vodInfo.thumb || '';
    try {
      for (const c of comments) {
        if (!COMMENT_AUTHOR_ID || !COMMENT_AUTHOR_ID.includes(c.user_id || '')) continue;
        dbg('--- comment_author_id 댓글 파싱 시작 ---');
        const rawItems = parser.parseComment(c.comment);
        const parsedList = await resolver.resolveAll(rawItems);
        dbg('--- 파싱 완료 → 곡 수:', parsedList.length);
        if (parsedList.length > 0) {
          dbg('파싱된 곡:', parsedList.map((p) => `${p.title}${p.artist ? ` (${p.artist})` : ''} ${p.time}`));
        }
        songInfo = songInfo.concat(parsedList);
      }

      if (!String(thumb).trim()) {
        const override = this.catalog.getThumbnailOverride(videoId);
        if (override && String(override).trim()) {
          thumb = String(override).trim();
          dbg('썸네일 override 매핑 사용:', thumb);
        } else {
          console.warn(
            `[경고] VOD ${videoId} 썸네일을 API에서 가져오지 못했습니다(권한 부족 등으로 공백). ` +
              `songArchives/common/data/thumbnailOverrides.json 에도 이 videoId 항목이 없습니다.`
          );
          if (rl) await rl.question('썸네일 없이 계속 진행하려면 Enter를 누르세요: ');
        }
      }
    } finally {
      if (rl) rl.close();
    }

    dbg('합친 songInfo 개수:', songInfo.length);
    if (songInfo.length === 0 && comments.length > 0) {
      dbg('comment_author_id 댓글이 없거나 linePrefix 형식이 아님. config/parseConfig 확인.');
    }

    const date = extractBroadcastDate(vodInfo);
    const title = vodInfo.full_title || vodInfo.title || '';
    const url = `https://vod.sooplive.com/player/${videoId}`;

    const historyEntry = { title, date, url, thumbnail: thumb, songInfo };
    const { replaced } = repository.mergeVod(historyEntry);

    return { videoId, title, date, songCount: songInfo.length, replaced };
  }
}

module.exports = { VodImportPipeline };
