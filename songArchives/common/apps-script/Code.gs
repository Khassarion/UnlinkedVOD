/**
 * 노래 기록 커뮤니티 제출용 Google Apps Script
 *
 * 설정:
 * 1. 스프레드시트를 만들고 확장 프로그램 > Apps Script 에 Code.gs / appsscript.json 반영
 * 2. appsscript.json 스코프:
 *      https://www.googleapis.com/auth/spreadsheets
 *      https://www.googleapis.com/auth/script.external_request
 * 3. 외부 요청 권한 승인 (팝업이 안 뜰 때 포함):
 *    A) 편집기에서 doGet 실행(매개변수 없음). 권한 오류가 나면 실행 로그의
 *       authUrl 을 브라우저로 열어 허용
 *    B) 또는 배포 URL 을 본인 계정으로 직접 열기:
 *       .../exec?action=authorize
 * 4. 아래 SPREADSHEET_ID 를 시트 ID로 바꾸거나, 시트에 바인딩된 컨테이너 스크립트로 사용
 * 5. 배포 > 새 배포(또는 기존 배포 수정) > 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: 모든 사용자
 * 6. 배포 URL 을 songArchives/common/community-data.js 의
 *    COMMUNITY_SHEETS_WEB_APP_URL 또는 각 페이지 SONG_ARCHIVE_PAGE.sheetsWebAppUrl 에 넣기
 *
 * API:
 *   GET  ?action=songs&streamerId=churahee
 *   GET  ?action=vod_info&videoId=199397037
 *   GET  ?action=authorize   → 권한 상태/승인 URL
 *   POST { action: "submit_song", ... }
 */

var SPREADSHEET_ID = ''; // 컨테이너 바인딩이면 비워도 됨
var SHEET_NAME = 'requests';

var HEADERS = [
  'streamerId',
  'submittedAt',
  'status',
  'vodTitle',
  'date',
  'vodUrl',
  'thumbnail',
  'songTitle',
  'time',
  'artist',
  'noMistake',
  'recommended',
  'needsReview',
  'groupSong',
  'groupMembers',
  'note',
];

