// One opener per camera visit, then at most one unanswered question.
export function createInitiative({now=Date.now,lastAt=-Infinity,save=()=>{},cooldown=90000,idle=60000}={}){
  let opened=false,pending=false,waiting=false,activity=now()
  return {
    open(){opened=true;pending=true;waiting=false;activity=now()},
    close(){opened=false;pending=false;waiting=true},
    activity(){activity=now()},
    userTurn(){pending=false;waiting=false;activity=now()},
    next({ready,available,enabled}){
      if(!opened||!enabled||!ready||!available||now()-lastAt<cooldown)return null
      if(!pending&&(waiting||now()-activity<idle))return null
      const kind=pending?'camera-open':'idle'
      pending=false;waiting=true;lastAt=now();activity=now();save(lastAt)
      return kind
    },
  }
}
