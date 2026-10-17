#!/usr/bin/env python3
"""Isolated research probe. Uses synthetic local credentials, never browser profiles.

python3 probe.py --output results.json [--public]
Needs the installed macOS V-Download engines; all media/cookie files are temporary.
Public probes extract metadata only, without account cookies or PO plugins.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import tempfile
import threading
import time
import urllib.parse

ENGINES = Path('/Applications/V-Download.app/Contents/Resources/engines/darwin-arm64')
YTDLP, FFMPEG, FFPROBE = [ENGINES / name for name in ('yt-dlp', 'ffmpeg', 'ffprobe')]
NODE = Path('/Users/mingjie/.nvm/versions/node/v23.10.0/bin/node')
ROOT = Path(__file__).resolve().parents[4]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(argv, timeout=35):
    start = time.monotonic()
    process = subprocess.Popen([str(x) for x in argv], stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    expired = False
    try:
        out, err = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        expired = True
        os.killpg(process.pid, signal.SIGKILL)
        out, err = process.communicate()
    return {'exit': process.returncode, 'timeout': expired,
            'elapsed_seconds': round(time.monotonic() - start, 3),
            'stdout': out.decode('utf-8', 'replace'), 'stderr': err.decode('utf-8', 'replace')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--public', action='store_true')
    args = parser.parse_args()
    base = [YTDLP, '--ignore-config', '--no-cookies', '--no-cookies-from-browser',
            '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--proxy', '',
            '--socket-timeout', '7', '--retries', '0', '--extractor-retries', '0',
            '--fragment-retries', '0', '--no-progress', '--newline',
            '--ffmpeg-location', ENGINES, '--js-runtimes', 'node:' + str(NODE)]
    result = {'started_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'host': {'os': platform.platform(), 'arch': platform.machine()},
              'engine': {'path': str(YTDLP), 'version': run([YTDLP, '--version'])['stdout'].strip(),
                         'sha256': digest(YTDLP), 'ffmpeg_sha256': digest(FFMPEG),
                         'ffprobe_sha256': digest(FFPROBE)},
              'base_argv': [str(x) for x in base],
              'scope': 'macOS engine baseline; no desktop pipeline, PO provider, cloud IP, real login, or personal Chrome profile',
              'local_cases': [], 'public_cases': []}
    source_files = ['package.json', 'src/main/videoInfoResolver.ts', 'src/main/remoteApiHandler.ts',
                    'src/main/downloadManager.ts', 'src/main/nativeAuth.ts', 'src/main/downloadPlans.ts',
                    'packages/shared/src/media-source-context.ts']
    result['source_sha256'] = {p: digest(ROOT / p) for p in source_files}
    with tempfile.TemporaryDirectory(prefix='vdownload-web-auth-', dir='/private/tmp') as temp:
        work = Path(temp)
        video = work / 'source.mp4'
        encoded = run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
                       '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi',
                       '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3',
                       '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                       '-c:a', 'aac', '-movflags', '+faststart', video])
        if encoded['exit'] != 0:
            raise RuntimeError(encoded['stderr'])
        content = video.read_bytes()
        result['fixture'] = {'kind': 'synthetic testsrc2 + sine, 3s H264/AAC 640x360',
                             'sha256': digest(video), 'bytes': len(content)}
        requests = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_HEAD(self):
                self.serve(False)

            def do_GET(self):
                self.serve(True)

            def serve(self, body):
                path = urllib.parse.urlsplit(self.path).path
                cookie = self.headers.get('Cookie', '')
                status, media, set_cookie = 200, path != '/watch-guest', None
                if path == '/watch-guest':
                    data = b'<html><title>Research guest</title><video controls src="/guest.mp4" type="video/mp4"></video></html>'
                    set_cookie = 'research_visitor=anonymous; Path=/; HttpOnly; SameSite=Lax'
                else:
                    data = content
                    if path == '/guest.mp4' and 'research_visitor=anonymous' not in cookie:
                        status = 403
                    if path in ('/account.mp4', '/bound.mp4') and 'research_session=synthetic' not in cookie:
                        status = 401
                    if path == '/bound.mp4' and status == 200 and self.headers.get('User-Agent') != 'VDownloadResearch/1.0':
                        status = 403
                    if path == '/referer.mp4' and self.headers.get('Referer') != self.server.full_referer:
                        status = 403
                    if path not in ('/public.mp4', '/guest.mp4', '/account.mp4', '/bound.mp4', '/referer.mp4'):
                        status = 404
                requests.append({'method': self.command, 'path': path, 'status': status,
                                 'cookie_present': bool(cookie), 'referer': self.headers.get('Referer'),
                                 'ua': self.headers.get('User-Agent')})
                self.send_response(status)
                self.send_header('Content-Type', 'video/mp4' if media and status == 200 else 'text/html')
                self.send_header('Content-Length', str(len(data) if status == 200 else 0))
                if set_cookie:
                    self.send_header('Set-Cookie', set_cookie)
                self.end_headers()
                if body and status == 200:
                    try:
                        self.wfile.write(data)
                    except (BrokenPipeError, ConnectionResetError):
                        pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = 'http://127.0.0.1:' + str(server.server_port)
        server.full_referer = origin + '/watch/path?video=42&variant=full'
        cookie_file = work / 'synthetic-only.cookies.txt'
        cookie_file.write_text('# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tresearch_session\tsynthetic\n')
        cases = [
            ('public_no_cookie', '/public.mp4', [], True),
            ('guest_direct_no_cookie', '/guest.mp4', [], False),
            ('guest_page_sets_cookie', '/watch-guest', [], True),
            ('account_no_cookie', '/account.mp4', [], False),
            ('account_synthetic_cookie', '/account.mp4', ['--cookies', cookie_file], True),
            ('referer_missing', '/referer.mp4', [], False),
            ('referer_origin_only', '/referer.mp4', ['--referer', origin + '/'], False),
            ('referer_complete', '/referer.mp4', ['--referer', server.full_referer], True),
            ('bound_cookie_only', '/bound.mp4', ['--cookies', cookie_file], False),
            ('bound_cookie_and_ua', '/bound.mp4', ['--cookies', cookie_file, '--user-agent', 'VDownloadResearch/1.0'], True),
        ]
        try:
            for case_id, path, extra, expected in cases:
                output = work / (case_id + '.mp4')
                request_start = len(requests)
                entry = run(base + extra + ['-o', output, origin + path])
                entry.pop('stdout')
                entry.update({'id': case_id, 'input_path': path,
                              'extra_argv': [str(x).replace(str(work), '<temporary>') for x in extra],
                              'expected_download': expected, 'file_exists': output.is_file(),
                              'requests': requests[request_start:]})
                if output.is_file():
                    probe = run([FFPROBE, '-v', 'error', '-show_entries',
                                 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', output])
                    decoded = run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', output, '-f', 'null', '-'])
                    entry['output'] = {'sha256': digest(output), 'bytes': output.stat().st_size,
                                       'ffprobe': json.loads(probe['stdout']), 'ffprobe_exit': probe['exit'],
                                       'full_decode_exit': decoded['exit'], 'decode_stderr': decoded['stderr']}
                success = entry['exit'] == 0 and output.is_file()
                entry['matches_expectation'] = success == expected and (not success or entry['output']['full_decode_exit'] == 0)
                entry['stderr'] = entry['stderr'].replace(str(work), '<temporary>')[-4000:]
                result['local_cases'].append(entry)
                print(case_id + ': ' + ('PASS' if entry['matches_expectation'] else 'MISMATCH'), flush=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
        if args.public:
            samples = [
                ('YouTube', 'https://www.youtube.com/watch?v=YE7VzlLtp-4'),
                ('Bilibili', 'https://www.bilibili.com/video/BV1nx411u79K'),
                ('Douyin', 'https://www.douyin.com/video/6953975910773099811'),
                ('Xiaohongshu', 'https://www.xiaohongshu.com/explore/6411cf99000000001300b6d9'),
                ('Instagram', 'https://www.instagram.com/reel/Chunk8-jurw/'),
                ('X', 'https://twitter.com/oshtru/status/1577855540407197696'),
                ('HLS', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
                ('DASH', 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd'),
            ]

            def public_probe(sample):
                site, url = sample
                probe = run(base + ['--skip-download', '--dump-single-json', url], timeout=35)
                raw = probe.pop('stdout')
                probe.update({'site': site, 'url': url, 'mode': 'metadata_only'})
                if probe['exit'] == 0:
                    info = json.loads(raw)
                    formats = info.get('formats') or []
                    probe['metadata'] = {'id': info.get('id'), 'title': info.get('title'),
                                         'duration': info.get('duration'), 'format_count': len(formats),
                                         'heights': sorted({x['height'] for x in formats if isinstance(x.get('height'), int)}),
                                         'subtitle_languages': sorted((info.get('subtitles') or {}).keys()),
                                         'automatic_caption_languages': sorted((info.get('automatic_captions') or {}).keys())}
                probe['stderr'] = probe['stderr'][-5000:]
                print(site + ': ' + ('metadata OK' if probe['exit'] == 0 else 'exit ' + str(probe['exit'])), flush=True)
                return probe

            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                result['public_cases'] = list(pool.map(public_probe, samples))
    result['ended_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result['cleanup'] = {'temporary_media_and_synthetic_cookies_removed': not Path(temp).exists(),
                         'fixture_listener_closed': True, 'personal_profiles_accessed': False}
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('RESULT ' + str(Path(args.output).resolve()), flush=True)


if __name__ == '__main__':
    main()
