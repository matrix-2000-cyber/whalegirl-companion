// Conservative residual-speech detector. Browser echo cancellation is required.
export function cosine(a,b){
  if(!a?.length||a.length!==b?.length)return 0
  let dot=0,aa=0,bb=0
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}
  return aa&&bb?dot/Math.sqrt(aa*bb):0
}
export function createSignalProbe(analyser,sampleRate){
  const wave=new Float32Array(analyser.fftSize),spectrum=new Float32Array(analyser.frequencyBinCount)
  const edges=[120,250,500,1000,2000,3500,6000]
  return ()=>{
    analyser.getFloatTimeDomainData(wave);analyser.getFloatFrequencyData(spectrum)
    let sum=0;for(const x of wave)sum+=x*x
    const bands=edges.slice(0,-1).map((low,i)=>{
      const start=Math.max(1,Math.floor(low*analyser.fftSize/sampleRate)),end=Math.min(spectrum.length,Math.ceil(edges[i+1]*analyser.fftSize/sampleRate))
      let power=0;for(let j=start;j<end;j++)power+=10**(spectrum[j]/10)
      return Math.sqrt(power/Math.max(1,end-start))
    })
    return {rms:Math.sqrt(sum/wave.length),bands}
  }
}
export function createBargeInDetector({holdMs=300,warmupMs=240}={}){
  let candidate=null,noise=.003,echo=.002,started=null,latched=false
  return {reset(){candidate=null;started=null;latched=false;echo=.002},update({mic,output,active,enabled,now}){
    const rms=mic?.rms
    if(!Number.isFinite(rms)||rms<0){candidate=null;return null}
    if(!active){if(rms<.012)noise=noise*.95+rms*.05;candidate=null;started=null;latched=false;return null}
    if(!enabled||latched){candidate=null;return null}
    if(started===null)started=now
    const playing=output?.playing===true,reference=output?.rms||0
    if(playing&&!output?.bands?.length){candidate=null;return null}
    const similar=playing&&reference>.008&&cosine(mic.bands,output.bands)>.9
    if(similar)echo=Math.min(.012,echo*.8+rms*.2)
    // Similar playback, room noise and short clicks cannot interrupt speech.
    const threshold=Math.max(.024,noise*4,playing?echo*2.5:0)
    if(now-started<warmupMs||similar||rms<threshold){candidate=null;return null}
    if(candidate===null)candidate=now
    if(now-candidate<holdMs)return null
    latched=true;return {startedAt:candidate,detectedAt:now,trimLeadMs:250}
  }}
}
