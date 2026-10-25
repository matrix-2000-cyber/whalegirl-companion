import test from 'node:test'
import assert from 'node:assert/strict'
import { mouthFrame } from '../public/avatar.mjs'
test('avatar closes its mouth during silence and interruption, independent of reply generation',()=>{
  assert.equal(mouthFrame(.2,false),0)
  assert.equal(mouthFrame(0,true),0)
  assert.equal(mouthFrame(.03,true),1)
  assert.equal(mouthFrame(.12,true),2)
  assert.equal(mouthFrame(NaN,true),0)
})
