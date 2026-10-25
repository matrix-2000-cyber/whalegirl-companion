import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {managedOwnerFactory} from '../managed-owner.js'

test('managed owner never creates a session without explicit isolated opt-in or a model',async()=>{
 let creates=0
 const ctx={get:()=>({currentSelection:()=>null}),agents:{create:()=>creates++}}
 for(const options of [{enabled:false,cwd:tmpdir()},{enabled:true,cwd:'relative'},{enabled:true,cwd:tmpdir()}]){
  await assert.rejects(managedOwnerFactory({ctx,...options})())
 }
 assert.equal(creates,0)
})
test('concurrent first requests share one session and use only managed workspace',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'whale-owner-'))
 try{
  let creates=0,saved,held,creation
  const agent={id:'test'},handle={agent,dispose:async()=>{}}
  const preset=()=>{}
  const ctx={get:()=>({currentSelection:()=>({provider:'user-provider',model:'user-model'})}),agents:{create:async options=>{creates++;creation=options;await new Promise(r=>setImmediate(r));return handle}}}
  const create=managedOwnerFactory({ctx,enabled:true,cwd,preset,save:async id=>{saved=id},hold:(id,h)=>{held=[id,h]}})
  assert.deepEqual(await Promise.all([create(),create()]),[agent,agent])
  assert.equal(creates,1);assert.equal(creation.meta.cwd,cwd);assert.equal(creation.setup,preset)
  assert.equal(creation.sessionId,saved);assert.equal(held[0],saved);assert.equal(held[1],handle)
 }finally{await rm(cwd,{recursive:true,force:true})}
})
test('failed persistence disposes the new handle and allows retry',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'whale-owner-'))
 try{
  let disposed=0,held=0,saves=0
  const handle={agent:{},dispose:async()=>{disposed++}}
  const ctx={get:()=>({currentSelection:()=>({provider:'p',model:'m'})}),agents:{create:async()=>handle}}
  const create=managedOwnerFactory({ctx,enabled:true,cwd,save:async()=>{if(!saves++)throw Error('disk full')},hold:()=>held++})
  await assert.rejects(create(),/disk full/);assert.equal(disposed,1);assert.equal(held,0)
  assert.equal(await create(),handle.agent);assert.equal(held,1)
 }finally{await rm(cwd,{recursive:true,force:true})}
})