function doGet(e) {
  e = e || {};
  var params = e.parameter || {};
  var hasParams = false;
  for (var key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      hasParams = true;
      break;
    }
  }

  var action = hasParams ? String(params.action || 'songs') : 'authorize';

  // 권한 확인/승인 — try/catch 밖에서 처리해야 편집기 승인 UI가 뜰 수 있음
  if (action === 'authorize' || action === 'auth_status') {
    return handleAuthorizeGet_(action === 'auth_status');
  }

  try {
    if (action === 'songs') {
      var streamerId = String(params.streamerId || '').trim();
      if (!streamerId) {
        return jsonResponse_({ ok: false, error: 'missing_streamerId' });
      }
      var includePending = String(params.includePending || '') === '1';
      var history = buildHistoryForStreamer_(streamerId, includePending);
      return jsonResponse_({
        ok: true,
        streamerId: streamerId,
        history: history,
        count: countSongsInHistory_(history),
        updatedAt: new Date().toISOString(),
      });
    }

    if (action === 'vod_info') {
      var videoId = String(params.videoId || '').trim();
      if (!videoId) {
        videoId = extractVideoId_(params.vodUrl || params.url || '');
      }
      if (!videoId) {
        return jsonResponse_({ ok: false, error: 'missing_videoId' });
      }
      try {
        var info = fetchSoopVodInfo_(videoId);
        if (!info) {
          return jsonResponse_({ ok: false, error: 'vod_info_failed', videoId: videoId });
        }
        return jsonResponse_({
          ok: true,
          videoId: videoId,
          vodTitle: info.vodTitle,
          date: info.date,
          thumbnail: info.thumbnail,
          url: 'https://vod.sooplive.com/player/' + videoId,
        });
      } catch (fetchErr) {
        var auth = getAuthInfoPayload_();
        return jsonResponse_({
          ok: false,
          error: 'urlfetch_unauthorized',
          detail: String(fetchErr && fetchErr.message ? fetchErr.message : fetchErr),
          videoId: videoId,
          authUrl: auth.authUrl,
          authStatus: auth.authStatus,
        });
      }
    }

    if (action === 'ping') {
      return jsonResponse_({ ok: true, message: 'pong' });
    }

    return jsonResponse_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    if (isAuthorizationError_(err)) {
      // 편집기 Run 시 승인 팝업을 위해 권한 오류는 다시 던짐
      throw err;
    }
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function getAuthInfoPayload_() {
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  var status = authInfo.getAuthorizationStatus();
  var authUrl = '';
  try {
    authUrl = authInfo.getAuthorizationUrl() || '';
  } catch (ignore) {
    authUrl = '';
  }
  return {
    authStatus: String(status),
    authUrl: authUrl,
  };
}

function handleAuthorizeGet_(statusOnly) {
  var auth = getAuthInfoPayload_();
  if (statusOnly) {
    return jsonResponse_({
      ok: true,
      action: 'auth_status',
      authStatus: auth.authStatus,
      authUrl: auth.authUrl,
    });
  }

  // REQUIRED 이면 UrlFetch 전에 승인 URL을 먼저 돌려줌 (팝업이 안 뜨는 환경 대응)
  if (auth.authStatus === String(ScriptApp.AuthorizationStatus.REQUIRED) && auth.authUrl) {
    return jsonResponse_({
      ok: false,
      error: 'authorization_required',
      message: '아래 authUrl 을 브라우저에서 열어 권한을 허용한 뒤, 웹 앱을 새 버전으로 배포하세요.',
      authUrl: auth.authUrl,
      authStatus: auth.authStatus,
    });
  }

  // 편집기에서 이 경로가 권한 오류를 throw 하면 승인 UI가 뜸 (절대 catch 하지 말 것)
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  getOrCreateSheet_();

  return jsonResponse_({
    ok: true,
    message: 'authorization_ready',
    authStatus: auth.authStatus,
    authUrl: auth.authUrl,
    hint: '권한이 준비되었습니다. 웹 앱을 새 버전으로 배포한 뒤 페이지에서 다시 시도하세요.',
  });
}

function isAuthorizationError_(err) {
  var msg = String(err && err.message ? err.message : err);
  return (
    msg.indexOf('권한이 없습니다') >= 0 ||
    msg.indexOf('permission') >= 0 ||
    msg.indexOf('Authorization') >= 0 ||
    msg.indexOf('external_request') >= 0 ||
    msg.indexOf('Authorization is required') >= 0
  );
}

function doPost(e) {
  try {
    var body = parsePostBody_(e);
    var action = String(body.action || 'submit_song');

    if (action === 'submit_song') {
      var result = appendSongSubmission_(body);
      return jsonResponse_(result);
    }

    return jsonResponse_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function parsePostBody_(e) {
  if (!e || !e.postData || e.postData.contents == null) {
    throw new Error('empty_body');
  }
  var raw = String(e.postData.contents);
  if (!raw) throw new Error('empty_body');
  var parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_json');
  }
  return parsed;
}

function appendSongSubmission_(body) {
  var streamerId = String(body.streamerId || '').trim();
  var vodUrl = normalizeVodUrl_(body.vodUrl || body.url || '');
  var songTitle = String(body.songTitle || body.title || '').trim();
  var time = String(body.time || '').trim();
  var videoId = extractVideoId_(vodUrl);

  if (!streamerId) return { ok: false, error: 'missing_streamerId' };
  if (!vodUrl || !videoId) return { ok: false, error: 'missing_vodUrl' };
  if (!songTitle) return { ok: false, error: 'missing_songTitle' };
  if (!time) return { ok: false, error: 'missing_time' };
  if (!isValidTime_(time)) return { ok: false, error: 'invalid_time' };

  vodUrl = 'https://vod.sooplive.com/player/' + videoId;
  var vodTitle = String(body.vodTitle || body.videoTitle || '').trim();
  var date = String(body.date || '').trim();
  var thumbnail = String(body.thumbnail || '').trim();

  // Soop API 우선. 권한/네트워크 문제 시 클라이언트가 보낸 값 사용
  try {
    var soop = fetchSoopVodInfo_(videoId);
    if (soop) {
      if (soop.vodTitle) vodTitle = soop.vodTitle;
      if (soop.date) date = soop.date;
      if (soop.thumbnail) thumbnail = soop.thumbnail;
    }
  } catch (err) {
    // keep client-provided fields
  }

  if (!date || !isValidDate_(date)) return { ok: false, error: 'missing_or_invalid_date' };
  if (!vodTitle) vodTitle = '(제목 없음)';

  var sheet = getOrCreateSheet_();
  ensurePlainTextColumns_(sheet);
  var artist = String(body.artist || '').trim();
  var groupMembers = String(body.groupMembers || '').trim();
  var note = String(body.note || '').trim().slice(0, 500);
  var row = [
    neutralizeSheetFormula_(streamerId),
    neutralizeSheetFormula_(new Date().toISOString()),
    'approved',
    neutralizeSheetFormula_(vodTitle),
    neutralizeSheetFormula_(date),
    neutralizeSheetFormula_(vodUrl),
    neutralizeSheetFormula_(thumbnail),
    neutralizeSheetFormula_(songTitle),
    neutralizeSheetFormula_(time),
    neutralizeSheetFormula_(artist),
    toBool01_(body.noMistake),
    toBool01_(body.recommended),
    1, // 커뮤니티 제출은 항상 검토 필요
    toBool01_(body.groupSong),
    neutralizeSheetFormula_(groupMembers),
    neutralizeSheetFormula_(note),
  ];

  sheet.appendRow(row);
  var lastRow = sheet.getLastRow();
  // Sheets 가 날짜/시간을 Date 로 자동 변환하지 않도록 텍스트로 재기록
  sheet.getRange(lastRow, HEADERS.indexOf('date') + 1).setNumberFormat('@').setValue(neutralizeSheetFormula_(date));
  sheet.getRange(lastRow, HEADERS.indexOf('time') + 1).setNumberFormat('@').setValue(neutralizeSheetFormula_(time));

  return {
    ok: true,
    row: lastRow,
    streamerId: streamerId,
    vodTitle: vodTitle,
    date: date,
    thumbnail: thumbnail,
    vodUrl: vodUrl,
    time: time,
  };
}

function extractVideoId_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  var m = s.match(/vod\.sooplive\.(?:com|co\.kr)\/player\/(\d+)/i);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return '';
}

/**
 * soopPipeline.getSoopVodInfo / getBroadcastDate 와 동일한 소스.
 * @returns {{ vodTitle: string, date: string, thumbnail: string }|null}
 */
function fetchSoopVodInfo_(videoId) {
  videoId = String(videoId || '').trim();
  if (!videoId) return null;

  var endpoint = 'https://api.m.sooplive.com/station/video/a/view';
  var res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: {
      accept: 'application/json, text/plain, */*',
      Referer: 'https://vod.sooplive.com/player/' + videoId,
    },
    payload: 'nTitleNo=' + encodeURIComponent(videoId) + '&nApiLevel=11&nPlaylistIdx=0',
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) return null;

  var json;
  try {
    json = JSON.parse(res.getContentText());
  } catch (err) {
    return null;
  }
  if (!json || json.result !== 1 || !json.data) return null;

  var data = json.data;
  var vodTitle = String(data.full_title || data.title || '').trim();
  var thumbnail = String(data.thumb || '').trim();
  var date = getBroadcastDate_(data);

  return {
    vodTitle: vodTitle,
    date: date,
    thumbnail: thumbnail,
  };
}

