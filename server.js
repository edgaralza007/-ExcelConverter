// ============================================================
//  server.js — Express backend for DCF Model Visualizer
//  Run with: node server.js
// ============================================================

const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const multer = require('multer');

// ── 1. Create the Express app ──
// Think of this as your "server object." You attach routes to it.
const app = express();
const PORT = process.env.PORT || 3000;  // Render sets PORT automatically

// ── 2. Middleware ──
// Middleware = functions that run on EVERY request before your routes.
// They prepare the request for your route handlers.

// Trust the reverse proxy (Render, Nginx, etc.) so cookies and HTTPS work
app.set('trust proxy', 1);

// Parse JSON bodies (when frontend sends { username: "...", password: "..." })
app.use(express.json());

// Serve static files from public/ (your existing frontend)
// This is why index.html, styles.css, app.js still work — Express serves them.
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware: creates a cookie-based session for each visitor.
// "secret" is used to sign the cookie so it can't be tampered with.
// In production you'd use a long random string from an environment variable.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dcf-visualizer-dev-secret',
  resave: false,              // don't re-save session if nothing changed
  saveUninitialized: false,   // don't create session until something is stored
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // session lasts 24 hours
    httpOnly: true,               // JavaScript can't read the cookie (security)
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
  proxy: process.env.NODE_ENV === 'production',  // trust Render's reverse proxy
}));

// Multer: handles file uploads. Files are stored in memory as buffers.
// For large-scale apps you'd write to disk, but for learning this is simpler.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ── 3. Database setup ──
// This creates (or opens) a SQLite file at data/app.db.
// SQLite stores everything in this one file — no separate database server.
const db = new Database(path.join(__dirname, 'data', 'app.db'));

// Enable WAL mode for better performance with concurrent reads
db.pragma('journal_mode = WAL');

// Create tables if they don't exist.
// This runs every time the server starts, but "IF NOT EXISTS" makes it safe.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    data BLOB NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Prepare statements ahead of time (faster than building SQL strings each time)
const stmts = {
  findUser:    db.prepare('SELECT * FROM users WHERE username = ?'),
  createUser:  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  saveFile:    db.prepare('INSERT INTO files (user_id, filename, data) VALUES (?, ?, ?)'),
  getUserFiles: db.prepare('SELECT id, filename, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC'),
  getFile:     db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?'),
  deleteFile:  db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?'),
};

// ── 4. Auth helper ──
// This function checks if a request has a logged-in session.
// We'll use it to protect routes that require authentication.
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next(); // user is authenticated, continue to the route handler
}

// ── 5. AUTH ROUTES ──

// POST /api/register — create a new account
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Check if username is taken
  const existing = stmts.findUser.get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  // Hash the password. The "10" is the salt rounds — higher = slower but more secure.
  // bcrypt automatically generates a random salt and embeds it in the hash.
  const hash = await bcrypt.hash(password, 10);

  // Store the user
  const result = stmts.createUser.run(username, hash);

  // Log them in immediately by setting the session
  req.session.userId = result.lastInsertRowid;
  req.session.username = username;

  res.status(201).json({ message: 'Account created', username });
});

// POST /api/login — authenticate an existing user
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = stmts.findUser.get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Compare the provided password against the stored hash.
  // bcrypt handles extracting the salt from the hash automatically.
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Set session — this is the "you're logged in now" step
  req.session.userId = user.id;
  req.session.username = user.username;

  res.json({ message: 'Logged in', username: user.username });
});

// POST /api/logout — destroy the session
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// GET /api/me — check if currently logged in (frontend uses this on page load)
app.get('/api/me', (req, res) => {
  if (req.session.userId) {
    res.json({ username: req.session.username });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// ── 6. FILE ROUTES ──
// All of these require authentication (requireAuth middleware)

// POST /api/files — upload and save a file
app.post('/api/files', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const result = stmts.saveFile.run(
    req.session.userId,
    req.file.originalname,
    req.file.buffer  // the raw file bytes
  );

  res.status(201).json({
    id: result.lastInsertRowid,
    filename: req.file.originalname,
    message: 'File saved',
  });
});

// GET /api/files — list all files for the logged-in user
app.get('/api/files', requireAuth, (req, res) => {
  const files = stmts.getUserFiles.all(req.session.userId);
  res.json(files);
});

// GET /api/files/:id — download a specific file
app.get('/api/files/:id', requireAuth, (req, res) => {
  const file = stmts.getFile.get(req.params.id, req.session.userId);
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Send the file back as a download
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(file.data);
});

// DELETE /api/files/:id — delete a saved file
app.delete('/api/files/:id', requireAuth, (req, res) => {
  const result = stmts.deleteFile.run(req.params.id, req.session.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.json({ message: 'File deleted' });
});

// ── 7. Start the server ──
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
