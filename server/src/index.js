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
function sign(role){ return jwt.sign({role}, process.env.JWT_SECRET, {expiresIn:'8h'}); }
function auth(role){ return (req,res,next)=>{ try { const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):''; const p=jwt.verify(token,process.env.JWT_SECRET); if(role && p.role!==role) throw new Error(); req.auth=p; next(); } catch { res.status(401).json({message:'인증이 필요합니다.'}); } }; }
function grades(input){ return [...new Set((Array.isArray(input)?input:[]).map(Number).filter(g=>Number.isInteger(g)&&g>=1&&g<=6))].sort((a,b)=>a-b); }
const recs=['적극 추천','추천','조건부 추천','비추천'];

app.get('/api/health', async (_req,res)=>{ try{ await pool.query('SELECT 1'); res.json({ok:true}); }catch(e){res.status(500).json({ok:false});} });
app.post('/api/admin/login', limiter, (req,res)=>{ if(!process.env.ADMIN_PASSWORD || req.body?.password!==process.env.ADMIN_PASSWORD) return res.status(401).json({message:'관리자 비밀번호가 올바르지 않습니다.'}); res.json({token:sign('admin')}); });

app.get('/api/years', async (_req,res)=>{
 try { const rows=await pool.query(`SELECT school_year AS year FROM activity_years_v4 UNION SELECT school_year AS year FROM activity_records_v4 ORDER BY year DESC`); res.json(rows.rows.map(r=>Number(r.year))); }
 catch(e){res.status(500).json({message:'운영 연도를 불러오지 못했습니다.'});}
});

app.get('/api/activities', async (req,res)=>{
 const g=Number(req.query.grade), year=Number(req.query.year), q=(req.query.q||'').trim(); const params=[]; const where=['a.is_active=true'];
 if(Number.isInteger(year)&&year>=2000&&year<=2100){params.push(year);where.push(`EXISTS(SELECT 1 FROM activity_years_v4 ay WHERE ay.activity_id=a.id AND ay.school_year=$${params.length})`);}
 if(Number.isInteger(g)&&g>=1&&g<=6){params.push(g);where.push(`EXISTS(SELECT 1 FROM activity_year_grades_v4 yg JOIN activity_years_v4 ay ON ay.id=yg.activity_year_id WHERE ay.activity_id=a.id AND yg.grade=$${params.length}${Number.isInteger(year)&&year>=2000&&year<=2100?` AND ay.school_year=$1`:''})`);}
 if(q){params.push(`%${q}%`);where.push(`(a.name ILIKE $${params.length} OR COALESCE(a.provider,'') ILIKE $${params.length})`);}
 const sql=`SELECT a.id,a.name,a.activity_type,a.provider,a.description,a.duration_periods,
 COALESCE((SELECT ARRAY_AGG(ag.grade ORDER BY ag.grade) FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id),'{}') AS available_grades,
 ay.school_year AS selected_year, ay.budget,
 COALESCE((SELECT ARRAY_AGG(yg.grade ORDER BY yg.grade) FROM activity_year_grades_v4 yg WHERE yg.activity_year_id=ay.id),'{}') AS operated_grades,
 (SELECT COUNT(*) FROM activity_records_v4 r WHERE r.activity_id=a.id AND r.school_year=ay.school_year)::int AS record_count,
 (SELECT ROUND(AVG(r.overall_satisfaction)::numeric,1) FROM activity_records_v4 r WHERE r.activity_id=a.id AND r.school_year=ay.school_year) AS average_satisfaction,
 (SELECT r.recommendation FROM activity_records_v4 r WHERE r.activity_id=a.id AND r.school_year=ay.school_year ORDER BY CASE r.recommendation WHEN '적극 추천' THEN 1 WHEN '추천' THEN 2 WHEN '조건부 추천' THEN 3 ELSE 4 END LIMIT 1) AS recommendation
 FROM activities_v4 a JOIN activity_years_v4 ay ON ay.activity_id=a.id WHERE ${where.join(' AND ')} ORDER BY a.name`;
 try{res.json((await pool.query(sql,params)).rows);}catch(e){res.status(500).json({message:'교육활동을 불러오지 못했습니다.'});}
});

