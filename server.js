const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// ========== 初始化数据库 ==========
const db = new sqlite3.Database('./database.sqlite');

// 创建用户表和文章表（如果不存在）
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// ========== 辅助函数 ==========
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ========== 1. 注册接口 ==========
app.post('/api/register', async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;

    if (!name || !phone || !password) {
      return res.json({ code: 400, msg: '姓名、手机号、密码不能为空' });
    }

    const existing = await getQuery('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing) {
      return res.json({ code: 400, msg: '该手机号已注册' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await runQuery(
      'INSERT INTO users (name, phone, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [name, phone, email || null, passwordHash, role || 'member']
    );

    res.json({ code: 200, msg: '注册成功', userId: result.lastID });
  } catch (err) {
    console.error('注册错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 2. 登录接口 ==========
app.post('/api/login', async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.json({ code: 400, msg: '请提供手机号或邮箱，以及密码' });
    }

    let user;
    if (phone) {
      user = await getQuery('SELECT * FROM users WHERE phone = ?', [phone]);
    } else if (email) {
      user = await getQuery('SELECT * FROM users WHERE email = ?', [email]);
    }

    if (!user) {
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

// ========== 3. 投稿接口 ==========
app.post('/api/submit', async (req, res) => {
  try {
    const { userId, title, content } = req.body;

    if (!userId || !title || !content) {
      return res.json({ code: 400, msg: '用户ID、标题、内容不能为空' });
    }

    const user = await getQuery('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.json({ code: 400, msg: '用户不存在' });
    }

    await runQuery(
      'INSERT INTO articles (user_id, title, content, status) VALUES (?, ?, ?, ?)',
      [userId, title, content, 'pending']
    );

    res.json({ code: 200, msg: '投稿成功，等待审核' });
  } catch (err) {
    console.error('投稿错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 4. 获取我的稿件 ==========
app.post('/api/my-articles', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.json({ code: 400, msg: '用户ID不能为空' });
    }

    const articles = await allQuery(
      'SELECT id, title, content, status, created_at as time FROM articles WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    res.json({ code: 200, msg: 'success', articles });
  } catch (err) {
    console.error('查询稿件错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 5. 修改个人信息 ==========
app.post('/api/update-profile', async (req, res) => {
  try {
    const { userId, name, email } = req.body;

    if (!userId || !name) {
      return res.json({ code: 400, msg: '用户ID和姓名不能为空' });
    }

    await runQuery(
      'UPDATE users SET name = ?, email = ? WHERE id = ?',
      [name, email || null, userId]
    );

    const user = await getQuery('SELECT id, name, phone, email, role FROM users WHERE id = ?', [userId]);
    res.json({ code: 200, msg: '信息更新成功', user });
  } catch (err) {
    console.error('更新信息错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 6. 管理员审核接口 ==========
app.post('/api/review-article', async (req, res) => {
  try {
    const { articleId, status } = req.body;

    if (!articleId || !status) {
      return res.json({ code: 400, msg: '文章ID和审核状态不能为空' });
    }

    if (status !== 'approved' && status !== 'rejected') {
      return res.json({ code: 400, msg: '审核状态必须是 approved 或 rejected' });
    }

    await runQuery(
      'UPDATE articles SET status = ? WHERE id = ?',
      [status, articleId]
    );

    res.json({ code: 200, msg: '审核完成' });
  } catch (err) {
    console.error('审核错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 7. 管理员获取所有待审稿件 ==========
app.post('/api/pending-articles', async (req, res) => {
  try {
    const articles = await allQuery(
      `SELECT a.id, a.title, a.content, a.status, a.created_at as time, u.name as author_name 
       FROM articles a 
       JOIN users u ON a.user_id = u.id 
       WHERE a.status = 'pending' 
       ORDER BY a.created_at DESC`
    );

    res.json({ code: 200, msg: 'success', articles });
  } catch (err) {
    console.error('获取待审稿件错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 8. 管理员获取所有用户 ==========
app.post('/api/all-users', async (req, res) => {
  try {
    const users = await allQuery(
      'SELECT id, name, phone, email, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ code: 200, msg: 'success', users });
  } catch (err) {
    console.error('获取用户列表错误:', err);
    res.json({ code: 500, msg: '服务器内部错误' });
  }
});

// ========== 健康检查 ==========
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ========== 启动服务器 ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 半贤书院后端已启动，端口: ${PORT}`);
});