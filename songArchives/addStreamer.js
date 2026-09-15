#!/usr/bin/env node
/**
 * 새 스트리머 노래 기록 보관소 폴더를 생성합니다.
 * parseConfig / defaultArtistMapping 기본값은 churahee 를 복사합니다.
 *
 * Usage (repo root):
 *   npm run add-streamer -- --id <soopChannelId> --title <표시이름> [--flags]
 *   npm run add-streamer -- --id irumi1523 --title 백시호 --flags
 *
 * --flags: 실수 없음/추천/검토 필요 UI·제출을 쓰는 스트리머로 streamerFlags.js 에 등록
 *
 * 생성 후 config.json 의 comment_author_id 를 확인한 뒤:
 *   npm run add -- "https://vod.sooplive.com/player/{videoId}"
 */
const fs = require('fs');
const path = require('path');

const songArchivesRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, '..');
const templateStreamerId = 'churahee';
const flagsModulePath = path.join(songArchivesRoot, 'common', 'streamerFlags.js');
const streamerListPath = path.join(songArchivesRoot, 'common', 'streamerList.js');

function parseArgs(argv) {
  let id = '';
  let title = '';
  let flags = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--id' || token === '-i') {
      id = String(argv[++i] || '').trim();
      continue;
    }
    if (token === '--title' || token === '-t' || token === '--name' || token === '-n') {
      title = String(argv[++i] || '').trim();
      continue;
    }
    if (token === '--flags' || token === '--with-flags') {
      flags = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { help: true };
    }
    throw new Error(`알 수 없는 인자: ${token}`);
  }

  return { id, title, flags, help: false };
}

function usage() {
  return [
    'Usage:',
    '  npm run add-streamer -- --id <soopChannelId> --title <표시이름> [--flags]',
    '',
    'Examples:',
    '  npm run add-streamer -- --id irumi1523 --title 백시호 --flags',
    '  npm run add-streamer -- --id singgyul --title 띵귤',
  ].join('\n');
}

function assertSafeId(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('id 는 영문/숫자/밑줄/하이픈만 사용할 수 있습니다.');
  }
  if (id === 'common') {
    throw new Error('"common" 은 예약된 폴더명입니다.');
  }
}

function copyJsonFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function writeText(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function buildIndexHtml({ streamerId, siteTitle }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-G43LGMKF2W"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-G43LGMKF2W');
  </script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(siteTitle)}</title>
  <script>
    window.SONG_ARCHIVE_PAGE = {
      siteTitle: ${JSON.stringify(siteTitle)},
      soopChannelId: ${JSON.stringify(streamerId)},
    };
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../common/archive-page.css">
</head>
<body>

  <header class="site-header">
    <div class="site-header-top site-header-top-three-items">
      <h1 class="site-title">${escapeHtml(siteTitle)}</h1>
      <div class="data-update-meta">
        <p class="data-last-updated" id="dataLastUpdated" aria-live="polite" title=""></p>
      </div>
      <nav class="site-header-nav" aria-label="보관소 이동">
        <select id="archiveNav" class="select site-archive-nav" aria-label="보관소 이동"></select>
      </nav>
    </div>
    <div class="toolbar">
      <input type="text" id="searchBar" class="search-input" placeholder="노래 검색" autocomplete="off" />
      <span class="toolbar-divider" aria-hidden="true"></span>

      <div class="logic-sentence" aria-label="필터링 및 정렬 적용 방식">
        <span>기록 중</span>
        <div class="logic-checkbox-group" role="group" aria-label="기록 필터">
          <label class="chip-label" data-version-flags="on"><input type="checkbox" id="filterVersionNoMistake" /> 클립 방지 실패</label>
          <label class="chip-label" data-version-flags="on"><input type="checkbox" id="filterVersionRecommended" /> 추천</label>
          <label class="chip-label" data-version-flags="on"><input type="checkbox" id="filterVersionNeedsReview" /> 검토 필요</label>
          <label class="chip-label"><input type="checkbox" id="filterExcludeSyncroom" /> 싱크룸 제외</label>
        </div>
        <span>에 해당하는 것만 남기고, 그 기록이 최소</span>
        <input
          type="number"
          id="minVersionCount"
          class="min-version-input"
          min="1"
          step="1"
          value="1"
          aria-label="최소 버전 수"
        />
        <span>개 있는 곡을</span>
        <select id="listSort" class="select" aria-label="곡 정렬 옵션">
          <option value="title">가나다순</option>
          <option value="dateDesc">최신 방송순</option>
          <option value="dateAsc">오래된 방송순</option>
          <option value="versionCountDesc">기록 많은 순</option>
          <option value="noMistakeRatioDesc" data-version-flags="on">클립 방지 비율 낮은 순</option>
          <option value="noMistakeRatioAsc" data-version-flags="on">클립 방지 비율 높은 순</option>
          <option value="noMistakeCountDesc" data-version-flags="on">클립 방지 적은 순</option>
          <option value="noMistakeCountAsc" data-version-flags="on">클립 방지 많은 순</option>
        </select>
        <span>으로 정렬합니다.</span>
        <span class="logic-sep" aria-hidden="true">|</span>
        <span>남은 기록은</span>
        <select id="versionSort" class="select" aria-label="버전 정렬 옵션">
          <option value="dateDesc">최신순</option>
          <option value="dateAsc">오래된순</option>
        </select>
        <span>으로 정렬합니다.</span>
      </div>
    </div>
  </header>

  <div class="page-layout">
    <main class="main main-area">
      <div id="songList" class="song-rows">
      </div>
    </main>

    <aside id="vodPanel" class="vod-panel" aria-label="노래 기록이 있는 날짜">
      <div class="vod-panel-header">
        <button type="button" id="vodPanelToggle" class="vod-panel-toggle" aria-expanded="true" aria-controls="vodPanelBody" title="패널 접기/펼치기">
          <span class="vod-panel-toggle-icon" aria-hidden="true"></span>
        </button>
        <h2 class="vod-panel-title">노래 기록이 있는 날짜</h2>
      </div>
      <div id="vodPanelBody" class="vod-panel-body">
        <div class="vod-panel-toolbar">
          <label class="vod-panel-label" for="vodPanelViewMode">보기 형식</label>
          <select id="vodPanelViewMode" class="select vod-panel-select" aria-label="노래 기록 날짜 패널 표시 방식">
            <option value="list">목록</option>
            <option value="calendar" selected>달력</option>
          </select>
          <label class="vod-panel-label" for="vodPanelDateSort">날짜 정렬</label>
          <select id="vodPanelDateSort" class="select vod-panel-select" aria-label="노래 기록 날짜 정렬">
            <option value="dateDesc">최근순</option>
            <option value="dateAsc">오래된 순</option>
          </select>
        </div>
        <div id="vodPanelListWrap" class="vod-panel-list-wrap is-hidden" hidden>
          <ul id="vodPanelList" class="vod-panel-list"></ul>
        </div>
        <div id="vodPanelCalendarWrap" class="vod-panel-calendar-wrap"></div>
      </div>
    </aside>
  </div>

  <script src="songs.js"></script>
  <script src="../common/streamerList.js"></script>
  <script src="../common/streamerFlags.js"></script>
  <script src="../common/archive-page.js"></script>
  <script src="../common/community-data.js"></script>

</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureHubLink(streamerId, displayName) {
  const hubPath = path.join(songArchivesRoot, 'index.html');
  let html = fs.readFileSync(hubPath, 'utf8');
  if (html.includes(`href="${streamerId}/"`)) {
    console.log(`[skip] hub already has link for ${streamerId}`);
    return;
  }
  const link = `    <a href="${streamerId}/">${escapeHtml(displayName)}의 노래 기록 보관소</a>\n`;
  const navClose = /([\t ]*)<\/nav>/;
  if (!navClose.test(html)) {
    throw new Error('songArchives/index.html 에서 </nav> 를 찾지 못했습니다.');
  }
  html = html.replace(navClose, `${link}$1</nav>`);
  fs.writeFileSync(hubPath, html, 'utf8');
  console.log(`[ok] hub link → songArchives/index.html`);
}

function registerFlagsStreamer(streamerId) {
  let src = fs.readFileSync(flagsModulePath, 'utf8');
  if (new RegExp(`['"]${streamerId}['"]`).test(src)) {
    console.log(`[skip] already in STREAMERS_WITH_VERSION_FLAGS: ${streamerId}`);
    return;
  }
  const next = src.replace(
    /(var\s+STREAMERS_WITH_VERSION_FLAGS\s*=\s*\[)([^\]]*)(\])/,
    function (_m, open, body, close) {
      var trimmed = String(body || '').trim();
      var entry = trimmed ? trimmed.replace(/\s*$/, '') + `, '${streamerId}'` : `'${streamerId}'`;
      return open + entry + close;
    }
  );
  if (next === src) {
    throw new Error('streamerFlags.js 의 STREAMERS_WITH_VERSION_FLAGS 배열을 찾지 못했습니다.');
  }
  fs.writeFileSync(flagsModulePath, next, 'utf8');
  console.log(`[ok] flags list ← ${streamerId}`);
}

