#!/usr/bin/env node
/**
 * Add or update VODs from a Soop URL and/or bare videoIds. Archive = match VOD streamer id (API field `writer_id`) to config/folder.
 * Usage (repo root):
 *   npm run add -- "https://vod.sooplive.com/player/{videoId}"
 *   npm run add -- "https://vod.sooplive.com/player/{videoId}" 189435112 189435113
 *   npm run add -- 189435111 189435112
 * 강제 아카이브 지정: npm run add -- "<url|videoId>" [videoId...] --streamer chebi2
 * 비대화형(제목/가수 확인 프롬프트 생략): ADD_VOD_NON_INTERACTIVE=1 npm run add -- "<url|videoId>" [videoId...]
 *
 * 이 파일은 CLI 진입점만 담당한다. 파이프라인 로직은 common/ 아래 객체들이 담당:
 *   ArchiveRegistry -> StreamerRepository (스트리머 1명의 데이터), SongReferenceCatalog (전역 레퍼런스),
 *   VodImportPipeline (SoopApi + TimelineCommentParser + SongResolver 조립).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { SoopApi } = require('./common/soopApi');
const { ArchiveRegistry } = require('./common/archiveRegistry');
const { SongReferenceCatalog } = require('./common/songReferenceCatalog');
const { VodImportPipeline } = require('./common/vodImportPipeline');
const { parseVodUrl, normalizeSoopUserId } = require('./common/utils');

const songArchivesRoot = path.resolve(__dirname);
const argv = process.argv.slice(2);

const archiveRegistry = new ArchiveRegistry(songArchivesRoot);
const catalog = new SongReferenceCatalog(songArchivesRoot);
const pipeline = new VodImportPipeline(new SoopApi(), catalog);

function isBareVideoId(token) {
  return /^\d+$/.test(token);
}

/** @param {string} input @returns {string|null} canonical vod.sooplive.com URL */
function toVodUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  const parsed = parseVodUrl(trimmed);
  if (parsed) return `https://vod.sooplive.com/player/${parsed.videoId}`;
  if (isBareVideoId(trimmed)) return `https://vod.sooplive.com/player/${trimmed}`;
  return null;
}

function parseCliArgs(args) {
  let forceStreamerId = '';
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token) continue;

    if (token === '--streamer' || token === '--force-streamer' || token === '-s') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(`옵션 ${token} 뒤에 스트리머 id를 넣어 주세요. 예: ${token} chebi2`);
      }
      forceStreamerId = next.trim();
      i++;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`알 수 없는 옵션 "${token}" 입니다.`);
    }

    positionals.push(token.trim());
  }

  if (!positionals.length) {
    return { vodUrls: [], forceStreamerId };
  }

  const firstUrl = toVodUrl(positionals[0]);
  if (!firstUrl) {
    throw new Error(
      `첫 인자는 VOD URL 또는 videoId(숫자)여야 합니다: "${positionals[0]}"`
    );
  }

  const vodUrls = [firstUrl];
  for (let i = 1; i < positionals.length; i++) {
    const token = positionals[i];
    if (!isBareVideoId(token)) {
      throw new Error(`맨 뒤 인자는 videoId(숫자)만 올 수 있습니다: "${token}"`);
    }
    vodUrls.push(`https://vod.sooplive.com/player/${token}`);
  }

  const seen = new Set();
  const uniqueUrls = [];
  for (const url of vodUrls) {
    const videoId = parseVodUrl(url).videoId;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    uniqueUrls.push(url);
  }

  return { vodUrls: uniqueUrls, forceStreamerId };
}

function formatUsage() {
  return [
    'Usage:',
    '  npm run add -- "<vod_url|videoId>" [videoId...]',
    '  npm run add -- "<vod_url|videoId>" [videoId...] --streamer <archiveId>',
    '  npm run add -- "<vod_url|videoId>" [videoId...] -s <archiveId>',
    '',
    'Examples:',
    '  npm run add -- "https://vod.sooplive.com/player/189435111"',
    '  npm run add -- "https://vod.sooplive.com/player/189435111" 189435112 189435113',
    '  npm run add -- 189435111 189435112',
  ].join('\n');
}

let cliArgs;
try {
  cliArgs = parseCliArgs(argv);
} catch (err) {
  console.error(err.message || err);
  console.error('');
  console.error(formatUsage());
  process.exit(1);
}

const { vodUrls, forceStreamerId } = cliArgs;

if (!vodUrls.length) {
  console.error(formatUsage());
  process.exit(1);
}