app.get('/api/activities/:id', async(req,res)=>{
 const id=Number(req.params.id); const year=Number(req.query.year); if(!Number.isInteger(id))return res.status(400).json({message:'잘못된 교육활동입니다.'});
 try{
  const a=(await pool.query(`SELECT a.*,COALESCE((SELECT ARRAY_AGG(ag.grade ORDER BY ag.grade) FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id),'{}') available_grades FROM activities_v4 a WHERE a.id=$1 AND a.is_active=true`,[id])).rows[0];
  if(!a)return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});
  const years=(await pool.query(`SELECT ay.id,ay.school_year,ay.budget,COALESCE(ARRAY_AGG(yg.grade ORDER BY yg.grade) FILTER(WHERE yg.grade IS NOT NULL),'{}') AS operated_grades FROM activity_years_v4 ay LEFT JOIN activity_year_grades_v4 yg ON yg.activity_year_id=ay.id WHERE ay.activity_id=$1 GROUP BY ay.id ORDER BY ay.school_year DESC`,[id])).rows;
  const params=[id]; let yClause=''; if(Number.isInteger(year)&&year>=2000&&year<=2100){params.push(year);yClause=' AND r.school_year=$2';}
  const records=(await pool.query(`SELECT r.* FROM activity_records_v4 r WHERE r.activity_id=$1${yClause} ORDER BY r.school_year DESC,r.reviewer_grade`,params)).rows;
  res.json({activity:a,years,records});
 }catch(e){res.status(500).json({message:'상세 정보를 불러오지 못했습니다.'});}
});

