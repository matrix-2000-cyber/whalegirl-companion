// Keep a clear camera frame within the existing bridge's 330KB JPEG limit.
export function captureFrame(video,canvasFactory=()=>document.createElement('canvas')){
  if(video.readyState<2||!video.videoWidth||!video.videoHeight)throw Error('摄像头还在准备，请稍等一下')
  const canvas=canvasFactory();let width=Math.min(1280,video.videoWidth)
  for(let scale=0;scale<4;scale++){
    canvas.width=Math.floor(width);canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth)
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height)
    for(const quality of [.86,.76,.65]){
      const uri=canvas.toDataURL('image/jpeg',quality)
      if(!uri.startsWith('data:image/jpeg;base64,'))throw Error('浏览器无法生成摄像头照片，请用 Edge 重试')
      const image=uri.split(',')[1]
      if(image&&image.length<=400000)return {image,width:canvas.width,height:canvas.height,quality}
    }
    width*=.8
  }
  throw Error('画面内容太复杂，请靠近一些或换个背景再试')
}
