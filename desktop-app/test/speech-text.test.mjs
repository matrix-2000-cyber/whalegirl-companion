import test from 'node:test'
import assert from 'node:assert/strict'
import {formatReply,speechText,createPlaybackGate} from '../public/speech-text.mjs'
test('duplicated assembled replies speak each sentence once, including changed closing punctuation',()=>{
  const input='鲸鲸今天翻到个好玩的海怪冷知识～ 爸爸晚饭吃了吗，别只忙不吃饭。\n鲸鲸今天翻到个好玩的海怪冷知识～\n\n爸爸晚饭吃了吗，别只忙不吃饭～'
  assert.equal(formatReply(input),'鲸鲸今天翻到个好玩的海怪冷知识～\n爸爸晚饭吃了吗，别只忙不吃饭。')
  assert.equal(speechText(input),'鲸鲸今天翻到个好玩的海怪冷知识。\n爸爸晚饭吃了吗，别只忙不吃饭。')
})
test('formatting preserves distinct sentences, decimals, emphasis and short breath groups',()=>{
  assert.equal(formatReply('真的真的好开心！温度是1.5度。温度是15度。'),'真的真的好开心！\n温度是1.5度。\n温度是15度。')
  const formatted=formatReply('今天在海边看到一只小海豚，它轻轻地跳过浪花又回头看了我一眼。')
  assert.ok(formatted.split('\n').every(line=>Array.from(line).length<=20))
  assert.equal(formatted.replace(/\n/g,''),'今天在海边看到一只小海豚，它轻轻地跳过浪花又回头看了我一眼。')
  assert.ok(speechText('今天在海边看到一只小海豚，它轻轻地跳过浪花又回头看了我一眼。').includes('，\n'))
})
test('automatic playback claims each reply once but permits the same words in a later reply',()=>{
  const gate=createPlaybackGate()
  assert.equal(gate.claim('reply-1'),true)
  assert.equal(gate.claim('reply-1'),false)
  assert.equal(gate.claim('reply-2'),true)
})
