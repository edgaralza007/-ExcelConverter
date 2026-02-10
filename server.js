// ============================================================
//  server.js — Express backend for DCF Model Visualizer
//  Run with: node server.js
// ============================================================

const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const multer = require('multer');

// ── 1. Create the Express app ──
const app = express();
const PORT = process.env.PORT || 3000;

// ── 2. Middleware ──

app.set('trust proxy', 1);

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dcf-visualizer-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
  proxy: process.env.NODE_ENV === 'production',
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── 3. Database setup (PostgreSQL) ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      data BYTEA NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── 4. Auth helper ──
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// ── 5. AUTH ROUTES ──

// POST /api/register — create a new account
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [username, hash]
  );

  req.session.userId = result.rows[0].id;
  req.session.username = username;

  res.status(201).json({ message: 'Account created', username });
});

// POST /api/login — authenticate an existing user
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;

  res.json({ message: 'Logged in', username: user.username });
});

// POST /api/logout — destroy the session
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// GET /api/me — check if currently logged in
app.get('/api/me', (req, res) => {
  if (req.session.userId) {
    res.json({ username: req.session.username });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// ── 6. FILE ROUTES ──

// POST /api/files — upload and save a file
app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const result = await pool.query(
    'INSERT INTO files (user_id, filename, data) VALUES ($1, $2, $3) RETURNING id',
    [req.session.userId, req.file.originalname, req.file.buffer]
  );

  res.status(201).json({
    id: result.rows[0].id,
    filename: req.file.originalname,
    message: 'File saved',
  });
});

// GET /api/files — list all files for the logged-in user
app.get('/api/files', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, filename, uploaded_at FROM files WHERE user_id = $1 ORDER BY uploaded_at DESC',
    [req.session.userId]
  );
  res.json(result.rows);
});

// GET /api/files/:id — download a specific file
app.get('/api/files/:id', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM files WHERE id = $1 AND user_id = $2',
    [req.params.id, req.session.userId]
  );
  const file = result.rows[0];
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(file.data);
});

// DELETE /api/files/:id — delete a saved file
app.delete('/api/files/:id', requireAuth, async (req, res) => {
  const result = await pool.query(
    'DELETE FROM files WHERE id = $1 AND user_id = $2',
    [req.params.id, req.session.userId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.json({ message: 'File deleted' });
});

// ── 7. Start the server ──
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
