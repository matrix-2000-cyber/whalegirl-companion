import test from 'node:test'
import assert from 'node:assert/strict'
import {createHandTracker} from '../public/hand-tracker.mjs'
test('hand detections do not drive gaze by default, and an explicit action can enable and revoke it',t=>{
 const previousWindow=globalThis.window,previousWorker=globalThis.Worker,previousDocument=globalThis.document,workers=[]
 class Worker{constructor(){workers.push(this)}postMessage(){}terminate(){}}
 globalThis.window={Worker,createImageBitmap(){}};globalThis.Worker=Worker;globalThis.document={hidden:false}
 const trackers=[]
 t.after(()=>{for(const tracker of trackers)tracker.stop();if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument})
 const points=Array.from({length:21},()=>({x:.2,y:.3})),gaze=[],draws=[]
 const context={clearRect(){},beginPath(){},arc(){draws.push('marker')},fill(){},stroke(){}}
 const base={video:{readyState:0},overlay:{width:640,height:480,getContext:()=>context},onGaze:value=>gaze.push(value),onStatus(){},onWave(){}}
 const defaults=createHandTracker(base);trackers.push(defaults);defaults.start()
 workers[0].onmessage({data:{type:'ready'}});workers[0].onmessage({data:{type:'result',points}})
 assert.equal(gaze.at(-1),null);assert.equal(draws.length,0)
 let enabled=false
 const selected=createHandTracker({...base,isGazeEnabled:()=>enabled});trackers.push(selected);selected.start()
 workers[1].onmessage({data:{type:'ready'}})
 enabled=true;workers[1].onmessage({data:{type:'result',points}})
 assert.deepEqual(gaze.at(-1),{x:.8,y:.3});assert.equal(draws.length,1)
 enabled=false;workers[1].onmessage({data:{type:'result',points}})
 assert.equal(gaze.at(-1),null);assert.equal(draws.length,1)
})