function getBroadcastDate_(vodInfo) {
  var s = vodInfo.broad_start || vodInfo.write_tm || '';
  if (typeof s === 'number') {
    return new Date(s * 1000).toISOString().slice(0, 10);
  }
  var str = String(s || '');
  var match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[0];
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function buildHistoryForStreamer_(streamerId, includePending) {
  var sheet = getOrCreateSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var header = values[0].map(function (h) {
    return String(h || '').trim();
  });
  var idx = indexMap_(header);
  var byVod = {};

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rowStreamer = String(cell_(row, idx.streamerId) || '').trim();
    if (rowStreamer !== streamerId) continue;

    var status = String(cell_(row, idx.status) || 'approved').trim().toLowerCase();
    if (status === 'rejected' || status === 'spam') continue;
    if (!includePending && status === 'pending') continue;

    var vodUrl = normalizeVodUrl_(cell_(row, idx.vodUrl));
    var songTitle = String(cell_(row, idx.songTitle) || '').trim();
    var time = formatSheetTime_(cell_(row, idx.time));
    if (!vodUrl || !songTitle || !time) continue;

    var date = formatSheetDate_(cell_(row, idx.date));
    var vodTitle = String(cell_(row, idx.vodTitle) || '').trim();
    var thumbnail = String(cell_(row, idx.thumbnail) || '').trim();
    if (!date) continue;

    if (!byVod[vodUrl]) {
      byVod[vodUrl] = {
        title: vodTitle,
        date: date,
        url: vodUrl,
        thumbnail: thumbnail,
        songInfo: [],
      };
    } else {
      if (!byVod[vodUrl].title && vodTitle) byVod[vodUrl].title = vodTitle;
      if (!byVod[vodUrl].date && date) byVod[vodUrl].date = date;
      if (!byVod[vodUrl].thumbnail && thumbnail) byVod[vodUrl].thumbnail = thumbnail;
    }

    var song = {
      title: songTitle,
      time: time,
      artist: String(cell_(row, idx.artist) || '').trim(),
    };

    if (asBool_(cell_(row, idx.noMistake))) song.noMistake = true;
    if (asBool_(cell_(row, idx.recommended))) song.recommended = true;
    if (asBool_(cell_(row, idx.needsReview))) song.needsReview = true;
    if (asBool_(cell_(row, idx.groupSong))) {
      song.groupSong = true;
      var members = String(cell_(row, idx.groupMembers) || '').trim();
      if (members) song.groupMembers = members;
    }

    byVod[vodUrl].songInfo.push(song);
  }

  return Object.keys(byVod).map(function (key) {
    return byVod[key];
  });
}

