import jwt from 'jsonwebtoken';

function bearer(req){
  const h=req.headers.authorization||'';
  return h.startsWith('Bearer ')?h.slice(7):null;
}
function verify(req){
  const token=bearer(req);
  if(!token) return null;
  try{return jwt.verify(token,process.env.JWT_SECRET);}catch{return null;}
}
export function memberRequired(req,res,next){
  const p=verify(req);
  if(!p || p.role!=='member') return res.status(401).json({message:'학교 구성원 로그인이 필요합니다.'});
  req.auth=p; next();
}
export function adminRequired(req,res,next){
  const p=verify(req);
  if(!p || p.role!=='admin') return res.status(401).json({message:'관리자 권한이 필요합니다.'});
  req.auth=p; next();
}
