import test from 'node:test'
import assert from 'node:assert/strict'
import {recoverPending,waitForPending,forgetPending} from '../public/pending-turn.mjs'
function storage(id){const map=new Map(id?[['whale-pending',id]]:[]);return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
test('a missing receipt clears the stale wait so the next voice turn can proceed without replay',async()=>{
  const s=storage('stale');let calls=0
  const job=await waitForPending({storage:s,getJob:async id=>{calls++;assert.equal(id,'stale');throw Object.assign(Error('没有这条消息'),{status:404})}})
  assert.equal(job.status,'missing');assert.equal(s.getItem('whale-pending'),null);assert.equal(calls,1)
})
test('actual pending requests wait for completion; authentication/network failures preserve the receipt',async()=>{
  const s=storage('accepted');let calls=0
  await waitForPending({storage:s,getJob:async()=>({status:++calls===1?'pending':'done'}),pause:async()=>{}})
  assert.equal(calls,2);assert.equal(s.getItem('whale-pending'),null)
  for(const status of [401,500,undefined]){
    s.setItem('whale-pending','accepted')
    await assert.rejects(recoverPending({storage:s,getJob:async()=>{throw Object.assign(Error('offline'),{status})}}),/offline/)
    assert.equal(s.getItem('whale-pending'),'accepted')
  }
})
test('recovery cannot erase a newer accepted turn, and cancelled calls never query',async()=>{
  const s=storage('old');s.setItem('whale-pending','new');forgetPending(s,'old');assert.equal(s.getItem('whale-pending'),'new')
  const c=new AbortController();c.abort()
  await assert.rejects(waitForPending({storage:s,signal:c.signal,getJob:async()=>assert.fail('cancelled')}),{name:'AbortError'})
})
