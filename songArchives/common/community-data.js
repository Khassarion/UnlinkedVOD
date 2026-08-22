/**
 * 커뮤니티 노래 기록: Google Apps Script 시트에서 추가분을 불러오고,
 * 모달 폼으로 새 기록을 POST 제출한다.
 *
 * 배포 후 COMMUNITY_SHEETS_WEB_APP_URL 을 채우거나
 * window.SONG_ARCHIVE_PAGE.sheetsWebAppUrl 로 덮어쓴다.
 */
(function () {
  'use strict';

  /** @type {string} Apps Script 웹 앱 배포 URL */
  const COMMUNITY_SHEETS_APPS_SCRIPT_ID = 'AKfycbzk8AAG0Lf7l0jbYG6KqxvX1lDTc_j2MoWt9TQOQRShWD7yCXykuMCjejVcCZgPPz29';
  var COMMUNITY_SHEETS_WEB_APP_URL = `https://script.google.com/macros/s/${COMMUNITY_SHEETS_APPS_SCRIPT_ID}/exec`;

  var DIALOG_ID = 'addSongDialog';
  var PREVIEW_DIALOG_ID = 'addSongCardPreviewDialog';
  var FORM_ID = 'addSongForm';
  var DIALOG_HTML_FILE = 'add-song-dialog.html';
  var communityMerged = false;
  /** @type {{ videoId: string, vodTitle: string, date: string, thumbnail: string, url: string }|null} */
  var resolvedVodMeta = null;
  var vodLookupTimer = null;
  var vodLookupSeq = 0;
  var suppressVodUrlParse = false;
  /** @type {Record<string, string>|null} */
  var defaultArtistMap = null;
  var songTitleLookupTimer = null;
  var titleSuggestItems = [];
  var titleSuggestActive = -1;
  var titleSuggestComposing = false;

  function getPageConfig() {
    var page = typeof window !== 'undefined' ? window.SONG_ARCHIVE_PAGE : null;
    page = page && typeof page === 'object' ? page : {};
    var webAppUrl = String(page.sheetsWebAppUrl || COMMUNITY_SHEETS_WEB_APP_URL || '').trim();
    var streamerId = String(page.archiveId || page.soopChannelId || '').trim();
    return { webAppUrl: webAppUrl, streamerId: streamerId };
  }

  function normalizeDateString(value) {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    }
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    var ymd = s.match(/(\d{4}-\d{2}-\d{2})/);
    if (ymd) {
      // ISO datetime 은 타임존에 따라 하루 밀릴 수 있어 Seoul 기준으로 재계산
      if (s.indexOf('T') >= 0 || /GMT|UTC|Z$/i.test(s)) {
        var inst = new Date(s);
        if (!isNaN(inst.getTime())) {
          return inst.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
        }
      }
      return ymd[1];
    }
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    }
    return '';
  }

  function normalizeTimeString(value) {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return secondsToTime(value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds());
    }
    var parsed = parseTimeInputToSeconds(value);
    if (parsed != null) return secondsToTime(parsed);
    var s = String(value == null ? '' : value).trim();
    if (!s) return '';
    var matched = s.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
    if (matched) {
      return secondsToTime(
        Number(matched[1]) * 3600 + Number(matched[2]) * 60 + Number(matched[3])
      );
    }
    return '';
  }

  /**
   * 시작 시간 입력을 초로 변환. 끝의 잡문자(숫자·콜론 아님)는 무시.
   * 2:451234 처럼 자릿수가 이어지면 무효(null).
   */
  function parseTimeInputToSeconds(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;

    var hms = s.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?!\d)(.*)$/);
    if (hms) {
      var hh = Number(hms[1]);
      var mm = Number(hms[2]);
      var ss = Number(hms[3]);
      var restHms = hms[4] || '';
      if (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) return null;
      if (mm > 59 || ss > 59) return null;
      if (restHms && /^[\d:]/.test(restHms)) return null;
      return hh * 3600 + mm * 60 + ss;
    }

    var ms = s.match(/^(\d{1,2}):(\d{1,2})(?!\d)(.*)$/);
    if (ms) {
      var m = Number(ms[1]);
      var sec = Number(ms[2]);
      var restMs = ms[3] || '';
      if (Number.isNaN(m) || Number.isNaN(sec)) return null;
      if (sec > 59) return null;
      if (restMs && /^[\d:]/.test(restMs)) return null;
      return m * 60 + sec;
    }

    var plain = s.match(/^(\d+)([^\d:]*)$/);
    if (plain) {
      var only = Number.parseInt(plain[1], 10);
      return Number.isNaN(only) ? null : only;
    }

    return null;
  }

  function isValidTimeInput(value) {
    return parseTimeInputToSeconds(value) != null;
  }

  function timeToSeconds(timeStr) {
    var parsed = parseTimeInputToSeconds(timeStr);
    if (parsed != null) return parsed;
    var normalized = normalizeTimeString(timeStr);
    if (!normalized) return 0;
    parsed = parseTimeInputToSeconds(normalized);
    return parsed != null ? parsed : 0;
  }

  function formatTimeInputValue(raw) {
    var parsed = parseTimeInputToSeconds(raw);
    if (parsed == null) return String(raw == null ? '' : raw).trim();
    return secondsToTime(parsed);
  }

  function normalizeVodUrl(rawUrl) {
    try {
      var u = new URL(rawUrl, typeof location !== 'undefined' ? location.href : undefined);
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch (err) {
      var s = String(rawUrl || '');
      var q = s.indexOf('?');
      if (q >= 0) s = s.slice(0, q);
      var h = s.indexOf('#');
      if (h >= 0) s = s.slice(0, h);
      return s;
    }
  }

  function parseChangeSecondValue(raw) {
    var m = String(raw == null ? '' : raw).trim().match(/^(\d+)/);
    if (!m) return null;
    var n = Number.parseInt(m[1], 10);
    return Number.isNaN(n) ? null : n;
  }

  function parseVodUrlParts(rawUrl) {
    var s = String(rawUrl || '').trim();
    if (!s) return null;
    var videoId = '';
    var changeSecond = null;
    try {
      var u = new URL(s.indexOf('://') >= 0 ? s : 'https://' + s);
      var m = u.pathname.match(/\/player\/(\d+)/i);
      if (!m) return null;
      if (!/vod\.sooplive\.(?:com|co\.kr)$/i.test(u.hostname)) return null;
      videoId = m[1];
      changeSecond = parseChangeSecondValue(u.searchParams.get('change_second'));
    } catch (err) {
      var m2 = s.match(/vod\.sooplive\.(?:com|co\.kr)\/player\/(\d+)/i);
      if (!m2) return null;
      videoId = m2[1];
      var qm = s.match(/[?&]change_second=([^&#\s]*)/i);
      changeSecond = qm ? parseChangeSecondValue(qm[1]) : null;
    }
    return {
      videoId: videoId,
      changeSecond: changeSecond,
      url: 'https://vod.sooplive.com/player/' + videoId,
    };
  }

  function buildCanonicalVodUrl(parts) {
    if (!parts || !parts.videoId) return '';
    var url = 'https://vod.sooplive.com/player/' + parts.videoId;
    if (parts.changeSecond != null && !Number.isNaN(parts.changeSecond) && parts.changeSecond >= 0) {
      url += '?change_second=' + parts.changeSecond;
    }
    return url;
  }

  /** 찾은 URL 패턴만 입력칸에 다시 쓴다. input/change 재파싱은 막는다. */
  function writeCanonicalVodUrl(parts) {
    var input = document.getElementById('addSongVodUrl');
    if (!input || !parts) return;
    var canonical = buildCanonicalVodUrl(parts);
    if (!canonical || String(input.value || '') === canonical) return;
    suppressVodUrlParse = true;
    input.value = canonical;
    setTimeout(function () {
      suppressVodUrlParse = false;
    }, 0);
  }

  function secondsToTime(total) {
    var n = Math.floor(Number(total) || 0);
    if (n < 0) n = 0;
    var h = Math.floor(n / 3600);
    var m = Math.floor((n % 3600) / 60);
    var s = n % 60;
    var pad = function (x) {
      return String(x).padStart(2, '0');
    };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    if (m > 0) return m + ':' + pad(s);
    return String(s);
  }

  function escapeAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function historyToSongs(history) {
    var songsDict = {};
    if (!Array.isArray(history)) return [];

    for (var i = 0; i < history.length; i++) {
      var entry = history[i];
      if (!entry || entry.template) continue;
      var urlBase = normalizeVodUrl(entry.url || '');
      if (!urlBase) continue;
      var date = normalizeDateString(entry.date);
      var videoTitle = String(entry.title || '').trim();
      var thumbnail = String(entry.thumbnail || '').trim();
      var songInfo = Array.isArray(entry.songInfo) ? entry.songInfo : [];
      if (!date) continue;

      for (var j = 0; j < songInfo.length; j++) {
        var song = songInfo[j] || {};
        var title = String(song.title || '').trim();
        if (!title) continue;
        var artist = String(song.artist || '').trim();
        var key = title + '\0' + artist;
        var seconds = timeToSeconds(song.time);
        var vodUrl = urlBase + (seconds > 0 ? '?change_second=' + seconds : '');
        var ver = {
          date: date,
          url: vodUrl,
          videoTitle: videoTitle,
          views: 1000,
          thumbnail: thumbnail,
          noMistake: !!song.noMistake,
          recommended: !!song.recommended,
          needsReview: !!song.needsReview,
          groupSong: !!song.groupSong,
          groupMembers: song.groupMembers != null ? String(song.groupMembers).trim() : '',
          fromCommunity: true,
        };

        if (!songsDict[key]) {
          songsDict[key] = { title: title, artist: artist, versions: [ver] };
        } else {
          songsDict[key].versions.push(ver);
        }
      }
    }

    return Object.keys(songsDict).map(function (k) {
      return songsDict[k];
    });
  }

  function collectExistingVersionUrls(songList) {
    var set = {};
    if (!Array.isArray(songList)) return set;
    for (var i = 0; i < songList.length; i++) {
      var versions = songList[i].versions || [];
      for (var j = 0; j < versions.length; j++) {
        var url = String(versions[j].url || '');
        if (url) set[url] = true;
      }
    }
    return set;
  }

  function mergeCommunitySongs(baseSongs, communitySongs) {
    if (!Array.isArray(baseSongs)) baseSongs = [];
    var existingUrls = collectExistingVersionUrls(baseSongs);
    var byKey = {};

    for (var i = 0; i < baseSongs.length; i++) {
      var s = baseSongs[i];
      byKey[String(s.title || '') + '\0' + String(s.artist || '')] = s;
    }

    var added = 0;
    for (var c = 0; c < communitySongs.length; c++) {
      var cs = communitySongs[c];
      var key = String(cs.title || '') + '\0' + String(cs.artist || '');
      var versions = cs.versions || [];
      var fresh = [];
      for (var v = 0; v < versions.length; v++) {
        var ver = versions[v];
        var url = String(ver.url || '');
        if (!url || existingUrls[url]) continue;
        existingUrls[url] = true;
        fresh.push(ver);
      }
      if (!fresh.length) continue;
      added += fresh.length;
      if (byKey[key]) {
        byKey[key].versions = (byKey[key].versions || []).concat(fresh);
      } else {
        var created = {
          title: cs.title,
          artist: cs.artist,
          versions: fresh.slice(),
        };
        byKey[key] = created;
        baseSongs.push(created);
      }
    }
    return added;
  }

  function refreshViews() {
    if (typeof window.refreshSongArchiveViews === 'function') {
      window.refreshSongArchiveViews();
      return;
    }
    if (typeof loadSongs === 'function') {
      var term =
        (document.getElementById('searchBar') && document.getElementById('searchBar').value) || '';
      loadSongs(term);
    }
    if (typeof renderVodPanel === 'function') renderVodPanel();
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', !!isError);
    el.hidden = !message;
  }

  function getCommonAssetUrl(fileName) {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('community-data.js') >= 0) {
        return src.replace(/community-data\.js(?:\?.*)?$/i, fileName);
      }
    }
    return '../common/' + fileName;
  }

  function loadAddSongDialog() {
    if (document.getElementById(DIALOG_ID)) {
      return Promise.resolve(document.getElementById(DIALOG_ID));
    }

    return fetch(getCommonAssetUrl(DIALOG_HTML_FILE), { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('http_' + res.status);
        return res.text();
      })
      .then(function (html) {
        var wrap = document.createElement('div');
        wrap.innerHTML = String(html || '').trim();
        var dialog = wrap.querySelector('#' + DIALOG_ID) || wrap.firstElementChild;
        if (!dialog) throw new Error('dialog_markup_missing');
        var nodes = Array.prototype.slice.call(wrap.children);
        nodes.forEach(function (node) {
          document.body.appendChild(node);
        });
        return dialog;
      });
  }

  function ensureOpenButton() {
    var meta = document.querySelector('.data-update-meta');
    if (meta && !document.getElementById('addSongOpenButton')) {
      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.id = 'addSongOpenButton';
      openBtn.className = 'add-song-open-button';
      openBtn.textContent = '노래 추가하기';
      openBtn.disabled = true;
      openBtn.title = '모달을 불러오는 중…';
      meta.appendChild(openBtn);
    }
    return document.getElementById('addSongOpenButton');
  }

  function bindDialogUi() {
    var dialog = document.getElementById(DIALOG_ID);
    var form = document.getElementById(FORM_ID);
    var openButton = ensureOpenButton();
    if (!dialog || !form || !openButton) return;
    if (dialog.dataset.bound === '1') {
      openButton.disabled = false;
      openButton.removeAttribute('title');
      return;
    }
    dialog.dataset.bound = '1';
    openButton.disabled = false;
    openButton.removeAttribute('title');

    openButton.addEventListener('click', function () {
      var status = document.getElementById('addSongFormStatus');
      setStatus(status, '', false);
      clearVodMetaPreview('');
      resetArtistAutoUi(true);
      hideTitleSuggestions();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      var first = form.querySelector('#addSongTitle') || form.querySelector('input[name="vodUrl"]');
      if (first) {
        first.focus();
        var vodUrl = form.querySelector('input[name="vodUrl"]');
        if (vodUrl && String(vodUrl.value || '').trim()) onVodUrlChanged();
        else setLookupStatus('', false);
      }
      maybeAutofillArtist();
    });

    dialog.querySelectorAll('[data-add-song-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      });
    });

    var groupSong = document.getElementById('addSongGroupSong');
    var membersWrap = document.getElementById('addSongGroupMembersWrap');
    var syncGroupMembersVisibility = function () {
      if (!membersWrap) return;
      var showMembers = !!(groupSong && groupSong.checked);
      membersWrap.hidden = !showMembers;
      if (!showMembers) {
        var membersInput = membersWrap.querySelector('input[name="groupMembers"]');
        if (membersInput) membersInput.value = '';
      }
    };
    if (groupSong) {
      groupSong.addEventListener('change', syncGroupMembersVisibility);
    }
    syncGroupMembersVisibility();

    var vodUrlInput = document.getElementById('addSongVodUrl');
    if (vodUrlInput) {
      vodUrlInput.addEventListener('input', onVodUrlChanged);
      vodUrlInput.addEventListener('change', onVodUrlChanged);
      vodUrlInput.addEventListener('blur', onVodUrlBlur);
      vodUrlInput.addEventListener('paste', function () {
        setTimeout(onVodUrlChanged, 0);
      });
    }

    var timeInput = document.getElementById('addSongTime');
    if (timeInput) {
      timeInput.addEventListener('blur', onSongTimeBlur);
      timeInput.addEventListener('input', onSongTimeInput);
    }

    var songTitleInput = document.getElementById('addSongTitle');
    if (songTitleInput) {
      songTitleInput.addEventListener('input', onSongTitleChanged);
      songTitleInput.addEventListener('change', onSongTitleChanged);
      songTitleInput.addEventListener('keydown', onSongTitleKeydown);
      songTitleInput.addEventListener('focus', onSongTitleChanged);
      songTitleInput.addEventListener('compositionstart', function () {
        titleSuggestComposing = true;
      });
      songTitleInput.addEventListener('compositionend', function () {
        titleSuggestComposing = false;
        onSongTitleChanged();
      });
      songTitleInput.addEventListener('blur', function () {
        setTimeout(hideTitleSuggestions, 150);
      });
    }

    var suggestList = document.getElementById('addSongTitleSuggest');
    if (suggestList) {
      suggestList.addEventListener('mousedown', function (ev) {
        var li = ev.target && ev.target.closest ? ev.target.closest('[data-suggest-index]') : null;
        if (!li) return;
        ev.preventDefault();
        selectTitleSuggestion(Number(li.getAttribute('data-suggest-index')));
      });
    }

    var artistAuto = document.getElementById('addSongArtistAuto');
    if (artistAuto) {
      artistAuto.addEventListener('change', onArtistAutoToggle);
    }

    form.addEventListener('submit', onSubmitForm);

    var previewBtn = document.getElementById('addSongPreviewBtn');
    if (previewBtn) {
      previewBtn.addEventListener('click', onPreviewCardClick);
    }
    bindCardPreviewDialog();
    attachDataUpdateInfoHandler();
  }

  function bindCardPreviewDialog() {
    var previewDialog = document.getElementById(PREVIEW_DIALOG_ID);
    if (!previewDialog || previewDialog.dataset.bound === '1') return;
    previewDialog.dataset.bound = '1';

    previewDialog.querySelectorAll('[data-add-song-preview-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeCardPreviewDialog();
      });
    });

    previewDialog.addEventListener('click', function (ev) {
      if (ev.target === previewDialog) closeCardPreviewDialog();
    });
  }

  function closeCardPreviewDialog() {
    var previewDialog = document.getElementById(PREVIEW_DIALOG_ID);
    if (!previewDialog) return;
    if (typeof previewDialog.close === 'function') previewDialog.close();
    else previewDialog.removeAttribute('open');
  }

  function openCardPreviewDialog() {
    var previewDialog = document.getElementById(PREVIEW_DIALOG_ID);
    if (!previewDialog) return;
    if (typeof previewDialog.showModal === 'function') previewDialog.showModal();
    else previewDialog.setAttribute('open', '');
  }

  function escapePreviewHtml(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function previewIconsHtml(version) {
    if (typeof versionIconsHtml === 'function') return versionIconsHtml(version);
    var parts = [];
    if (version.noMistake) parts.push('<span class="version-icon" title="실수 없음">○</span>');
    if (version.recommended) parts.push('<span class="version-icon" title="추천">☆</span>');
    if (version.needsReview) {
      parts.push('<span class="version-icon version-icon-review" title="검토 필요">?</span>');
    }
    return parts.length ? '<span class="version-icons">' + parts.join('') + '</span>' : '';
  }

  function previewSyncroomBadgeHtml(version) {
    if (typeof syncroomBadgeHtml === 'function') return syncroomBadgeHtml(version);
    if (!version || !version.groupSong) return '';
    var members = String(version.groupMembers || '').trim();
    var titleAttr = members ? ' title="' + escapePreviewHtml(members) + '"' : '';
    return '<span class="version-badge version-badge-syncroom"' + titleAttr + '>싱크룸</span>';
  }

  function formatPreviewDate(dateValue) {
    var raw = String(dateValue || '').trim();
    return raw || '날짜 미입력';
  }

  function buildPreviewPayloadFromForm(form) {
    var config = getPageConfig();
    var meta = null;
    var vodUrlRaw =
      (document.getElementById('addSongVodUrl') && document.getElementById('addSongVodUrl').value) ||
      '';
    var parts = parseVodUrlParts(vodUrlRaw);
    if (parts) {
      meta = metaFromFormFields(parts.videoId) || resolvedVodMeta;
      if (meta && !meta.thumbnail && resolvedVodMeta && resolvedVodMeta.thumbnail) {
        meta = Object.assign({}, meta, { thumbnail: resolvedVodMeta.thumbnail });
      }
    } else if (resolvedVodMeta) {
      meta = resolvedVodMeta;
    }
    return readFormPayload(form, config.streamerId || '', meta);
  }

  function renderCardPreview(payload) {
    var mount = document.getElementById('addSongCardPreviewMount');
    var note = document.getElementById('addSongCardPreviewNote');
    if (!mount) return;

    var title = payload.songTitle || '노래 제목 미입력';
    var artist = payload.artist || '';
    var dateLabel = formatPreviewDate(payload.date);
    var vodTitle = payload.vodTitle || '방송 제목 미입력';
    var thumb = payload.thumbnail || '';
    var urlBase = normalizeVodUrl(payload.vodUrl);
    var seconds = timeToSeconds(payload.time);
    var url = urlBase
      ? urlBase + (seconds > 0 ? '?change_second=' + seconds : '')
      : '';
    var version = {
      date: dateLabel,
      videoTitle: vodTitle,
      thumbnail: thumb,
      url: url,
      noMistake: !!payload.noMistake,
      recommended: !!payload.recommended,
      needsReview: !!payload.needsReview,
      groupSong: !!payload.groupSong,
      groupMembers: payload.groupMembers || '',
      time: payload.time || '',
    };

    var icons = previewIconsHtml(version);
    var syncroomBadge = previewSyncroomBadgeHtml(version);
    var thumbHtml = thumb
      ? '<img src="' + escapePreviewHtml(thumb) + '" alt="" />'
      : '<span class="add-song-preview-thumb-empty">썸네일 없음</span>';
    var cardTag = url ? 'a' : 'div';
    var cardAttrs = url
      ? ' href="' +
        escapePreviewHtml(url) +
        '" target="_blank" rel="noopener noreferrer"'
      : ' role="link" aria-disabled="true"';

    mount.innerHTML =
      '<section class="song-row">' +
      '<div class="song-row-heading">' +
      '<h2 class="song-row-title">' +
      escapePreviewHtml(title) +
      '</h2>' +
      (artist
        ? '<span class="song-row-artist">' + escapePreviewHtml(artist) + '</span>'
        : '') +
      '</div>' +
      '<div class="version-strip">' +
      '<' +
      cardTag +
      ' class="version-card"' +
      cardAttrs +
      '>' +
      '<span class="version-card-thumb">' +
      thumbHtml +
      '</span>' +
      '<span class="version-card-info">' +
      '<span class="version-card-meta">' +
      '<span class="version-card-date">' +
      escapePreviewHtml(dateLabel) +
      '</span>' +
      (syncroomBadge ? '<span class="version-card-badges">' + syncroomBadge + '</span>' : '') +
      (icons ? '<span class="version-card-icons">' + icons + '</span>' : '') +
      '</span>' +
      '<span class="version-card-title">' +
      escapePreviewHtml(vodTitle) +
      '</span>' +
      '</span>' +
      '</' +
      cardTag +
      '>' +
      '</div>' +
      '</section>';

    var warnings = [];
    if (!payload.songTitle) warnings.push('노래 제목');
    if (!payload.vodUrl) warnings.push('다시보기 URL');
    if (!payload.date) warnings.push('방송 날짜');
    if (!payload.time) warnings.push('시작 시간');
    if (note) {
      if (warnings.length) {
        note.hidden = false;
        note.textContent = '아직 비어 있는 항목: ' + warnings.join(', ');
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }
  }

  function onPreviewCardClick() {
    var form = document.getElementById(FORM_ID);
    if (!form) return;
    var payload = buildPreviewPayloadFromForm(form);
    renderCardPreview(payload);
    openCardPreviewDialog();
  }

  function ensureUi() {
    ensureOpenButton();
    return loadAddSongDialog()
      .then(function () {
        bindDialogUi();
      })
      .catch(function (err) {
        var openButton = document.getElementById('addSongOpenButton');
        if (openButton) {
          openButton.disabled = true;
          openButton.title =
            '모달을 불러오지 못했습니다: ' + (err && err.message ? err.message : err);
        }
        console.error('[community-data] failed to load add-song dialog', err);
      });
  }

  function attachDataUpdateInfoHandler() {
    var updateInfoButton = document.getElementById('dataUpdateInfoButton');
    if (!updateInfoButton || updateInfoButton.dataset.bound === '1') return;
    updateInfoButton.dataset.bound = '1';
    var parseExample = '';

    fetch('./data/parseConfig.json')
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to load parseConfig.json');
        return response.json();
      })
      .then(function (config) {
        if (config){
          if (Array.isArray(config.example)) {
            parseExample = config.example.join('\n').trim();
          } else if (typeof config.example === 'string') {
            parseExample = config.example.trim();
          }
        }
      })
      .catch(function () {
        parseExample = '';
      });

    updateInfoButton.addEventListener('click', function () {
      var message =
        '노래 기록 보관소에 표시되는 노래는 두 가지 데이터가 합쳐져 표시됩니다.\n\n' + 
        '1. 개발자가 다시보기에 작성된 타임라인 댓글을 기반으로 업데이트한 데이터\n\n' +
        '2. 일반 사용자가 \'노래 추가하기\'로 제출된 기록 데이터\n\n' +
        '이 창에서 제출한 기록은 커뮤니티 시트로 저장된 뒤, 페이지를 불러올 때 함께 표시됩니다.\n' + 
        '추후 개발자가 제출된 데이터를 검토하여 1번 데이터에 추가할 것입니다.';
      /// 이거 딱히 안 보여줘도 될듯?
      // if (parseExample) {
      //   message += '\n\n현재 이 스트리머에 적용중인 타임라인 댓글 파싱 규칙:\n' + parseExample;
      // }
      alert(message);
    });
  }

  function getSongTitleCatalog() {
    var byTitle = {};

    function addEntry(title, artist, weight) {
      var t = String(title || '').trim();
      if (!t) return;
      var a = String(artist || '').trim();
      var w = weight || 1;
      if (!byTitle[t]) {
        byTitle[t] = { title: t, artist: a, weight: w, artists: {} };
      } else {
        byTitle[t].weight += w;
      }
      if (a) {
        byTitle[t].artists[a] = (byTitle[t].artists[a] || 0) + w;
        if (!byTitle[t].artist || byTitle[t].artists[a] > (byTitle[t].artists[byTitle[t].artist] || 0)) {
          byTitle[t].artist = a;
        }
      }
    }

    if (typeof songs !== 'undefined' && Array.isArray(songs)) {
      for (var i = 0; i < songs.length; i++) {
        var song = songs[i] || {};
        addEntry(song.title, song.artist, (song.versions && song.versions.length) || 1);
      }
    }

    if (defaultArtistMap && typeof defaultArtistMap === 'object') {
      Object.keys(defaultArtistMap).forEach(function (title) {
        addEntry(title, defaultArtistMap[title], 1);
      });
    }

    return Object.keys(byTitle)
      .map(function (k) {
        return byTitle[k];
      })
      .sort(function (a, b) {
        return b.weight - a.weight || a.title.localeCompare(b.title, 'ko');
      });
  }

  function filterTitleSuggestions(query) {
    var q = String(query || '').trim().toLowerCase();
    var catalog = getSongTitleCatalog();
    if (!q) return catalog.slice(0, 8);
    var starts = [];
    var contains = [];
    for (var i = 0; i < catalog.length; i++) {
      var item = catalog[i];
      var titleLower = item.title.toLowerCase();
      var artistLower = (item.artist || '').toLowerCase();
      if (titleLower.indexOf(q) === 0) starts.push(item);
      else if (titleLower.indexOf(q) >= 0 || artistLower.indexOf(q) >= 0) contains.push(item);
      if (starts.length + contains.length >= 12) break;
    }
    return starts.concat(contains).slice(0, 8);
  }

  function hideTitleSuggestions() {
    var list = document.getElementById('addSongTitleSuggest');
    var input = document.getElementById('addSongTitle');
    titleSuggestItems = [];
    titleSuggestActive = -1;
    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function renderTitleSuggestions(items) {
    var list = document.getElementById('addSongTitleSuggest');
    var input = document.getElementById('addSongTitle');
    if (!list || !input) return;

    titleSuggestItems = items || [];
    titleSuggestActive = -1;
    list.innerHTML = '';

    if (!titleSuggestItems.length) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    for (var i = 0; i < titleSuggestItems.length; i++) {
      var item = titleSuggestItems[i];
      var li = document.createElement('li');
      li.className = 'add-song-suggest-item';
      li.setAttribute('role', 'option');
      li.setAttribute('data-suggest-index', String(i));
      li.id = 'addSongTitleSuggest-' + i;

      var titleSpan = document.createElement('span');
      titleSpan.className = 'add-song-suggest-title';
      titleSpan.textContent = item.title;

      var metaSpan = document.createElement('span');
      metaSpan.className = 'add-song-suggest-meta';
      metaSpan.textContent = item.artist || '가수 미상';

      li.appendChild(titleSpan);
      li.appendChild(metaSpan);
      list.appendChild(li);
    }

    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function setActiveTitleSuggestion(index) {
    var list = document.getElementById('addSongTitleSuggest');
    var input = document.getElementById('addSongTitle');
    if (!list || !titleSuggestItems.length) return;

    if (index < 0) index = titleSuggestItems.length - 1;
    if (index >= titleSuggestItems.length) index = 0;
    titleSuggestActive = index;

    var nodes = list.querySelectorAll('.add-song-suggest-item');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('is-active', i === titleSuggestActive);
    }
    if (input && nodes[titleSuggestActive]) {
      input.setAttribute('aria-activedescendant', nodes[titleSuggestActive].id);
    }
  }

  function selectTitleSuggestion(index) {
    var item = titleSuggestItems[index];
    var input = document.getElementById('addSongTitle');
    if (!item || !input) return;
    input.value = item.title;
    hideTitleSuggestions();
    maybeAutofillArtist();
    input.focus();
  }

  function onSongTitleKeydown(ev) {
    var list = document.getElementById('addSongTitleSuggest');
    if (!list || list.hidden || !titleSuggestItems.length) {
      if (ev.key === 'Escape') hideTitleSuggestions();
      return;
    }

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setActiveTitleSuggestion(titleSuggestActive + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActiveTitleSuggestion(titleSuggestActive - 1);
    } else if (ev.key === 'Enter') {
      if (titleSuggestActive >= 0) {
        ev.preventDefault();
        selectTitleSuggestion(titleSuggestActive);
      }
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      hideTitleSuggestions();
    }
  }

  function isArtistAutoEnabled() {
    var el = document.getElementById('addSongArtistAuto');
    return !el || !!el.checked;
  }

  function resetArtistAutoUi(checked) {
    var auto = document.getElementById('addSongArtistAuto');
    var artist = document.getElementById('addSongArtist');
    if (auto) auto.checked = checked !== false;
    if (artist) {
      artist.readOnly = isArtistAutoEnabled();
      artist.classList.toggle('is-autofilled', isArtistAutoEnabled());
      if (isArtistAutoEnabled()) artist.placeholder = '제목 입력 시 자동 입력';
      else artist.placeholder = '가수 직접 입력';
    }
  }

  function lookupArtistForTitle(title) {
    var t = String(title || '').trim();
    if (!t) return '';

    if (defaultArtistMap && typeof defaultArtistMap === 'object') {
      var mapped = defaultArtistMap[t];
      if (mapped != null && String(mapped).trim()) return String(mapped).trim();
    }

    if (typeof songs !== 'undefined' && Array.isArray(songs)) {
      var counts = {};
      for (var i = 0; i < songs.length; i++) {
        var song = songs[i];
        if (String(song.title || '').trim() !== t) continue;
        var artist = String(song.artist || '').trim();
        if (!artist) continue;
        counts[artist] = (counts[artist] || 0) + (song.versions ? song.versions.length : 1);
      }
      var best = '';
      var bestCount = 0;
      Object.keys(counts).forEach(function (name) {
        if (counts[name] > bestCount) {
          best = name;
          bestCount = counts[name];
        }
      });
      if (best) return best;
    }

    return '';
  }

  function maybeAutofillArtist() {
    if (!isArtistAutoEnabled()) return;
    var titleInput = document.getElementById('addSongTitle');
    var artistInput = document.getElementById('addSongArtist');
    if (!titleInput || !artistInput) return;

    var title = String(titleInput.value || '').trim();
    if (!title) {
      artistInput.value = '';
      return;
    }

    var artist = lookupArtistForTitle(title);
    artistInput.value = artist;
    artistInput.readOnly = true;
    artistInput.classList.add('is-autofilled');
  }

  function onSongTitleChanged() {
    if (songTitleLookupTimer) {
      clearTimeout(songTitleLookupTimer);
      songTitleLookupTimer = null;
    }
    songTitleLookupTimer = setTimeout(function () {
      if (titleSuggestComposing) return;
      var input = document.getElementById('addSongTitle');
      var query = input ? String(input.value || '') : '';
      if (!String(query).trim()) {
        hideTitleSuggestions();
      } else {
        renderTitleSuggestions(filterTitleSuggestions(query));
      }
      if (isArtistAutoEnabled()) maybeAutofillArtist();
    }, 120);
  }

  function onArtistAutoToggle() {
    var artistInput = document.getElementById('addSongArtist');
    var enabled = isArtistAutoEnabled();
    if (artistInput) {
      artistInput.readOnly = enabled;
      artistInput.classList.toggle('is-autofilled', enabled);
      artistInput.placeholder = enabled ? '제목 입력 시 자동 입력' : '가수 직접 입력';
      if (enabled) {
        maybeAutofillArtist();
        artistInput.blur();
      } else {
        artistInput.focus();
      }
    }
  }

  function setLookupStatus(message, isError) {
    var el = document.getElementById('addSongVodLookupStatus');
    setStatus(el, message, isError);
  }

  function setAuthHint(authUrl) {
    var el = document.getElementById('addSongAuthHint');
    if (!el) return;
    el.textContent = '';
    el.hidden = !authUrl;
    el.classList.remove('is-error');
    if (!authUrl) return;
    el.appendChild(document.createTextNode('권한 허용이 필요합니다: '));
    var a = document.createElement('a');
    a.href = authUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '이 링크를 열어 승인하기';
    el.appendChild(a);
  }

  function setMetaFieldsEditable(editable) {
    var dateInput = document.getElementById('addSongDate');
    var titleInput = document.getElementById('addSongVodTitle');
    if (dateInput) {
      dateInput.readOnly = !editable;
      dateInput.classList.toggle('is-autofilled', !editable && !!dateInput.value);
    }
    if (titleInput) {
      titleInput.readOnly = !editable;
      titleInput.classList.toggle('is-autofilled', !editable && !!titleInput.value);
    }
  }

  function setMetaFailureHint(show) {
    var hint = document.getElementById('addSongMetaHint');
    if (hint) hint.hidden = !show;
  }

  function showVodMetaFields(show) {
    var wrap = document.getElementById('addSongVodMetaFields');
    var dateInput = document.getElementById('addSongDate');
    if (wrap) wrap.hidden = !show;
    if (dateInput) {
      if (show) dateInput.setAttribute('required', 'required');
      else dateInput.removeAttribute('required');
    }
  }

  function fillMetaFormFields(meta) {
    var dateInput = document.getElementById('addSongDate');
    var titleInput = document.getElementById('addSongVodTitle');
    if (dateInput) dateInput.value = (meta && meta.date) || '';
    if (titleInput) titleInput.value = (meta && meta.vodTitle) || '';
  }

  function clearVodMetaPreview(lookupMessage) {
    resolvedVodMeta = null;
    var preview = document.getElementById('addSongVodPreview');
    var thumb = document.getElementById('addSongVodThumb');
    if (preview) preview.hidden = true;
    if (thumb) {
      thumb.hidden = true;
      thumb.removeAttribute('src');
      thumb.alt = '';
    }
    fillMetaFormFields(null);
    setMetaFieldsEditable(true);
    setMetaFailureHint(false);
    showVodMetaFields(false);
    setLookupStatus(lookupMessage || '', false);
    setAuthHint('');
  }

  function applyVodMetaPreview(meta) {
    resolvedVodMeta = meta;
    var preview = document.getElementById('addSongVodPreview');
    var thumb = document.getElementById('addSongVodThumb');

    showVodMetaFields(true);
    fillMetaFormFields(meta);
    setMetaFieldsEditable(false);
    setMetaFailureHint(false);

    if (thumb) {
      if (meta.thumbnail) {
        thumb.src = meta.thumbnail;
        thumb.alt = escapeAttr(meta.vodTitle || '썸네일');
        thumb.hidden = false;
        if (preview) preview.hidden = false;
      } else {
        thumb.hidden = true;
        thumb.removeAttribute('src');
        if (preview) preview.hidden = true;
      }
    } else if (preview) {
      preview.hidden = true;
    }
    setLookupStatus('', false);
    setAuthHint('');
  }

  function applyChangeSecondToTime(changeSecond) {
    if (changeSecond == null || Number.isNaN(changeSecond)) return;
    var timeInput = document.getElementById('addSongTime');
    if (!timeInput) return;
    timeInput.value = secondsToTime(changeSecond);
  }

  function onVodUrlChanged() {
    if (suppressVodUrlParse) return;

    var input = document.getElementById('addSongVodUrl');
    var raw = input ? String(input.value || '').trim() : '';
    if (vodLookupTimer) {
      clearTimeout(vodLookupTimer);
      vodLookupTimer = null;
    }

    if (!raw) {
      // URL 비어 있으면 조회하지 않고 방송 메타 필드도 숨김
      clearVodMetaPreview('');
      return;
    }

    var parts = parseVodUrlParts(raw);
    if (!parts) {
      resolvedVodMeta = null;
      var preview = document.getElementById('addSongVodPreview');
      if (preview) preview.hidden = true;
      fillMetaFormFields(null);
      showVodMetaFields(true);
      setMetaFieldsEditable(true);
      setMetaFailureHint(true);
      setLookupStatus('올바른 Soop 다시보기 URL이 아닙니다.', true);
      setAuthHint('');
      return;
    }

    applyChangeSecondToTime(parts.changeSecond);

    if (resolvedVodMeta && resolvedVodMeta.videoId === parts.videoId) {
      applyVodMetaPreview(resolvedVodMeta);
      return;
    }

    showVodMetaFields(true);
    fillMetaFormFields(null);
    setMetaFieldsEditable(true);
    setMetaFailureHint(false);
    var previewLoading = document.getElementById('addSongVodPreview');
    if (previewLoading) previewLoading.hidden = true;
    setLookupStatus('방송 정보를 불러오는 중…', false);
    setAuthHint('');
    vodLookupTimer = setTimeout(function () {
      lookupVodMeta(parts.videoId);
    }, 350);
  }

  function onVodUrlBlur() {
    if (suppressVodUrlParse) return;
    var input = document.getElementById('addSongVodUrl');
    var parts = parseVodUrlParts(input ? input.value : '');
    if (parts) writeCanonicalVodUrl(parts);
  }

  function onSongTimeBlur() {
    var input = document.getElementById('addSongTime');
    if (!input) return;
    var raw = String(input.value || '').trim();
    if (!raw) {
      input.setCustomValidity('');
      return;
    }
    var seconds = parseTimeInputToSeconds(raw);
    if (seconds == null) {
      input.setCustomValidity('시:분:초, 분:초, 또는 초 단위 숫자로 입력해 주세요.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    input.value = secondsToTime(seconds);
  }

  function onSongTimeInput() {
    var input = document.getElementById('addSongTime');
    if (input) input.setCustomValidity('');
  }

  function findMetaInLocalSongs(videoId) {
    if (typeof songs === 'undefined' || !Array.isArray(songs)) return null;
    var needle = '/player/' + videoId;
    for (var i = 0; i < songs.length; i++) {
      var versions = songs[i].versions || [];
      for (var j = 0; j < versions.length; j++) {
        var ver = versions[j] || {};
        var url = String(ver.url || '');
        if (url.indexOf(needle) < 0) continue;
        return {
          videoId: videoId,
          vodTitle: String(ver.videoTitle || '').trim(),
          date: String(ver.date || '').trim(),
          thumbnail: String(ver.thumbnail || '').trim(),
          url: 'https://vod.sooplive.com/player/' + videoId,
          source: 'local',
        };
      }
    }
    return null;
  }

  function fetchVodMetaFromAppsScript(videoId) {
    var config = getPageConfig();
    if (!config.webAppUrl) {
      return Promise.reject(new Error('missing_web_app_url'));
    }
    var url =
      config.webAppUrl +
      (config.webAppUrl.indexOf('?') >= 0 ? '&' : '?') +
      'action=vod_info&videoId=' +
      encodeURIComponent(videoId);

    return fetch(url, { method: 'GET', redirect: 'follow' }).then(function (res) {
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json().then(function (data) {
        if (!data || !data.ok) {
          var err = new Error((data && data.error) || 'vod_info_failed');
          err.authUrl = data && data.authUrl;
          err.detail = data && data.detail;
          throw err;
        }
        return {
          videoId: String(data.videoId || videoId),
          vodTitle: String(data.vodTitle || '').trim(),
          date: String(data.date || '').trim(),
          thumbnail: String(data.thumbnail || '').trim(),
          url: String(data.url || 'https://vod.sooplive.com/player/' + videoId),
          source: 'apps_script',
        };
      });
    });
  }

  function fetchAuthUrl() {
    var config = getPageConfig();
    if (!config.webAppUrl) return Promise.resolve('');
    var url =
      config.webAppUrl +
      (config.webAppUrl.indexOf('?') >= 0 ? '&' : '?') +
      'action=authorize';
    return fetch(url, { method: 'GET', redirect: 'follow' })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        return (data && data.authUrl) || '';
      })
      .catch(function () {
        return '';
      });
  }

  function handleLookupFailure(err) {
    resolvedVodMeta = null;
    var preview = document.getElementById('addSongVodPreview');
    if (preview) preview.hidden = true;
    showVodMetaFields(true);
    setMetaFieldsEditable(true);
    setMetaFailureHint(true);

    var msg = String(err && err.message ? err.message : err);
    var detail = err && err.detail ? String(err.detail) : '';
    var authUrl = (err && err.authUrl) || '';
    var needsAuth =
      msg.indexOf('external_request') >= 0 ||
      msg === 'urlfetch_unauthorized' ||
      msg === 'authorization_required' ||
      detail.indexOf('external_request') >= 0 ||
      detail.indexOf('권한이 없습니다') >= 0;

    if (needsAuth) {
      setLookupStatus(
        'Apps Script 외부 요청 권한이 없습니다. 아래 링크로 승인한 뒤 웹 앱을 새 버전 배포하세요. 당장은 방송 날짜를 직접 입력해 제출할 수 있습니다.',
        true
      );
      if (authUrl) {
        setAuthHint(authUrl);
        return;
      }
      fetchAuthUrl().then(function (url) {
        if (url) setAuthHint(url);
        else {
          var config = getPageConfig();
          if (config.webAppUrl) {
            setAuthHint(
              config.webAppUrl +
                (config.webAppUrl.indexOf('?') >= 0 ? '&' : '?') +
                'action=authorize'
            );
          }
        }
      });
      return;
    }

    setLookupStatus(
      '방송 정보를 자동으로 불러오지 못했습니다. 방송 날짜를 직접 입력해 제출할 수 있습니다. (' +
        msg +
        ')',
      true
    );
    setAuthHint('');
  }

  function lookupVodMeta(videoId) {
    var seq = ++vodLookupSeq;

    var local = findMetaInLocalSongs(videoId);
    if (local && local.date) {
      if (seq === vodLookupSeq) applyVodMetaPreview(local);
      return Promise.resolve(local);
    }

    return fetchVodMetaFromAppsScript(videoId)
      .then(function (meta) {
        if (seq !== vodLookupSeq) return null;
        if (!meta.date) throw new Error('vod_info_failed');
        applyVodMetaPreview(meta);
        return meta;
      })
      .catch(function (err) {
        if (seq !== vodLookupSeq) return null;
        handleLookupFailure(err);
        return null;
      });
  }

  function metaFromFormFields(videoId) {
    var dateInput = document.getElementById('addSongDate');
    var titleInput = document.getElementById('addSongVodTitle');
    var date = dateInput ? String(dateInput.value || '').trim() : '';
    var vodTitle = titleInput ? String(titleInput.value || '').trim() : '';
    if (!date) return null;
    return {
      videoId: videoId,
      vodTitle: vodTitle,
      date: date,
      thumbnail: (resolvedVodMeta && resolvedVodMeta.videoId === videoId && resolvedVodMeta.thumbnail) || '',
      url: 'https://vod.sooplive.com/player/' + videoId,
      source: resolvedVodMeta && resolvedVodMeta.videoId === videoId ? resolvedVodMeta.source || 'form' : 'form',
    };
  }

  function ensureVodMetaForSubmit(rawUrl) {
    var parts = parseVodUrlParts(rawUrl);
    if (!parts) return Promise.reject(new Error('invalid_vod_url'));
    applyChangeSecondToTime(parts.changeSecond);
    if (resolvedVodMeta && resolvedVodMeta.videoId === parts.videoId && resolvedVodMeta.date) {
      // 폼 값이 있으면 폼 기준(사용자가 수정했을 수 있음)
      var fromForm = metaFromFormFields(parts.videoId);
      return Promise.resolve(fromForm || resolvedVodMeta);
    }
    var filled = metaFromFormFields(parts.videoId);
    if (filled) return Promise.resolve(filled);
    return lookupVodMeta(parts.videoId).then(function (meta) {
      if (meta && meta.date) return metaFromFormFields(parts.videoId) || meta;
      var again = metaFromFormFields(parts.videoId);
      if (again) return again;
      throw new Error('vod_info_failed');
    });
  }

  function readFormPayload(form, streamerId, meta) {
    var fd = new FormData(form);
    var parts = parseVodUrlParts(String(fd.get('vodUrl') || ''));
    var formMeta = parts ? metaFromFormFields(parts.videoId) : null;
    return {
      action: 'submit_song',
      streamerId: streamerId,
      vodUrl: (meta && meta.url) || (parts && parts.url) || normalizeVodUrl(String(fd.get('vodUrl') || '')),
      vodTitle:
        String(fd.get('vodTitle') || '').trim() ||
        (meta && meta.vodTitle) ||
        (formMeta && formMeta.vodTitle) ||
        '',
      date:
        String(fd.get('date') || '').trim() ||
        (meta && meta.date) ||
        (formMeta && formMeta.date) ||
        '',
      thumbnail: (meta && meta.thumbnail) || '',
      time: formatTimeInputValue(String(fd.get('time') || '').trim()),
      songTitle: String(fd.get('songTitle') || '').trim(),
      artist: String(fd.get('artist') || '').trim(),
      note: '',
      noMistake: false,
      recommended: false,
      // 커뮤니티 제출은 항상 검토 필요로 표시
      needsReview: true,
      groupSong:
        !!form.elements.namedItem('groupSong') && form.elements.namedItem('groupSong').checked,
      groupMembers: String(fd.get('groupMembers') || '').trim(),
    };
  }

  function payloadToHistoryEntry(payload) {
    var song = {
      title: payload.songTitle,
      time: payload.time,
      artist: payload.artist,
    };
    if (payload.noMistake) song.noMistake = true;
    if (payload.recommended) song.recommended = true;
    if (payload.needsReview) song.needsReview = true;
    if (payload.groupSong) {
      song.groupSong = true;
      if (payload.groupMembers) song.groupMembers = payload.groupMembers;
    }
    return {
      title: payload.vodTitle,
      date: payload.date,
      url: normalizeVodUrl(payload.vodUrl),
      thumbnail: payload.thumbnail,
      songInfo: [song],
    };
  }

  function optimisticMerge(payload) {
    if (typeof songs === 'undefined' || !Array.isArray(songs)) return;
    var extra = historyToSongs([payloadToHistoryEntry(payload)]);
    mergeCommunitySongs(songs, extra);
    refreshViews();
  }

  function resetFormAfterSubmit(form) {
    form.reset();
    var membersWrap = document.getElementById('addSongGroupMembersWrap');
    if (membersWrap) membersWrap.hidden = true;
    clearVodMetaPreview('');
    resetArtistAutoUi(true);
    hideTitleSuggestions();
  }

  function onSubmitForm(ev) {
    ev.preventDefault();
    var form = ev.target;
    var config = getPageConfig();
    var status = document.getElementById('addSongFormStatus');
    var submitBtn = document.getElementById('addSongSubmitBtn');
    var dialog = document.getElementById(DIALOG_ID);
    var vodUrlRaw =
      (document.getElementById('addSongVodUrl') && document.getElementById('addSongVodUrl').value) ||
      '';

    if (!config.webAppUrl) {
      setStatus(
        status,
        'Apps Script 웹 앱 URL이 아직 설정되지 않았습니다. community-data.js 의 COMMUNITY_SHEETS_WEB_APP_URL 을 채워 주세요.',
        true
      );
      return;
    }
    if (!config.streamerId) {
      setStatus(status, '스트리머 ID(soopChannelId)가 없습니다.', true);
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    setStatus(status, '방송 정보 확인 중…', false);

    ensureVodMetaForSubmit(vodUrlRaw)
      .then(function (meta) {
        var payload = readFormPayload(form, config.streamerId, meta);
        if (!payload.songTitle) throw new Error('missing_songTitle');
        if (!payload.time) throw new Error('missing_time');
        setStatus(status, '제출 중…', false);

        return fetch(config.webAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          redirect: 'follow',
        }).then(function (res) {
          return res.text().then(function (text) {
            var data = null;
            try {
              data = text ? JSON.parse(text) : null;
            } catch (err) {
              data = null;
            }
            return { res: res, data: data, payload: payload };
          });
        });
      })
      .then(function (result) {
        if (result.data && result.data.ok === false) {
          throw new Error(result.data.error || 'submit_failed');
        }
        if (!result.res.ok && !(result.data && result.data.ok)) {
          throw new Error('http_' + result.res.status);
        }
        if (result.data && result.data.ok) {
          result.payload.vodTitle = result.data.vodTitle || result.payload.vodTitle;
          result.payload.date = result.data.date || result.payload.date;
          result.payload.thumbnail = result.data.thumbnail || result.payload.thumbnail;
          result.payload.vodUrl = result.data.vodUrl || result.payload.vodUrl;
        }
        optimisticMerge(result.payload);
        resetFormAfterSubmit(form);
        setStatus(status, '제출되었습니다. 목록에 반영했습니다.', false);
        setTimeout(function () {
          if (dialog && typeof dialog.close === 'function') dialog.close();
          setStatus(status, '', false);
        }, 700);
      })
      .catch(function (err) {
        var msg = String(err && err.message ? err.message : err);
        if (msg === 'invalid_vod_url') {
          setStatus(status, '올바른 Soop 다시보기 URL을 입력해 주세요.', true);
          return;
        }
        if (msg === 'vod_info_failed') {
          setStatus(status, '방송 정보를 가져오지 못해 제출할 수 없습니다.', true);
          return;
        }
        if (msg === 'missing_songTitle' || msg === 'missing_time') {
          setStatus(status, '노래 제목과 시작 시간을 입력해 주세요.', true);
          return;
        }
        // Apps Script 웹 앱은 CORS/리다이렉트 때문에 응답 본문을 못 읽는 경우가 많음
        if (msg === 'Failed to fetch' || msg.indexOf('http_') === 0) {
          var payload = readFormPayload(form, config.streamerId, resolvedVodMeta);
          if (payload.date && payload.songTitle && payload.time) {
            optimisticMerge(payload);
            resetFormAfterSubmit(form);
            setStatus(
              status,
              '제출 요청을 보냈습니다. 응답 확인이 제한되어 목록에 우선 반영했습니다.',
              false
            );
            setTimeout(function () {
              if (dialog && typeof dialog.close === 'function') dialog.close();
              setStatus(status, '', false);
            }, 900);
            return;
          }
        }
        setStatus(status, '제출 실패: ' + msg, true);
      })
      .finally(function () {
        if (submitBtn) submitBtn.disabled = false;
      });
  }

  function loadCommunityData() {
    var config = getPageConfig();
    if (!config.webAppUrl || !config.streamerId) return;
    if (typeof songs === 'undefined' || !Array.isArray(songs)) return;
    if (communityMerged) return;

    var url =
      config.webAppUrl +
      (config.webAppUrl.indexOf('?') >= 0 ? '&' : '?') +
      'action=songs&streamerId=' +
      encodeURIComponent(config.streamerId);

    fetch(url, { method: 'GET', redirect: 'follow' })
      .then(function (res) {
        if (!res.ok) throw new Error('http_' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.history)) return;
        var extra = historyToSongs(data.history);
        var added = mergeCommunitySongs(songs, extra);
        communityMerged = true;
        if (added > 0) refreshViews();
      })
      .catch(function () {
        // 시트 미배포·오프라인 시 정적 songs.js 만으로 동작
      });
  }

  function loadDefaultArtistMap() {
    return fetch('./data/defaultArtistMapping.json')
      .then(function (res) {
        if (!res.ok) throw new Error('http_' + res.status);
        return res.json();
      })
      .then(function (data) {
        defaultArtistMap = data && typeof data === 'object' ? data : {};
      })
      .catch(function () {
        defaultArtistMap = {};
      });
  }

  function init() {
    ensureUi();
    loadDefaultArtistMap();
    loadCommunityData();
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
