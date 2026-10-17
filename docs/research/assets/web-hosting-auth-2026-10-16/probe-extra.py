#!/usr/bin/env python3
"""Complete uncovered TikTok metadata and a small public MP4 download.
Run after probe.py, from this directory or the repository root.
"""
import datetime
import json
from pathlib import Path
import tempfile
from probe import run, digest, YTDLP, FFMPEG, FFPROBE

here = Path(__file__).resolve().parent
baseline = json.loads((here / 'results.json').read_text())
assert digest(YTDLP) == baseline['engine']['sha256']
base = baseline['base_argv']
report = {'started_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'base_argv_from': 'results.json', 'public_cases': [],
          'upstream_head_at_research': '897341241f2bfb2439fe0367f4c7c9ccd29a3828'}
url = 'https://www.tiktok.com/@patroxofficial/video/6742501081818877190?langCountry=en'
entry = run(base + ['--skip-download', '--dump-single-json', url])
raw = entry.pop('stdout')
entry.update({'site': 'TikTok', 'url': url, 'mode': 'metadata_only'})
if entry['exit'] == 0:
    info = json.loads(raw)
    entry['metadata'] = {'id': info.get('id'), 'title': info.get('title'),
                         'duration': info.get('duration'), 'format_count': len(info.get('formats') or [])}
report['public_cases'].append(entry)
print('TikTok: exit', entry['exit'], flush=True)
with tempfile.TemporaryDirectory(prefix='vdownload-web-auth-extra-', dir='/private/tmp') as temp:
    out = Path(temp) / 'flower.mp4'
    url = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
    entry = run(base + ['-o', str(out), url])
    entry.pop('stdout')
    entry['stderr'] = entry['stderr'].replace(temp, '<temporary>')
    entry.update({'site': 'MDN public MP4', 'url': url, 'mode': 'complete_download', 'file_exists': out.is_file()})
    if out.is_file():
        probe = run([FFPROBE, '-v', 'error', '-show_entries',
                     'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', out])
        decode = run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', out, '-f', 'null', '-'])
        entry['output'] = {'sha256': digest(out), 'bytes': out.stat().st_size,
                           'ffprobe': json.loads(probe['stdout']), 'ffprobe_exit': probe['exit'],
                           'full_decode_exit': decode['exit'], 'decode_stderr': decode['stderr']}
    report['public_cases'].append(entry)
    print('MDN MP4: exit', entry['exit'], flush=True)
report['cleanup'] = {'temporary_media_removed': not Path(temp).exists(), 'personal_profiles_accessed': False}
report['ended_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(here / 'results-extra.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
