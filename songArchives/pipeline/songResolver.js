const { nonEmptyStr, makeDebugLogger } = require('./utils');

function mergeSongMeta(item, title, artistStorage) {
  const artist = nonEmptyStr(artistStorage);
  return { ...item, title, artist: artist || null };
}

/**
 * Cross-references raw parsed {title, artist} against a SongReferenceCatalog + StreamerRepository
 * to confirm the final title/artist — handling new-title registration and artist-conflict prompts
 * (interactively when an `rl` is given, non-interactively otherwise). Caches answers per run so the
 * same title/conflict is never asked twice.
 */
class SongResolver {
  /**
   * @param {object} opts
   * @param {import('./songReferenceCatalog').SongReferenceCatalog} opts.catalog
   * @param {import('./streamerRepository').StreamerRepository} opts.repository
   * @param {import('readline').Interface|null} [opts.rl]
   * @param {boolean} [opts.interactive]
   * @param {boolean} [opts.debug]
   */
  constructor({ catalog, repository, rl = null, interactive = false, debug = false }) {
    this.catalog = catalog;
    this.repository = repository;
    this.rl = rl;
    this.interactive = interactive;
    this.debug = debug;
    this.dbg = makeDebugLogger(debug);
    this.caches = {
      titleNewSong: new Map(),
      artistPick: new Map(),
      updateDefault: new Map(),
      blankArtistAnswer: new Map(),
      newSongDefaultMap: new Map(),
    };
  }

  async _askYesNo(message) {
    if (!this.rl) return false;
    const ans = (await this.rl.question(message)).trim().toUpperCase();
    return ans === 'Y' || ans === 'YES';
  }