app.get('/api/admin/activities',auth('admin'),async(_req,res)=>{
 try{const rows=(await pool.query(`SELECT a.*,COALESCE((SELECT ARRAY_AGG(ag.grade ORDER BY ag.grade) FROM activity_available_grades_v4 ag WHERE ag.activity_id=a.id),'{}') available_grades FROM activities_v4 a WHERE a.is_active=true ORDER BY a.name`)).rows;res.json(rows);}catch(e){res.status(500).json({message:'교육활동을 불러오지 못했습니다.'});}
});
app.post('/api/admin/activities',auth('admin'),async(req,res)=>{
 const {name,activity_type,provider='',description='',duration_periods=null,available_grades=[]}=req.body||{}; const gs=grades(available_grades);
 if(!name?.trim()||!activity_type?.trim())return res.status(400).json({message:'교육활동명과 유형을 입력해주세요.'}); if(!gs.length)return res.status(400).json({message:'신청 가능한 학년을 하나 이상 선택해주세요.'});
 const c=await pool.connect();try{await c.query('BEGIN');const a=(await c.query(`INSERT INTO activities_v4(name,activity_type,provider,description,duration_periods) VALUES($1,$2,$3,$4,$5) RETURNING *`,[name.trim(),activity_type.trim(),provider.trim(),description.trim(),duration_periods?Number(duration_periods):null])).rows[0];for(const g of gs)await c.query('INSERT INTO activity_available_grades_v4(activity_id,grade) VALUES($1,$2)',[a.id,g]);await c.query('COMMIT');res.status(201).json({...a,available_grades:gs});}catch(e){await c.query('ROLLBACK');res.status(500).json({message:'교육활동을 저장하지 못했습니다.'});}finally{c.release();}
});
app.put('/api/admin/activities/:id',auth('admin'),async(req,res)=>{
 const id=Number(req.params.id);const {name,activity_type,provider='',description='',duration_periods=null,available_grades=[]}=req.body||{};const gs=grades(available_grades);if(!name?.trim()||!activity_type?.trim()||!gs.length)return res.status(400).json({message:'필수 정보를 확인해주세요.'});
 const c=await pool.connect();try{await c.query('BEGIN');const a=(await c.query(`UPDATE activities_v4 SET name=$1,activity_type=$2,provider=$3,description=$4,duration_periods=$5 WHERE id=$6 RETURNING *`,[name.trim(),activity_type.trim(),provider.trim(),description.trim(),duration_periods?Number(duration_periods):null,id])).rows[0];if(!a){await c.query('ROLLBACK');return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});}await c.query('DELETE FROM activity_available_grades_v4 WHERE activity_id=$1',[id]);for(const g of gs)await c.query('INSERT INTO activity_available_grades_v4(activity_id,grade) VALUES($1,$2)',[id,g]);await c.query('COMMIT');res.json({...a,available_grades:gs});}catch(e){await c.query('ROLLBACK');res.status(500).json({message:'교육활동을 수정하지 못했습니다.'});}finally{c.release();}
});
app.delete('/api/admin/activities/:id',auth('admin'),async(req,res)=>{try{const r=await pool.query('UPDATE activities_v4 SET is_active=false WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!r.rows[0])return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});res.json({ok:true});}catch(e){res.status(500).json({message:'삭제하지 못했습니다.'});}});

// 관리자: 교육활동의 연도별 운영 여부, 예산, 실제 운영 학년을 관리
app.post('/api/admin/activities/:id/years',auth('admin'),async(req,res)=>{
 const id=Number(req.params.id),year=Number(req.body?.school_year),budget=req.body?.budget;const gs=grades(req.body?.operated_grades);
 if(!Number.isInteger(year)||year<2000||year>2100)return res.status(400).json({message:'운영 연도를 확인해주세요.'});
 if(budget!==''&&budget!=null&&(!Number.isFinite(Number(budget))||Number(budget)<0))return res.status(400).json({message:'예산은 0 이상으로 입력해주세요.'});
 if(!gs.length)return res.status(400).json({message:'실제 운영 학년을 하나 이상 선택해주세요.'});
 const c=await pool.connect();try{await c.query('BEGIN');const activity=(await c.query('SELECT id FROM activities_v4 WHERE id=$1 AND is_active=true',[id])).rows[0];if(!activity){await c.query('ROLLBACK');return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});}
 const yr=(await c.query(`INSERT INTO activity_years_v4(activity_id,school_year,budget) VALUES($1,$2,$3) ON CONFLICT(activity_id,school_year) DO UPDATE SET budget=EXCLUDED.budget,updated_at=NOW() RETURNING *`,[id,year,budget===''||budget==null?null:Number(budget)])).rows[0];
 await c.query('DELETE FROM activity_year_grades_v4 WHERE activity_year_id=$1',[yr.id]);for(const g of gs)await c.query('INSERT INTO activity_year_grades_v4(activity_year_id,grade) VALUES($1,$2)',[yr.id,g]);
 await c.query('COMMIT');res.status(201).json({...yr,operated_grades:gs});}catch(e){await c.query('ROLLBACK');res.status(500).json({message:'연도별 운영 정보를 저장하지 못했습니다.'});}finally{c.release();}
});
app.get('/api/admin/activities/:id/years',auth('admin'),async(req,res)=>{try{const rows=(await pool.query(`SELECT ay.id,ay.school_year,ay.budget,COALESCE(ARRAY_AGG(yg.grade ORDER BY yg.grade) FILTER(WHERE yg.grade IS NOT NULL),'{}') operated_grades FROM activity_years_v4 ay LEFT JOIN activity_year_grades_v4 yg ON yg.activity_year_id=ay.id WHERE ay.activity_id=$1 GROUP BY ay.id ORDER BY ay.school_year DESC`,[Number(req.params.id)])).rows;res.json(rows);}catch(e){res.status(500).json({message:'연도별 운영 정보를 불러오지 못했습니다.'});}});
app.delete('/api/admin/years/:id',auth('admin'),async(req,res)=>{try{const r=await pool.query('DELETE FROM activity_years_v4 WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!r.rows[0])return res.status(404).json({message:'운영 연도를 찾을 수 없습니다.'});res.json({ok:true});}catch(e){res.status(500).json({message:'운영 연도를 삭제하지 못했습니다.'});}});

// 학년부장: 관리자가 미리 등록한 연도/학년 운영 건에 평가만 기록
app.post('/api/activities/:id/records',limiter,async(req,res)=>{
 const id=Number(req.params.id);const {school_year,overall_satisfaction=null,recommendation='추천',pros='',cons='',additional_comment='',reviewer_name='',reviewer_grade}=req.body||{};const grade=Number(reviewer_grade),year=Number(school_year);
 if(!Number.isInteger(id))return res.status(400).json({message:'잘못된 교육활동입니다.'});if(!Number.isInteger(year)||year<2000||year>2100)return res.status(400).json({message:'운영 연도를 확인해주세요.'});if(!Number.isInteger(grade)||grade<1||grade>6)return res.status(400).json({message:'작성 학년을 선택해주세요.'});if(!recs.includes(recommendation))return res.status(400).json({message:'재실시 추천을 선택해주세요.'});
 if(overall_satisfaction!==''&&overall_satisfaction!=null&&(!Number.isFinite(Number(overall_satisfaction))||Number(overall_satisfaction)<1||Number(overall_satisfaction)>5))return res.status(400).json({message:'만족도는 1~5 사이로 입력해주세요.'});
 const allowed=(await pool.query('SELECT 1 FROM activity_years_v4 ay JOIN activity_year_grades_v4 yg ON yg.activity_year_id=ay.id WHERE ay.activity_id=$1 AND ay.school_year=$2 AND yg.grade=$3',[id,year,grade])).rows[0];if(!allowed)return res.status(400).json({message:'해당 연도에 운영한 학년으로 등록되어 있지 않습니다. 관리자에게 확인해주세요.'});
 try{const r=(await pool.query(`INSERT INTO activity_records_v4(activity_id,school_year,reviewer_grade,budget,overall_satisfaction,recommendation,pros,cons,additional_comment,reviewer_name) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9) ON CONFLICT(activity_id,school_year,reviewer_grade) DO UPDATE SET overall_satisfaction=EXCLUDED.overall_satisfaction,recommendation=EXCLUDED.recommendation,pros=EXCLUDED.pros,cons=EXCLUDED.cons,additional_comment=EXCLUDED.additional_comment,reviewer_name=EXCLUDED.reviewer_name,updated_at=NOW() RETURNING *`,[id,year,grade,overall_satisfaction===''||overall_satisfaction==null?null:Number(overall_satisfaction),recommendation,pros.trim(),cons.trim(),additional_comment.trim(),reviewer_name.trim()])).rows[0];await pool.query('DELETE FROM activity_record_grades_v4 WHERE record_id=$1',[r.id]);await pool.query('INSERT INTO activity_record_grades_v4(record_id,grade) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.id,grade]);res.status(201).json(r);}catch(e){res.status(500).json({message:'운영 기록을 저장하지 못했습니다.'});}
});


// 학년부장 운영기록 수정/삭제. 별도 로그인 없이 사용하는 학교 내부용 공개 API입니다.
app.put('/api/activities/:id/records/:recordId',limiter,async(req,res)=>{
 const activityId=Number(req.params.id),recordId=Number(req.params.recordId);
 const {overall_satisfaction=null,recommendation='추천',pros='',cons='',additional_comment='',reviewer_name=''}=req.body||{};
 if(!Number.isInteger(activityId)||!Number.isInteger(recordId))return res.status(400).json({message:'잘못된 운영 기록입니다.'});
 if(!recs.includes(recommendation))return res.status(400).json({message:'재실시 추천을 선택해주세요.'});
 if(overall_satisfaction!==''&&overall_satisfaction!=null&&(!Number.isFinite(Number(overall_satisfaction))||Number(overall_satisfaction)<1||Number(overall_satisfaction)>5))return res.status(400).json({message:'만족도는 1~5 사이로 입력해주세요.'});
 try{const r=(await pool.query(`UPDATE activity_records_v4 SET overall_satisfaction=$1,recommendation=$2,pros=$3,cons=$4,additional_comment=$5,reviewer_name=$6,updated_at=NOW() WHERE id=$7 AND activity_id=$8 RETURNING *`,[overall_satisfaction===''||overall_satisfaction==null?null:Number(overall_satisfaction),recommendation,String(pros).trim(),String(cons).trim(),String(additional_comment).trim(),String(reviewer_name).trim(),recordId,activityId])).rows[0];if(!r)return res.status(404).json({message:'운영 기록을 찾을 수 없습니다.'});res.json(r);}catch(e){res.status(500).json({message:'운영 기록을 수정하지 못했습니다.'});}
});
app.delete('/api/activities/:id/records/:recordId',limiter,async(req,res)=>{
 const activityId=Number(req.params.id),recordId=Number(req.params.recordId);
 try{const r=await pool.query('DELETE FROM activity_records_v4 WHERE id=$1 AND activity_id=$2 RETURNING id',[recordId,activityId]);if(!r.rows[0])return res.status(404).json({message:'운영 기록을 찾을 수 없습니다.'});res.json({ok:true});}catch(e){res.status(500).json({message:'운영 기록을 삭제하지 못했습니다.'});}
});

const port=process.env.PORT||10000;app.listen(port,'0.0.0.0',()=>console.log(`API listening on ${port}`));
