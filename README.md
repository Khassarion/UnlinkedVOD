# UnlinkedVOD — 노래 기록 보관소

Soop 다시보기에 부른 노래를 모아 둔 **스트리머별 노래 기록 보관소**입니다.  
(루트의 반응 클립 그래프는 준비 중입니다.)

## 바로가기

| 구분 | 링크 |
|------|------|
| 노래 기록 허브 | [노래 기록 보관소](https://khassarion.github.io/UnlinkedVOD/songArchives/) |
| 츄라희 | [츄라희 노래 기록 보관소](https://khassarion.github.io/UnlinkedVOD/songArchives/churahee/) |
| 백시호 | [백시호 노래 기록 보관소](https://khassarion.github.io/UnlinkedVOD/songArchives/irumi1523/) |
| 체비 | [체비 노래 기록 보관소](https://khassarion.github.io/UnlinkedVOD/songArchives/chebi2/) |

## 사이트에서 할 수 있는 일

- **검색·필터·정렬**로 곡과 다시보기 기록을 찾습니다.
- 카드(또는 날짜 패널)를 누르면 해당 **다시보기 시점**으로 이동합니다.
- **노래 추가하기**로 빠진 기록을 제출할 수 있습니다.
  1. 노래 제목(·가수)을 입력합니다. 기존 곡이면 자동완성이 됩니다.
  2. Soop 다시보기 URL을 넣으면 방송 날짜·제목·썸네일·시작 시간(`change_second`)이 채워집니다.
  3. **미리보기**로 목록에 어떻게 보이는지 확인한 뒤 제출합니다.
- 「데이터는 어떻게 갱신되나요?」에서 운영 방식과 타임라인 파싱 안내를 볼 수 있습니다.

제출한 기록은 커뮤니티 시트에 저장된 뒤, 페이지를 열 때 기존 보관소 데이터와 함께 표시됩니다.  
정기적으로는 다시보기 타임라인 댓글을 바탕으로 운영자가 데이터를 갱신합니다.

## 다시보기 URL 형식

```
https://vod.sooplive.com/player/{영상번호}
https://vod.sooplive.com/player/{영상번호}?change_second={시작초}
```

---

개발·배포·데이터 파이프라인 안내는 [README.dev.md](README.dev.md)를 보세요.