  /**
   * 파싱된 title/artist를 catalog·repository와 대조해 최종 확정한다.
   * 신규 제목 등록, 가수 불일치 시 대화형 선택, 캐싱까지 포함하는 핵심 로직.
   * @param {object} item - TimelineCommentParser의 원본 파싱 결과 1개
   * @returns {Promise<object>} 확정된 { title, artist, ... }
   */
  async resolve(item) {
    const dbg = this.dbg;
    const { catalog, repository, rl, interactive, caches } = this;
    const rawTitle = (item.title || '').trim();
    const rawArtist = nonEmptyStr(item.artist);
    const hadRawArtistInComment = !!rawArtist;

    let canonicalTitle = catalog.resolveTitle(rawTitle);

    // 제목이 titleReference에 없음 → 신규 등록 여부부터 확인
    if (!canonicalTitle) {
      const cacheKey = rawTitle;
      let registerNew = false;
      if (interactive && rl) {
        // 대화형일 때만 물어봄(비대화형은 registerNew=false 유지), 같은 제목은 한 번만 물어보고 캐시
        if (!caches.titleNewSong.has(cacheKey)) {
          const yn = await this._askYesNo(
            `[새 노래?] titleReference에 없는 제목입니다 (오타 확인).\n` +
              `  rawTitle="${rawTitle}"  rawArtist="${rawArtist || '(댓글 생략)'}"\n` +
              `  새 노래로 등록하고 레퍼런스에 추가할까요? [Y/N]: `
          );
          caches.titleNewSong.set(cacheKey, yn);
        }
        registerNew = caches.titleNewSong.get(cacheKey);
      }

      if (registerNew) {
        // 사용자가 신규 등록에 동의 → titleReference(+ 가수 있으면 artistReference)에 추가
        catalog.addTitle(rawTitle);
        const rawArtistWasNew = rawArtist ? !catalog.hasArtist(rawArtist) : false;
        if (rawArtist) catalog.addArtist(rawArtist);
        canonicalTitle = rawTitle;
        if (rawArtist) {
          // 댓글에 가수도 같이 왔으면 defaultArtistMapping 등록까지 시도
          const canonicalFromRaw = catalog.resolveArtist(rawArtist) || String(rawArtist).trim();
          if (canonicalFromRaw) {
            let doSetDefault = true;
            if (interactive && rl && rawArtistWasNew) {
              // 가수까지 완전 신규일 때만 별도로 확인(기존 가수면 바로 저장)
              const mapKey = `newSongDefault:${canonicalTitle}\t${canonicalFromRaw}`;
              if (!caches.newSongDefaultMap.has(mapKey)) {
                const yn = await this._askYesNo(
                  `[새 노래+새 아티스트] 제목 "${canonicalTitle}" / 가수 "${canonicalFromRaw}"\n` +
                    `defaultArtistMapping.json에 기본 가수로 저장할까요? [Y/N]: `
                );
                caches.newSongDefaultMap.set(mapKey, yn);
              }
              doSetDefault = caches.newSongDefaultMap.get(mapKey);
            }
            if (doSetDefault) {
              repository.setDefaultArtist(canonicalTitle, canonicalFromRaw);
            }
          }
        }
      } else {
        // 등록 거부(또는 비대화형) → 레퍼런스는 안 건드리고 원본 제목 그대로 사용
        canonicalTitle = rawTitle;
      }
    }

    dbg('resolve:', { rawTitle, canonicalTitle, rawArtist, hadRawArtistInComment });

    // 댓글에 가수 자체가 없던 경우
    if (!hadRawArtistInComment) {
      const defBlank = (() => {
        const def = repository.getDefaultArtist(canonicalTitle);
        if (!def) return '';
        return catalog.resolveArtist(def) || def;
      })();
      if (defBlank) {
        // 이미 기본 가수가 있으면 그걸로 채움
        return mergeSongMeta(item, canonicalTitle, defBlank);
      }
      if (interactive && rl) {
        // 기본값도 없음 → 대화형이면 직접 입력받음
        const cacheKeyBlank = `blankArtist:${canonicalTitle}`;
        if (!caches.blankArtistAnswer.has(cacheKeyBlank)) {
          const typed = (
            await rl.question(
              `[가수 없음] 댓글에 가수가 없고 defaultArtistMapping에 제목 "${canonicalTitle}" 항목이 없습니다.\n` +
                `기록할 가수명을 입력하세요 (비우면 source에는 null, 레퍼런스/매핑은 변경 안 함): `
            )
          ).trim();
          caches.blankArtistAnswer.set(cacheKeyBlank, typed);
        }
        const typed = caches.blankArtistAnswer.get(cacheKeyBlank);
        if (!typed) {
          // 입력 없이 그냥 넘김 → artist null, 레퍼런스/매핑 변경 없음
          return mergeSongMeta(item, canonicalTitle, null);
        }
        if (!catalog.hasArtist(typed)) {
          // 처음 보는 가수명이면 artistReference에 추가
          catalog.addArtist(typed);
        }
        const canonFromTyped = catalog.resolveArtist(typed) || String(typed).trim();
        repository.setDefaultArtist(canonicalTitle, canonFromTyped);
        return mergeSongMeta(item, canonicalTitle, canonFromTyped);
      }
      // 비대화형이면 물어볼 수 없으니 artist null로 반환
      return mergeSongMeta(item, canonicalTitle, null);
    }

    let canonicalArtist = catalog.resolveArtist(rawArtist);

    const defMapped = repository.getDefaultArtist(canonicalTitle);
    const def = defMapped ? catalog.resolveArtist(defMapped) || defMapped : '';

    if (!defMapped) {
      // 기본 매핑이 아직 없음: 댓글 가수를 그대로 쓴다. 레퍼런스에서 resolve됐으면 매핑도 채워 둔다.
      if (canonicalArtist) {
        repository.setDefaultArtist(canonicalTitle, canonicalArtist);
        return mergeSongMeta(item, canonicalTitle, canonicalArtist);
      }
      // 레퍼런스에도 없는 가수라 채울 값이 없음 → 아래 "다른 가수" 분기로 흘러감(선택 프롬프트로 처리)
    } else if (rawArtist === defMapped || rawArtist === def || (canonicalArtist && canonicalArtist === def)) {
      // 댓글 가수가 기본값과 사실상 같음(레퍼런스 등록 여부 무관) → 선택 없이 그대로 사용
      return mergeSongMeta(item, canonicalTitle, def || canonicalArtist);
    }

    // 여기부터는 기본 매핑과 다른 가수가 명시된 경우(레퍼런스 등록 여부 무관) → 선택 필요
    if (!interactive || !rl) {
      // 비대화형은 물어볼 수 없으니 기본값을 우선 사용
      return mergeSongMeta(item, canonicalTitle, def || canonicalArtist || rawArtist || null);
    }

    const pickKey = `${canonicalTitle}\t${rawArtist}\t${defMapped}`;
    if (!caches.artistPick.has(pickKey)) {
      // 같은 충돌 조합은 한 번만 물어보고 캐시
      caches.artistPick.set(
        pickKey,
        await (async () => {
          if (!rl) return 1;
          const msg =
            `가수 불일치 — 제목 기준 기본값 "${def || defMapped || '(없음)'}" vs 댓글 "${rawArtist}"\n` +
            `  [1] 기본값 사용\n` +
            `  [2] 댓글 가수 사용 (artistReference에 추가)\n` +
            `선택 (1/2): `;
          const a = (await rl.question(msg)).trim();
          return a === '2' ? 2 : 1;
        })()
      );
    }
    const choice = caches.artistPick.get(pickKey);

    if (choice === 1) {
      // 기본값 선택 → 레퍼런스/매핑 변경 없이 그대로 사용
      return mergeSongMeta(item, canonicalTitle, def || canonicalArtist || rawArtist || null);
    }

    if (!canonicalArtist) {
      // 댓글 가수 선택 & 레퍼런스에 없던 가수면 등록
      catalog.addArtist(rawArtist);
      canonicalArtist = catalog.resolveArtist(rawArtist) || rawArtist;
    }

    const updKey = `upd:${canonicalTitle}\t${canonicalArtist}`;
    let doUpd = caches.updateDefault.get(updKey);
    if (doUpd === undefined) {
      // defaultArtistMapping도 이 값으로 바꿀지 별도로 확인
      doUpd = await this._askYesNo(
        `defaultArtistMapping.json 에서 "${canonicalTitle}" 의 기본 가수를 "${canonicalArtist}" 로 바꿀까요? [Y/N]: `
      );
      caches.updateDefault.set(updKey, doUpd);
    }
    if (doUpd) {
      repository.setDefaultArtist(canonicalTitle, canonicalArtist);
    }

    return mergeSongMeta(item, canonicalTitle, canonicalArtist);
  }

  /**
   * 원본 파싱 결과 목록을 순서대로 resolve하고, 확정된 title|artist|time 기준으로 중복 제거한다.
   * @param {object[]} rawItems
   * @returns {Promise<object[]>}
   */
  async resolveAll(rawItems) {
    const results = [];
    const seen = new Set();
    for (const raw of rawItems) {
      const resolved = await this.resolve(raw);
      this.dbg('  결과(resolve 후):', resolved);
      const key = (resolved.title || '') + '|' + (resolved.artist == null ? '' : resolved.artist) + '|' + (resolved.time || '');
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(resolved);
    }
    return results;
  }
}

module.exports = { SongResolver };
