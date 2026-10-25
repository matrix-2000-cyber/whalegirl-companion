import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVoiceScript } from '../public/voice-emotion.mjs'

const clipOf=text=>parseVoiceScript(text).clip

test('every emotion cue maps to its clip', () => {
  const cases=[
    ['呜呜呜，我好难过。','cry_1'],
    ['哈哈哈，这个太好玩了。','laugh_1'],
    ['哼！我才不要理你。','angry_1'],
    ['唉，今天有一点累。','sigh_1'],
    ['好耶，我们出去走走吧。','happy_1'],
    ['啊？你说什么？','surprise_1'],
  ]
  for(const [text,clip] of cases)assert.equal(clipOf(text),clip,text)
  assert.equal(clipOf('😭 今天真的好难'),'cry_1')
  assert.equal(clipOf('555，我不想上班'),'cry_1')
  assert.equal(clipOf('T_T 又被你说中了'),'cry_1')
  assert.equal(clipOf('气死我了'),'angry_1')
  assert.equal(clipOf('笑死我了'),'laugh_1')
  assert.equal(clipOf('哇！好漂亮'),'surprise_1')
})

test('crying wins over laughing so a sob is never read as a joke', () => {
  assert.equal(clipOf('哈哈哈，呜呜呜，我没事。'),'cry_1')
  assert.equal(clipOf('呜呜，哈哈哈，别管我。'),'cry_1')
  assert.equal(clipOf('唉，哈哈哈，算了。'),'laugh_1')
  assert.equal(clipOf('生气，但是好开心。'),'angry_1')
})

test('onomatopoeia is stripped but the emotion word stays readable', () => {
  const laugh=parseVoiceScript('哈哈哈，好开心！')
  assert.equal(laugh.clip,'laugh_1')
  assert.equal(laugh.spoken,'好开心！')
  assert.ok(!laugh.spoken.includes('哈哈哈'))
  assert.equal(parseVoiceScript('嘿嘿嘿，被你发现了。').spoken,'被你发现了。')
  assert.equal(parseVoiceScript('呜呜呜，别走。').spoken,'别走。')
  assert.equal(parseVoiceScript('555，算了。').spoken,'算了。')
  assert.equal(parseVoiceScript('😭 我好想你。').spoken,'我好想你。')
  assert.equal(parseVoiceScript('唉，今天有一点累。').spoken,'今天有一点累。')
  assert.equal(parseVoiceScript('今天有一点累，唉。').spoken,'今天有一点累。')
  assert.equal(parseVoiceScript('我在唉声叹气。').spoken,'我在唉声叹气。')
})

test('the reply is never emptied even when it is only a sound', () => {
  for(const text of ['哈哈哈','呜呜呜','😭','555','嘻']){
    const script=parseVoiceScript(text)
    assert.ok(script.spoken.length>0,text)
  }
  assert.equal(parseVoiceScript('呜呜呜').spoken,'呜呜呜')
  assert.equal(parseVoiceScript('哈哈哈').clip,'laugh_1')
})

test('neutral replies keep the exact original text', () => {
  const text='今天天气不错，陪我坐一会儿吧。'
  assert.deepEqual(parseVoiceScript(text),{spoken:text,clip:null})
  assert.deepEqual(parseVoiceScript('嗯，我在听。'),{spoken:'嗯，我在听。',clip:null})
})

test('comforting someone else is not her own crying', () => {
  assert.equal(clipOf('别哭了，我不是在凶你。'),null)
  assert.equal(clipOf('不哭不哭，慢慢来。'),null)
  assert.equal(parseVoiceScript('别哭了，我在这儿。').clip,null)
  // Once she admits her own tears the cue is back.
  assert.equal(clipOf('别哭了，其实我也想哭。'),'cry_1')
})

test('non-strings are reported as empty instead of throwing', () => {
  for(const value of [null,undefined,42,true,{},[],()=>{}])assert.deepEqual(parseVoiceScript(value),{spoken:'',clip:null})
})

test('only the first 200 characters are inspected and the tail is never lost', () => {
  const late='好'.repeat(200)+'哈哈哈'
  assert.equal(clipOf(late),null)
  assert.equal(parseVoiceScript(late).spoken,late)
  const early='哈哈哈，'+'今天我们一起把作业写完，然后再去阳台看一会儿海。'.repeat(12)
  const script=parseVoiceScript(early)
  assert.equal(script.clip,'laugh_1')
  assert.ok(script.spoken.startsWith('今天'))
  assert.ok(script.spoken.endsWith('。'))
  assert.ok(script.spoken.length>200)
  assert.ok(!script.spoken.includes('哈哈哈'))
})
