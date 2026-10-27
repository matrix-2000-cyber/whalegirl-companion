"""Persistent speech worker. Text/audio stay in pipes, never in files or logs."""
import asyncio,base64,json,sys
from tts import communicator

def emit(value):
    sys.stdout.write(json.dumps(value,separators=(',',':'))+'\n');sys.stdout.flush()

async def main():
    tasks={}
    async def speak(request):
        key=request['id']
        try:
            speech=communicator(request['text'],request['style'])
            async for chunk in speech.stream():
                if chunk['type']=='audio':emit({'id':key,'audio':base64.b64encode(chunk['data']).decode('ascii')})
            emit({'id':key,'done':True})
        except asyncio.CancelledError:
            emit({'id':key,'done':True,'cancelled':True})
        except Exception:
            emit({'id':key,'error':'speech-failed'})
        finally:
            tasks.pop(key,None)
    emit({'ready':True})
    while True:
        line=await asyncio.to_thread(sys.stdin.readline)
        if not line:break
        try:request=json.loads(line)
        except (ValueError,TypeError):continue
        key=request.get('id')
        if request.get('cancel'):
            task=tasks.get(key)
            if task:
                task.cancel();await asyncio.gather(task,return_exceptions=True)
        elif key and not tasks:
            tasks[key]=asyncio.create_task(speak(request))
        elif key:emit({'id':key,'error':'busy'})
    for task in list(tasks.values()):task.cancel()
    if tasks:await asyncio.gather(*list(tasks.values()),return_exceptions=True)

if __name__=='__main__':asyncio.run(main())
