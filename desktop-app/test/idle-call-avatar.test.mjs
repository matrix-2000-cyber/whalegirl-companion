import test from 'node:test'
import assert from 'node:assert/strict'
import {createAvatar} from '../public/avatar.mjs'

test('only the audio mouth is available; interruption restores idle',async t=>{
  const names=['document','Image','matchMedia','requestAnimationFrame','cancelAnimationFrame','performance','window']
  const previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]))
  let avatar
  t.after(()=>{avatar?.destroy();for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}})
  let now=0,id=0;const callbacks=new Map(),images=[],created=[]
  const context=new Proxy({}, {get(target,key){
    if(key==='createLinearGradient')return ()=>({addColorStop(){}})
    if(key==='getImageData')return (_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})
    return target[key]??(()=>{})
  }})
  const canvas=()=>({dataset:{},getContext:()=>context})
  const install=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value})
  install('performance',{now:()=>now})
  install('Image',class {constructor(){images.push(this)}})
  install('matchMedia',()=>({matches:false}))
  install('window',{AudioContext:class{
    state='running';sampleRate=48000;destination={}
    createMediaElementSource(){return {connect(){}}}
    createAnalyser(){return {frequencyBinCount:1024,getFloatTimeDomainData(data){data.fill(.06)},getFloatFrequencyData(data){data.fill(-40)},connect(){}}}
    close(){}
  }})
  const video={paused:true,readyState:2,currentTime:0,addEventListener(){},play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true},removeAttribute(){},load(){}}
  install('document',{hidden:false,addEventListener(){},removeEventListener(){},createElement(kind){created.push(kind);return kind==='video'?video:canvas()}})
  install('requestAnimationFrame',callback=>{callbacks.set(++id,callback);return id})
  install('cancelAnimationFrame',id=>callbacks.delete(id))
  const actor=canvas(),player={paused:true,ended:false,readyState:2,currentTime:.08}
  avatar=createAvatar({canvas:actor,player})
  const frame=time=>{now=time;const [id,callback]=callbacks.entries().next().value;callbacks.delete(id);callback(time)}
  images[0].onload();images[1].onload();await avatar.unlockAudio();frame(100)
  for(const kind of ['wave','smile','sigh','shy','bow']){
    avatar.greet();avatar.express(kind,{source:'face'});assert.equal(avatar.action(kind),false)
  }
  avatar.express('nod');avatar.express('cry');avatar.setInteraction({busy:true});frame(200)
  assert.equal(actor.dataset.pose,'front');assert.equal(actor.dataset.action,'')
  assert.equal(actor.dataset.animationSet,'idle-and-audio-mouth');assert.equal(actor.dataset.tilt,'0')
  assert.equal(video.paused,true)
  avatar.setGaze({x:1,y:.5});frame(300);assert.equal(+actor.dataset.gazeX,0)
  avatar.setGazeEnabled(true);avatar.setGaze({x:1,y:.5});frame(400)
  assert.ok(+actor.dataset.gazeX>0);assert.equal(actor.dataset.pose,'front')
  player.paused=false;frame(500)
  assert.ok(+actor.dataset.mouth>0)
    assert.equal(actor.dataset.speechAnimation,'v1-audio-mouth');assert.equal(actor.dataset.action,'')
    assert.equal(actor.dataset.headSource,'front');assert.equal(actor.dataset.feetLift,'0')
    assert.ok(+actor.dataset.jaw>0);assert.equal(actor.dataset.lipSync,'audio-envelope-spectrum')
  player.paused=true;avatar.setGazeEnabled(false);frame(600)
  assert.equal(actor.dataset.mouth,'0');assert.equal(actor.dataset.gazeEnabled,'false')
  assert.equal(video.paused,true);assert.equal(actor.dataset.action,'')
  assert.equal(actor.dataset.speechAnimation,'none')
  avatar.blink();frame(680);assert.equal(actor.dataset.blinkPhase,'closed')
  assert.equal(actor.dataset.headSource,'front');assert.equal(actor.dataset.feetLift,'0')
  assert.equal(created.filter(kind=>kind==='video').length,0)
  assert.deepEqual(images.map(image=>image.src),['/standing/front.png','/whalegirl-seated-atlas.png'])
})