function formatResolveError(res, vodStreamerId) {
  if (res.reason === 'no_vod_streamer_id') {
    return [
      'VOD 메타에 스트리머 id(writer_id)가 없어 어떤 아카이브에 넣을지 판별할 수 없습니다.',
      'Soop API 응답을 확인해 주세요.',
    ].join('\n');
  }
  if (res.reason === 'ambiguous') {
    return [
      `스트리머 id "${vodStreamerId}"에 해당하는 아카이브가 둘 이상입니다: ${res.matches.join(', ')}.`,
      '각 songArchives/{id}/data/config.json의 streamer_id·comment_author_id·폴더명이 겹치지 않게 조정해 주세요.',
    ].join('\n');
  }
  const configured = res.configuredIds && res.configuredIds.length ? res.configuredIds.join(', ') : '(없음)';
  return [
    `이 VOD의 스트리머 id(Soop writer_id)는 "${vodStreamerId}" 입니다.`,
    `songArchives 아래 data/config.json이 있는 폴더: ${configured}`,
    '새 스트리머면 폴더를 만들고 config.json에 comment_author_id(타임라인 댓글 작성자)를 넣고,',
    'VOD 스트리머 id와 폴더명/comment_author_id가 다르면 streamer_id를 VOD와 맞춰 주세요.',
  ].join('\n');
}

/**
 * @param {string} url
 * @param {import('./common/streamerRepository').StreamerRepository|null} forcedRepository - already resolved archive, or null
 * @returns {Promise<string>} streamerId
 */
async function addOneVod(url, forcedRepository) {
  const parsed = parseVodUrl(url);
  if (!parsed) {
    throw new Error(
      'URL 형식이 올바르지 않습니다. https://vod.sooplive.com/player/{숫자} 또는 .co.kr 도메인을 사용해 주세요.'
    );
  }

  const vodInfo = await pipeline.getVodInfo(parsed.videoId);
  if (!vodInfo) {
    throw new Error(`VOD ${parsed.videoId} 정보를 가져오지 못했습니다.`);
  }

  const vodStreamerId = vodInfo.writer_id;
  let repository;
  if (forcedRepository) {
    repository = forcedRepository;
    if (normalizeSoopUserId(vodStreamerId) !== normalizeSoopUserId(repository.streamerId)) {
      console.log(
        `[override] VOD writer_id="${vodStreamerId}" 이지만 --streamer "${repository.streamerId}" 로 강제 저장합니다.`
      );
    }
  } else {
    const resolved = archiveRegistry.resolve(vodStreamerId);
    if (!resolved.repository) {
      throw new Error(formatResolveError(resolved, vodStreamerId));
    }
    repository = resolved.repository;
  }

  try {
    const result = await pipeline.run(url, repository, vodInfo);
    console.log(
      result.replaced ? 'Updated' : 'Added',
      `VOD ${result.videoId}: "${result.title}" (${result.date}), ${result.songCount} song(s).`
    );
    console.log(`Archive: ${repository.streamerId}`);
    return repository.streamerId;
  } catch (err) {
    const { debug } = repository.getConfig();
    if (debug) {
      console.error(err);
    } else {
      console.error(err.message || err);
    }
    process.exit(1);
  }
}

function runPreprocess(streamerId) {
  const preprocessPath = path.join(songArchivesRoot, 'common', 'preprocess.py');
  const py = spawnSync('python', [preprocessPath, streamerId], {
    cwd: songArchivesRoot,
    stdio: 'inherit',
  });
  if (py.status !== 0) {
    console.error(`Preprocess failed. From repo root: python songArchives/common/preprocess.py ${streamerId}`);
    process.exit(1);
  }
  console.log(`${streamerId}/songs.js updated.`);
}

async function main() {
  let forcedRepository = null;
  if (forceStreamerId) {
    const forced = archiveRegistry.resolveForced(forceStreamerId);
    if (!forced.repository) {
      const configured = forced.configuredIds.length ? forced.configuredIds.join(', ') : '(없음)';
      console.error(`강제 지정한 스트리머 id "${forceStreamerId}" 를 찾을 수 없습니다.`);
      console.error(`사용 가능한 아카이브: ${configured}`);
      process.exit(1);
    }
    forcedRepository = forced.repository;
  }

  const touchedStreamers = new Set();
  for (let i = 0; i < vodUrls.length; i++) {
    const url = vodUrls[i];
    if (vodUrls.length > 1) {
      console.log(`\n[${i + 1}/${vodUrls.length}] ${url}`);
    }
    try {
      const streamerId = await addOneVod(url, forcedRepository);
      touchedStreamers.add(streamerId);
    } catch (err) {
      console.error(err.message || err);
      process.exit(1);
    }
  }

  for (const streamerId of touchedStreamers) {
    runPreprocess(streamerId);
  }
}

main();
