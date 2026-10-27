import test from 'node:test'
import assert from 'node:assert/strict'
import {fingerGazeCommand,createFingerGaze} from '../public/finger-gaze.mjs'
test('only a direct request activates finger gaze; descriptions and ordinary chat do not',()=>{
 for(const text of ['看我的手指','请你看着我的食指','鲸鲸，眼睛跟着我的手指移动','能不能盯着我的指尖'])assert.equal(fingerGazeCommand(text),'start',text)
 for(const text of ['你好','我今天看了手指的照片','我把手指放到摄像头前了','如果我说看我的手指会怎样','解释“看我的手指”这句话',null])assert.equal(fingerGazeCommand(text),null,text)
 for(const text of ['不要看我的手指','别盯着手指了','停止跟随','看回我','好了，看着我'])assert.equal(fingerGazeCommand(text),'stop',text)
})
test('gaze starts disabled, expires after one action, and stop/camera reset revoke it',()=>{
 let now=100;const action=createFingerGaze({now:()=>now})
 assert.equal(action.active(),false);action.command('你好');assert.equal(action.active(),false)
 action.command('看我的手指');assert.equal(action.active(),true);assert.equal(action.remaining(),30000)
 now+=30000;assert.equal(action.active(),false)
 action.command('请看手指');assert.equal(action.active(),true);action.command('看回我');assert.equal(action.active(),false)
 action.command('请看手指');action.reset();assert.equal(action.active(),false)
})
