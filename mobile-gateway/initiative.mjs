export const INITIATIVE_COOLDOWN=90000
export const initiativePrompts={
  'camera-open':'[开场事件，非用户发言]主动招呼并问一个轻松问题，或说标明“小故事”的趣事再问一句。勿虚构真实经历。每条20字内，最多3条。',
  idle:'[空闲事件，非用户发言]接话题问一个轻松问题，或分享标明“小故事”的趣事。不重复问候，勿虚构经历。每条20字内，最多3条。',
}
export function initiativePrompt(kind,hasImage){
 return initiativePrompts[kind]+(hasImage?'仅用本轮镜头，不沿用旧镜头。':'本轮无新镜头，不描述外貌衣着。')
}
