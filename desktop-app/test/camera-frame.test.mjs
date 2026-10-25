import test from 'node:test'
import assert from 'node:assert/strict'
import {captureFrame} from '../public/camera-frame.mjs'
test('camera preserves HD detail and adapts quality to bridge limits without stretching',()=>{
  const qualities=[]
  const canvas={getContext:()=>({drawImage(){}}),toDataURL(_type,q){qualities.push(q);return 'data:image/jpeg;base64,'+'a'.repeat(q>.8?410000:200000)}}
  const frame=captureFrame({readyState:2,videoWidth:1920,videoHeight:1080},()=>canvas)
  assert.equal(frame.width,1280);assert.equal(frame.height,720)
  assert.equal(frame.quality,.76);assert.equal(frame.image.length,200000)
  assert.deepEqual(qualities,[.86,.76])
})
test('camera never uploads blank/unready video or unsupported image encodings',()=>{
  assert.throws(()=>captureFrame({readyState:0,videoWidth:0}),/还在准备/)
  assert.throws(()=>captureFrame({readyState:2,videoWidth:640,videoHeight:480},()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/png;base64,fake'})),/无法生成/)
})
