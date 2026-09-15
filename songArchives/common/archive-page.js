function getListSort() {
  const el = document.getElementById('listSort');
  return (el && el.value) || 'title';
}

function getVersionSort() {
  const el = document.getElementById('versionSort');
  return (el && el.value) || 'dateDesc';
}

/** 1-1 기록 필터 체크박스 상태(복수 선택 시 AND로 적용) */
function getVersionFilters() {
  return {
    noMistakeOnly: document.getElementById('filterVersionNoMistake')?.checked ?? false,
    recommendedOnly: document.getElementById('filterVersionRecommended')?.checked ?? false,
    needsReviewOnly: document.getElementById('filterVersionNeedsReview')?.checked ?? false,
    excludeSyncroom: document.getElementById('filterExcludeSyncroom')?.checked ?? false,
  };
}

function getExcludeSyncroom() {
  return document.getElementById('filterExcludeSyncroom')?.checked ?? false;
}

function getMinVersionCount() {
  const el = document.getElementById('minVersionCount');
  const raw = el?.value;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 1;
  return Math.max(1, n);
}

function parseVodDate(dateStr) {
  if (!dateStr) return 0;
  const s = String(dateStr).trim();
  if (!s) return 0;
  const ymd = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (ymd) {
    const t = new Date(ymd[1] + 'T00:00:00+09:00').getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function maxDateFromVersions(versions) {
  if (!versions || !versions.length) return 0;
  const timestamps = versions.map((v) => parseVodDate(v.date)).filter((t) => t > 0);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function minDateFromVersions(versions) {
  if (!versions || !versions.length) return 0;
  const timestamps = versions.map((v) => parseVodDate(v.date)).filter((t) => t > 0);
  return timestamps.length ? Math.min(...timestamps) : 0;
}

function noMistakeRatio(versions) {
  if (!versions || !versions.length) return 0;
  const total = versions.length;
  if (!total) return 0;
  const ok = versions.filter((v) => v.noMistake).length;
  return ok / total;
}

function noMistakeCount(versions) {
  if (!versions || !versions.length) return 0;
  return versions.filter((v) => v.noMistake).length;
}

/** 1-1 기록 필터링: 체크된 조건을 AND로 적용해 기록(버전)을 실제로 걸러낸다(선택 없으면 전부 유지) */
function applyRecordFilters(versions, versionFilters) {
  let list = versions ? [...versions] : [];
  if (versionFilters.noMistakeOnly) list = list.filter((v) => v.noMistake);
  if (versionFilters.recommendedOnly) list = list.filter((v) => v.recommended);
  if (versionFilters.needsReviewOnly) list = list.filter((v) => v.needsReview);
  if (versionFilters.excludeSyncroom) list = list.filter((v) => !isSyncroomVersion(v));
  return list;
}

/** 3) 노래 안의 기록 정렬 */
function sortVersionsByVersionSort(versions, versionSort) {
  let list = versions ? [...versions] : [];
  if (versionSort === 'dateAsc') {
    list.sort((a, b) => parseVodDate(a.date) - parseVodDate(b.date));
  } else {
    list.sort((a, b) => parseVodDate(b.date) - parseVodDate(a.date));
  }
  return list;
}

function versionIconsHtml(version) {
  const parts = [];
  if (version.noMistake) parts.push('<span class="version-icon" title="실수 없음">○</span>');
  if (version.recommended) parts.push('<span class="version-icon" title="추천">☆</span>');
  if (version.needsReview) parts.push('<span class="version-icon version-icon-review" title="검토 필요">?</span>');
  return parts.length ? '<span class="version-icons">' + parts.join('') + '</span>' : '';
}

function syncroomBadgeHtml(version) {
  if (!isSyncroomVersion(version)) return '';
  const members = String(version?.groupMembers || '').trim();
  const titleAttr = members ? ` title="${escapeHtml(members)}"` : '';
  return `<span class="version-badge version-badge-syncroom"${titleAttr}>싱크룸</span>`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function isSyncroomVersion(version) {
  return version?.groupSong === true;
}

function loadSongs(searchTerm = '') {
  const container = document.getElementById('songList');
  if (!container) return;

  const versionFilters = getVersionFilters();
  const versionSort = getVersionSort();
  const minVersionCount = getMinVersionCount();
  const listSort = getListSort();

  const q = (searchTerm || '').toLowerCase();
  let list = songs
    // 1-2) 노래 필터링: 키워드 검색(제목/가수)
    .filter((song) => {
      const t = (song.title || '').toLowerCase();
      const a = (song.artist || '').toLowerCase();
      return t.includes(q) || a.includes(q);
    })
    .map((song) => ({
      song,
      // 1-1) 기록 필터링: 체크된 조건을 AND로 적용
      versions: applyRecordFilters(song.versions || [], versionFilters),
    }))
    // 1-3) 노래 필터링: 필터링된 기록이 최소 개수 이상인 곡만
    .filter(({ versions }) => versions.length >= minVersionCount);

  // 2) 노래 정렬: 필터링된 기록 기준으로 곡 순서를 정함
  if (listSort === 'title') {
    list.sort((a, b) => {
      const c = (a.song.title || '').localeCompare(b.song.title || '', 'ko');
      if (c !== 0) return c;
      return (a.song.artist || '').localeCompare(b.song.artist || '', 'ko');
    });
  } else if (listSort === 'dateDesc') {
    list.sort((a, b) => maxDateFromVersions(b.versions) - maxDateFromVersions(a.versions));
  } else if (listSort === 'dateAsc') {
    list.sort((a, b) => minDateFromVersions(a.versions) - minDateFromVersions(b.versions));
  } else if (listSort === 'versionCountDesc') {
    list.sort((a, b) => b.versions.length - a.versions.length);
  } else if (listSort === 'noMistakeRatioDesc') {
    list.sort(
      (a, b) =>
        noMistakeRatio(b.versions) - noMistakeRatio(a.versions) ||
        b.versions.length - a.versions.length
    );
  } else if (listSort === 'noMistakeRatioAsc') {
    list.sort(
      (a, b) =>
        noMistakeRatio(a.versions) - noMistakeRatio(b.versions) ||
        a.versions.length - b.versions.length
    );
  } else if (listSort === 'noMistakeCountDesc') {
    list.sort(
      (a, b) =>
        noMistakeCount(b.versions) - noMistakeCount(a.versions) ||
        b.versions.length - a.versions.length
    );
  } else if (listSort === 'noMistakeCountAsc') {
    list.sort(
      (a, b) =>
        noMistakeCount(a.versions) - noMistakeCount(b.versions) ||
        a.versions.length - b.versions.length
    );
  }

  container.innerHTML = '';

  list.forEach(({ song, versions }) => {
    // 3) 노래 안의 기록 정렬
    const versionsSorted = sortVersionsByVersionSort(versions, versionSort);

    const row = document.createElement('section');
    row.className = 'song-row';

    const heading = document.createElement('div');
    heading.className = 'song-row-heading';

    const titleEl = document.createElement('h2');
    titleEl.className = 'song-row-title';
    titleEl.textContent = song.title;
    heading.appendChild(titleEl);

    if (song.artist) {
      const artistEl = document.createElement('span');
      artistEl.className = 'song-row-artist';
      artistEl.textContent = song.artist;
      heading.appendChild(artistEl);
    }

    const strip = document.createElement('div');
    strip.className = 'version-strip';

    versionsSorted.forEach((v) => {
      const icons = versionIconsHtml(v);
      const syncroomBadge = syncroomBadgeHtml(v);
      const card = document.createElement('a');
      card.href = v.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.className = 'version-card';
      card.innerHTML = `
        <span class="version-card-thumb">
          <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy" />
        </span>
        <span class="version-card-info">
          <span class="version-card-meta">
            <span class="version-card-date">${escapeHtml(v.date)}</span>
            ${syncroomBadge ? `<span class="version-card-badges">${syncroomBadge}</span>` : ''}
            ${icons ? `<span class="version-card-icons">${icons}</span>` : ''}
          </span>
          <span class="version-card-title">${escapeHtml(v.videoTitle || '')}</span>
        </span>
      `;
      strip.appendChild(card);
    });

    row.appendChild(heading);
    row.appendChild(strip);
    container.appendChild(row);
  });
}

function searchSongs() {
  loadSongs(document.getElementById('searchBar')?.value ?? '');
}

function onFilterOrSortChange() {
  loadSongs(document.getElementById('searchBar')?.value ?? '');
}

function onSyncroomToggleChange() {
  loadSongs(document.getElementById('searchBar')?.value ?? '');
  renderVodPanel();
}

(function setupStripDragScroll() {
  const DRAG_THRESHOLD = 5;
  let state = { strip: null, startX: 0, startScroll: 0, didMove: false };
  let preventClick = false;

  function getStrip(el) {
    return el && el.closest ? el.closest('.version-strip') : null;
  }

  function isStripBackground(target) {
    const strip = getStrip(target);
    return strip && target === strip;
  }

  function endDrag(allowPreventClick) {
    if (state.strip) {
      if (state.didMove && allowPreventClick) preventClick = true;
      state.strip.classList.remove('dragging');
      state = { strip: null, startX: 0, startScroll: 0, didMove: false };
    }
  }

  document.addEventListener('mousedown', (e) => {
    if (!isStripBackground(e.target)) return;
    const strip = getStrip(e.target);
    state = { strip, startX: e.clientX, startScroll: strip.scrollLeft, didMove: false };
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.strip) return;
    const dx = state.startX - e.clientX;
    if (!state.didMove && Math.abs(dx) > DRAG_THRESHOLD) {
      state.didMove = true;
      state.strip.classList.add('dragging');
    }
    if (state.didMove) state.strip.scrollLeft = state.startScroll + dx;
  });

  document.addEventListener('mouseup', () => endDrag(true));
  window.addEventListener('mouseup', () => endDrag(true), true);
  document.addEventListener('mouseleave', (e) => {
    if (e.target === document.documentElement || e.target === document.body) endDrag(false);
  });

  document.addEventListener('click', (e) => {
    if (preventClick && getStrip(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      preventClick = false;
    }
  }, true);

  document.addEventListener('touchstart', (e) => {
    if (!isStripBackground(e.target) || e.touches.length !== 1) return;
    const strip = getStrip(e.target);
    state = { strip, startX: e.touches[0].clientX, startScroll: strip.scrollLeft, didMove: false };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!state.strip || e.touches.length !== 1) return;
    const dx = state.startX - e.touches[0].clientX;
    if (!state.didMove && Math.abs(dx) > DRAG_THRESHOLD) {
      state.didMove = true;
      state.strip.classList.add('dragging');
    }
    if (state.didMove) state.strip.scrollLeft = state.startScroll + dx;
  }, { passive: true });

  document.addEventListener('touchend', () => endDrag(true));
  document.addEventListener('touchcancel', () => endDrag(false));
})();

function renderDataLastUpdated() {
  const el = document.getElementById('dataLastUpdated');
  if (!el) return;
  if (typeof SONGS_DATA_LAST_UPDATED !== 'string' || !SONGS_DATA_LAST_UPDATED) {
    el.textContent = '';
    return;
  }
  const d = new Date(SONGS_DATA_LAST_UPDATED);
  if (Number.isNaN(d.getTime())) {
    el.textContent = '정식 데이터 갱신일: ' + SONGS_DATA_LAST_UPDATED;
    el.title = SONGS_DATA_LAST_UPDATED;
    return;
  }
  el.textContent =
    '정식 데이터 갱신일: ' +
    d.toLocaleString('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Seoul',
    });
  el.title = 'UTC: ' + d.toISOString();
}

/** 다시보기 플레이어 URL에서 쿼리를 제거한 페이지 주소 (동일 방송 중복 제거용) */
function vodPageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl, typeof location !== 'undefined' ? location.href : undefined);
    u.search = '';
    return u.toString();
  } catch {
    const s = String(rawUrl);
    const i = s.indexOf('?');
    return i >= 0 ? s.slice(0, i) : s;
  }
}

