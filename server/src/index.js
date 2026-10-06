import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { pool } from './db.js';

dotenv.config();
const app = express();
app.use(helmet());
const origins = process.env.CLIENT_ORIGIN?.split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({ origin: origins?.length ? origins : true }));
app.use(express.json({ limit:'30kb' }));
const limiter = rateLimit({ windowMs:60_000, max:60, standardHeaders:true, legacyHeaders:false });

function sign(role){ return jwt.sign({role}, process.env.JWT_SECRET, {expiresIn: role==='admin'?'8h':'30d'}); }
function auth(role){ return (req,res,next)=>{ try { const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):''; const p=jwt.verify(token,process.env.JWT_SECRET); if(role && p.role!==role) throw new Error(); req.auth=p; next(); } catch { res.status(401).json({message:'인증이 필요합니다.'}); } }; }
function grades(input){ return [...new Set((Array.isArray(input)?input:[]).map(Number).filter(g=>Number.isInteger(g)&&g>=1&&g<=6))].sort((a,b)=>a-b); }

app.get('/api/health', async (_req,res)=>{ try{ await pool.query('SELECT 1'); res.json({ok:true}); }catch(e){res.status(500).json({ok:false});} });
app.post('/api/admin/login', limiter, (req,res)=>{ if(!process.env.ADMIN_PASSWORD || req.body?.password!==process.env.ADMIN_PASSWORD) return res.status(401).json({message:'관리자 비밀번호가 올바르지 않습니다.'}); res.json({token:sign('admin')}); });

app.get('/api/activities', async (req,res)=>{
  const g=Number(req.query.grade), q=(req.query.q||'').trim(); const params=[]; const where=['a.is_active=true'];
  if(Number.isInteger(g)&&g>=1&&g<=6){params.push(g);where.push(`EXISTS(SELECT 1 FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id AND ag.grade=$${params.length})`);}
  if(q){params.push(`%${q}%`);where.push(`(a.name ILIKE $${params.length} OR COALESCE(a.provider,'') ILIKE $${params.length})`);}
  const sql=`SELECT a.id,a.name,a.activity_type,a.provider,a.description,a.duration_minutes,
    COALESCE((SELECT ARRAY_AGG(ag.grade ORDER BY ag.grade) FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id),'{}') AS available_grades,
    (SELECT COUNT(*) FROM activity_records_v4 r WHERE r.activity_id=a.id)::int AS record_count,
    (SELECT r.school_year FROM activity_records_v4 r WHERE r.activity_id=a.id ORDER BY r.school_year DESC LIMIT 1) AS latest_year,
    (SELECT r.overall_satisfaction FROM activity_records_v4 r WHERE r.activity_id=a.id ORDER BY r.school_year DESC LIMIT 1) AS latest_satisfaction,
    (SELECT r.recommendation FROM activity_records_v4 r WHERE r.activity_id=a.id ORDER BY r.school_year DESC LIMIT 1) AS latest_recommendation
    FROM activities_v4 a WHERE ${where.join(' AND ')} ORDER BY a.name`;
  try{res.json((await pool.query(sql,params)).rows);}catch(e){res.status(500).json({message:'교육활동을 불러오지 못했습니다.'});}
});

app.get('/api/activities/:id', async(req,res)=>{
  const id=Number(req.params.id); if(!Number.isInteger(id)) return res.status(400).json({message:'잘못된 교육활동입니다.'});
  try{
    const a=(await pool.query(`SELECT a.*,COALESCE((SELECT ARRAY_AGG(ag.grade ORDER BY ag.grade) FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id),'{}') available_grades FROM activities_v4 a WHERE a.id=$1 AND a.is_active=true`,[id])).rows[0];
    if(!a) return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});
    const records=(await pool.query(`SELECT r.*,COALESCE((SELECT ARRAY_AGG(rg.grade ORDER BY rg.grade) FROM activity_record_grades_v4 rg WHERE rg.record_id=r.id),'{}') operated_grades FROM activity_records_v4 r WHERE r.activity_id=$1 ORDER BY r.school_year DESC`,[id])).rows;
    res.json({activity:a,records});
  }catch(e){res.status(500).json({message:'상세 정보를 불러오지 못했습니다.'});}
});

app.get('/api/admin/activities',auth('admin'),async(_req,res)=>{
  const rows=(await pool.query(`SELECT a.*,COALESCE((SELECT ARRAY_AGG(ag.grade ORDER BY ag.grade) FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id),'{}') available_grades FROM activities_v4 a ORDER BY a.name`)).rows; res.json(rows);
});

