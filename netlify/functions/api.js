const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ===== Supabase 配置（从环境变量读取） =====
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ===== 1. 注册 =====
app.post('/api/register', async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;
    if (!name || !phone || !password) {
      return res.json({ code: 400, msg: '姓名、手机号、密码不能为空' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      return res.json({ code: 400, msg: '该手机号已注册' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{ name, phone, email: email || null, password_hash: passwordHash, role: role || 'member' }])
      .select()
      .single();

    if (error) {
      console.error('注册错误:', error);
      return res.json({ code: 500, msg: '注册失败' });
    }

    res.json({ code: 200, msg: '注册成功', userId: newUser.id });
  } catch (err) {
    console.error('注册错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 2. 登录 =====
app.post('/api/login', async (req, res) => {
  try {
    const { phone, email, password } = req.body;
    if ((!phone && !email) || !password) {
      return res.json({ code: 400, msg: '请提供手机号或邮箱，以及密码' });
    }

    let query = supabase.from('users').select('*');
    if (phone) query = query.eq('phone', phone);
    else if (email) query = query.eq('email', email);
    
    const { data: user, error } = await query.maybeSingle();

    if (error || !user) {
      return res.json({ code: 400, msg: '用户不存在' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.json({ code: 400, msg: '密码错误' });
    }

    const { password_hash, ...userInfo } = user;
    res.json({ code: 200, msg: '登录成功', user: userInfo });
  } catch (err) {
    console.error('登录错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 3. 投稿 =====
app.post('/api/submit', async (req, res) => {
  try {
    const { userId, title, content } = req.body;
    if (!userId || !title || !content) {
      return res.json({ code: 400, msg: '用户ID、标题、内容不能为空' });
    }

    const { data: article, error } = await supabase
      .from('articles')
      .insert([{ user_id: userId, title, content, status: 'pending' }])
      .select()
      .single();

    if (error) {
      console.error('投稿错误:', error);
      return res.json({ code: 500, msg: '投稿失败' });
    }

    res.json({ code: 200, msg: '投稿成功，等待审核' });
  } catch (err) {
    console.error('投稿错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 4. 我的稿件 =====
app.post('/api/my-articles', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.json({ code: 400, msg: '用户ID不能为空' });
    }

    const { data: articles, error } = await supabase
      .from('articles')
      .select('id, title, content, status, created_at as time')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('查询稿件错误:', error);
      return res.json({ code: 500, msg: '查询失败' });
    }

    res.json({ code: 200, msg: 'success', articles: articles || [] });
  } catch (err) {
    console.error('查询稿件错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 5. 修改个人信息 =====
app.post('/api/update-profile', async (req, res) => {
  try {
    const { userId, name, email } = req.body;
    if (!userId || !name) {
      return res.json({ code: 400, msg: '用户ID和姓名不能为空' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({ name, email: email || null })
      .eq('id', userId)
      .select('id, name, phone, email, role')
      .single();

    if (error) {
      console.error('更新信息错误:', error);
      return res.json({ code: 500, msg: '更新失败' });
    }

    res.json({ code: 200, msg: '信息更新成功', user });
  } catch (err) {
    console.error('更新信息错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 6. 管理员审核 =====
app.post('/api/review-article', async (req, res) => {
  try {
    const { articleId, status } = req.body;
    if (!articleId || !status) {
      return res.json({ code: 400, msg: '文章ID和审核状态不能为空' });
    }
    if (status !== 'approved' && status !== 'rejected') {
      return res.json({ code: 400, msg: '审核状态必须是 approved 或 rejected' });
    }

    const { error } = await supabase
      .from('articles')
      .update({ status })
      .eq('id', articleId);

    if (error) {
      console.error('审核错误:', error);
      return res.json({ code: 500, msg: '审核失败' });
    }

    res.json({ code: 200, msg: '审核完成' });
  } catch (err) {
    console.error('审核错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 7. 获取所有待审稿件 =====
app.post('/api/pending-articles', async (req, res) => {
  try {
    const { data: articles, error } = await supabase
      .from('articles')
      .select('id, title, content, status, created_at as time, users(name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取待审稿件错误:', error);
      return res.json({ code: 500, msg: '查询失败' });
    }

    const formatted = articles.map(a => ({
      ...a,
      author_name: a.users?.name || '未知'
    }));

    res.json({ code: 200, msg: 'success', articles: formatted });
  } catch (err) {
    console.error('获取待审稿件错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 8. 获取所有用户 =====
app.post('/api/all-users', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, phone, email, role, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取用户列表错误:', error);
      return res.json({ code: 500, msg: '查询失败' });
    }

    res.json({ code: 200, msg: 'success', users: users || [] });
  } catch (err) {
    console.error('获取用户列表错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ===== 健康检查 =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/', (req, res) => res.json({ status: 'ok' }));
module.exports.handler = serverless(app);
