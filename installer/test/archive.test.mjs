import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {extractZip,safeChild} from '../archive.mjs'
function zip(name='ok.txt',{crc=0x352441c2,mode=0}={}){
 const n=Buffer.from(name),bytes=Buffer.from('abc'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22)
 local.writeUInt32LE(0x04034b50);local.writeUInt32LE(crc,14);local.writeUInt32LE(3,18);local.writeUInt32LE(3,22);local.writeUInt16LE(n.length,26)
 central.writeUInt32LE(0x02014b50);central.writeUInt32LE(crc,16);central.writeUInt32LE(3,20);central.writeUInt32LE(3,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE((mode<<16)>>>0,38)
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(local.length+n.length+3,16)
 return Buffer.concat([local,n,bytes,central,n,end])
}
test('archive rejects traversal, drive paths and alternate streams',()=>{
 for(const name of ['../outside','..\\outside','/root','C:/root','safe:stream','\\\\host\\share'])assert.throws(()=>safeChild(join(tmpdir(),'payload'),name))
})
test('archive verifies CRC and rejects links before writing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'whale-archive-'))
 try{
  const path=join(dir,'payload.zip'),target=join(dir,'out')
  await writeFile(path,zip());await extractZip(path,target);assert.equal(await readFile(join(target,'ok.txt'),'utf8'),'abc')
  for(const bytes of [zip('../outside'),zip('bad.txt',{crc:1}),zip('link',{mode:0xa1ff})]){
   await writeFile(path,bytes);await assert.rejects(extractZip(path,target))
  }
  if(process.platform!=='win32'){
   await symlink(dir,join(target,'redirect'));await writeFile(path,zip('redirect/escape'));await assert.rejects(extractZip(path,target),/Linked/)
  }
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('an empty deflated file in vendor ZIP archives is valid',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'whale-empty-'))
 try{
  const bytes=zip('empty'),localName=5,centralOffset=30+localName+3
  bytes.writeUInt16LE(8,8);bytes.writeUInt32LE(0,14);bytes.writeUInt32LE(2,18);bytes.writeUInt32LE(0,22)
  bytes[35]=3;bytes[36]=0
  bytes.writeUInt16LE(8,centralOffset+10);bytes.writeUInt32LE(0,centralOffset+16);bytes.writeUInt32LE(2,centralOffset+20);bytes.writeUInt32LE(0,centralOffset+24)
  await writeFile(join(dir,'a.zip'),bytes);await extractZip(join(dir,'a.zip'),join(dir,'out'))
  assert.equal((await readFile(join(dir,'out/empty'))).length,0)
 }finally{await rm(dir,{recursive:true,force:true})}
})