function ensureStreamerListEntry(streamerId, displayName) {
  let src = fs.readFileSync(streamerListPath, 'utf8');
  if (new RegExp(`id:\\s*['"]${streamerId}['"]`).test(src)) {
    console.log(`[skip] already in SONG_ARCHIVE_STREAMERS: ${streamerId}`);
    return;
  }
  const entry = `  { id: ${JSON.stringify(streamerId)}, name: ${JSON.stringify(displayName)} },\n`;
  const next = src.replace(
    /(var\s+SONG_ARCHIVE_STREAMERS\s*=\s*\[[\s\S]*?)(\n\];)/,
    function (_m, body, close) {
      return body + entry + close;
    }
  );
  if (next === src) {
    throw new Error('streamerList.js 의 SONG_ARCHIVE_STREAMERS 배열을 찾지 못했습니다.');
  }
  fs.writeFileSync(streamerListPath, next, 'utf8');
  console.log(`[ok] streamer list ← ${streamerId}`);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message || err);
    console.error('');
    console.error(usage());
    process.exit(1);
  }

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const streamerId = args.id;
  const titleName = args.title;
  if (!streamerId || !titleName) {
    console.error('--id 와 --title 은 필수입니다.');
    console.error('');
    console.error(usage());
    process.exit(1);
  }

  assertSafeId(streamerId);

  const siteTitle = titleName.includes('노래 기록')
    ? titleName
    : `${titleName} 노래 기록 보관소`;
  const hubLabel = titleName.replace(/\s*노래 기록 보관소\s*$/, '').trim() || titleName;

  const destDir = path.join(songArchivesRoot, streamerId);
  if (fs.existsSync(destDir)) {
    console.error(`이미 존재하는 폴더입니다: ${destDir}`);
    process.exit(1);
  }

  const templateDir = path.join(songArchivesRoot, templateStreamerId);
  const templateParse = path.join(templateDir, 'data', 'parseConfig.json');
  const templateMap = path.join(templateDir, 'data', 'defaultArtistMapping.json');
  if (!fs.existsSync(templateParse) || !fs.existsSync(templateMap)) {
    console.error(`기본 템플릿(${templateStreamerId}) parseConfig/defaultArtistMapping 이 없습니다.`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(destDir, 'data'), { recursive: true });

  writeText(path.join(destDir, 'index.html'), buildIndexHtml({ streamerId, siteTitle }));
  writeText(
    path.join(destDir, 'data', 'source.json'),
    JSON.stringify({ history: [] }, null, 4) + '\n'
  );
  copyJsonFile(templateParse, path.join(destDir, 'data', 'parseConfig.json'));
  copyJsonFile(templateMap, path.join(destDir, 'data', 'defaultArtistMapping.json'));

  const config = {
    comment_author_id: streamerId,
    debug: false,
  };
  writeText(path.join(destDir, 'data', 'config.json'), JSON.stringify(config, null, 2) + '\n');
  writeText(
    path.join(destDir, 'data', 'config.example.json'),
    JSON.stringify({ comment_author_id: '', debug: false }, null, 2) + '\n'
  );

  const nowIso = new Date().toISOString();
  writeText(
    path.join(destDir, 'songs.js'),
    `const SONGS_DATA_LAST_UPDATED = ${JSON.stringify(nowIso)};\nconst songs = [];\n`
  );

  writeText(
    path.join(destDir, 'README.md'),
    `# ${hubLabel} 보관소 (\`${streamerId}/\`)\n\n` +
      `- **사용자:** 저장소 루트 [README.md](../../README.md)\n` +
      `- **개발:** 저장소 루트 [README.dev.md](../../README.dev.md)\n`
  );

  ensureHubLink(streamerId, hubLabel);
  ensureStreamerListEntry(streamerId, hubLabel);

  if (args.flags) {
    registerFlagsStreamer(streamerId);
  }

  console.log('');
  console.log(`생성 완료: songArchives/${streamerId}/`);
  console.log(`siteTitle: ${siteTitle}`);
  console.log(`version flags: ${args.flags ? 'ON' : 'OFF'}`);
  console.log('');
  console.log('다음:');
  console.log(`  1) songArchives/${streamerId}/data/config.json 의 comment_author_id 확인`);
  console.log(`  2) npm run add -- "https://vod.sooplive.com/player/{videoId}"`);
  console.log(`  3) (선택) README.md 바로가기에 링크 추가`);
  if (!args.flags) {
    console.log(`  4) 플래그가 필요하면 streamerFlags.js 에 '${streamerId}' 추가`);
  }
}

main();