const VOD_CAL_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let vodIndexCache = null;

function buildVodIndex() {
  const byBase = new Map();
  if (typeof songs === 'undefined' || !Array.isArray(songs)) {
    return { entries: [], byDate: new Map() };
  }

  for (const song of songs) {
    const versions = song.versions || [];
    for (const v of versions) {
      if (!v || !v.url) continue;
      const base = vodPageUrl(v.url);
      const datePart = String(v.date || '').trim().slice(0, 10);
      const ts = parseVodDate(datePart);
      const existing = byBase.get(base);
      if (!existing) {
        byBase.set(base, {
          pageUrl: base,
          date: datePart,
          ts,
          videoTitle: v.videoTitle || '',
          thumbnail: v.thumbnail || '',
        });
      } else {
        if (ts > existing.ts) {
          existing.date = datePart;
          existing.ts = ts;
        }
        if (!existing.videoTitle && v.videoTitle) existing.videoTitle = v.videoTitle;
        if (!existing.thumbnail && v.thumbnail) existing.thumbnail = v.thumbnail;
      }
    }
  }

  const entries = Array.from(byBase.values());
  const byDate = new Map();
  for (const e of entries) {
    if (!e.date) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  for (const [, arr] of byDate) {
    arr.sort((a, b) => (a.pageUrl || '').localeCompare(b.pageUrl || ''));
  }
  return { entries, byDate };
}

function getVodIndex() {
  if (!vodIndexCache) vodIndexCache = buildVodIndex();
  return vodIndexCache;
}

function getFilteredVodEntries() {
  const { entries } = getVodIndex();
  const excludeSyncroom = getExcludeSyncroom();
  if (!excludeSyncroom) return entries;
  return entries.filter((e) => !isSyncroomVersion(e));
}

function buildVodByDate(entries) {
  const byDate = new Map();
  for (const e of entries) {
    if (!e.date) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  for (const [, arr] of byDate) {
    arr.sort((a, b) => (a.pageUrl || '').localeCompare(b.pageUrl || ''));
  }
  return byDate;
}

function getVodPanelDateSort() {
  const el = document.getElementById('vodPanelDateSort');
  return (el && el.value) || 'dateDesc';
}

function getVodPanelViewMode() {
  const el = document.getElementById('vodPanelViewMode');
  return (el && el.value) || 'list';
}

function sortedVodEntries(entries, sortMode) {
  const list = entries ? [...entries] : [];
  if (sortMode === 'dateAsc') {
    list.sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.pageUrl || '').localeCompare(b.pageUrl || ''));
  } else {
    list.sort((a, b) => (b.ts || 0) - (a.ts || 0) || (a.pageUrl || '').localeCompare(b.pageUrl || ''));
  }
  return list;
}

