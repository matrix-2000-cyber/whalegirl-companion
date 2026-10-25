"""Generate a bounded reply using the project's isolated Edge TTS dependency."""
import asyncio
import pathlib
import sys
import os

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / '.desktop-runtime' / 'python'))
import edge_tts
import aiohttp

# aiohttp trust_env invokes Windows proxy discovery before every WebSocket;
# on this machine that takes ~9s. Scope the direct session to this TTS process.
if os.environ.get('WHALE_TTS_USE_SYSTEM_PROXY') != '1':
    _session = aiohttp.ClientSession
    def _tts_session(*args, **kwargs):
        kwargs['trust_env'] = False
        return _session(*args, **kwargs)
    aiohttp.ClientSession = _tts_session

async def main():
    text = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
    if not text.strip() or len(text) > 2000:
        raise ValueError('Invalid speech length')
    voices = {
        'cute': ('zh-CN-XiaoyiNeural', '-6%', '+18Hz'),
        'gentle': ('zh-CN-XiaoxiaoNeural', '-8%', '+6Hz'),
    }
    voice, rate, pitch = voices[sys.argv[3]]
    speech=edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, proxy=os.environ.get('WHALE_TTS_PROXY') or None)
    if sys.argv[2] == '-':
        async for chunk in speech.stream():
            if chunk['type'] == 'audio':
                sys.stdout.buffer.write(chunk['data'])
                sys.stdout.buffer.flush()
    else:
        await speech.save(sys.argv[2])

asyncio.run(main())
