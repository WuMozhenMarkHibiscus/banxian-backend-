// ============================================================
// 文件: functions/api.js
// 用途: 半贤书院文学社后端 - Cloudflare Pages Functions 入口
// 说明: 使用 Express + serverless-http 适配 Cloudflare Pages
// ============================================================

import express from 'express';
import cors from 'cors';
import serverless from 'serverless-http';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

// --- 初始化 Express ---
const app = express();
app.use(cors());
app.use(express.json());

// --- 读取 Supabase 环境变量 ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL 或 SUPABASE_ANON_KEY 未设置!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
//  1. 健康检查（无前缀，用于验证函数是否运行）
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '半贤书院后端运行正常 (Cloudflare Pages)',
    time: new Date().toISOString(),
    supabase_configured: !!(supabaseUrl && supabaseKey)
  });
});

// ============================================================
//  2. 注册接口（路径: /api/register）
// ============================================================
app.post('/api/register', async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;

    // 必填校验
    if (!name || !phone || !password) {
      return res.status(400).json({
        code: 400,
        msg: '姓名、手机号、密码不能为空'
      });
    }

    // 检查手机号是否已注册
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (findError && findError.code !== 'PGRST116') {
      console.error('❌ 查询用户错误:', findError);
      return res.status(500).json({
        code: 500,
        msg: '数据库查询失败，请稍后重试'
      });
    }

    if (existingUser) {
      return res.status(400).json({
        code: 400,
        msg: '该手机号已注册'
      });
    }

    // 加密密码
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 插入新用户
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([{
        name: name,
        phone: phone,
        email: email || null,
        password_hash: passwordHash,
        role: role || 'member'
      }])
      .select()
      .single();

    if (insertError) {
      console.error('❌ 插入用户错误:', insertError);
      return res.status(500).json({
        code: 500,
        msg: '注册失败，请检查数据库表结构'
      });
    }

    res.status(200).json({
      code: 200,
      msg: '注册成功',
      userId: newUser.id
    });

  } catch (err) {
    console.error('❌ 注册接口异常:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器内部错误，请稍后重试'
    });
  }
});

// ============================================================
//  3. 登录接口（路径: /api/login）
// ============================================================
app.post('/api/login', async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json({
        code: 400,
        msg: '请提供手机号或邮箱，以及密码'
      });
    }

    let query = supabase.from('users').select('*');
    if (phone) {
      query = query.eq('phone', phone);
    } else if (email) {
      query = query.eq('email', email);
    }

    const { data: user, error: findError } = await query.maybeSingle();

    if (findError || !user) {
      return res.status(400).json({
        code: 400,
        msg: '用户不存在或查询失败'
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(400).json({
        code: 400,
        msg: '密码错误'
      });
    }

    const { password_hash, ...userInfo } = user;
    res.status(200).json({
      code: 200,
      msg: '登录成功',
      user: userInfo
    });

  } catch (err) {
    console.error('❌ 登录接口异常:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器内部错误'
    });
  }
});

// ============================================================
//  4. 导出为 Cloudflare Pages Function
// ============================================================
export const onRequest = serverless(app);