function renderVodPanelList() {
  const ul = document.getElementById('vodPanelList');
  if (!ul) return;
  const entries = getFilteredVodEntries();
  const sortMode = getVodPanelDateSort();
  const sorted = sortedVodEntries(entries, sortMode);

  ul.innerHTML = '';
  sorted.forEach((e) => {
    const li = document.createElement('li');
    li.className = 'vod-panel-item';
    const a = document.createElement('a');
    a.className = 'vod-panel-link';
    a.href = e.pageUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'vod-panel-date';
    dateSpan.textContent = e.date || '날짜 없음';
    a.appendChild(dateSpan);
    if (e.videoTitle) {
      const t = document.createElement('span');
      t.className = 'vod-panel-link-title';
      t.textContent = e.videoTitle;
      a.appendChild(t);
    }
    li.appendChild(a);
    ul.appendChild(li);
  });
}

/** 한국(서울) 기준 오늘이 속한 연-월 `YYYY-MM` */
function getCurrentYearMonthSeoul() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const mRaw = parts.find((p) => p.type === 'month')?.value;
  if (!y || mRaw == null || mRaw === '') {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${y}-${String(mRaw).padStart(2, '0')}`;
}

function enumerateYearMonths(minDateStr, maxDateStr, newestFirst) {
  const months = [];
  const min = String(minDateStr || '').slice(0, 7);
  const max = String(maxDateStr || '').slice(0, 7);
  if (!min || min.length < 7 || !max || max.length < 7) return months;

  const [y0, m0] = min.split('-').map((x) => Number.parseInt(x, 10));
  const [y1, m1] = max.split('-').map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y0) || !Number.isFinite(m0) || !Number.isFinite(y1) || !Number.isFinite(m1)) {
    return months;
  }

  let y = y0;
  let m = m0;
  const endKey = y1 * 12 + (m1 - 1);
  for (;;) {
    const key = y * 12 + (m - 1);
    if (key > endKey) break;
    months.push({ y, m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  if (newestFirst) months.reverse();
  return months;
}

function primaryVodForDay(dayEntries, sortMode) {
  if (!dayEntries || !dayEntries.length) return null;
  const copy = [...dayEntries];
  if (sortMode === 'dateAsc') {
    copy.sort((a, b) => (a.pageUrl || '').localeCompare(b.pageUrl || ''));
  } else {
    copy.sort((a, b) => (b.pageUrl || '').localeCompare(a.pageUrl || ''));
  }
  return copy[0];
}

function renderVodPanelCalendar() {
  const wrap = document.getElementById('vodPanelCalendarWrap');
  if (!wrap) return;
  const entries = getFilteredVodEntries();
  const byDate = buildVodByDate(entries);
  if (!entries.length) {
    wrap.innerHTML = '';
    return;
  }

  const sortMode = getVodPanelDateSort();
  const chron = sortedVodEntries(entries, 'dateAsc');
  const firstDataDate = chron[0]?.date;
  const firstYm = String(firstDataDate || '').slice(0, 7);
  const curYm = getCurrentYearMonthSeoul();
  if (!firstYm || firstYm.length < 7) {
    wrap.innerHTML = '';
    return;
  }
  /* 가장 오래된 기록 월 ~ 오늘(서울)이 속한 월 (ISO YYYY-MM 문자열 비교) */
  const minRangeYm = firstYm <= curYm ? firstYm : curYm;
  const maxRangeYm = firstYm <= curYm ? curYm : firstYm;
  const months = enumerateYearMonths(
    `${minRangeYm}-01`,
    `${maxRangeYm}-01`,
    sortMode === 'dateDesc'
  );

  wrap.innerHTML = '';
  months.forEach(({ y, m }) => {
    const section = document.createElement('section');
    section.className = 'vod-cal-month';
    const h3 = document.createElement('h3');
    h3.className = 'vod-cal-month-title';
    h3.textContent = `${y}년 ${m}월`;
    section.appendChild(h3);

    const grid = document.createElement('div');
    grid.className = 'vod-cal-grid';
    VOD_CAL_WEEKDAYS.forEach((wd) => {
      const h = document.createElement('div');
      h.className = 'vod-cal-weekday';
      h.textContent = wd;
      grid.appendChild(h);
    });

    const first = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0).getDate();
    const startPad = first.getDay();
    for (let i = 0; i < startPad; i += 1) {
      const pad = document.createElement('div');
      pad.className = 'vod-cal-day is-pad';
      pad.setAttribute('aria-hidden', 'true');
      grid.appendChild(pad);
    }

    for (let d = 1; d <= lastDay; d += 1) {
      const mm = String(m).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${y}-${mm}-${dd}`;
      const dayList = byDate.get(dateStr);
      if (dayList && dayList.length) {
        const primary = primaryVodForDay(dayList, sortMode);
        const a = document.createElement('a');
        a.className = 'vod-cal-day';
        a.href = primary ? primary.pageUrl : '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title =
          dayList.length > 1
            ? `${dateStr} · 다시보기 ${dayList.length}건`
            : primary?.videoTitle
              ? `${dateStr} — ${primary.videoTitle}`
              : dateStr;
        const inner = document.createElement('span');
        inner.className = 'vod-cal-day-inner';
        inner.textContent = String(d);
        if (dayList.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'vod-cal-day-count';
          badge.textContent = String(dayList.length);
          inner.appendChild(badge);
        }
        a.appendChild(inner);
        grid.appendChild(a);
      } else {
        const span = document.createElement('div');
        span.className = 'vod-cal-day';
        span.textContent = String(d);
        grid.appendChild(span);
      }
    }

    section.appendChild(grid);
    wrap.appendChild(section);
  });
}

