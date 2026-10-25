"""Persistent local SenseVoice decoder. JSON lines over parent-owned stdio only."""
import contextlib
import json
import os
import pathlib
import re
import sys
import time
import wave

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

try:
    started = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import sherpa_onnx
        folder = pathlib.Path(sys.argv[1])
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(folder / 'model.int8.onnx'), tokens=str(folder / 'tokens.txt'),
            num_threads=4, use_itn=True, language='zh', provider='cpu', debug=False)
    root = pathlib.Path(sys.argv[2]).resolve()
    emit({'ready': True, 'loadMs': round((time.perf_counter()-started)*1000)})
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            source = pathlib.Path(request['wav']).resolve()
            if root not in source.parents or source.suffix != '.wav':
                raise ValueError('Invalid audio path')
            started = time.perf_counter()
            with wave.open(str(source), 'rb') as audio:
                if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000 or audio.getnframes() > 16000*30:
                    raise ValueError('Invalid WAV format')
                samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32)/32768.0
            if len(samples) < 1600 or float(np.sqrt(np.mean(samples*samples))) < .001:
                text = ''
            else:
                with contextlib.redirect_stdout(sys.stderr):
                    stream = recognizer.create_stream()
                    stream.accept_waveform(16000, samples)
                    recognizer.decode_stream(stream)
                    text = re.sub(r'<\|[^|]+\|>', '', stream.result.text or '').strip()
            emit({'id': request['id'], 'text': text[:2000], 'decodeMs': round((time.perf_counter()-started)*1000)})
        except Exception:
            emit({'id': request.get('id'), 'error': '本机语音识别失败，请再说一遍'})
except Exception:
    emit({'error': '本机语音模型尚未就绪'})
    sys.exit(1)
