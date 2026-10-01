import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import XLSX from 'xlsx';
import { pool } from './db.js';
import { adminRequired, memberRequired } from './auth.js';
dotenv.config();

const app=express();
app.use(helmet());
app.use(cors({origin:process.env.CLIENT_ORIGIN?.split(',').map(s=>s.trim())||'*'}));
app.use(express.json({limit:'20kb'}));
const limiter=rateLimit({windowMs:60_000,max:30,standardHeaders:true,legacyHeaders:false});

app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true});}catch{res.status(500).json({ok:false});}});

app.post('/api/member/login',limiter,(req,res)=>{
  const {accessCode}=req.body||{};
  if(!process.env.SCHOOL_ACCESS_CODE) return res.status(500).json({message:'SCHOOL_ACCESS_CODE가 설정되지 않았습니다.'});
  if(accessCode!==process.env.SCHOOL_ACCESS_CODE) return res.status(401).json({message:'학교 구성원 인증코드가 올바르지 않습니다.'});
  const reviewerKey=crypto.randomUUID();
  const token=jwt.sign({role:'member',reviewerKey},process.env.JWT_SECRET,{expiresIn:'30d'});
  res.json({token});
});

app.post('/api/admin/login',limiter,(req,res)=>{
  const {password}=req.body||{};
  if(!password || password!==process.env.ADMIN_PASSWORD) return res.status(401).json({message:'관리자 비밀번호가 올바르지 않습니다.'});
  const token=jwt.sign({role:'admin'},process.env.JWT_SECRET,{expiresIn:'8h'});
  res.json({token});
});

app.get('/api/activities',async(_req,res)=>{
 const {rows}=await pool.query(`SELECT a.id,a.title,a.category,a.activity_date,a.description,a.created_at,COUNT(r.id)::int review_count,ROUND(COALESCE(AVG(r.rating),0)::numeric,1) average_rating FROM activities a LEFT JOIN reviews r ON r.activity_id=a.id GROUP BY a.id ORDER BY a.activity_date DESC NULLS LAST,a.created_at DESC`);
 res.json(rows);
});

app.get('/api/activities/:id',async(req,res)=>{
 const id=Number(req.params.id); const a=await pool.query('SELECT id,title,category,activity_date,description,created_at FROM activities WHERE id=$1',[id]);
 if(!a.rows[0]) return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});
 const reviews=await pool.query(`SELECT id,rating,educational_effect,student_participation,operation_ease,reuse_intention,comment,created_at,updated_at FROM reviews WHERE activity_id=$1 ORDER BY created_at DESC`,[id]);
 const stats=await pool.query(`SELECT COUNT(*)::int count,ROUND(COALESCE(AVG(rating),0)::numeric,1) average,ROUND(COALESCE(AVG(educational_effect),0)::numeric,1) educational_effect,ROUND(COALESCE(AVG(student_participation),0)::numeric,1) student_participation,ROUND(COALESCE(AVG(operation_ease),0)::numeric,1) operation_ease,ROUND(COALESCE(AVG(reuse_intention),0)::numeric,1) reuse_intention FROM reviews WHERE activity_id=$1`,[id]);
 res.json({activity:a.rows[0],stats:stats.rows[0],reviews:reviews.rows});
});

app.get('/api/my-reviews',memberRequired,async(req,res)=>{const {rows}=await pool.query('SELECT activity_id,id FROM reviews WHERE reviewer_key=$1',[req.auth.reviewerKey]);res.json(rows);});

app.post('/api/activities/:id/reviews',memberRequired,async(req,res)=>{
 const id=Number(req.params.id); const {rating,educational_effect,student_participation,operation_ease,reuse_intention,comment}=req.body||{};
 const vals=[rating,educational_effect,student_participation,operation_ease,reuse_intention].map(Number);
 if(vals.some(v=>!Number.isInteger(v)||v<1||v>5)) return res.status(400).json({message:'모든 평가는 1~5점으로 입력해주세요.'});
 if(typeof comment!=='string'||comment.length>300) return res.status(400).json({message:'코멘트는 300자 이내로 입력해주세요.'});
 const exists=await pool.query('SELECT id FROM activities WHERE id=$1',[id]); if(!exists.rows[0]) return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});
 const r=await pool.query(`INSERT INTO reviews(activity_id,reviewer_key,rating,educational_effect,student_participation,operation_ease,reuse_intention,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(activity_id,reviewer_key) DO UPDATE SET rating=EXCLUDED.rating,educational_effect=EXCLUDED.educational_effect,student_participation=EXCLUDED.student_participation,operation_ease=EXCLUDED.operation_ease,reuse_intention=EXCLUDED.reuse_intention,comment=EXCLUDED.comment,updated_at=NOW() RETURNING id`,[id,req.auth.reviewerKey,...vals,comment.trim()]);
 res.status(201).json({id:r.rows[0].id,updated:true});
});