function updateVodPanelVisibility() {
  const mode = getVodPanelViewMode();
  const listWrap = document.getElementById('vodPanelListWrap');
  const calWrap = document.getElementById('vodPanelCalendarWrap');
  if (listWrap && calWrap) {
    const isList = mode === 'list';
    listWrap.classList.toggle('is-hidden', !isList);
    listWrap.toggleAttribute('hidden', !isList);
    calWrap.classList.toggle('is-hidden', isList);
    calWrap.toggleAttribute('hidden', isList);
  }
}

function renderVodPanel() {
  updateVodPanelVisibility();
  const mode = getVodPanelViewMode();
  if (mode === 'list') {
    renderVodPanelList();
  } else {
    renderVodPanelCalendar();
  }
}

/** 커뮤니티 데이터 병합 후 목록·VOD 패널을 다시 그린다. */
function refreshSongArchiveViews() {
  vodIndexCache = null;
  loadSongs(document.getElementById('searchBar')?.value ?? '');
  renderVodPanel();
}

if (typeof window !== 'undefined') {
  window.refreshSongArchiveViews = refreshSongArchiveViews;
}

function setupVodPanel() {
  const panel = document.getElementById('vodPanel');
  const toggle = document.getElementById('vodPanelToggle');
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  }
  document.getElementById('vodPanelViewMode')?.addEventListener('change', renderVodPanel);
  document.getElementById('vodPanelDateSort')?.addEventListener('change', renderVodPanel);
  renderVodPanel();
}

