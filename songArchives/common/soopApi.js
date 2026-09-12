/**
 * Soop public API client. Ported from VOD-Master `src/.test/soop_api_standalone.js` (class SoopAPI).
 * Only what the addVod pipeline needs is kept: VOD info lookup + full comment pagination.
 */

const REQUEST_CACHE_TTL_MS = 60 * 1000;

const SOOP_URLS = {
  VOD_ORIGIN: 'https://vod.sooplive.com',
  STBBS_ORIGIN: 'https://stbbs.sooplive.com',
  API_M_ORIGIN: 'https://api.m.sooplive.com',
};

class SoopApi {
  constructor() {
    /** @type {Map<string, { data: any, expiresAt: number }>} */
    this._requestCache = new Map();
  }

  _getCached(key) {
    const entry = this._requestCache.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.data;
  }

  _setCache(key, data) {
    this._requestCache.set(key, { data, expiresAt: Date.now() + REQUEST_CACHE_TTL_MS });
  }

  /**
   * @param {number|string} videoId
   * @param {{ referer?: string }} [opts]
   * @returns {Promise<{ result: number, data?: object, message?: string }|null>}
   */
  async getSoopVodInfo(videoId, opts = {}) {
    const referer =
      typeof opts.referer === 'string' && opts.referer.length > 0
        ? opts.referer
        : `${SOOP_URLS.VOD_ORIGIN}/player/${videoId}`;
    const cacheKey = `getSoopVodInfo:${videoId}`;
    const cached = this._getCached(cacheKey);
    if (cached !== null) return cached;

    const res = await fetch(`${SOOP_URLS.API_M_ORIGIN}/station/video/a/view`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded',
        Referer: referer,
      },
      body: `nTitleNo=${videoId}&nApiLevel=11&nPlaylistIdx=0`,
    });
    if (res.status !== 200) return null;
    const b = await res.json();
    this._setCache(cacheKey, b);
    return b;
  }

  /**
   * VOD 댓글 한 페이지 조회 (bbs_memo_action szAction=get).
   * @returns {Promise<object|null>}
   */
  async getSoopCommentInVod(videoId, streamerId, opts = {}) {
    const { stationNo, bbsNo, boardType = 105, pageNo = 1, orderNo = 1, lastNo = 0 } = opts;
    if (stationNo == null || bbsNo == null || !streamerId) return null;

    const tn = String(videoId);
    const referer = `${SOOP_URLS.VOD_ORIGIN}/player/${tn}`;
    const body = new URLSearchParams({
      nStationNo: String(stationNo),
      nBbsNo: String(bbsNo),
      nTitleNo: tn,
      bj_id: String(streamerId),
      nPageNo: String(pageNo),
      nOrderNo: String(orderNo),
      nBoardType: String(boardType),
      szAction: 'get',
      nVod: '1',
      nLastNo: String(lastNo),
    });

    const res = await fetch(`${SOOP_URLS.STBBS_ORIGIN}/api/bbs_memo_action.php`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/x-www-form-urlencoded',
        Referer: referer,
      },
      body: body.toString(),
    });
    if (res.status !== 200) return null;
    try {
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  /**
   * VOD 부모 댓글 전체를 페이지네이션으로 모아 반환.
   * @param {string|number} videoId
   * @param {{ stationNo?: string|number, bbsNo?: string|number, bjId?: string, boardType?: string|number }} [opts] - 미리 알고 있으면 VOD 정보 재조회 생략
   * @returns {Promise<object[]|null>}
   */
  async getSoopParentCommentsInVod(videoId, opts = {}) {
    let { stationNo, bbsNo, bjId, boardType } = opts;

    if (stationNo == null || bbsNo == null || !bjId) {
      const vodInfo = await this.getSoopVodInfo(videoId);
      const data = vodInfo?.data;
      if (!data || vodInfo?.result !== 1) return null;
      stationNo = stationNo ?? data.station_no;
      bbsNo = bbsNo ?? data.bbs_no;
      bjId = bjId || data.bj_id;
      boardType = boardType ?? data.board_type ?? 105;
    }
    boardType = boardType ?? 105;
    if (stationNo == null || bbsNo == null || !bjId) return null;

    const all = [];
    let pageNo = 1;
    let lastNo = 0;
    const maxPages = 100;

    for (let i = 0; i < maxPages; i++) {
      const page = await this.getSoopCommentInVod(videoId, bjId, { stationNo, bbsNo, boardType, pageNo, lastNo });
      const channel = page?.CHANNEL;
      const pageOk =
        channel && [channel.RESULT, channel.result].some((v) => v === 1 || v === true || String(v) === '1');
      if (!pageOk) {
        if (i === 0) return null;
        break;
      }
      const list = Array.isArray(channel.DATA?.list_data) ? channel.DATA.list_data : [];
      all.push(...list);
      if (channel.DATA?.has_more !== true || list.length === 0) break;
      const nextLast = Number(list[list.length - 1]?.p_comment_no);
      if (!Number.isFinite(nextLast) || nextLast === lastNo) break;
      lastNo = nextLast;
      pageNo += 1;
    }
    return all;
  }
}

module.exports = { SoopApi };