function getOrCreateSheet_() {
  var ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('spreadsheet_not_found');
  }

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    ensurePlainTextColumns_(sheet);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  ensurePlainTextColumns_(sheet);
  return sheet;
}

/** date/time 열이 Date 로 자동변환되지 않도록 텍스트 서식 */
function ensurePlainTextColumns_(sheet) {
  var dateCol = HEADERS.indexOf('date') + 1;
  var timeCol = HEADERS.indexOf('time') + 1;
  var lastRow = Math.max(sheet.getMaxRows(), 2);
  sheet.getRange(2, dateCol, lastRow, dateCol).setNumberFormat('@');
  sheet.getRange(2, timeCol, lastRow, timeCol).setNumberFormat('@');
}

/**
 * 시트 수식 인젝션 방지: = + - @ 또는 탭/CR 로 시작하면 텍스트로 강제.
 * Sheets getValue/getDisplayValue 에서는 선행 ' 가 보통 보이지 않음.
 */
function neutralizeSheetFormula_(value) {
  var s = String(value == null ? '' : value);
  if (!s) return s;
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

/** Sheets Date / 문자열 → yyyy-MM-dd */
function formatSheetDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var s = String(value == null ? '' : value).trim();
  if (!s) return '';
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return '';
}

/** Sheets Date(시각) / 문자열 → H:mm:ss 또는 m:ss */
function formatSheetTime_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'H:mm:ss');
  }
  var s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^(\d{1,2}:)?\d{1,2}:\d{1,2}$/.test(s)) return s;
  var m = s.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
  if (m) {
    var h = Number(m[1]);
    var mm = m[2];
    var ss = m[3];
    if (h > 0) return h + ':' + mm + ':' + ss;
    return Number(mm) + ':' + ss;
  }
  if (/^\d+$/.test(s)) {
    var totalSec = Number(s);
    var hh = Math.floor(totalSec / 3600);
    var mmNum = Math.floor((totalSec % 3600) / 60);
    var ssNum = totalSec % 60;
    var ssStr = (ssNum < 10 ? '0' : '') + ssNum;
    if (hh > 0) {
      var mmStr = (mmNum < 10 ? '0' : '') + mmNum;
      return hh + ':' + mmStr + ':' + ssStr;
    }
    return mmNum + ':' + ssStr;
  }
  return '';
}

function indexMap_(header) {
  var map = {};
  for (var i = 0; i < HEADERS.length; i++) {
    var name = HEADERS[i];
    var found = header.indexOf(name);
    map[name] = found >= 0 ? found : i;
  }
  return map;
}

function cell_(row, index) {
  if (index == null || index < 0 || index >= row.length) return '';
  return row[index];
}

function normalizeVodUrl_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  try {
    var url = s;
    if (url.indexOf('://') < 0) url = 'https://' + url;
    var q = url.indexOf('?');
    if (q >= 0) url = url.slice(0, q);
    var h = url.indexOf('#');
    if (h >= 0) url = url.slice(0, h);
    return url;
  } catch (err) {
    return s.split('?')[0].split('#')[0];
  }
}

function toBool01_(value) {
  return asBool_(value) ? 'TRUE' : 'FALSE';
}

function asBool_(value) {
  if (value === true || value === 1) return true;
  var s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on';
}

function isValidDate_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function isValidTime_(value) {
  var s = String(value || '').trim();
  if (/^\d+$/.test(s)) return true;
  var hms = s.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (hms) {
    var mm = Number(hms[2]);
    var ss = Number(hms[3]);
    return mm <= 59 && ss <= 59;
  }
  var ms = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (ms) {
    return Number(ms[2]) <= 59;
  }
  return false;
}

function countSongsInHistory_(history) {
  var n = 0;
  for (var i = 0; i < history.length; i++) {
    n += (history[i].songInfo || []).length;
  }
  return n;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