/** Soop CDN 프로필 로고 (webp). fetch 불필요 — <link rel="icon">은 CORS 제한 없이 로드됨. */
function soopProfileLogoWebpUrl(channelId) {
  const id = String(channelId).trim().toLowerCase();
  if (id.length < 2) return null;
  const prefix = id.slice(0, 2);
  const enc = encodeURIComponent(id);
  const encPrefix = encodeURIComponent(prefix);
  return `https://stimg.sooplive.com/LOGO/${encPrefix}/${enc}/m/${enc}.webp`;
}

function guessFaviconMimeType(href) {
  const lower = String(href).toLowerCase();
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.svg')) return 'image/svg+xml';
  if (lower.includes('.ico')) return 'image/x-icon';
  return 'image/png';
}

function ensureStimgPreconnect() {
  const origin = 'https://stimg.sooplive.com';
  if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const pc = document.createElement('link');
  pc.rel = 'preconnect';
  pc.href = origin;
  pc.crossOrigin = 'anonymous';
  document.head.insertBefore(pc, document.head.firstChild);
}

/**
 * 스트리머 폴더 index.html: window.SONG_ARCHIVE_PAGE
 * - siteTitle (선택)
 * - favicon (선택): 절대 URL 또는 스트리머 폴더 기준 상대 경로. 있으면 Soop CDN보다 우선.
 * - soopChannelId (선택): Soop 채널 슬러그. 로고는 LOGO/{앞2글자}/{id}/m/{id}.webp.
 */
