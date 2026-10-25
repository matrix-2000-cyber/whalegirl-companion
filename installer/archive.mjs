import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises'
import {resolve,dirname,sep,isAbsolute} from 'node:path'
import {inflateRawSync} from 'node:zlib'
export function safeChild(root,name){
 if(!name||isAbsolute(name)||/^[A-Za-z]:|:|\0/.test(name))throw Error('Unsafe archive path')
 const base=resolve(root),full=resolve(base,name.replaceAll('\\','/'))
 if(!full.startsWith(base+sep))throw Error('Archive path escapes destination')
 return full
}
const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc32=b=>{let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0}
export async function extractZip(file,root){
 const data=await readFile(file);let eocd=-1
 for(let p=data.length-22;p>=Math.max(0,data.length-65558);p--)if(data.readUInt32LE(p)===0x06054b50){eocd=p;break}
 if(eocd<0||data.readUInt16LE(eocd+4)||data.readUInt16LE(eocd+6))throw Error('Unsupported ZIP archive')
 const count=data.readUInt16LE(eocd+10);let offset=data.readUInt32LE(eocd+16),total=0
 if(count===65535||offset===0xffffffff)throw Error('ZIP64 is not supported')
 const files=[],seen=new Set()
 for(let i=0;i<count;i++){
  if(offset+46>data.length||data.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid ZIP directory')
  const flags=data.readUInt16LE(offset+8),method=data.readUInt16LE(offset+10),crc=data.readUInt32LE(offset+16),size=data.readUInt32LE(offset+20),length=data.readUInt32LE(offset+24)
  const n=data.readUInt16LE(offset+28),extra=data.readUInt16LE(offset+30),comment=data.readUInt16LE(offset+32),mode=data.readUInt32LE(offset+38)>>>16,local=data.readUInt32LE(offset+42)
  const name=data.subarray(offset+46,offset+46+n).toString('utf8'),target=safeChild(root,name)
  offset+=46+n+extra+comment
  if(flags&1||(mode&0xf000)===0xa000||![0,8].includes(method))throw Error('Unsupported archive entry')
  if(name.endsWith('/'))continue
  if(seen.has(target.toLowerCase()))throw Error('Duplicate archive target');seen.add(target.toLowerCase())
  total+=length;if(total>3_000_000_000||length>1_000_000_000)throw Error('Archive too large')
  if(local+30>data.length||data.readUInt32LE(local)!==0x04034b50)throw Error('Invalid local ZIP entry')
  const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28)
  if(start+size>data.length)throw Error('Invalid ZIP length')
  files.push({target,method,crc,length,bytes:data.subarray(start,start+size)})
 }
 await mkdir(root,{recursive:true})
 for(const entry of files){
  await mkdir(dirname(entry.target),{recursive:true})
  let current=dirname(entry.target)
  while(current.length>=resolve(root).length){if((await lstat(current)).isSymbolicLink())throw Error('Linked archive destination');current=dirname(current)}
  try{if((await lstat(entry.target)).isSymbolicLink())throw Error('Linked archive file')}catch(e){if(e.code!=='ENOENT')throw e}
  const bytes=entry.method===8?inflateRawSync(entry.bytes,{maxOutputLength:Math.max(1,entry.length)}):entry.bytes
  if(bytes.length!==entry.length||crc32(bytes)!==entry.crc)throw Error('ZIP integrity check failed')
  await writeFile(entry.target,bytes)
 }
 return files.length
}