app.get('/api/admin/dashboard',adminRequired,async(_req,res)=>{
 const activities=(await pool.query(`SELECT a.id,a.title,a.category,a.activity_date,COUNT(r.id)::int review_count,ROUND(COALESCE(AVG(r.rating),0)::numeric,1) average_rating,ROUND(COALESCE(AVG(r.educational_effect),0)::numeric,1) educational_effect,ROUND(COALESCE(AVG(r.student_participation),0)::numeric,1) student_participation,ROUND(COALESCE(AVG(r.operation_ease),0)::numeric,1) operation_ease,ROUND(COALESCE(AVG(r.reuse_intention),0)::numeric,1) reuse_intention FROM activities a LEFT JOIN reviews r ON r.activity_id=a.id GROUP BY a.id ORDER BY average_rating DESC,review_count DESC`)).rows;
 const category=(await pool.query(`SELECT category,COUNT(DISTINCT a.id)::int activities,COUNT(r.id)::int reviews,ROUND(COALESCE(AVG(r.rating),0)::numeric,1) average_rating FROM activities a LEFT JOIN reviews r ON r.activity_id=a.id GROUP BY category ORDER BY average_rating DESC`)).rows;
 const total=(await pool.query('SELECT COUNT(*)::int activities,(SELECT COUNT(*)::int FROM reviews) reviews FROM activities')).rows[0];
 res.json({activities,category,total});
});

app.get('/api/admin/export.xlsx',adminRequired,async(_req,res)=>{
 const {rows}=await pool.query(`SELECT a.title 교육활동,a.category 분류,a.activity_date 활동일,r.rating 종합평점,r.educational_effect 교육적효과,r.student_participation 학생참여도,r.operation_ease 운영편의성,r.reuse_intention 재실행의향,r.comment 코멘트,r.created_at 작성일 FROM reviews r JOIN activities a ON a.id=r.activity_id ORDER BY a.activity_date DESC NULLS LAST,r.created_at DESC`);
 const wb=XLSX.utils.book_new(); const ws=XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb,ws,'리뷰');
 const summary=(await pool.query(`SELECT a.title 교육활동,a.category 분류,COUNT(r.id)::int 리뷰수,ROUND(COALESCE(AVG(r.rating),0)::numeric,1) 종합평균,ROUND(COALESCE(AVG(r.educational_effect),0)::numeric,1) 교육적효과,ROUND(COALESCE(AVG(r.student_participation),0)::numeric,1) 학생참여도,ROUND(COALESCE(AVG(r.operation_ease),0)::numeric,1) 운영편의성,ROUND(COALESCE(AVG(r.reuse_intention),0)::numeric,1) 재실행의향 FROM activities a LEFT JOIN reviews r ON r.activity_id=a.id GROUP BY a.id ORDER BY 종합평균 DESC`)).rows;
 XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),'활동별요약');
 const out=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}); res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="school-activity-review.xlsx"');res.send(out);
});

app.post('/api/activities',adminRequired,async(req,res)=>{const {title,category='기타',activity_date=null,description=''}=req.body||{};if(!title?.trim())return res.status(400).json({message:'교육활동명을 입력해주세요.'});const r=await pool.query('INSERT INTO activities(title,category,activity_date,description) VALUES($1,$2,$3,$4) RETURNING *',[title.trim(),category,activity_date||null,description.trim()]);res.status(201).json(r.rows[0]);});
app.put('/api/activities/:id',adminRequired,async(req,res)=>{const {title,category='기타',activity_date=null,description=''}=req.body||{};const r=await pool.query('UPDATE activities SET title=$1,category=$2,activity_date=$3,description=$4 WHERE id=$5 RETURNING *',[title?.trim(),category,activity_date||null,description.trim(),Number(req.params.id)]);if(!r.rows[0])return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});res.json(r.rows[0]);});
app.delete('/api/activities/:id',adminRequired,async(req,res)=>{const r=await pool.query('DELETE FROM activities WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!r.rows[0])return res.status(404).json({message:'교육활동을 찾을 수 없습니다.'});res.json({ok:true});});
app.delete('/api/reviews/:id',adminRequired,async(req,res)=>{const r=await pool.query('DELETE FROM reviews WHERE id=$1 RETURNING id',[Number(req.params.id)]);if(!r.rows[0])return res.status(404).json({message:'리뷰를 찾을 수 없습니다.'});res.json({ok:true});});

const port=Number(process.env.PORT||10000); app.listen(port,()=>console.log(`API running on ${port}`));