function applySongArchivePageConfig() {
  const c = typeof window !== 'undefined' ? window.SONG_ARCHIVE_PAGE : null;
  if (!c || typeof c !== 'object') return;
  if (c.siteTitle) {
    document.title = c.siteTitle;
    const h1 = document.querySelector('.site-title');
    if (h1) h1.textContent = c.siteTitle;
  }

  let iconHref = null;
  let iconType = 'image/png';
  if (typeof c.favicon === 'string' && c.favicon.trim()) {
    iconHref = c.favicon.trim();
    iconType = guessFaviconMimeType(iconHref);
  } else if (typeof c.soopChannelId === 'string' && c.soopChannelId.trim()) {
    iconHref = soopProfileLogoWebpUrl(c.soopChannelId);
    if (iconHref) {
      iconType = 'image/webp';
      ensureStimgPreconnect();
    }
  }
  if (!iconHref) return;

  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.insertBefore(link, document.head.firstChild);
  }
  link.type = iconType;
  link.href = iconHref;
}

function getArchiveStreamerId() {
  const c = typeof window !== 'undefined' ? window.SONG_ARCHIVE_PAGE : null;
  if (!c || typeof c !== 'object') return '';
  return String(c.archiveId || c.soopChannelId || '').trim();
}

function getArchiveStreamerEntries() {
  const api = typeof window !== 'undefined' ? window.SONG_ARCHIVE_STREAMER_LIST : null;
  const list = api && Array.isArray(api.SONG_ARCHIVE_STREAMERS) ? api.SONG_ARCHIVE_STREAMERS : [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const id = String(entry.id || '').trim();
      const name = String(entry.name || '').trim();
      if (!id || !name) return null;
      return { id, name };
    })
    .filter(Boolean);
}

