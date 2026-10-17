#!/usr/bin/env python3
"""Generate only synthetic local research media; never fetch remote input."""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MEDIA = ROOT / "media"
EVIDENCE = ROOT / "evidence"
ENGINE_ROOT = Path("/Users/mingjie/Documents/github/personal-projects/v-download/resources/engines/darwin-arm64")
FFMPEG = ENGINE_ROOT / "ffmpeg"
FFPROBE = ENGINE_ROOT / "ffprobe"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    MEDIA.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for name in ("hls/720", "hls/360", "dash"):
        (MEDIA / name).mkdir(parents=True, exist_ok=True)
    commands = []

    def run(args):
        completed = subprocess.run([str(x) for x in args], capture_output=True, text=True)
        commands.append({"argv": [str(x) for x in args], "returncode": completed.returncode,
                         "stdout": completed.stdout, "stderr": completed.stderr})
        (EVIDENCE / "generation-commands.json").write_text(json.dumps(commands, ensure_ascii=False, indent=2))
        if completed.returncode:
            raise RuntimeError(completed.stderr)
        return completed.stdout

    (MEDIA / "captions.en.srt").write_text(
        "1\n00:00:00,000 --> 00:00:04,000\nSynthetic sample: opening chapter.\n\n"
        "2\n00:00:04,000 --> 00:00:08,000\n720p test pattern and 440 Hz sine audio.\n\n"
        "3\n00:00:08,000 --> 00:00:12,000\nLocal research fixture: closing chapter.\n", encoding="utf-8")
    (MEDIA / "captions.en.vtt").write_text(
        "WEBVTT\n\n00:00.000 --> 00:04.000\nSynthetic sample: opening chapter.\n\n"
        "00:04.000 --> 00:08.000\n720p test pattern and 440 Hz sine audio.\n\n"
        "00:08.000 --> 00:12.000\nLocal research fixture: closing chapter.\n", encoding="utf-8")
    (MEDIA / "chapters.ffmetadata").write_text(
        ";FFMETADATA1\ntitle=REA synthetic media fixture\nartist=Local test generator\n"
        "comment=Generated locally from FFmpeg testsrc2 and sine. No third-party video.\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4000\ntitle=Opening\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=4000\nEND=8000\ntitle=Middle\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=8000\nEND=12000\ntitle=Closing\n", encoding="utf-8")
    common = [FFMPEG, "-hide_banner", "-nostdin", "-y"]
    run(common + ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=12",
                  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12",
                  "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast",
                  "-b:v", "1800k", "-maxrate", "1800k", "-bufsize", "3600k",
                  "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
                  "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                  "-metadata", "title=REA synthetic 720p fixture", MEDIA / "sample-720.mp4"])
    run(common + ["-i", MEDIA / "sample-720.mp4", "-vf", "scale=640:360", "-c:v", "libx264",
                  "-preset", "veryfast", "-b:v", "600k", "-maxrate", "600k", "-bufsize", "1200k",
                  "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
                  "-c:a", "copy", "-movflags", "+faststart", MEDIA / "sample-360.mp4"])
    run(common + ["-i", MEDIA / "sample-720.mp4", "-vn", "-c:a", "copy", "-movflags", "+faststart",
                  MEDIA / "sample-audio.m4a"])
    run(common + ["-i", MEDIA / "sample-720.mp4", "-i", MEDIA / "captions.en.srt",
                  "-i", MEDIA / "chapters.ffmetadata", "-map", "0:v", "-map", "0:a", "-map", "1:s",
                  "-map_metadata", "2", "-map_chapters", "2", "-c:v", "copy", "-c:a", "copy",
                  "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-movflags", "+faststart",
                  MEDIA / "sample-annotated.mp4"])
    for size in (720, 360):
        run(common + ["-i", MEDIA / ("sample-%s.mp4" % size), "-c", "copy", "-f", "hls",
                      "-hls_time", "2", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
                      "-hls_segment_filename", MEDIA / ("hls/%s/segment-%%03d.ts" % size),
                      MEDIA / ("hls/%s/index.m3u8" % size)])
    master = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n'
    for size, width, codec in ((720, 1280, "avc1.64001f"), (360, 640, "avc1.64001e")):
        variant = MEDIA / ("hls/%s" % size)
        durations = []
        segments = []
        for line in (variant / "index.m3u8").read_text().splitlines():
            if line.startswith("#EXTINF:"):
                durations.append(float(line.split(":", 1)[1].split(",", 1)[0]))
            elif line and not line.startswith("#"):
                segments.append(variant / line)
        rates = [path.stat().st_size * 8 / duration for path, duration in zip(segments, durations)]
        peak = int(max(rates)) + 1
        average = int(sum(path.stat().st_size * 8 for path in segments) / sum(durations))
        master += '#EXT-X-STREAM-INF:BANDWIDTH=%s,AVERAGE-BANDWIDTH=%s,RESOLUTION=%sx%s,CODECS="%s,mp4a.40.2"\n%s/index.m3u8\n' % (peak, average, width, size, codec, size)
    (MEDIA / "hls/master.m3u8").write_text(master, encoding="utf-8")
    run(common + ["-i", MEDIA / "sample-720.mp4", "-i", MEDIA / "sample-360.mp4",
                  "-map", "0:v", "-map", "1:v", "-map", "0:a", "-c", "copy", "-f", "dash",
                  "-seg_duration", "2", "-use_template", "1", "-use_timeline", "1",
                  "-adaptation_sets", "id=0,streams=v id=1,streams=a", MEDIA / "dash/manifest.mpd"])
    probes = {}
    for name in ("sample-720.mp4", "sample-360.mp4", "sample-audio.m4a", "sample-annotated.mp4",
                 "hls/master.m3u8", "dash/manifest.mpd"):
        out = run([FFPROBE, "-v", "error", "-show_format", "-show_streams", "-show_chapters",
                   "-of", "json", MEDIA / name])
        probes[name] = json.loads(out)
    (EVIDENCE / "ffprobe-local.json").write_text(json.dumps(probes, ensure_ascii=False, indent=2))
    outputs = []
    for path in sorted(MEDIA.rglob("*")):
        if path.is_file():
            relative = str(path.relative_to(MEDIA))
            item = {"path": relative, "bytes": path.stat().st_size, "sha256": sha256(path)}
            if relative in probes:
                probe = probes[relative]
                item["duration_seconds"] = float(probe["format"]["duration"])
                item["streams"] = [{key: stream[key] for key in ("index", "codec_type", "codec_name", "width", "height", "sample_rate", "channels", "duration") if key in stream}
                                   for stream in probe.get("streams", [])]
                item["chapters"] = probe.get("chapters", [])
            outputs.append(item)
    engine_info = {}
    for binary in (FFMPEG, FFPROBE):
        engine_info[binary.name] = {"path": str(binary), "sha256": sha256(binary), "version": run([binary, "-version"]).splitlines()[0]}
    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(), "media_root": str(MEDIA),
        "inputs": "Local FFmpeg lavfi testsrc2 (12 s, 30 fps) and sine (440 Hz, 48 kHz); hand-authored subtitles and chapters.",
        "licensing": "No remote or third-party audiovisual input. Synthetic fixture data and authored captions/metadata are dedicated to CC0-1.0 for research and test reuse; FFmpeg binary licensing is separate and not redistributed here.",
        "reproducibility": "build_samples.py records exact command arguments and binary hashes; repeated encoding need not be byte-identical across toolchains.",
        "engines": engine_info, "files": outputs, "total_media_bytes": sum(x["bytes"] for x in outputs),
        "evidence": "evidence/ffprobe-local.json", "app_support_claim": "Fixture validity only; no assertion about Downie or v-download support."
    }
    (ROOT / "sample-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    assert manifest["total_media_bytes"] < 100_000_000
    print(json.dumps({"files": len(outputs), "total_media_bytes": manifest["total_media_bytes"],
                      "manifest": str(ROOT / "sample-manifest.json")}, indent=2))


if __name__ == "__main__":
    main()
