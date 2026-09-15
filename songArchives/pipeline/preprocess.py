import json
import os
import sys
from datetime import datetime, timezone

# Archive root = parent of this file's directory (songArchives/pipeline → songArchives).
# Run: python songArchives/pipeline/preprocess.py [streamerId]  (cwd 무관)
_script_dir = os.path.dirname(os.path.abspath(__file__))
archive_root = os.path.dirname(_script_dir)
streamer_id = sys.argv[1] if len(sys.argv) > 1 else "churahee"
source_path = os.path.join(archive_root, streamer_id, "data", "source.json")
songs_js_path = os.path.join(archive_root, streamer_id, "songs.js")
default_map_path = os.path.join(archive_root, streamer_id, "data", "defaultArtistMapping.json")

with open(source_path, "rt", encoding="utf-8") as f:
    json_data = json.load(f)

default_map = {}
if os.path.isfile(default_map_path):
    with open(default_map_path, "rt", encoding="utf-8") as f:
        default_map = json.load(f)
if not isinstance(default_map, dict):
    default_map = {}


def effective_artist(song):
    """source.json의 artist가 null/비어 있으면 defaultArtistMapping으로 보강."""
    a = song.get("artist")
    if a is not None and str(a).strip() != "":
        return str(a).strip()
    title = song.get("title") or ""
    v = default_map.get(title)
    if v is not None and str(v).strip() != "":
        return str(v).strip()
    return ""


# 시간을 초 단위로 변환하는 함수
def time_to_seconds(time_str):
    splitres = time_str.split(":")
    h = 0
    m = 0
    s = 0
    if len(splitres) == 3:
        h, m, s = map(int, splitres)
    elif len(splitres) == 2:
        m, s = map(int, splitres)
    elif len(splitres) == 1:
        s = map(int, splitres)

    return h * 3600 + m * 60 + s


# url 겹치는지 체크용
url_dict = {}

songs_dict = {}
for history in json_data["history"]:
    if "template" in history:
        continue

    url_base = history["url"]
    if url_base in url_dict:
        print(f"[중복] url: {url_base}")
    else:
        url_dict[url_base] = True

    date = history["date"]
    videoTitle = history["title"]
    thumbnail_url = history["thumbnail"]

    for song in history["songInfo"]:
        title = song["title"]
        artist_eff = effective_artist(song)
        bucket_key = (title, artist_eff)
        time_in_seconds = time_to_seconds(song["time"])
        vod_url = f"{url_base}?change_second={time_in_seconds}"
        noMistake = False
        recommended = False
        needsReview = False
        groupSong = False
        groupMembers = ""
        if "noMistake" in song:
            noMistake = song["noMistake"]
        if "recommended" in song:
            recommended = song["recommended"]
        if "needsReview" in song:
            needsReview = song["needsReview"]
        if "groupSong" in song:
            groupSong = bool(song["groupSong"])
        if "groupMembers" in song and song["groupMembers"] is not None:
            groupMembers = str(song["groupMembers"]).strip()

        ver = {
            "date": date,
            "url": vod_url,
            "videoTitle": videoTitle,
            "views": 1000,
            "thumbnail": thumbnail_url,
            "noMistake": noMistake,
            "recommended": recommended,
            "needsReview": needsReview,
            "groupSong": groupSong,
            "groupMembers": groupMembers,
        }

        if bucket_key in songs_dict:
            songs_dict[bucket_key]["versions"].append(ver)
        else:
            songs_dict[bucket_key] = {
                "title": title,
                "artist": artist_eff,
                "versions": [ver],
            }

songs_js_data = list(songs_dict.values())
songs_js_data.sort(key=lambda x: (x["title"], x.get("artist") or ""))
last_updated = datetime.now(timezone.utc).isoformat()
songs_js = (
    f"const SONGS_DATA_LAST_UPDATED = {json.dumps(last_updated)};\n"
    f"const songs = {json.dumps(songs_js_data, indent=2, ensure_ascii=False)};"
)

with open(songs_js_path, "w", encoding="utf-8") as f:
    f.write(songs_js)