/** 헤더 드롭다운: 허브·다른 스트리머 보관소로 이동 */
function setupArchiveNav() {
  const select = document.getElementById('archiveNav');
  if (!select) return;

  const currentId = getArchiveStreamerId();
  const hubValue = '../index.html';
  const options = [
    { value: hubValue, label: '목록으로 돌아가기', id: '' },
    ...getArchiveStreamerEntries().map((entry) => ({
      value: `../${entry.id}/`,
      label: entry.name,
      id: entry.id,
    })),
  ];

  select.textContent = '';
  let selectedValue = hubValue;
  options.forEach((opt) => {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    if (opt.id && opt.id === currentId) selectedValue = opt.value;
    select.appendChild(el);
  });
  select.value = selectedValue;

  select.addEventListener('change', () => {
    const href = String(select.value || '').trim();
    if (!href) return;
    window.location.assign(href);
  });
}

function archiveUsesVersionFlags() {
  const api = typeof window !== 'undefined' ? window.SONG_ARCHIVE_STREAMER_FLAGS : null;
  if (!api || typeof api.usesVersionFlags !== 'function') return false;
  return !!api.usesVersionFlags(getArchiveStreamerId());
}

/** streamerFlags.js 기준으로 실수없음/추천/검토 UI·정렬 옵션 표시 */
function setupVersionFlagsUi() {
  const enabled = archiveUsesVersionFlags();

  document.querySelectorAll('[data-version-flags="on"]').forEach((el) => {
    if (el.tagName === 'OPTION') {
      el.disabled = !enabled;
      el.hidden = !enabled;
      return;
    }
    el.hidden = !enabled;
  });

  document.querySelectorAll('[data-version-flags="off"]').forEach((el) => {
    el.hidden = enabled;
  });

  if (!enabled) {
    const listSort = document.getElementById('listSort');
    if (listSort && String(listSort.value || '').startsWith('noMistake')) {
      listSort.value = 'title';
    }
    ['filterVersionNoMistake', 'filterVersionRecommended', 'filterVersionNeedsReview'].forEach(
      (id) => {
        const input = document.getElementById(id);
        if (input) input.checked = false;
      }
    );
  }
}

applySongArchivePageConfig();
setupVersionFlagsUi();
setupArchiveNav();

window.onload = () => {
  setupVersionFlagsUi();
  renderDataLastUpdated();
  loadSongs();
  setupVodPanel();
  document.getElementById('searchBar')?.addEventListener('input', searchSongs);
  document.getElementById('searchBar')?.addEventListener('keyup', searchSongs);
  document.getElementById('listSort')?.addEventListener('change', onFilterOrSortChange);
  document.getElementById('versionSort')?.addEventListener('change', onFilterOrSortChange);
  document.getElementById('minVersionCount')?.addEventListener('input', onFilterOrSortChange);
  ['filterVersionNoMistake', 'filterVersionRecommended', 'filterVersionNeedsReview'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', onFilterOrSortChange);
  });
  document.getElementById('filterExcludeSyncroom')?.addEventListener('change', onSyncroomToggleChange);
};
