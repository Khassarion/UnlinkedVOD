#!/usr/bin/env node
/**
 * thumbnailOverrides.json의 내용을 이미 저장된 source.json에 직접 반영한다. VOD를 다시 받지 않는다
 * (네트워크 호출 없음) — thumbnailOverrides.json만 고친 뒤 이 스크립트로 기존 기록에 소급 적용할 때 쓴다.
 *
 * 각 history 항목의 videoId로 오버라이드를 찾아:
 *   - subscribePlusRequired: 오버라이드 값으로 그대로 덮어씀
 *   - thumbnail: 기존 값이 비어 있고 오버라이드에 thumbnail이 있을 때만 채움(API 썸네일을 덮어쓰지 않음)
 * 바뀐 스트리머만 songs.js를 재생성한다.
 *
 * Usage (repo root):
 *   npm run apply-thumbnail-overrides                          # 전체 스트리머
 *   npm run apply-thumbnail-overrides -- churahee irumi1523     # 특정 스트리머만
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { ArchiveRegistry } = require('./archiveRegistry');
const { StreamerRepository } = require('./streamerRepository');
const { SongReferenceCatalog } = require('./songReferenceCatalog');
const { parseVodUrl } = require('./utils');

const songArchivesRoot = path.resolve(__dirname, '..');
const catalog = new SongReferenceCatalog(songArchivesRoot);
const registry = new ArchiveRegistry(songArchivesRoot);

/** @param {string} streamerId @returns {number} 바뀐 history 항목 수 */
function applyForStreamer(streamerId) {
  const repo = new StreamerRepository(songArchivesRoot, streamerId);
  let changedCount = 0;

  try {
    repo.updateHistory((history) => {
      for (const entry of history) {
        const videoId = parseVodUrl(entry.url || '')?.videoId;
        if (!videoId) continue;
        const override = catalog.getThumbnailOverride(videoId);
        if (!override) continue;

        let entryChanged = false;
        if (entry.subscribePlusRequired !== override.subscribePlusRequired) {
          entry.subscribePlusRequired = override.subscribePlusRequired;
          entryChanged = true;
        }
        if (!String(entry.thumbnail || '').trim() && override.thumbnail) {
          entry.thumbnail = override.thumbnail;
          entryChanged = true;
        }
        if (entryChanged) {
          changedCount++;
          console.log(
            `[${streamerId}] ${videoId}: subscribePlusRequired=${entry.subscribePlusRequired}` +
              (entry.thumbnail ? `, thumbnail=${entry.thumbnail}` : '')
          );
        }
      }
      return changedCount > 0;
    });
  } catch (err) {
    console.error(`[${streamerId}] source.json 처리 실패: ${err.message || err}`);
  }

  return changedCount;
}

function runPreprocess(streamerId) {
  const preprocessPath = path.join(songArchivesRoot, 'pipeline', 'preprocess.py');
  const py = spawnSync('python', [preprocessPath, streamerId], {
    cwd: songArchivesRoot,
    stdio: 'inherit',
  });
  if (py.status !== 0) {
    console.error(`Preprocess failed. From repo root: python songArchives/pipeline/preprocess.py ${streamerId}`);
    process.exit(1);
  }
  console.log(`${streamerId}/songs.js updated.`);
}

function main() {
  const args = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  const streamerIds = args.length > 0 ? args : registry.listConfiguredIds();

  if (!streamerIds.length) {
    console.error('대상 스트리머가 없습니다. songArchives/{id}/data/config.json이 있는 폴더가 있는지 확인하세요.');
    process.exit(1);
  }

  let totalChanged = 0;
  const touchedStreamers = [];
  for (const id of streamerIds) {
    const changed = applyForStreamer(id);
    totalChanged += changed;
    if (changed > 0) touchedStreamers.push(id);
  }

  if (totalChanged === 0) {
    console.log('변경된 항목이 없습니다 (thumbnailOverrides.json과 이미 일치하거나, 해당 videoId가 source.json에 없습니다).');
    return;
  }

  console.log(`\n총 ${totalChanged}건 갱신. songs.js 재생성: ${touchedStreamers.join(', ')}`);
  for (const id of touchedStreamers) {
    runPreprocess(id);
  }
}

main();
