importScripts('/vendor/vision/vision_bundle.js')
let model=null
self.onmessage=async event=>{
  const {type,frame,time}=event.data
  try{
    if(type==='init'){
      const files=await Vision.FilesetResolver.forVisionTasks('/vendor/vision/wasm')
      model=await Vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/vendor/models/face_landmarker.task',delegate:'CPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.5})
      self.postMessage({type:'ready'})
    }else if(type==='frame'){
      const result=model.detectForVideo(frame,time)
      self.postMessage({type:'result',categories:result.faceBlendshapes?.[0]?.categories||null,matrix:result.facialTransformationMatrixes?.[0]?.data||null})
    }
  }catch{self.postMessage({type:'error',message:'面部动作识别暂时不可用，不影响其他聊天'})}
  finally{frame?.close()}
}
