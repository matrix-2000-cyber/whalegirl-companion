// Camera frames stay in this local worker. No remote inference or frame uploads.
importScripts('/vendor/vision/vision_bundle.js')
let model=null
self.onmessage=async event=>{
  const {type,frame,time}=event.data
  try{
    if(type==='init'){
      const files=await Vision.FilesetResolver.forVisionTasks('/vendor/vision/wasm')
      model=await Vision.HandLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/vendor/models/hand_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.5,minHandPresenceConfidence:.5,minTrackingConfidence:.5})
      self.postMessage({type:'ready'})
    }else if(type==='frame'){
      if(!model)throw Error('Model not ready')
      const result=model.detectForVideo(frame,time)
      self.postMessage({type:'result',points:result.landmarks?.[0]||null})
    }
  }catch{self.postMessage({type:'error',message:'手势识别暂时不可用，请关闭摄像头后重试'})}
  finally{frame?.close()}
}
