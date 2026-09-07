// ============================================================
// 文件: netlify/functions/api.js（路径不变，内容改成 Cloudflare 格式）
// 用途: 半贤书院文学社后端 - Cloudflare Pages Functions 入口
// ============================================================

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

// --- 从环境变量读取 Supabase 配置 ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL 或 SUPABASE_ANON_KEY 环境变量未设置!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
//  1. 健康检查
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '半贤书院后端运行正常',
    time: new Date().toISOString(),
    supabase_configured: !!(supabaseUrl && supabaseKey)
  });
});

// ============================================================
//  2. 注册接口
// ============================================================
app.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({
        code: 400,
        msg: '姓名、手机号、密码不能为空'
      });
    }

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

    const bcrypt = (await import('bcrypt')).default;
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

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
//  3. 登录接口
// ============================================================
app.post('/login', async (req, res) => {
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

    const bcrypt = (await import('bcrypt')).default;
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
export default {
  async fetch(request, env, ctx) {
    // Cloudflare Pages 会把 /api/* 的请求转发到这里
    // 但需要把路径中的 /api 去掉，因为 Express 里定义的路径没有 /api
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      // 重写路径，去掉 /api 前缀
      const newUrl = new URL(request.url);
      newUrl.pathname = url.pathname.replace('/api', '');
      request = new Request(newUrl.toString(), request);
    }
    return app(request, env, ctx);
  }
};