app.post('/api/admin/activities',auth('admin'),async(req,res)=>{
  const {name,activity_type,provider='',description='',duration_minutes=null,available_grades=[]}=req.body||{}; const gs=grades(available_grades);
  if(!name?.trim()||!activity_type?.trim()) return res.status(400).json({message:'교육활동명과 유형을 입력해주세요.'}); if(!gs.length) return res.status(400).json({message:'신청 가능한 학년을 하나 이상 선택해주세요.'});
  const c=await pool.connect(); try{await c.query('BEGIN'); const a=(await c.query(`INSERT INTO activities_v4(name,activity_type,provider,description,duration_minutes) VALUES($1,$2,$3,$4,$5) RETURNING *`,[name.trim(),activity_type.trim(),provider.trim(),description.trim(),duration_minutes?Number(duration_minutes):null])).rows[0]; for(const g of gs) await c.query('INSERT INTO activity_available_grades_v4(activity_id,grade) VALUES($1,$2)',[a.id,g]); await c.query('COMMIT'); res.status(201).json({...a,available_grades:gs}); }catch(e){await c.query('ROLLBACK');res.status(500).json({message:'교육활동을 저장하지 못했습니다.'});}finally{c.release();}
});

app.put('/api/admin/activities/:id',auth('admin'),async(req,res)=>{
  const id=Number(req.params.id); const {name,activity_type,provider='',description='',duration_minutes=null,available_grades=[]}=req.body||{}; const gs=grades(available_grades); if(!name?.trim()||!activity_type?.trim()||!gs.length)return res.status(400).json({message:'필수 정보를 확인해주세요.'});
  const c=await pool.connect(); try{await c.query('BEGIN'); const a=(await c.query(`UPDATE activities_v4 SET name=$1,activity_type=$2,provider=$3,description=$4,duration_minutes=$5 WHERE id=$6 RETURNING *`,[name.trim(),activity_type.trim(),provider.trim(),description.trim(),duration_minutes?Number(duration_minutes):null,id])).rows[0]; if(!a){await c.query('ROLLBACK');return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});} await c.query('DELETE FROM activity_available_grades_v4 WHERE activity_id=$1',[id]); for(const g of gs)await c.query('INSERT INTO activity_available_grades_v4(activity_id,grade) VALUES($1,$2)',[id,g]); await c.query('COMMIT');res.json({...a,available_grades:gs});}catch(e){await c.query('ROLLBACK');res.status(500).json({message:'교육활동을 수정하지 못했습니다.'});}finally{c.release();}
});
app.delete('/api/admin/activities/:id',auth('admin'),async(req,res)=>{const id=Number(req.params.id);try{const r=await pool.query('UPDATE activities_v4 SET is_active=false WHERE id=$1 RETURNING id',[id]);if(!r.rows[0])return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});res.json({ok:true});}catch(e){res.status(500).json({message:'삭제하지 못했습니다.'});}});

app.post('/api/admin/activities/:id/records',auth('admin'),async(req,res)=>{
 const id=Number(req.params.id); const {school_year,budget=null,overall_satisfaction=null,recommendation='추천',pros='',cons='',additional_comment='',reviewer_name='',operated_grades=[]}=req.body||{}; const gs=grades(operated_grades); const year=Number(school_year);
 if(!Number.isInteger(year)||year<2000||year>2100)return res.status(400).json({message:'운영 연도를 확인해주세요.'}); if(!gs.length)return res.status(400).json({message:'실제 운영 학년을 하나 이상 선택해주세요.'}); if(!['적극 추천','추천','조건부 추천','비추천'].includes(recommendation))return res.status(400).json({message:'재실시 추천을 선택해주세요.'});
 const c=await pool.connect(); try{await c.query('BEGIN'); const r=(await c.query(`INSERT INTO activity_records_v4(activity_id,school_year,budget,overall_satisfaction,recommendation,pros,cons,additional_comment,reviewer_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(activity_id,school_year) DO UPDATE SET budget=EXCLUDED.budget,overall_satisfaction=EXCLUDED.overall_satisfaction,recommendation=EXCLUDED.recommendation,pros=EXCLUDED.pros,cons=EXCLUDED.cons,additional_comment=EXCLUDED.additional_comment,reviewer_name=EXCLUDED.reviewer_name RETURNING *`,[id,year,budget===''||budget==null?null:Number(budget),overall_satisfaction===''||overall_satisfaction==null?null:Number(overall_satisfaction),recommendation,pros.trim(),cons.trim(),additional_comment.trim(),reviewer_name.trim()])).rows[0]; await c.query('DELETE FROM activity_record_grades_v4 WHERE record_id=$1',[r.id]);for(const g of gs)await c.query('INSERT INTO activity_record_grades_v4(record_id,grade) VALUES($1,$2)',[r.id,g]);await c.query('COMMIT');res.status(201).json(r);}catch(e){await c.query('ROLLBACK');res.status(500).json({message:'운영 기록을 저장하지 못했습니다.'});}finally{c.release();}
});
app.delete('/api/admin/records/:id',auth('admin'),async(req,res)=>{try{const r=await pool.query('DELETE FROM activity_records_v4 WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!r.rows[0])return res.status(404).json({message:'기록을 찾을 수 없습니다.'});res.json({ok:true});}catch(e){res.status(500).json({message:'기록을 삭제하지 못했습니다.'});}});

const port=process.env.PORT||10000; app.listen(port,()=>console.log(`API listening on ${port}`));
