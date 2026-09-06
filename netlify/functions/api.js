// ============================================================
// 文件: netlify/functions/api.js
// 用途: 半贤书院文学社后端 - Netlify Functions 入口
// 说明: 使用 Express + serverless-http 包装，导出为 Netlify Function
// ============================================================

const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// --- 初始化 Express ---
const app = express();
app.use(cors());
app.use(express.json());

// --- 从环境变量读取 Supabase 配置 ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// 如果环境变量未配置，给出明确提示（用于调试）
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 错误: SUPABASE_URL 或 SUPABASE_ANON_KEY 环境变量未设置!');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
//  1. 测试路由 - 用于验证函数是否部署成功
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
//  2. 注册接口 (完整版)
// ============================================================
app.post('/api/register', async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;

    // 1. 校验必填字段
    if (!name || !phone || !password) {
      return res.status(400).json({
        code: 400,
        msg: '姓名、手机号、密码不能为空'
      });
    }

    // 2. 检查手机号是否已注册
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (findError && findError.code !== 'PGRST116') { // PGRST116 是"未找到"的正常状态
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

    // 3. 加密密码
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 4. 插入新用户
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

    // 5. 注册成功
    res.status(200).json({
      code: 200,
      msg: '注册成功',
      userId: newUser.id
    });

  } catch (err) {
    console.error('❌ 注册接口未捕获异常:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器内部错误，请稍后重试'
    });
  }
});

// ============================================================
//  3. 登录接口 (精简版，先确保核心功能)
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

    // 查询用户
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

    // 验证密码
    const bcrypt = require('bcrypt');
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(400).json({
        code: 400,
        msg: '密码错误'
      });
    }

    // 登录成功，返回用户信息（隐藏密码）
    const { password_hash, ...userInfo } = user;
    res.status(200).json({
      code: 200,
      msg: '登录成功',
      user: userInfo
    });

  } catch (err) {
    console.error('❌ 登录接口未捕获异常:', err);
    res.status(500).json({
      code: 500,
      msg: '服务器内部错误'
    });
  }
});

// ============================================================
//  4. 导出为 Netlify Function (关键!)
// ============================================================
// 注意: 必须使用 exports.handler = serverless(app) 格式
//       不能使用 module.exports = app
// ============================================================
module.exports.handler = serverless(app);
