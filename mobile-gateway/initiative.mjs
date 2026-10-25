export const INITIATIVE_COOLDOWN=90000
export const initiativePrompts={
  'camera-open':'[开场事件，非用户发言]主动招呼，先接一句，再围绕一个小观察、标明“小故事”的趣事或轻松话题自然展开。整段正文150–200字，目标170–180字，分成几个完整的短句连续讲述；最后最多问一个轻松问题，不要只说一两句，不列提纲，不复读。勿虚构真实经历。',
  idle:'[空闲事件，非用户发言]主动接一个新的轻松话题，展开一个小观察或标明“小故事”的趣事。整段正文150–200字，目标170–180字，分成几个完整的短句连续讲述；最后最多问一个轻松问题，不重复问候、不复读、不列提纲，勿虚构真实经历。',
}
export function initiativePrompt(kind,hasImage){
 return initiativePrompts[kind]+(hasImage?'仅用本轮镜头，不沿用旧镜头。':'本轮无新镜头，不描述外貌衣着。')
}
