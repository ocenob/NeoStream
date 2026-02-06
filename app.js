const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const archiver = require('archiver');

const fs = require('fs');
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

require('./services/logger.js');

// Handle EPIPE error to prevent crash
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});

const express = require('express');
const engine = require('ejs-mate');
const os = require('os');
const multer = require('multer');
const metadataWorker = require('./services/metadataWorker');
const csrf = require('csrf');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('./models/User');
const { db, checkIfUsersExist, initializeDatabase } = require('./db/database');
const systemMonitor = require('./services/systemMonitor');
const { uploadVideo, upload, uploadThumbnail, uploadAudio } = require('./middleware/uploadMiddleware');
const chunkUploadService = require('./services/chunkUploadService');
const audioConverter = require('./services/audioConverter');
const { ensureDirectories } = require('./utils/storage');
const { getVideoInfo, generateThumbnail, generateImageThumbnail } = require('./utils/videoProcessor');
const YoutubeService = require('./utils/youtubeService'); // Import Service Baru
const YoutubeStreamKey = require('./models/YoutubeStreamKey'); // Import Model Key
const Video = require('./models/Video');
const Playlist = require('./models/Playlist');
const Stream = require('./models/Stream');
const Thumbnail = require('./models/Thumbnail');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const streamingService = require('./services/streamingService');
const schedulerService = require('./services/schedulerService');
const rotationService = require('./services/rotationService');
const SmartSchedulerService = require('./services/smartSchedulerService');
const AutoSchedulerService = require('./services/autoScheduler');
const packageJson = require('./package.json');
const { encrypt, decrypt } = require('./utils/encryption');
const { google } = require('googleapis');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
process.on('unhandledRejection', (reason, promise) => {
  console.error('-----------------------------------');
  console.error('UNHANDLED REJECTION AT:', promise);
  console.error('REASON:', reason);
  console.error('-----------------------------------');
});
process.on('uncaughtException', (error) => {
  console.error('-----------------------------------');
  console.error('UNCAUGHT EXCEPTION:', error);
  console.error('-----------------------------------');
});
const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || 7575;
const tokens = new csrf();

ensureDirectories();
app.locals.helpers = {
  getUsername: function (req) {
    if (req.session && req.session.username) {
      return req.session.username;
    }
    return 'User';
  },
  getAvatar: function (req) {
    if (req.session && req.session.userId) {
      const avatarPath = req.session.avatar_path;
      if (avatarPath) {
        return `<img src="${avatarPath}" alt="${req.session.username || 'User'}'s Profile" class="w-full h-full object-cover" onerror="this.onerror=null; this.src='/images/default-avatar.jpg';">`;
      }
    }
    return '<img src="/images/default-avatar.jpg" alt="Default Profile" class="w-full h-full object-cover">';
  },
  getPlatformIcon: function (platform) {
    switch (platform) {
      case 'YouTube': return 'youtube';
      case 'Facebook': return 'facebook';
      case 'Twitch': return 'twitch';
      case 'TikTok': return 'tiktok';
      case 'Instagram': return 'instagram';
      case 'Shopee Live': return 'shopping-bag';
      case 'Restream.io': return 'live-photo';
      default: return 'broadcast';
    }
  },
  getPlatformColor: function (platform) {
    switch (platform) {
      case 'YouTube': return 'red-500';
      case 'Facebook': return 'blue-500';
      case 'Twitch': return 'purple-500';
      case 'TikTok': return 'gray-100';
      case 'Instagram': return 'pink-500';
      case 'Shopee Live': return 'orange-500';
      case 'Restream.io': return 'teal-500';
      default: return 'gray-400';
    }
  },
  formatDateTime: function (isoString) {
    if (!isoString) return '--';

    const utcDate = new Date(isoString);

    return utcDate.toLocaleString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },
  formatDuration: function (seconds) {
    if (!seconds) return '--';
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
  }
};
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'db'),
    table: 'sessions'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (user) {
        req.session.username = user.username;
        req.session.avatar_path = user.avatar_path;
        if (user.email) req.session.email = user.email;
        res.locals.user = {
          id: user.id,
          username: user.username,
          avatar_path: user.avatar_path,
          email: user.email
        };
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  }
  res.locals.req = req;
  res.locals.appVersion = packageJson.version;
  next();
});
app.use(function (req, res, next) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = uuidv4();
  }
  res.locals.csrfToken = tokens.create(req.session.csrfSecret);
  next();
});
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.svg') || filePath.endsWith('.ico') || filePath.endsWith('.png')) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use('/uploads', function (req, res, next) {
  res.header('Cache-Control', 'no-cache');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});
app.use(express.urlencoded({ extended: true, limit: '50gb' }));
app.use(express.json({ limit: '50gb' }));

const csrfProtection = function (req, res, next) {
  if ((req.path === '/login' && req.method === 'POST') ||
    (req.path === '/setup-account' && req.method === 'POST')) {
    return next();
  }
  const token = req.body._csrf || req.query._csrf || req.headers['x-csrf-token'];
  if (!token || !tokens.verify(req.session.csrfSecret, token)) {
    return res.status(403).render('error', {
      title: 'Error',
      error: 'CSRF validation failed. Please try again.'
    });
  }
  next();
};
const isAuthenticated = async (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (user) {
        return next();
      }
      // User not found despite session existing (e.g. deleted user or stale session)
      console.log('Session exists but user not found, destroying session');
      req.session.destroy();
    } catch (error) {
      console.error('Auth middleware error:', error);
      // In case of error, assume unauthorized to be safe
    }
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  res.redirect('/login');
};

const isAdmin = async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId);
    if (!user || user.user_role !== 'admin') {
      return res.redirect('/dashboard');
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.redirect('/dashboard');
  }
};
app.use('/uploads', function (req, res, next) {
  res.header('Cache-Control', 'no-cache');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});
app.use('/uploads/avatars', (req, res, next) => {
  const filename = path.basename(req.path);
  if (!filename || filename === 'avatars') {
    return res.status(403).send('Access denied');
  }
  const file = path.join(__dirname, 'public', 'uploads', 'avatars', filename);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    res.header('Content-Type', contentType);
    res.header('Cache-Control', 'max-age=60, must-revalidate');
    fs.createReadStream(file).pipe(res);
  } else {
    next();
  }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('login', {
      title: 'Login',
      error: 'Too many login attempts. Please try again in 15 minutes.'
    });
  },
  requestWasSuccessful: (request, response) => {
    return response.statusCode < 400;
  }
});
const loginDelayMiddleware = async (req, res, next) => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  next();
};
app.get('/login', async (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  try {
    const usersExist = await checkIfUsersExist();
    if (!usersExist) {
      return res.redirect('/setup-account');
    }

    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();

    res.render('login', {
      title: 'Login',
      error: null,
      recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
    });
  } catch (error) {
    console.error('Error checking for users:', error);
    res.render('login', {
      title: 'Login',
      error: 'System error. Please try again.',
      recaptchaSiteKey: null
    });
  }
});
app.post('/login', loginDelayMiddleware, loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const recaptchaResponse = req.body['g-recaptcha-response'];

  try {
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();

    if (recaptchaSettings.hasKeys && recaptchaSettings.enabled) {
      if (!recaptchaResponse) {
        return res.render('login', {
          title: 'Login',
          error: 'Please complete the reCAPTCHA verification',
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }

      const { decrypt } = require('./utils/encryption');
      const secretKey = decrypt(recaptchaSettings.secretKey);

      const axios = require('axios');
      const verifyResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(recaptchaResponse)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (!verifyResponse.data.success) {
        return res.render('login', {
          title: 'Login',
          error: 'reCAPTCHA verification failed. Please try again.',
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }
    }

    const user = await User.findByUsername(username);
    console.log('[DEBUG] Login attempt for username:', username);
    if (!user) {
      console.log('[DEBUG] User not found');
      return res.render('login', {
        title: 'Login',
        error: 'Invalid username or password',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }
    console.log('[DEBUG] User found, verifying password...');
    const passwordMatch = await User.verifyPassword(password, user.password);
    console.log('[DEBUG] Password match result:', passwordMatch);
    if (!passwordMatch) {
      return res.render('login', {
        title: 'Login',
        error: 'Invalid username or password',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    if (user.status !== 'active') {
      return res.render('login', {
        title: 'Login',
        error: 'Your account is not active. Please contact administrator for activation.',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.avatar_path = user.avatar_path;
    req.session.user_role = user.user_role;
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', {
      title: 'Login',
      error: 'An error occurred during login. Please try again.',
      recaptchaSiteKey: null
    });
  }
});
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/signup', async (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  try {
    const usersExist = await checkIfUsersExist();
    if (!usersExist) {
      return res.redirect('/setup-account');
    }

    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();

    res.render('signup', {
      title: 'Sign Up',
      error: null,
      success: null,
      recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
    });
  } catch (error) {
    console.error('Error loading signup page:', error);
    res.render('signup', {
      title: 'Sign Up',
      error: 'System error. Please try again.',
      success: null,
      recaptchaSiteKey: null
    });
  }
});

app.post('/signup', upload.single('avatar'), async (req, res) => {
  const { username, password, confirmPassword, user_role, status } = req.body;
  const recaptchaResponse = req.body['g-recaptcha-response'];

  try {
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();

    if (recaptchaSettings.hasKeys && recaptchaSettings.enabled) {
      if (!recaptchaResponse) {
        return res.render('signup', {
          title: 'Sign Up',
          error: 'Please complete the reCAPTCHA verification',
          success: null,
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }

      const { decrypt } = require('./utils/encryption');
      const secretKey = decrypt(recaptchaSettings.secretKey);

      const axios = require('axios');
      const verifyResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(recaptchaResponse)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      if (!verifyResponse.data.success) {
        return res.render('signup', {
          title: 'Sign Up',
          error: 'reCAPTCHA verification failed. Please try again.',
          success: null,
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }
    }

    if (!username || !password) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Username and password are required',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    if (password !== confirmPassword) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Passwords do not match',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    if (password.length < 6) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Password must be at least 6 characters long',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Username already exists',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    let avatarPath = null;
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    const newUser = await User.create({
      username,
      password,
      avatar_path: avatarPath,
      user_role: user_role || 'member',
      status: status || 'inactive'
    });

    if (newUser) {
      return res.render('signup', {
        title: 'Sign Up',
        error: null,
        success: 'Account created successfully! Please wait for admin approval to activate your account.',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    } else {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Failed to create account. Please try again.',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }
  } catch (error) {
    console.error('Signup error:', error);
    return res.render('signup', {
      title: 'Sign Up',
      error: 'An error occurred during registration. Please try again.',
      success: null,
      recaptchaSiteKey: null
    });
  }
});

app.get('/setup-account', async (req, res) => {
  try {
    const usersExist = await checkIfUsersExist();
    if (usersExist && !req.session.userId) {
      return res.redirect('/login');
    }
    if (req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (user && user.username) {
        return res.redirect('/dashboard');
      }
    }
    res.render('setup-account', {
      title: 'Complete Your Account',
      user: req.session.userId ? await User.findById(req.session.userId) : {},
      error: null
    });
  } catch (error) {
    console.error('Setup account error:', error);
    res.redirect('/login');
  }
});
app.post('/setup-account', upload.single('avatar'), [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('confirmPassword')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.render('setup-account', {
        title: 'Complete Your Account',
        user: { username: req.body.username || '' },
        error: errors.array()[0].msg
      });
    }
    const existingUsername = await User.findByUsername(req.body.username);
    if (existingUsername) {
      return res.render('setup-account', {
        title: 'Complete Your Account',
        user: { email: req.body.email || '' },
        error: 'Username is already taken'
      });
    }
    const avatarPath = req.file ? `/uploads/avatars/${req.file.filename}` : null;
    const usersExist = await checkIfUsersExist();
    if (!usersExist) {
      try {
        const user = await User.create({
          username: req.body.username,
          password: req.body.password,
          avatar_path: avatarPath,
          user_role: 'admin',
          status: 'active'
        });
        req.session.userId = user.id;
        req.session.username = req.body.username;
        req.session.user_role = user.user_role;
        if (avatarPath) {
          req.session.avatar_path = avatarPath;
        }
        console.log('Setup account - Using user ID from database:', user.id);
        console.log('Setup account - Session userId set to:', req.session.userId);
        return res.redirect('/welcome');
      } catch (error) {
        console.error('User creation error:', error);
        return res.render('setup-account', {
          title: 'Complete Your Account',
          user: {},
          error: 'Failed to create user. Please try again.'
        });
      }
    } else {
      await User.update(req.session.userId, {
        username: req.body.username,
        password: req.body.password,
        avatar_path: avatarPath,
      });
      req.session.username = req.body.username;
      if (avatarPath) {
        req.session.avatar_path = avatarPath;
      }
      res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('Account setup error:', error);
    res.render('setup-account', {
      title: 'Complete Your Account',
      user: { email: req.body.email || '' },
      error: 'An error occurred. Please try again.'
    });
  }
});
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});
app.get('/welcome', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.welcome_shown === 1) {
      return res.redirect('/dashboard');
    }
    res.render('welcome', {
      title: 'Welcome'
    });
  } catch (error) {
    console.error('Welcome page error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/welcome-bypass', (req, res) => {
  res.render('welcome', {
    title: 'Welcome'
  });
});
app.get('/welcome/continue', isAuthenticated, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET welcome_shown = 1 WHERE id = ?', [req.session.userId], function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Welcome continue error:', error);
    res.redirect('/dashboard');
  }
});
app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }
    const YoutubeChannel = require('./models/YoutubeChannel');
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);

    // Enrich channels with live/scheduled counts
    const enrichedChannels = await Promise.all(youtubeChannels.map(async (channel) => {
      const liveCount = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as count FROM streams WHERE youtube_channel_id = ? AND status = "live"', [channel.id], (err, row) => {
          resolve(row ? row.count : 0);
        });
      });
      const scheduledCount = await new Promise((resolve) => {
        db.get('SELECT COUNT(*) as count FROM streams WHERE youtube_channel_id = ? AND status = "scheduled"', [channel.id], (err, row) => {
          resolve(row ? row.count : 0);
        });
      });
      return { ...channel, liveCount, scheduledCount };
    }));

    // Calculate total active streams
    const activeStreamsCount = enrichedChannels.reduce((sum, channel) => sum + channel.liveCount, 0);

    // System stats (mock or real if available)
    const systemStats = {
      cpu: 0,
      memory: 0,
      uptime: process.uptime()
    };

    res.render('dashboard', {
      title: 'Dashboard',
      active: 'dashboard',
      user: user,
      youtubeChannels: enrichedChannels,
      activeStreamsCount: activeStreamsCount,
      systemStats: systemStats
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.redirect('/login');
  }
});

app.get('/dashboard/:channelId', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.redirect('/login');
    }

    const channelParam = req.params.channelId;
    const YoutubeChannel = require('./models/YoutubeChannel');

    let channel;
    // Check if param looks like a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelParam);

    if (isUuid) {
      channel = await YoutubeChannel.findById(channelParam);
    } else {
      channel = await YoutubeChannel.findBySlug(user.id, channelParam);
    }

    if (!channel && !isUuid) {
      // Fallback: try finding by ID just in case
      channel = await YoutubeChannel.findById(channelParam);
    }

    if (!channel || channel.user_id !== user.id) {
      return res.redirect('/dashboard?error=ChannelNotFound');
    }

    const streamsData = await Stream.findAllPaginated(req.session.userId, {
      page: 1,
      limit: 10,
      search: '',
      channelId: channel.id // Pass internal DB ID
    });

    const videos = await Video.findAll(user.id, channel.id);
    const playlists = await Playlist.findAll(user.id, channel.id);
    const thumbnails = await Thumbnail.findAll(user.id, channel.id);
    // Fetch rotations for this user (filtered in view)
    const rotations = await Rotation.findAll(user.id);

    // Filter music/audios from videos if they are stored there
    const music = videos.filter(v => v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac');
    const actualVideos = videos.filter(v =>
      !music.includes(v) &&
      v.format !== 'youtube' &&
      v.file_size !== null &&
      v.file_size > 0
    );

    res.render('channel_dashboard', {
      title: channel.channel_name,
      active: 'dashboard',
      user: user,
      channel: channel,
      streams: JSON.stringify(streamsData.streams),
      pagination: JSON.stringify(streamsData.pagination),
      videos: actualVideos,
      playlists: playlists,
      thumbnails: thumbnails,
      music: music,
      rotations: rotations
    });
  } catch (error) {
    console.error('Channel Dashboard error:', error);
    res.redirect('/dashboard');
  }
});



// Rotations Route
app.get('/rotations', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const rotations = await Rotation.findAll(req.session.userId);
    const videos = await Video.findAll(req.session.userId);
    // Filter valid videos like in dashboard
    const validVideos = videos.filter(v =>
      !(v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac') &&
      v.format !== 'youtube' &&
      v.file_size > 0
    );
    const playlists = await Playlist.findAll(req.session.userId);

    res.render('rotations', {
      title: 'Stream Rotations',
      active: 'rotations',
      user: user,
      rotations: rotations,
      videos: validVideos,
      playlists: playlists
    });
  } catch (error) {
    console.error('Rotations page error:', error);
    res.redirect('/dashboard');
  }
});

// Gallery Route
app.get('/gallery', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const videos = await Video.findAll(req.session.userId);
    // Filter out audio and youtube imports for main gallery
    const validVideos = videos.filter(v =>
      !(v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac') &&
      v.format !== 'youtube'
    );

    res.render('gallery', {
      title: 'Video Gallery',
      active: 'gallery',
      user: user,
      videos: validVideos,
      mediaType: 'video'
    });
  } catch (error) {
    console.error('Gallery page error:', error);
    res.redirect('/dashboard');
  }
});

// Playlist Route
app.get('/playlist', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const playlists = await Playlist.findAll(req.session.userId);
    const allFiles = await Video.findAll(req.session.userId);
    const videos = allFiles.filter(v =>
      !(v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac') &&
      v.format !== 'youtube'
    );
    const audios = allFiles.filter(v => (v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac'));

    res.render('playlist', {
      title: 'Playlist Manager',
      active: 'playlist',
      user: user,
      playlists: playlists,
      videos: videos,
      audios: audios
    });
  } catch (error) {
    console.error('Playlist page error:', error);
    res.redirect('/dashboard');
  }
});

// History Route
app.get('/history', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    // Fetch recent streams
    const streamsData = await Stream.findAllPaginated(req.session.userId, { limit: 50 });

    res.render('history', {
      title: 'Stream History',
      active: 'history',
      user: user,
      streams: streamsData.streams
    });
  } catch (error) {
    console.error('History page error:', error);
    res.redirect('/dashboard');
  }
});

// Users Route (Admin)
app.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId);
    const users = await User.findAll();

    res.render('users', {
      title: 'User Management',
      active: 'users',
      user: currentUser,
      users: users
    });
  } catch (error) {
    console.error('Users page error:', error);
    res.redirect('/dashboard');
  }
});

// Settings Route
app.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: user,
      activeTab: req.query.activeTab || 'profile',
      error: req.query.error,
      success: req.query.success
    });
  } catch (error) {
    console.error('Settings page error:', error);
    res.redirect('/dashboard');
  }
});





// Helper for channel gallery routes
async function getChannelBySlugOrId(idOrSlug, userId) {
  console.log('getChannelBySlugOrId called with:', idOrSlug, userId);
  const YoutubeChannel = require('./models/YoutubeChannel');

  let channel = await YoutubeChannel.findById(idOrSlug);
  if (!channel) {
    console.log('Not found by ID, trying slug...');
    channel = await YoutubeChannel.findBySlug(userId, idOrSlug);
  }

  if (channel) {
    console.log('Channel found:', channel.channel_name, 'User match:', channel.user_id === userId);
  } else {
    console.log('Channel NOT found for:', idOrSlug);
  }

  return (channel && channel.user_id === userId) ? channel : null;
}

app.get('/dashboard/:slug/videos', isAuthenticated, async (req, res) => {
  console.log('Route hit: /dashboard/:slug/videos', req.params.slug);
  try {
    const user = await User.findById(req.session.userId);
    const channel = await getChannelBySlugOrId(req.params.slug, user.id);
    if (!channel) {
      console.warn('Channel not found, redirecting to dashboard');
      return res.redirect('/dashboard');
    }

    const videos = await Video.findAll(user.id, channel.id);
    // Filter out audio, youtube imports, and invalid files
    const actualVideos = videos.filter(v =>
      !(v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac') &&
      v.format !== 'youtube' &&
      v.file_size !== null &&
      v.file_size > 0
    );

    res.render('channel_gallery', {
      title: channel.channel_name + ' - Videos',
      active: 'dashboard',
      user,
      channel,
      files: actualVideos,
      mediaType: 'video'
    });
  } catch (e) { console.error(e); res.redirect('/dashboard'); }
});

app.get('/dashboard/:slug/music', isAuthenticated, async (req, res) => {
  console.log('Route hit: /dashboard/:slug/music', req.params.slug);
  try {
    const user = await User.findById(req.session.userId);
    const channel = await getChannelBySlugOrId(req.params.slug, user.id);
    if (!channel) {
      console.warn('Channel not found, redirecting to dashboard');
      return res.redirect('/dashboard');
    }

    const videos = await Video.findAll(user.id, channel.id);
    // Filter only audio
    const audioFiles = videos.filter(v => (v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac'));

    res.render('channel_gallery', {
      title: channel.channel_name + ' - Music',
      active: 'dashboard',
      user,
      channel,
      files: audioFiles,
      mediaType: 'audio'
    });
  } catch (e) { console.error(e); res.redirect('/dashboard'); }
});

app.get('/dashboard/:slug/playlists', isAuthenticated, async (req, res) => {
  console.log('Route hit: /dashboard/:slug/playlists', req.params.slug);
  try {
    const user = await User.findById(req.session.userId);
    const channel = await getChannelBySlugOrId(req.params.slug, user.id);
    if (!channel) {
      console.warn('Channel not found, redirecting to dashboard');
      return res.redirect('/dashboard');
    }

    const playlists = await Playlist.findAll(user.id, channel.id);
    const allFiles = await Video.findAll(user.id, channel.id);
    const videos = allFiles.filter(v =>
      !(v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac') &&
      v.format !== 'youtube' &&
      v.file_size !== null &&
      v.file_size > 0
    );
    const audios = allFiles.filter(v => (v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac'));

    res.render('channel_playlists', {
      title: channel.channel_name + ' - Playlists',
      active: 'dashboard',
      user,
      channel,
      playlists,
      videos,
      audios
    });
  } catch (e) { console.error(e); res.redirect('/dashboard'); }
});

app.get('/dashboard/:slug/thumbnails', isAuthenticated, async (req, res) => {
  console.log('Route hit: /dashboard/:slug/thumbnails', req.params.slug);
  try {
    const user = await User.findById(req.session.userId);
    const channel = await getChannelBySlugOrId(req.params.slug, user.id);
    if (!channel) {
      console.warn('Channel not found, redirecting to dashboard');
      return res.redirect('/dashboard');
    }

    const thumbnails = await Thumbnail.findAll(user.id, channel.id);
    res.render('channel_gallery', {
      title: channel.channel_name + ' - Thumbnails',
      active: 'dashboard',
      user,
      channel,
      files: thumbnails,
      mediaType: 'image'
    });
  } catch (e) {
    console.error('Error in thumbnails route:', e);
    res.redirect('/dashboard');
  }
});

app.get('/dashboard/:slug/rotations', isAuthenticated, async (req, res) => {
  console.log('Route hit: /dashboard/:slug/rotations', req.params.slug);
  try {
    const user = await User.findById(req.session.userId);
    const channel = await getChannelBySlugOrId(req.params.slug, user.id);
    if (!channel) {
      console.warn('Channel not found, redirecting to dashboard');
      return res.redirect('/dashboard');
    }

    // Get ALL rotations and filter manually, or better: filter in DB if possible? 
    // Rotation.findAll returns all for user.
    const allRotations = await Rotation.findAll(user.id);
    const channelRotations = allRotations.filter(r => r.youtube_channel_id === channel.id);

    const allVideos = await Video.findAll(user.id, channel.id);
    const videos = allVideos.filter(v =>
      !(v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac') &&
      v.format !== 'youtube' &&
      v.file_size !== null &&
      v.file_size > 0
    );
    const playlists = await Playlist.findAll(user.id, channel.id);
    console.log(`[DEBUG] Rotations Route: found ${playlists.length} playlists for channel ${channel.id}`);
    const thumbnails = await Thumbnail.findAll(user.id, channel.id);

    res.render('channel_rotations', {
      title: channel.channel_name + ' - Stream Rotations',
      active: 'dashboard',
      user,
      channel,
      rotations: channelRotations,
      videos: videos || [],
      playlists: playlists || [],
      thumbnails: thumbnails || []
    });
  } catch (e) { console.error(e); res.redirect('/dashboard'); }
});

app.post('/api/channels/:id/generate-smart-rotation', isAuthenticated, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.session.userId;

    // Extracts new simplified parameters
    const {
      startTime,
      durationHours,
      minDurationHours,
      maxDurationHours,

      targetItemCount,
      sourcePlaylistId,
      customTitles,
      customDescription,
      customTags,
      postLiveTitles,
      postLiveThumbnailMode,
      postLiveDelayDays,
      postLiveCtrThreshold,
      privacy,
      repeatMode
    } = req.body;

    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(channelId);

    if (!channel || channel.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Channel not found or access denied' });
    }

    const AutoSchedulerService = require('./services/autoScheduler');
    let result;

    // Check if Batch Mode (startTimes array present)
    if (req.body.startTimes && Array.isArray(req.body.startTimes) && req.body.startTimes.length > 0) {
      result = await AutoSchedulerService.generateBatchRotations(channelId, userId, {
        startTimes: req.body.startTimes,
        // Pass Min/Max for random duration calculation
        durationHours: parseFloat(durationHours), // Fallback/Original
        minDurationHours: parseFloat(minDurationHours),
        maxDurationHours: parseFloat(maxDurationHours),
        targetItemCount: targetItemCount,
        sourcePlaylistId,
        customTitles: customTitles || [],
        customDescription,
        customTags,
        privacy: privacy || 'unlisted',
        repeatMode: repeatMode || 'daily',

        // Weekly Pattern Params
        weeklyPattern: req.body.weeklyPattern === true || req.body.weeklyPattern === 'true',
        minDailyStreams: parseInt(req.body.minDailyStreams || 5),
        maxDailyStreams: parseInt(req.body.maxDailyStreams || 10),
        postLiveTitles: postLiveTitles || [],
        postLiveThumbnailMode: postLiveThumbnailMode || 'none',
        postLiveDelayDays: parseInt(postLiveDelayDays || 0),
        postLiveCtrThreshold: parseFloat(postLiveCtrThreshold || 0)
      });
    } else {
      result = await AutoSchedulerService.generateRotations(channelId, userId, {
        startTime,
        durationHours: parseFloat(durationHours),
        minDurationHours: parseFloat(minDurationHours),
        maxDurationHours: parseFloat(maxDurationHours),
        targetItemCount: targetItemCount,
        sourcePlaylistId,
        customTitles: customTitles || [],
        customDescription,
        customTags,
        privacy: privacy || 'unlisted',
        repeatMode: repeatMode || 'daily',
        postLiveTitles: postLiveTitles || [],
        postLiveThumbnailMode: postLiveThumbnailMode || 'none',
        postLiveDelayDays: parseInt(postLiveDelayDays || 0),
        postLiveCtrThreshold: parseFloat(postLiveCtrThreshold || 0)
      });
    }

    res.json({
      success: true,
      message: `Successfully generated ${result.count} smart rotations`,
      batchMode: !!(req.body.startTimes && req.body.startTimes.length > 0)
    });
  } catch (e) {
    console.error('Smart Rotation Error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// API for Thumnails
app.post('/api/thumbnails/upload', isAuthenticated, uploadThumbnail.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
    const channelId = req.body.youtube_channel_id || null;

    const originalFilename = req.file.filename;
    // ... rest of implementation ... 
    // Wait, I need to check how uploadThumbnail works. 
    // Assuming uploadThumbnail saves file.
    // Let's optimize: user uploadThumbnail.single('media') to match channel_gallery input name="media"

    // Actually, I am REPLACING the route handler block.
    // I need to ensure line 930 uses 'media' instead of 'thumbnail'.

    const thumbFilename = req.file.filename; // Simple

    // Create DB record
    await Thumbnail.create({
      user_id: req.session.userId,
      youtube_channel_id: channelId,
      filepath: `/uploads/thumbnails/${thumbFilename}`,
      filename: thumbFilename,
      title: path.parse(req.file.originalname).name,
      original_filename: req.file.originalname,
      file_size: req.file.size,
      width: 0, height: 0 // Placeholder
    });

    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/thumbnails/:id', isAuthenticated, async (req, res) => {
  try {
    const thumb = await Thumbnail.findById(req.params.id);
    if (!thumb || thumb.user_id !== req.session.userId) return res.status(403).json({ success: false });

    // logic penghapusan file dan record sekarang ditangani di model Thumbnail.delete
    await Thumbnail.delete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('Error deleting thumbnail:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/gallery', isAuthenticated, async (req, res) => {
  try {
    const videos = await Video.findAll(req.session.userId, 'NULL');
    res.render('gallery', {
      title: 'Video Gallery',
      active: 'gallery',
      user: await User.findById(req.session.userId),
      videos: videos
    });
  } catch (error) {
    console.error('Gallery error:', error);
    res.redirect('/dashboard');
  }
});
app.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }

    const { decrypt } = require('./utils/encryption');
    const YoutubeChannel = require('./models/YoutubeChannel');
    const AppSettings = require('./models/AppSettings');
    const hasYoutubeCredentials = !!(user.youtube_client_id && user.youtube_client_secret);
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);
    const isYoutubeConnected = youtubeChannels.length > 0;
    const defaultChannel = youtubeChannels.find(c => c.is_default) || youtubeChannels[0];

    const recaptchaSettings = await AppSettings.getRecaptchaSettings();

    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: user,
      appVersion: packageJson.version,
      youtubeClientId: user.youtube_client_id || '',
      youtubeClientSecret: user.youtube_client_secret ? '••••••••••••••••' : '',
      youtubeConnected: isYoutubeConnected,
      youtubeChannels: youtubeChannels,
      youtubeChannelName: defaultChannel?.channel_name || '',
      youtubeChannelThumbnail: defaultChannel?.channel_thumbnail || '',
      youtubeSubscriberCount: defaultChannel?.subscriber_count || '0',
      hasYoutubeCredentials: hasYoutubeCredentials,
      recaptchaSiteKey: recaptchaSettings.siteKey || '',
      recaptchaSecretKey: recaptchaSettings.secretKey ? '••••••••••••••••' : '',
      hasRecaptchaKeys: recaptchaSettings.hasKeys,
      recaptchaEnabled: recaptchaSettings.enabled,
      success: req.query.success || null,
      error: req.query.error || null,
      activeTab: req.query.activeTab || null
    });
  } catch (error) {
    console.error('Settings error:', error);
    res.redirect('/login');
  }
});
app.get('/history', isAuthenticated, async (req, res) => {
  try {
    const db = require('./db/database').db;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const platform = req.query.platform || 'all';
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE h.user_id = ?';
    const params = [req.session.userId];

    if (platform !== 'all') {
      whereClause += ' AND h.platform = ?';
      params.push(platform);
    }

    if (search) {
      whereClause += ' AND h.title LIKE ?';
      params.push(`%${search}%`);
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM stream_history h ${whereClause}`,
        params,
        (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        }
      );
    });

    const history = await new Promise((resolve, reject) => {
      db.all(
        `SELECT h.*, v.thumbnail_path 
         FROM stream_history h 
         LEFT JOIN videos v ON h.video_id = v.id 
         ${whereClause}
         ORDER BY h.start_time ${sort}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.render('history', {
      active: 'history',
      title: 'Stream History',
      history: history,
      helpers: app.locals.helpers,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        sort: req.query.sort || 'newest',
        platform,
        search
      }
    });
  } catch (error) {
    console.error('Error fetching stream history:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load stream history',
      error: error
    });
  }
});
app.delete('/api/history/:id', isAuthenticated, async (req, res) => {
  try {
    const db = require('./db/database').db;
    const historyId = req.params.id;
    const history = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM stream_history WHERE id = ? AND user_id = ?',
        [historyId, req.session.userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    if (!history) {
      return res.status(404).json({
        success: false,
        error: 'History entry not found or not authorized'
      });
    }
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM stream_history WHERE id = ?',
        [historyId],
        function (err) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });
    res.json({ success: true, message: 'History entry deleted' });
  } catch (error) {
    console.error('Error deleting history entry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete history entry'
    });
  }
});

app.get('/users', isAdmin, async (req, res) => {
  try {
    const users = await User.findAll();

    const usersWithStats = await Promise.all(users.map(async (user) => {
      const videoStats = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as totalSize 
           FROM videos WHERE user_id = ?`,
          [user.id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      const streamStats = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as count FROM streams WHERE user_id = ?`,
          [user.id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      const activeStreamStats = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as count FROM streams WHERE user_id = ? AND status = 'live'`,
          [user.id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      return {
        ...user,
        videoCount: videoStats.count,
        totalVideoSize: videoStats.totalSize > 0 ? formatFileSize(videoStats.totalSize) : null,
        streamCount: streamStats.count,
        activeStreamCount: activeStreamStats.count
      };
    }));

    res.render('users', {
      title: 'User Management',
      active: 'users',
      users: usersWithStats,
      user: req.user
    });
  } catch (error) {
    console.error('Users page error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load users page',
      user: req.user
    });
  }
});

app.post('/api/users/status', isAdmin, async (req, res) => {
  try {
    const { userId, status } = req.body;

    if (!userId || !status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID or status'
      });
    }

    if (userId == req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own status'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.updateStatus(userId, status);

    res.json({
      success: true,
      message: `User ${status === 'active' ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

app.post('/api/users/role', isAdmin, async (req, res) => {
  try {
    const { userId, role } = req.body;

    if (!userId || !role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID or role'
      });
    }

    if (userId == req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own role'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.updateRole(userId, role);

    res.json({
      success: true,
      message: `User role updated to ${role} successfully`
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user role'
    });
  }
});

app.post('/api/users/delete', isAdmin, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (userId == req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.delete(userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

app.post('/api/users/update', isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const { userId, username, role, status, password, diskLimit } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let avatarPath = user.avatar_path;
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    const updateData = {
      username: username || user.username,
      user_role: role || user.user_role,
      status: status || user.status,
      avatar_path: avatarPath,
      disk_limit: diskLimit !== undefined && diskLimit !== '' ? parseInt(diskLimit) : user.disk_limit
    };

    if (password && password.trim() !== '') {
      const bcrypt = require('bcrypt');
      updateData.password = await bcrypt.hash(password, 10);
    }

    await User.updateProfile(userId, updateData);

    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

app.post('/api/users/create', isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const { username, role, status, password, diskLimit } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    let avatarPath = '/uploads/avatars/default-avatar.png';
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    const userData = {
      username: username,
      password: password,
      user_role: role || 'user',
      status: status || 'active',
      avatar_path: avatarPath,
      disk_limit: diskLimit ? parseInt(diskLimit) : 0
    };

    const result = await User.create(userData);

    res.json({
      success: true,
      message: 'User created successfully',
      userId: result.id
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
});

app.get('/api/users/:id/videos', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const videos = await Video.findAll(userId);
    res.json({ success: true, videos });
  } catch (error) {
    console.error('Get user videos error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user videos' });
  }
});

app.get('/api/users/:id/streams', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const streams = await Stream.findAll(userId);
    res.json({ success: true, streams });
  } catch (error) {
    console.error('Get user streams error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user streams' });
  }
});

app.get('/api/user/disk-usage', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const diskUsage = await User.getDiskUsage(req.session.userId);
    res.json({
      success: true,
      diskUsage: diskUsage,
      diskLimit: user.disk_limit || 0
    });
  } catch (error) {
    console.error('Get disk usage error:', error);
    res.status(500).json({ success: false, message: 'Failed to get disk usage' });
  }
});

app.get('/api/system-stats', isAuthenticated, async (req, res) => {
  try {
    const stats = await systemMonitor.getSystemStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  Object.keys(interfaces).forEach((ifname) => {
    interfaces[ifname].forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    });
  });
  return addresses.length > 0 ? addresses : ['localhost'];
}
app.post('/settings/profile', isAuthenticated, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.redirect('/settings?error=' + encodeURIComponent(err.message) + '&activeTab=profile#profile');
    } else if (err) {
      return res.redirect('/settings?error=' + encodeURIComponent(err.message) + '&activeTab=profile#profile');
    }
    next();
  });
}, [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: await User.findById(req.session.userId),
        error: errors.array()[0].msg,
        activeTab: 'profile'
      });
    }
    const currentUser = await User.findById(req.session.userId);
    if (req.body.username !== currentUser.username) {
      const existingUser = await User.findByUsername(req.body.username);
      if (existingUser) {
        return res.render('settings', {
          title: 'Settings',
          active: 'settings',
          user: currentUser,
          error: 'Username is already taken',
          activeTab: 'profile'
        });
      }
    }
    const updateData = {
      username: req.body.username
    };
    if (req.file) {
      updateData.avatar_path = `/uploads/avatars/${req.file.filename}`;
    }
    await User.update(req.session.userId, updateData);
    req.session.username = updateData.username;
    if (updateData.avatar_path) {
      req.session.avatar_path = updateData.avatar_path;
    }
    return res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      success: 'Profile updated successfully!',
      activeTab: 'profile'
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      error: 'An error occurred while updating your profile',
      activeTab: 'profile'
    });
  }
});
app.post('/settings/password', isAuthenticated, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('confirmPassword')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Passwords do not match'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: await User.findById(req.session.userId),
        error: errors.array()[0].msg,
        activeTab: 'security'
      });
    }
    const user = await User.findById(req.session.userId);
    const passwordMatch = await User.verifyPassword(req.body.currentPassword, user.password);
    if (!passwordMatch) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: user,
        error: 'Current password is incorrect',
        activeTab: 'security'
      });
    }
    const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
    await User.update(req.session.userId, { password: hashedPassword });
    return res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      success: 'Password changed successfully',
      activeTab: 'security'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      error: 'An error occurred while changing your password',
      activeTab: 'security'
    });
  }
});

app.get('/api/settings/logs', isAuthenticated, async (req, res) => {
  try {
    const logPath = path.join(__dirname, 'logs', 'app.log');
    const lines = parseInt(req.query.lines) || 200;
    const filter = req.query.filter || '';

    if (!fs.existsSync(logPath)) {
      return res.json({ success: true, logs: [], message: 'Log file not found' });
    }

    const stats = fs.statSync(logPath);
    const fileSize = stats.size;

    const maxReadSize = 5 * 1024 * 1024;
    let content = '';

    if (fileSize > maxReadSize) {
      const fd = fs.openSync(logPath, 'r');
      const buffer = Buffer.alloc(maxReadSize);
      fs.readSync(fd, buffer, 0, maxReadSize, fileSize - maxReadSize);
      fs.closeSync(fd);
      content = buffer.toString('utf8');
      const firstNewline = content.indexOf('\n');
      if (firstNewline > 0) {
        content = content.substring(firstNewline + 1);
      }
    } else {
      content = fs.readFileSync(logPath, 'utf8');
    }

    let logLines = content.split('\n').filter(line => line.trim());

    if (filter) {
      const filterLower = filter.toLowerCase();
      logLines = logLines.filter(line => line.toLowerCase().includes(filterLower));
    }

    logLines = logLines.slice(-lines);

    res.json({ success: true, logs: logLines });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/logs/clear', isAuthenticated, async (req, res) => {
  try {
    const logPath = path.join(__dirname, 'logs', 'app.log');
    fs.writeFileSync(logPath, '');
    res.json({ success: true, message: 'Logs cleared successfully' });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/settings/integrations/gdrive', isAuthenticated, [
  body('apiKey').notEmpty().withMessage('API Key is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: await User.findById(req.session.userId),
        error: errors.array()[0].msg,
        activeTab: 'integrations'
      });
    }
    await User.update(req.session.userId, {
      gdrive_api_key: req.body.apiKey
    });
    return res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      success: 'Google Drive API key saved successfully!',
      activeTab: 'integrations'
    });
  } catch (error) {
    console.error('Error saving Google Drive API key:', error);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      error: 'An error occurred while saving your Google Drive API key',
      activeTab: 'integrations'
    });
  }
});
app.post('/upload/video', isAuthenticated, uploadVideo.single('video'), async (req, res) => {
  try {
    console.log('Upload request received:', req.file);
    console.log('Session userId for upload:', req.session.userId);

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    const { filename, originalname, path: videoPath, mimetype, size } = req.file;
    const thumbnailName = path.basename(filename, path.extname(filename)) + '.jpg';
    const videoInfo = await getVideoInfo(videoPath);
    const thumbnailRelativePath = await generateThumbnail(videoPath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);
    let format = 'unknown';
    if (mimetype === 'video/mp4') format = 'mp4';
    else if (mimetype === 'video/avi') format = 'avi';
    else if (mimetype === 'video/quicktime') format = 'mov';
    const videoData = {
      title: path.basename(originalname, path.extname(originalname)),
      original_filename: originalname,
      filepath: `/uploads/videos/${filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: size,
      duration: videoInfo.duration,
      format: format,
      user_id: req.session.userId,
      youtube_channel_id: req.body.youtube_channel_id || null
    };
    const video = await Video.create(videoData);
    res.json({
      success: true,
      video: {
        id: video.id,
        title: video.title,
        filepath: video.filepath,
        thumbnail_path: video.thumbnail_path,
        duration: video.duration,
        file_size: video.file_size,
        format: video.format
      }
    });
  } catch (error) {
    console.error('Upload error details:', error);
    res.status(500).json({
      error: 'Failed to upload video',
      details: error.message
    });
  }
});
app.post('/api/videos/upload', isAuthenticated, (req, res, next) => {
  uploadVideo.single('video')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'File too large. Maximum size is 50GB.'
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          error: 'Unexpected file field.'
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided'
      });
    }

    const user = await User.findById(req.session.userId);
    if (user.disk_limit > 0) {
      const currentUsage = await User.getDiskUsage(req.session.userId);
      const newTotal = currentUsage + req.file.size;
      if (newTotal > user.disk_limit) {
        const fs = require('fs');
        const fullFilePath = path.join(__dirname, 'public', 'uploads', 'videos', req.file.filename);
        if (fs.existsSync(fullFilePath)) {
          fs.unlinkSync(fullFilePath);
        }
        return res.status(400).json({
          success: false,
          error: 'Disk limit exceeded. Please delete some files or contact admin.'
        });
      }
    }

    let title = path.parse(req.file.originalname).name;
    const filePath = `/uploads/videos/${req.file.filename}`;
    const fullFilePath = path.join(__dirname, 'public', filePath);
    const fileSize = req.file.size;
    await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(fullFilePath, (err, metadata) => {
        if (err) {
          console.error('Error extracting metadata:', err);
          return reject(err);
        }
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const duration = metadata.format.duration || 0;
        const format = metadata.format.format_name || '';
        const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : '';
        const bitrate = metadata.format.bit_rate ?
          Math.round(parseInt(metadata.format.bit_rate) / 1000) :
          null;
        let fps = null;
        if (videoStream && videoStream.avg_frame_rate) {
          const fpsRatio = videoStream.avg_frame_rate.split('/');
          if (fpsRatio.length === 2 && parseInt(fpsRatio[1]) !== 0) {
            fps = Math.round((parseInt(fpsRatio[0]) / parseInt(fpsRatio[1]) * 100)) / 100;
          } else {
            fps = parseInt(fpsRatio[0]) || null;
          }
        }
        const thumbnailFilename = `thumb-${path.parse(req.file.filename).name}.jpg`;
        const thumbnailPath = `/uploads/thumbnails/${thumbnailFilename}`;
        const fullThumbnailPath = path.join(__dirname, 'public', thumbnailPath);
        ffmpeg(fullFilePath)
          .screenshots({
            timestamps: ['10%'],
            filename: thumbnailFilename,
            folder: path.join(__dirname, 'public', 'uploads', 'thumbnails'),
            size: '854x480'
          })
          .on('end', async () => {
            try {
              const videoData = {
                title,
                filepath: filePath,
                thumbnail_path: thumbnailPath,
                file_size: fileSize,
                duration,
                format,
                resolution,
                bitrate,
                fps,
                user_id: req.session.userId,
                youtube_channel_id: req.body.youtube_channel_id || null
              };
              const video = await Video.create(videoData);
              res.json({
                success: true,
                message: 'Video uploaded successfully',
                video
              });
              resolve();
            } catch (dbError) {
              console.error('Database error:', dbError);
              reject(dbError);
            }
          })
          .on('error', (err) => {
            console.error('Error creating thumbnail:', err);
            reject(err);
          });
      });
    });
  } catch (error) {
    console.error('Upload error details:', error);
    res.status(500).json({
      error: 'Failed to upload video',
      details: error.message
    });
  }
});
app.get('/api/videos', isAuthenticated, async (req, res) => {
  try {
    const allVideos = await Video.findAll(req.session.userId, 'NULL');
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const playlists = await Playlist.findAll(req.session.userId);
    res.json({ success: true, videos, playlists });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch videos' });
  }
});

app.post('/api/audio/upload', isAuthenticated, (req, res, next) => {
  uploadAudio.single('audio')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'File too large. Maximum size is 50GB.'
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided'
      });
    }

    const user = await User.findById(req.session.userId);
    if (user.disk_limit > 0) {
      const currentUsage = await User.getDiskUsage(req.session.userId);
      const newTotal = currentUsage + req.file.size;
      if (newTotal > user.disk_limit) {
        const uploadedPath = path.join(__dirname, 'public', 'uploads', 'audio', req.file.filename);
        if (fs.existsSync(uploadedPath)) {
          fs.unlinkSync(uploadedPath);
        }
        return res.status(400).json({
          success: false,
          error: 'Disk limit exceeded. Please delete some files or contact admin.'
        });
      }
    }

    let title = path.parse(req.file.originalname).name;
    const uploadedPath = path.join(__dirname, 'public', 'uploads', 'audio', req.file.filename);
    const result = await audioConverter.processAudioFile(uploadedPath, req.file.originalname);
    const finalFilename = path.basename(result.filepath);
    const filePath = `/uploads/audio/${finalFilename}`;
    const fullFilePath = result.filepath;
    const audioInfo = await audioConverter.getAudioInfo(fullFilePath);
    const stats = fs.statSync(fullFilePath);
    const thumbnailPath = '/images/audio-thumbnail.png';
    const videoData = {
      title,
      filepath: filePath,
      thumbnail_path: thumbnailPath,
      file_size: stats.size,
      duration: audioInfo.duration,
      format: 'aac',
      resolution: null,
      bitrate: audioInfo.bitrate,
      fps: null,
      user_id: req.session.userId,
      youtube_channel_id: req.body.youtube_channel_id || null
    };
    const video = await Video.create(videoData);
    res.json({
      success: true,
      message: result.converted ? 'Audio converted to AAC and uploaded successfully' : 'Audio uploaded successfully',
      video,
      converted: result.converted
    });
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({
      error: 'Failed to upload audio',
      details: error.message
    });
  }
});

app.post('/api/videos/chunk/init', isAuthenticated, async (req, res) => {
  try {
    const { filename, fileSize, totalChunks, youtube_channel_id } = req.body;
    if (!filename || !fileSize || !totalChunks) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const allowedExts = ['.mp4', '.avi', '.mov'];
    const ext = path.extname(filename).toLowerCase();
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ success: false, error: 'Only .mp4, .avi, and .mov formats are allowed' });
    }

    const user = await User.findById(req.session.userId);
    if (user.disk_limit > 0) {
      const currentUsage = await User.getDiskUsage(req.session.userId);
      const newTotal = currentUsage + parseInt(fileSize);
      if (newTotal > user.disk_limit) {
        return res.status(400).json({
          success: false,
          error: 'Disk limit exceeded. Please delete some files or contact admin.'
        });
      }
    }

    const info = await chunkUploadService.initUpload(filename, fileSize, totalChunks, req.session.userId, youtube_channel_id);
    res.json({
      success: true,
      uploadId: info.uploadId,
      chunkSize: chunkUploadService.CHUNK_SIZE,
      uploadedChunks: info.uploadedChunks || [],
      resumed: (info.uploadedChunks || []).length > 0
    });
  } catch (error) {
    console.error('Chunk init error:', error);
    res.status(500).json({ success: false, error: 'Failed to initialize upload' });
  }
});

app.post('/api/videos/chunk/upload', isAuthenticated, express.raw({ type: 'application/octet-stream', limit: '60mb' }), async (req, res) => {
  try {
    const uploadId = req.headers['x-upload-id'];
    const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);
    if (!uploadId || isNaN(chunkIndex)) {
      return res.status(400).json({ success: false, error: 'Missing upload ID or chunk index' });
    }
    const info = await chunkUploadService.getUploadInfo(uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const result = await chunkUploadService.saveChunk(uploadId, chunkIndex, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload chunk' });
  }
});

app.get('/api/videos/chunk/status/:uploadId', isAuthenticated, async (req, res) => {
  try {
    const info = await chunkUploadService.getUploadInfo(req.params.uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    res.json({
      success: true,
      uploadedChunks: info.uploadedChunks,
      totalChunks: info.totalChunks,
      status: info.status
    });
  } catch (error) {
    console.error('Chunk status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get upload status' });
  }
});

app.post('/api/videos/chunk/complete', isAuthenticated, async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ success: false, error: 'Missing upload ID' });
    }
    const info = await chunkUploadService.getUploadInfo(uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const result = await chunkUploadService.mergeChunks(uploadId);
    const title = path.parse(info.filename).name;
    const fullFilePath = result.fullPath;
    const videoData = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(fullFilePath, (err, metadata) => {
        if (err) {
          console.error('Error extracting metadata:', err);
          return reject(err);
        }
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const duration = metadata.format.duration || 0;
        const format = metadata.format.format_name || '';
        const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : '';
        const bitrate = metadata.format.bit_rate ? Math.round(parseInt(metadata.format.bit_rate) / 1000) : null;
        let fps = null;
        if (videoStream && videoStream.avg_frame_rate) {
          const fpsRatio = videoStream.avg_frame_rate.split('/');
          if (fpsRatio.length === 2 && parseInt(fpsRatio[1]) !== 0) {
            fps = Math.round((parseInt(fpsRatio[0]) / parseInt(fpsRatio[1]) * 100)) / 100;
          } else {
            fps = parseInt(fpsRatio[0]) || null;
          }
        }
        const thumbnailFilename = `thumb-${path.parse(result.filename).name}.jpg`;
        const thumbnailPath = `/uploads/thumbnails/${thumbnailFilename}`;
        ffmpeg(fullFilePath)
          .screenshots({
            timestamps: ['10%'],
            filename: thumbnailFilename,
            folder: path.join(__dirname, 'public', 'uploads', 'thumbnails'),
            size: '854x480'
          })
          .on('end', async () => {
            resolve({
              title,
              filepath: result.filepath,
              thumbnail_path: thumbnailPath,
              file_size: result.fileSize,
              duration,
              format,
              resolution,
              bitrate,
              fps,
              user_id: req.session.userId,
              youtube_channel_id: info.youtubeChannelId || null
            });
          })
          .on('error', (err) => {
            console.error('Error creating thumbnail:', err);
            reject(err);
          });
      });
    });
    const video = await Video.create(videoData);
    await chunkUploadService.cleanupUpload(uploadId);
    res.json({ success: true, message: 'Video uploaded successfully', video });
  } catch (error) {
    console.error('Chunk complete error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete upload', details: error.message });
  }
});

app.post('/api/videos/chunk/pause', isAuthenticated, async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ success: false, error: 'Missing upload ID' });
    }
    const info = await chunkUploadService.getUploadInfo(uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    await chunkUploadService.pauseUpload(uploadId);
    res.json({ success: true });
  } catch (error) {
    console.error('Chunk pause error:', error);
    res.status(500).json({ success: false, error: 'Failed to pause upload' });
  }
});

app.delete('/api/videos/chunk/:uploadId', isAuthenticated, async (req, res) => {
  try {
    const info = await chunkUploadService.getUploadInfo(req.params.uploadId);
    if (info && info.userId === req.session.userId) {
      await chunkUploadService.cleanupUpload(req.params.uploadId);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Chunk cleanup error:', error);
    res.status(500).json({ success: false, error: 'Failed to cleanup upload' });
  }
});
app.delete('/api/videos/:id', isAuthenticated, async (req, res) => {
  try {
    const videoId = req.params.id;
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }
    if (video.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const videoPath = path.join(__dirname, 'public', video.filepath);
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }
    if (video.thumbnail_path) {
      const thumbnailPath = path.join(__dirname, 'public', video.thumbnail_path);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }
    }
    await Video.delete(videoId, req.session.userId);
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ success: false, error: 'Failed to delete video' });
  }
});
app.post('/api/videos/:id/rename', isAuthenticated, [
  body('title').trim().isLength({ min: 1 }).withMessage('Title cannot be empty')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    if (video.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'You don\'t have permission to rename this video' });
    }
    await Video.update(req.params.id, { title: req.body.title });
    res.json({ success: true, message: 'Video renamed successfully' });
  } catch (error) {
    console.error('Error renaming video:', error);
    res.status(500).json({ error: 'Failed to rename video' });
  }
});

// --- Gallery Bulk Actions API ---

app.post('/api/gallery/bulk-delete', isAuthenticated, async (req, res) => {
  try {
    const { ids, type } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No items selected' });
    }

    let deletedCount = 0;
    const Model = type === 'image' ? Thumbnail : Video;

    for (const id of ids) {
      try {
        const item = await Model.findById(id);
        if (item && item.user_id === req.session.userId) {
          // Delete file(s)
          if (type === 'image') {
            const filePath = path.join(__dirname, 'public', item.filepath);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            await Thumbnail.delete(id);
          } else {
            const videoPath = path.join(__dirname, 'public', item.filepath);
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (item.thumbnail_path && !item.thumbnail_path.includes('default')) {
              const thumbPath = path.join(__dirname, 'public', item.thumbnail_path);
              if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
            }
            await Video.delete(id, req.session.userId);
          }
          deletedCount++;
        }
      } catch (err) {
        console.error(`Error deleting item ${id}:`, err);
      }
    }

    res.json({ success: true, deleted: deletedCount });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete items' });
  }
});

app.post('/api/gallery/bulk-download', isAuthenticated, async (req, res) => {
  try {
    const { ids, type } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No items selected' });
    }

    // We generate a temp token and store the request in the session
    const downloadToken = uuidv4();
    if (!req.session.pendingDownloads) req.session.pendingDownloads = {};
    req.session.pendingDownloads[downloadToken] = { ids, type, timestamp: Date.now() };

    res.json({
      success: true,
      downloadUrl: `/api/gallery/bulk-download/serve/${downloadToken}`
    });
  } catch (error) {
    console.error('Bulk download init error:', error);
    res.status(500).json({ success: false, error: 'Failed to prepare download' });
  }
});

app.get('/api/gallery/bulk-download/serve/:token', isAuthenticated, async (req, res) => {
  try {
    const token = req.params.token;
    const pending = req.session.pendingDownloads ? req.session.pendingDownloads[token] : null;

    if (!pending) {
      return res.status(404).send('Download session expired or not found');
    }

    // Cleanup session to prevent reuse/bloat
    delete req.session.pendingDownloads[token];

    const { ids, type } = pending;
    const Model = type === 'image' ? Thumbnail : Video;
    const items = [];

    for (const id of ids) {
      const item = await Model.findById(id);
      if (item && item.user_id === req.session.userId) {
        items.push(item);
      }
    }

    if (items.length === 0) {
      return res.status(404).send('No valid files found for download');
    }

    // Setup ZIP streaming
    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipName = `neostream_bulk_${type}_${new Date().getTime()}.zip`;

    res.attachment(zipName);
    archive.pipe(res);

    for (const item of items) {
      const filePath = path.join(__dirname, 'public', item.filepath);
      if (fs.existsSync(filePath)) {
        // Use filename or title for entry name
        const entryName = (item.title || item.filename) + path.extname(item.filepath);
        archive.file(filePath, { name: entryName });
      }
    }

    archive.finalize();

  } catch (error) {
    console.error('Bulk download serving error:', error);
    res.status(500).send('Error generating download');
  }
});

app.get('/api/gallery/download/:type/:id', isAuthenticated, async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = type === 'image' ? Thumbnail : Video;
    const item = await Model.findById(id);

    if (!item || item.user_id !== req.session.userId) {
      return res.status(403).send('Not authorized');
    }

    const filePath = path.join(__dirname, 'public', item.filepath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    const downloadName = (item.title || item.filename) + path.extname(item.filepath);
    res.download(filePath, downloadName);
  } catch (error) {
    console.error('Single download error:', error);
    res.status(500).send('Error downloading file');
  }
});
app.get('/stream/:videoId', isAuthenticated, async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).send('Video not found');
    }
    if (video.user_id !== req.session.userId) {
      return res.status(403).send('You do not have permission to access this video');
    }
    const videoPath = path.join(__dirname, 'public', video.filepath);
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).send('Error streaming video');
  }
});
app.get('/api/settings/gdrive-status', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    res.json({
      hasApiKey: !!user.gdrive_api_key,
      message: user.gdrive_api_key ? 'Google Drive API key is configured' : 'No Google Drive API key found'
    });
  } catch (error) {
    console.error('Error checking Google Drive API status:', error);
    res.status(500).json({ error: 'Failed to check API key status' });
  }
});
app.post('/api/settings/gdrive-api-key', isAuthenticated, [
  body('apiKey').notEmpty().withMessage('API Key is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg
      });
    }
    await User.update(req.session.userId, {
      gdrive_api_key: req.body.apiKey
    });
    return res.json({
      success: true,
      message: 'Google Drive API key saved successfully!'
    });
  } catch (error) {
    console.error('Error saving Google Drive API key:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving your Google Drive API key'
    });
  }
});

app.post('/api/settings/youtube-credentials', isAuthenticated, [
  body('clientId').notEmpty().withMessage('Client ID is required'),
  body('clientSecret').notEmpty().withMessage('Client Secret is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg
      });
    }

    const { clientId, clientSecret } = req.body;

    const encryptedSecret = encrypt(clientSecret);

    await User.update(req.session.userId, {
      youtube_client_id: clientId,
      youtube_client_secret: encryptedSecret
    });

    return res.json({
      success: true,
      message: 'YouTube API credentials saved successfully!'
    });
  } catch (error) {
    console.error('Error saving YouTube credentials:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving your YouTube credentials'
    });
  }
});

app.get('/api/settings/youtube-status', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    const hasCredentials = !!(user.youtube_client_id && user.youtube_client_secret);
    const isConnected = !!(user.youtube_access_token && user.youtube_refresh_token);

    res.json({
      success: true,
      hasCredentials,
      isConnected,
      channelName: user.youtube_channel_name || null,
      channelId: user.youtube_channel_id || null
    });
  } catch (error) {
    console.error('Error checking YouTube status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check YouTube status'
    });
  }
});

// Settings Page Route
app.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const YoutubeChannel = require('./models/YoutubeChannel');
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);

    const hasYoutubeCredentials = !!(user.youtube_client_id && user.youtube_client_secret);

    // Decrypt credentials for display (show masked if exists)
    let youtubeClientId = '';
    let youtubeClientSecret = '';

    if (hasYoutubeCredentials) {
      youtubeClientId = user.youtube_client_id;
      // Show masked secret
      youtubeClientSecret = '••••••••••••••••';
    }

    res.render('settings', {
      title: 'Settings',
      user,
      youtubeChannels,
      hasYoutubeCredentials,
      youtubeClientId,
      youtubeClientSecret,
      activeTab: req.query.tab || 'profile',
      active: 'settings'
    });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).send('Error loading settings page');
  }
});

app.post('/api/settings/youtube-disconnect', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    await YoutubeChannel.deleteAll(req.session.userId);

    return res.json({
      success: true,
      message: 'All YouTube channels disconnected successfully'
    });
  } catch (error) {
    console.error('Error disconnecting YouTube:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect YouTube accounts'
    });
  }
});

app.post('/api/settings/recaptcha', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (user.user_role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only admin can manage reCAPTCHA settings'
      });
    }

    const { siteKey, secretKey, enabled } = req.body;

    if (!siteKey) {
      return res.status(400).json({
        success: false,
        error: 'Site Key is required'
      });
    }

    const AppSettings = require('./models/AppSettings');
    const existingSettings = await AppSettings.getRecaptchaSettings();

    if (secretKey) {
      const axios = require('axios');
      const verifyResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        `secret=${encodeURIComponent(secretKey)}&response=test`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const verifyData = verifyResponse.data;

      if (verifyData['error-codes'] && verifyData['error-codes'].includes('invalid-input-secret')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid reCAPTCHA Secret Key. Please check your credentials.'
        });
      }

      const encryptedSecretKey = encrypt(secretKey);
      await AppSettings.setRecaptchaSettings(siteKey, encryptedSecretKey, enabled);
    } else if (existingSettings.hasKeys) {
      await AppSettings.set('recaptcha_site_key', siteKey);
      await AppSettings.set('recaptcha_enabled', enabled ? '1' : '0');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Secret Key is required'
      });
    }

    return res.json({
      success: true,
      message: 'reCAPTCHA settings saved successfully!'
    });
  } catch (error) {
    console.error('Error saving reCAPTCHA settings:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving reCAPTCHA settings'
    });
  }
});

app.post('/api/settings/recaptcha/toggle', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (user.user_role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only admin can manage reCAPTCHA settings'
      });
    }

    const { enabled } = req.body;
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();

    if (!recaptchaSettings.hasKeys) {
      return res.status(400).json({
        success: false,
        error: 'Please save reCAPTCHA keys first before enabling'
      });
    }

    await AppSettings.set('recaptcha_enabled', enabled ? '1' : '0');

    return res.json({
      success: true,
      message: enabled ? 'reCAPTCHA enabled' : 'reCAPTCHA disabled'
    });
  } catch (error) {
    console.error('Error toggling reCAPTCHA:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reCAPTCHA status'
    });
  }
});


app.delete('/api/settings/recaptcha', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (user.user_role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only admin can manage reCAPTCHA settings'
      });
    }

    const AppSettings = require('./models/AppSettings');
    await AppSettings.deleteRecaptchaSettings();

    return res.json({
      success: true,
      message: 'reCAPTCHA keys removed successfully'
    });
  } catch (error) {
    console.error('Error removing reCAPTCHA keys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove reCAPTCHA keys'
    });
  }
});

app.post('/api/settings/youtube-credentials', isAuthenticated, async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'Client ID is required' });
    }

    // Only update secret if provided and not masked
    const updateData = { youtube_client_id: clientId };
    if (clientSecret && clientSecret !== '••••••••••••••••') {
      updateData.youtube_client_secret = encrypt(clientSecret);
    }

    await User.update(req.session.userId, updateData);

    res.json({
      success: true,
      message: 'YouTube credentials saved successfully'
    });
  } catch (error) {
    console.error('Error saving YouTube credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save YouTube credentials'
    });
  }
});


app.get('/api/settings/youtube-channels', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channels = await YoutubeChannel.findAll(req.session.userId);
    res.json({ success: true, channels });
  } catch (error) {
    console.error('Error fetching YouTube channels:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch channels' });
  }
});

app.post('/api/settings/youtube-channel/:id/default', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    await YoutubeChannel.setDefault(req.session.userId, req.params.id);
    res.json({ success: true, message: 'Default channel updated' });
  } catch (error) {
    console.error('Error setting default channel:', error);
    res.status(500).json({ success: false, error: 'Failed to set default channel' });
  }
});

// Edit Channel API
app.put('/api/channels/:id', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const { channel_name, slug, description, channel_color } = req.body;

    const channel = await YoutubeChannel.findById(req.params.id);
    if (!channel || channel.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    await YoutubeChannel.update(req.params.id, {
      channel_name,
      slug,
      description,
      channel_color
    });

    res.json({ success: true, message: 'Channel updated successfully' });
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/settings/youtube-channel/:id', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(req.params.id);

    if (!channel || channel.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    await YoutubeChannel.delete(req.params.id, req.session.userId);

    if (channel.is_default) {
      const channels = await YoutubeChannel.findAll(req.session.userId);
      if (channels.length > 0) {
        await YoutubeChannel.setDefault(req.session.userId, channels[0].id);
      }
    }

    res.json({ success: true, message: 'Channel disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting channel:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect channel' });
  }
});

app.post('/api/channels/:id/sync', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(req.params.id);
    if (!channel || channel.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Channel tidak ditemukan' });
    }

    const user = await User.findById(req.session.userId);

    // Validate YouTube API credentials
    if (!user.youtube_client_id || !user.youtube_client_secret) {
      return res.status(400).json({
        success: false,
        error: 'Kredensial YouTube API belum dikonfigurasi. Silakan setup di halaman Settings.'
      });
    }

    if (!channel.access_token || !channel.refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'Channel belum terhubung dengan YouTube. Silakan reconnect channel.'
      });
    }

    const clientSecret = decrypt(user.youtube_client_secret);
    if (!clientSecret) {
      return res.status(500).json({
        success: false,
        error: 'Gagal decrypt YouTube client secret'
      });
    }

    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, user.youtube_redirect_uri);

    const accessToken = decrypt(channel.access_token);
    const refreshToken = decrypt(channel.refresh_token);

    if (!accessToken) {
      return res.status(500).json({
        success: false,
        error: 'Gagal decrypt access token'
      });
    }

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
      part: 'statistics,snippet,contentDetails',
      id: channel.channel_id
    });

    if (response.data.items && response.data.items.length > 0) {
      const ytData = response.data.items[0];
      const stats = ytData.statistics;
      const uploadsPlaylistId = ytData.contentDetails.relatedPlaylists.uploads;

      await YoutubeChannel.update(channel.id, {
        subscriber_count: stats.subscriberCount,
        video_count: stats.videoCount,
        channel_name: ytData.snippet.title,
        channel_thumbnail: ytData.snippet.thumbnails.high ? ytData.snippet.thumbnails.high.url : ytData.snippet.thumbnails.default.url
      });

      // Fetch videos from uploads playlist
      let videosSynced = 0;
      try {
        const playlistResponse = await youtube.playlistItems.list({
          part: 'snippet,contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: 50 // Pull latest 50 videos
        });

        if (playlistResponse.data.items) {
          const Video = require('./models/Video');
          for (const item of playlistResponse.data.items) {
            const ytVideoId = item.contentDetails.videoId;
            const title = item.snippet.title;
            const thumbnail = item.snippet.thumbnails.high ? item.snippet.thumbnails.high.url : item.snippet.thumbnails.default.url;

            // Check if video already exists
            const existingVideos = await Video.findAll(req.session.userId, channel.id);
            const exists = existingVideos.some(v => v.youtube_video_id === ytVideoId || (v.title === title && !v.youtube_video_id));

            if (!exists) {
              await Video.create({
                title: title,
                filepath: `https://www.youtube.com/watch?v=${ytVideoId}`, // Store URL as filepath for external videos
                thumbnail_path: thumbnail,
                user_id: req.session.userId,
                youtube_channel_id: channel.id,
                youtube_video_id: ytVideoId,
                format: 'youtube',
                duration: 0 // Will be updated if we fetch video details later
              });
              videosSynced++;
            }
          }
        }
      } catch (videoError) {
        console.error('Error syncing videos:', videoError);
      }

      res.json({
        success: true,
        message: `Statistik channel disinkronkan. ${videosSynced} video baru ditambahkan.`,
        stats: {
          subscribers: stats.subscriberCount,
          videos: stats.videoCount,
          newVideos: videosSynced
        }
      });
    } else {
      res.status(404).json({ success: false, error: 'Data channel tidak ditemukan di YouTube' });
    }
  } catch (error) {
    console.error('Sync channel error:', error);
    res.status(500).json({ success: false, error: error.message || 'Terjadi kesalahan saat sinkronisasi' });
  }
});

// Stream Key Management APIs

app.get('/api/channels/:id/keys', isAuthenticated, async (req, res) => {
  try {
    const keys = await YoutubeStreamKey.findAll(req.session.userId, req.params.id);
    res.json({ success: true, keys });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/channels/:id/keys/bulk', isAuthenticated, async (req, res) => {
  try {
    const { prefix, count } = req.body;
    const channelId = req.params.id;

    // Validate input
    if (!prefix || !count || count < 1 || count > 200) {
      return res.status(400).json({ success: false, error: 'Invalid input' });
    }

    // Get channel and validate
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(channelId);
    if (!channel || channel.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Channel tidak ditemukan' });
    }

    // Get user and setup YouTube API
    const user = await User.findById(req.session.userId);
    if (!user.youtube_client_id || !user.youtube_client_secret) {
      return res.status(400).json({ success: false, error: 'Kredensial YouTube API belum dikonfigurasi' });
    }
    if (!channel.access_token || !channel.refresh_token) {
      return res.status(400).json({ success: false, error: 'Channel belum terhubung dengan YouTube' });
    }

    const clientSecret = decrypt(user.youtube_client_secret);
    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, user.youtube_redirect_uri);
    const accessToken = decrypt(channel.access_token);
    const refreshToken = decrypt(channel.refresh_token);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Create keys via YouTube API
    const createdKeys = [];
    const errors = [];

    for (let i = 1; i <= count; i++) {
      try {
        const keyName = `${prefix}-${String(i).padStart(3, '0')}`;
        const response = await youtube.liveStreams.insert({
          part: 'snippet,cdn,id',
          requestBody: {
            snippet: { title: keyName },
            cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' }
          }
        });

        createdKeys.push({
          name: keyName,
          stream_key: response.data.cdn.ingestionInfo.streamName,
          youtube_stream_id: response.data.id
        });

        if (i < count) await new Promise(r => setTimeout(r, 100));
      } catch (error) {
        errors.push({ index: i, name: `${prefix}-${String(i).padStart(3, '0')}`, error: error.message });
      }
    }

    // Save to database
    if (createdKeys.length > 0) {
      await YoutubeStreamKey.bulkCreate(createdKeys, req.session.userId, channelId);
    }
    res.json({ success: true, created: createdKeys.length, failed: errors.length, message: `Berhasil membuat ${createdKeys.length} stream keys di YouTube Studio${errors.length > 0 ? ` (${errors.length} gagal)` : ''}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/channels/:id/keys/sync', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(req.params.id);
    if (!channel || channel.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Channel tidak ditemukan' });
    }

    const user = await User.findById(req.session.userId);

    // Validate YouTube API credentials
    if (!user.youtube_client_id || !user.youtube_client_secret) {
      return res.status(400).json({
        success: false,
        error: 'Kredensial YouTube API belum dikonfigurasi. Silakan setup di halaman Settings.'
      });
    }

    if (!channel.access_token || !channel.refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'Channel belum terhubung dengan YouTube. Silakan reconnect channel.'
      });
    }

    const clientSecret = decrypt(user.youtube_client_secret);
    if (!clientSecret) {
      return res.status(500).json({
        success: false,
        error: 'Gagal decrypt YouTube client secret'
      });
    }

    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, user.youtube_redirect_uri);

    const accessToken = decrypt(channel.access_token);
    const refreshToken = decrypt(channel.refresh_token);

    if (!accessToken) {
      return res.status(500).json({
        success: false,
        error: 'Gagal decrypt access token'
      });
    }

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Fetch ALL stream keys from YouTube using pagination
    let allYtKeys = [];
    let pageToken = null;

    do {
      const response = await youtube.liveStreams.list({
        part: 'snippet,cdn,id',
        mine: true,
        maxResults: 50,
        pageToken: pageToken
      });

      allYtKeys = allYtKeys.concat(response.data.items || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    if (allYtKeys.length === 0) {
      return res.json({
        success: true,
        message: 'Tidak ada stream key ditemukan di YouTube. Buat stream key terlebih dahulu di YouTube Studio.',
        keys: []
      });
    }

    // Get existing keys from database to check for duplicates
    const existingKeys = await YoutubeStreamKey.findAll(req.session.userId, channel.id);
    const existingStreamIds = new Set(existingKeys.map(k => k.youtube_stream_id).filter(Boolean));
    const existingStreamKeys = new Set(existingKeys.map(k => k.stream_key).filter(Boolean));

    // Filter out keys that already exist
    const newKeysToSave = allYtKeys
      .filter(item => {
        const streamId = item.id;
        const streamKey = item.cdn.ingestionInfo.streamName;
        return !existingStreamIds.has(streamId) && !existingStreamKeys.has(streamKey);
      })
      .map(item => ({
        name: item.snippet.title,
        stream_key: item.cdn.ingestionInfo.streamName,
        youtube_stream_id: item.id
      }));

    // Save only new keys to database
    if (newKeysToSave.length > 0) {
      await YoutubeStreamKey.bulkCreate(newKeysToSave, req.session.userId, channel.id);
    }

    res.json({
      success: true,
      message: `Berhasil sinkronkan ${newKeysToSave.length} stream keys baru dari YouTube (${allYtKeys.length} total di YouTube, ${existingKeys.length} sudah ada)`
    });
  } catch (error) {
    console.error('Sync keys error:', error);

    // Handle specific YouTube API errors
    if (error.code === 401 || error.code === 403) {
      return res.status(401).json({
        success: false,
        error: 'Akses ditolak. Token YouTube mungkin kadaluarsa. Silakan reconnect channel.'
      });
    }

    res.status(500).json({ success: false, error: error.message || 'Terjadi kesalahan saat sinkronisasi stream keys' });
  }
});

app.delete('/api/channels/:channelId/keys/:keyId', isAuthenticated, async (req, res) => {
  try {
    await YoutubeStreamKey.delete(req.params.keyId, req.session.userId);
    res.json({ success: true, message: 'Key deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function getYouTubeOAuth2Client(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

app.get('/auth/youtube', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    if (!user.youtube_client_id || !user.youtube_client_secret) {
      return res.redirect('/settings?error=Please save your YouTube API credentials first&activeTab=integration');
    }

    const clientSecret = decrypt(user.youtube_client_secret);
    if (!clientSecret) {
      return res.redirect('/settings?error=Failed to decrypt credentials&activeTab=integration');
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/auth/youtube/callback`;

    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, redirectUri);

    const scopes = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/yt-analytics.readonly'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: req.session.userId
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('YouTube OAuth error:', error);
    res.redirect('/settings?error=Failed to initiate YouTube authentication&activeTab=integration');
  }
});

app.get('/auth/youtube/callback', isAuthenticated, async (req, res) => {
  try {
    const { code, error, state } = req.query;

    if (error) {
      console.error('YouTube OAuth error:', error);
      return res.redirect(`/settings?error=${encodeURIComponent(error)}&activeTab=integration`);
    }

    if (!code) {
      return res.redirect('/settings?error=No authorization code received&activeTab=integration');
    }

    const user = await User.findById(req.session.userId);

    if (!user.youtube_client_id || !user.youtube_client_secret) {
      return res.redirect('/settings?error=YouTube credentials not found&activeTab=integration');
    }

    const clientSecret = decrypt(user.youtube_client_secret);
    if (!clientSecret) {
      return res.redirect('/settings?error=Failed to decrypt credentials&activeTab=integration');
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/auth/youtube/callback`;

    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, redirectUri);

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      return res.redirect('/settings?error=No YouTube channel found for this account&activeTab=integration');
    }

    const channel = channelResponse.data.items[0];
    const channelId = channel.id;
    const channelName = channel.snippet.title;
    const channelThumbnail = channel.snippet.thumbnails?.default?.url || channel.snippet.thumbnails?.medium?.url || '';
    const subscriberCount = channel.statistics?.subscriberCount || '0';

    const YoutubeChannel = require('./models/YoutubeChannel');
    const existingChannel = await YoutubeChannel.findByChannelId(req.session.userId, channelId);

    if (existingChannel) {
      await YoutubeChannel.update(existingChannel.id, {
        access_token: encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : existingChannel.refresh_token,
        channel_name: channelName,
        channel_thumbnail: channelThumbnail,
        subscriber_count: subscriberCount
      });
    } else {
      await YoutubeChannel.create({
        user_id: req.session.userId,
        channel_id: channelId,
        channel_name: channelName,
        channel_thumbnail: channelThumbnail,
        subscriber_count: subscriberCount,
        access_token: encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null
      });
    }

    await User.update(req.session.userId, {
      youtube_redirect_uri: redirectUri
    });

    res.redirect('/settings?success=YouTube channel connected successfully&activeTab=integration');
  } catch (error) {
    console.error('YouTube OAuth callback error:', error);
    const errorMessage = error.message || 'Failed to connect YouTube account';
    res.redirect(`/settings?error=${encodeURIComponent(errorMessage)}&activeTab=integration`);
  }
});

app.post('/api/videos/import-drive', isAuthenticated, [
  body('driveUrl').notEmpty().withMessage('Google Drive URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { driveUrl, youtube_channel_id } = req.body;
    const { extractFileId, downloadFile } = require('./utils/googleDriveService');
    try {
      const fileId = extractFileId(driveUrl);
      const jobId = uuidv4();
      processGoogleDriveImport(jobId, fileId, req.session.userId, youtube_channel_id)
        .catch(err => console.error('Drive import failed:', err));
      return res.json({
        success: true,
        message: 'Video import started',
        jobId: jobId
      });
    } catch (error) {
      console.error('Google Drive URL parsing error:', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid Google Drive URL format'
      });
    }
  } catch (error) {
    console.error('Error importing from Google Drive:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});
app.get('/api/videos/import-status/:jobId', isAuthenticated, async (req, res) => {
  const jobId = req.params.jobId;
  if (!importJobs[jobId]) {
    return res.status(404).json({ success: false, error: 'Import job not found' });
  }
  return res.json({
    success: true,
    status: importJobs[jobId]
  });
});
const importJobs = {};
async function processGoogleDriveImport(jobId, fileId, userId, channelId = null) {
  const { downloadFile } = require('./utils/googleDriveService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');

  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };

  try {
    let result;
    try {
      result = await downloadFile(fileId, (progress) => {
        importJobs[jobId] = {
          status: 'downloading',
          progress: progress.progress,
          message: `Downloading ${progress.filename}: ${progress.progress}%`
        };
      });
    } catch (downloadError) {
      importJobs[jobId] = {
        status: 'failed',
        progress: 0,
        message: downloadError.message || 'Failed to download file'
      };
      setTimeout(() => { delete importJobs[jobId]; }, 5 * 60 * 1000);
      return;
    }

    if (!result || !result.localFilePath) {
      importJobs[jobId] = {
        status: 'failed',
        progress: 0,
        message: 'Download completed but file path is missing'
      };
      setTimeout(() => { delete importJobs[jobId]; }, 5 * 60 * 1000);
      return;
    }

    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };

    let videoInfo;
    try {
      videoInfo = await getVideoInfo(result.localFilePath);
    } catch (infoError) {
      videoInfo = { duration: 0 };
    }

    let resolution = '';
    let bitrate = null;

    try {
      const metadata = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ffprobe timeout')), 30000);
        ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
          clearTimeout(timeout);
          if (err) return reject(err);
          resolve(metadata);
        });
      });

      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (videoStream) {
        resolution = `${videoStream.width}x${videoStream.height}`;
      }

      if (metadata.format && metadata.format.bit_rate) {
        bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
      }
    } catch (probeError) {
      console.log('ffprobe error (non-fatal):', probeError.message);
    }

    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    let thumbnailRelativePath = null;

    try {
      await generateThumbnail(result.localFilePath, thumbnailName);
      thumbnailRelativePath = `/uploads/thumbnails/${thumbnailName}`;
    } catch (thumbError) {
      console.log('Thumbnail generation failed (non-fatal):', thumbError.message);
    }

    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';

    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration || 0,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      youtube_channel_id: channelId
    };

    const video = await Video.create(videoData);

    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing Google Drive import:', error.message);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.post('/api/videos/import-mediafire', isAuthenticated, [
  body('mediafireUrl').notEmpty().withMessage('Mediafire URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { mediafireUrl, youtube_channel_id } = req.body;
    const { extractFileKey } = require('./utils/mediafireService');
    try {
      const fileKey = extractFileKey(mediafireUrl);
      const jobId = uuidv4();
      processMediafireImport(jobId, fileKey, req.session.userId, youtube_channel_id)
        .catch(err => console.error('Mediafire import failed:', err));
      return res.json({
        success: true,
        message: 'Video import started',
        jobId: jobId
      });
    } catch (error) {
      console.error('Mediafire URL parsing error:', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid Mediafire URL format'
      });
    }
  } catch (error) {
    console.error('Error importing from Mediafire:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});

async function processMediafireImport(jobId, fileKey, userId, channelId = null) {
  const { downloadFile } = require('./utils/mediafireService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');

  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };

  try {
    const result = await downloadFile(fileKey, (progress) => {
      importJobs[jobId] = {
        status: 'downloading',
        progress: progress.progress,
        message: `Downloading ${progress.filename}: ${progress.progress}%`
      };
    });

    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };

    const videoInfo = await getVideoInfo(result.localFilePath);

    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });

    let resolution = '';
    let bitrate = null;

    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      resolution = `${videoStream.width}x${videoStream.height}`;
    }

    if (metadata.format && metadata.format.bit_rate) {
      bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
    }

    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    const thumbnailRelativePath = await generateThumbnail(result.localFilePath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);

    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';

    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      youtube_channel_id: channelId
    };

    const video = await Video.create(videoData);

    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing Mediafire import:', error);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.post('/api/videos/import-dropbox', isAuthenticated, [
  body('dropboxUrl').notEmpty().withMessage('Dropbox URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { dropboxUrl, youtube_channel_id } = req.body;
    if (!dropboxUrl.includes('dropbox.com')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Dropbox URL format'
      });
    }
    const jobId = uuidv4();
    processDropboxImport(jobId, dropboxUrl, req.session.userId, youtube_channel_id)
      .catch(err => console.error('Dropbox import failed:', err));
    return res.json({
      success: true,
      message: 'Video import started',
      jobId: jobId
    });
  } catch (error) {
    console.error('Error importing from Dropbox:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});

async function processDropboxImport(jobId, dropboxUrl, userId, channelId = null) {
  const { downloadFile } = require('./utils/dropboxService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');

  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };

  try {
    const result = await downloadFile(dropboxUrl, (progress) => {
      importJobs[jobId] = {
        status: 'downloading',
        progress: progress.progress,
        message: `Downloading ${progress.filename}: ${progress.progress}%`
      };
    });

    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };

    const videoInfo = await getVideoInfo(result.localFilePath);

    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });

    let resolution = '';
    let bitrate = null;

    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      resolution = `${videoStream.width}x${videoStream.height}`;
    }

    if (metadata.format && metadata.format.bit_rate) {
      bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
    }

    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    const thumbnailRelativePath = await generateThumbnail(result.localFilePath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);

    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';

    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      youtube_channel_id: channelId
    };

    const video = await Video.create(videoData);

    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing Dropbox import:', error);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.post('/api/videos/import-mega', isAuthenticated, [
  body('megaUrl').notEmpty().withMessage('MEGA URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { megaUrl, youtube_channel_id } = req.body;
    if (!megaUrl.includes('mega.nz') && !megaUrl.includes('mega.co.nz')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid MEGA URL format'
      });
    }
    const jobId = uuidv4();
    processMegaImport(jobId, megaUrl, req.session.userId, youtube_channel_id)
      .catch(err => console.error('MEGA import failed:', err));
    return res.json({
      success: true,
      message: 'Video import started',
      jobId: jobId
    });
  } catch (error) {
    console.error('Error importing from MEGA:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});

async function processMegaImport(jobId, megaUrl, userId, channelId = null) {
  const { downloadFile } = require('./utils/megaService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');

  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };

  try {
    const result = await downloadFile(megaUrl, (progress) => {
      importJobs[jobId] = {
        status: 'downloading',
        progress: progress.progress,
        message: `Downloading ${progress.filename}: ${progress.progress}%`
      };
    });

    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };

    const videoInfo = await getVideoInfo(result.localFilePath);

    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });

    let resolution = '';
    let bitrate = null;

    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      resolution = `${videoStream.width}x${videoStream.height}`;
    }

    if (metadata.format && metadata.format.bit_rate) {
      bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
    }

    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    const thumbnailRelativePath = await generateThumbnail(result.localFilePath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);

    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';

    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      youtube_channel_id: channelId
    };

    const video = await Video.create(videoData);

    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing MEGA import:', error);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.get('/api/stream/videos', isAuthenticated, async (req, res) => {
  try {
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const formattedVideos = videos.map(video => {
      const duration = video.duration ? Math.floor(video.duration) : 0;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      return {
        id: video.id,
        name: video.title,
        thumbnail: video.thumbnail_path,
        resolution: video.resolution || '1280x720',
        duration: formattedDuration,
        url: `/stream/${video.id}`,
        type: 'video'
      };
    });
    res.json(formattedVideos);
  } catch (error) {
    console.error('Error fetching videos for stream:', error);
    res.status(500).json({ error: 'Failed to load videos' });
  }
});

app.get('/api/stream/content', isAuthenticated, async (req, res) => {
  try {
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const formattedVideos = videos.map(video => {
      const duration = video.duration ? Math.floor(video.duration) : 0;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      return {
        id: video.id,
        name: video.title,
        thumbnail: video.thumbnail_path,
        resolution: video.resolution || '1280x720',
        duration: formattedDuration,
        url: `/stream/${video.id}`,
        type: 'video'
      };
    });

    const playlists = await Playlist.findAll(req.session.userId);
    const formattedPlaylists = playlists.map(playlist => {
      return {
        id: playlist.id,
        name: playlist.name,
        thumbnail: '/images/playlist-thumbnail.svg',
        resolution: 'Playlist',
        duration: `${playlist.video_count || 0} videos`,
        videoCount: playlist.video_count || 0,
        audioCount: playlist.audio_count || 0,
        url: `/playlist/${playlist.id}`,
        type: 'playlist',
        description: playlist.description,
        is_shuffle: playlist.is_shuffle
      };
    });

    const allContent = [...formattedPlaylists, ...formattedVideos];

    res.json(allContent);
  } catch (error) {
    console.error('Error fetching content for stream:', error);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

app.get('/api/streams', isAuthenticated, async (req, res) => {
  try {
    const filter = req.query.filter;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    if (req.query.page || req.query.limit) {
      const result = await Stream.findAllPaginated(req.session.userId, {
        page,
        limit,
        filter,
        search
      });
      res.json({ success: true, ...result });
    } else {
      const streams = await Stream.findAll(req.session.userId, filter);
      res.json({ success: true, streams });
    }
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch streams' });
  }
});
app.post('/api/streams', isAuthenticated, [
  body('title').trim().isLength({ min: 1 }).withMessage('Title is required'),
  body('rtmpUrl').trim().isLength({ min: 1 }).withMessage('RTMP URL is required')
], async (req, res) => {
  try {
    console.log('Session userId for stream creation:', req.session.userId);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    let platform = 'Custom';
    let platform_icon = 'ti-broadcast';
    if (req.body.rtmpUrl.includes('youtube.com')) {
      platform = 'YouTube';
      platform_icon = 'ti-brand-youtube';
    } else if (req.body.rtmpUrl.includes('facebook.com')) {
      platform = 'Facebook';
      platform_icon = 'ti-brand-facebook';
    } else if (req.body.rtmpUrl.includes('twitch.tv')) {
      platform = 'Twitch';
      platform_icon = 'ti-brand-twitch';
    } else if (req.body.rtmpUrl.includes('tiktok.com')) {
      platform = 'TikTok';
      platform_icon = 'ti-brand-tiktok';
    } else if (req.body.rtmpUrl.includes('instagram.com')) {
      platform = 'Instagram';
      platform_icon = 'ti-brand-instagram';
    } else if (req.body.rtmpUrl.includes('shopee.io')) {
      platform = 'Shopee Live';
      platform_icon = 'ti-brand-shopee';
    } else if (req.body.rtmpUrl.includes('restream.io')) {
      platform = 'Restream.io';
      platform_icon = 'ti-live-photo';
    }
    const streamData = {
      title: req.body.title,
      video_id: req.body.videoId || req.body.playlistId || null,
      rtmp_url: req.body.rtmpUrl || '',
      stream_key: req.body.streamKey || 'PENDING',
      platform,
      platform_icon,
      youtube_channel_id: req.body.channelId || null,
      bitrate: parseInt(req.body.bitrate) || 2500,
      resolution: req.body.resolution || '1280x720',
      fps: parseInt(req.body.fps) || 30,
      orientation: req.body.orientation || 'horizontal',
      loop_video: req.body.loopVideo === 'true' || req.body.loopVideo === true,
      use_advanced_settings: req.body.useAdvancedSettings === 'true' || req.body.useAdvancedSettings === true,
      user_id: req.session.userId,
      is_youtube_api: platform === 'YouTube' ? 1 : 0
    };
    const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function parseLocalDateTime(dateTimeString) {
      if (!dateTimeString) return null;
      // If it's already an ISO string with timezone info, return it directly
      if (dateTimeString.includes('Z') || (dateTimeString.includes('+') && dateTimeString.includes(':'))) {
        const d = new Date(dateTimeString);
        if (!isNaN(d.getTime())) return d;
      }

      // Legacy datetime-local format: YYYY-MM-DDTHH:mm
      // This will use the server's local time unless we shift it in frontend
      const [datePart, timePart] = dateTimeString.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);

      return new Date(year, month - 1, day, hours, minutes);
    }

    if (req.body.scheduleStartTime) {
      const scheduleStartDate = parseLocalDateTime(req.body.scheduleStartTime);
      streamData.schedule_time = scheduleStartDate.toISOString();
      streamData.status = 'scheduled';

      if (req.body.scheduleEndTime) {
        const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);

        if (scheduleEndDate <= scheduleStartDate) {
          return res.status(400).json({
            success: false,
            error: 'End time must be after start time'
          });
        }

        streamData.end_time = scheduleEndDate.toISOString();
        const durationMs = scheduleEndDate - scheduleStartDate;
        // Simpan durasi dalam DETIK agar konsisten dengan player dan plugin
        const durationSeconds = Math.round(durationMs / 1000);
        streamData.duration = durationSeconds > 0 ? durationSeconds : null;
      }
    } else if (req.body.scheduleEndTime) {
      const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
      streamData.end_time = scheduleEndDate.toISOString();
    }

    if (!streamData.status) {
      streamData.status = 'offline';
    }

    // --- LOGIKA SINKRONISASI YOUTUBE (MODIFIED: Lazy Creation) ---
    // Broadcast TIDAK dibuat sekarang (Just-In-Time). Hanya validasi Channel, Thumbnail & Save Metadata.
    if (streamData.platform === 'YouTube') {
      try {
        // 1. Validasi / Set Channel ID
        const YoutubeChannel = require('./models/YoutubeChannel');
        if (!streamData.youtube_channel_id) {
          const defaultChannel = await YoutubeChannel.findDefault(req.session.userId);
          if (defaultChannel) streamData.youtube_channel_id = defaultChannel.id;
          else {
            const channels = await YoutubeChannel.findAll(req.session.userId);
            if (channels && channels.length > 0) streamData.youtube_channel_id = channels[0].id;
          }
        }

        // 2. Set Thumbnail Path (jika ada thumbnailId)
        if (req.body.thumbnailId) {
          const Thumbnail = require('./models/Thumbnail');
          const thumb = await Thumbnail.findById(req.body.thumbnailId);
          if (thumb) {
            streamData.youtube_thumbnail = thumb.filepath;
            streamData.thumbnail_id = req.body.thumbnailId;
          }
        }

        // 3. SIMPAN METADATA (Description, Privacy, Tags, Category)
        // Agar saat startStream nanti, data ini tersedia untuk createYouTubeBroadcast
        streamData.youtube_description = req.body.youtube_description || '';
        streamData.youtube_privacy = req.body.youtube_privacy || 'public';
        streamData.youtube_category = req.body.youtube_category || '22'; // Default People & Blogs
        streamData.youtube_tags = req.body.tags || req.body.youtube_tags || '';

      } catch (ytError) {
        console.error('[YouTube Setup] Error saving metadata/channel:', ytError.message);
      }
    }

    const stream = await Stream.create(streamData);
    res.json({ success: true, stream });
  } catch (error) {
    console.error('Error creating stream:', error);
    res.status(500).json({ success: false, error: 'Failed to create stream' });
  }
});

app.post('/api/streams/youtube', isAuthenticated, uploadThumbnail.single('thumbnail'), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const YoutubeChannel = require('./models/YoutubeChannel');

    if (!user.youtube_client_id || !user.youtube_client_secret) {
      return res.status(400).json({
        success: false,
        error: 'YouTube API credentials not configured.'
      });
    }

    const { videoId, title, youtube_description, youtube_privacy, youtube_category, youtube_tags, loopVideo, scheduleStartTime, scheduleEndTime, repeat, ytChannelId } = req.body;

    let selectedChannel;
    if (ytChannelId) {
      selectedChannel = await YoutubeChannel.findById(ytChannelId);
      if (!selectedChannel || selectedChannel.user_id !== req.session.userId) {
        return res.status(400).json({ success: false, error: 'Invalid channel selected' });
      }
    } else {
      selectedChannel = await YoutubeChannel.findDefault(req.session.userId);
      if (!selectedChannel) {
        const channels = await YoutubeChannel.findAll(req.session.userId);
        selectedChannel = channels[0];
      }
    }

    if (!selectedChannel || !selectedChannel.access_token || !selectedChannel.refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'YouTube account not connected. Please connect your YouTube account in Settings.'
      });
    }

    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Video is required' });
    }

    if (!title) {
      return res.status(400).json({ success: false, error: 'Stream title is required' });
    }

    let localThumbnailPath = null;
    if (req.file) {
      try {
        const originalFilename = req.file.filename;
        const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;
        await generateImageThumbnail(req.file.path, thumbFilename);
        localThumbnailPath = `/uploads/thumbnails/${thumbFilename}`;
      } catch (thumbError) {
        console.log('Note: Could not process thumbnail:', thumbError.message);
      }
    }

    const streamData = {
      title: title,
      video_id: videoId,
      rtmp_url: '',
      stream_key: '',
      platform: 'YouTube',
      platform_icon: 'ti-brand-youtube',
      bitrate: 4000,
      resolution: '1920x1080',
      fps: 30,
      orientation: 'horizontal',
      loop_video: loopVideo === 'true' || loopVideo === true,
      use_advanced_settings: false,
      user_id: req.session.userId,
      youtube_broadcast_id: null,
      youtube_stream_id: null,
      youtube_description: youtube_description || '',
      youtube_privacy: youtube_privacy || 'unlisted',
      youtube_category: youtube_category || '10',
      youtube_tags: youtube_tags || '',
      youtube_thumbnail: localThumbnailPath,
      youtube_channel_id: selectedChannel.id,
      is_youtube_api: true
    };

    if (scheduleStartTime) {
      const [datePart, timePart] = scheduleStartTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const scheduleDate = new Date(year, month - 1, day, hours, minutes);
      streamData.schedule_time = scheduleDate.toISOString();
      streamData.status = 'scheduled';
    } else {
      streamData.status = 'offline';
    }

    if (scheduleEndTime) {
      const [datePart, timePart] = scheduleEndTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const endDate = new Date(year, month - 1, day, hours, minutes);
      streamData.end_time = endDate.toISOString();
    }

    const stream = await Stream.create(streamData);

    res.json({
      success: true,
      stream,
      message: 'Stream created. YouTube broadcast will be created when stream starts.'
    });
  } catch (error) {
    console.error('Error creating YouTube stream:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create YouTube stream'
    });
  }
});

app.put('/api/streams/:id', isAuthenticated, async (req, res) => {
  try {
    const streamId = req.params.id;
    const stream = await Stream.findById(streamId);

    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }

    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const { title, scheduleStartTime, scheduleEndTime, rtmpUrl, streamKey, videoId, thumbnailId, youtube_category, youtube_privacy } = req.body;

    const updateData = {
      title,
      schedule_time: scheduleStartTime || null,
      end_time: scheduleEndTime || null,
      rtmp_url: rtmpUrl || null,
      stream_key: streamKey || null,
      video_id: videoId || null,
      thumbnail_id: thumbnailId || null,
      youtube_category: youtube_category || null,
      youtube_privacy: youtube_privacy || null
    };

    if (rtmpUrl) {
      updateData.platform = rtmpUrl.includes('youtube.com') ? 'YouTube' : 'Custom';
      updateData.is_youtube_api = updateData.platform === 'YouTube' ? 1 : 0;
    }

    if (thumbnailId) {
      const Thumbnail = require('./models/Thumbnail');
      const thumb = await Thumbnail.findById(thumbnailId);
      if (thumb) {
        updateData.youtube_thumbnail = thumb.filepath;
        updateData.thumbnail_id = thumbnailId;
      }
    }

    // Update local database
    await Stream.update(streamId, updateData);

    // Sync to YouTube if broadcast exists
    if (stream.youtube_broadcast_id) {
      try {
        const User = require('./models/User');
        const user = await User.findById(req.session.userId);

        const YoutubeService = require('./utils/youtubeService');
        const ytService = new YoutubeService(user, stream.youtube_channel_id);
        await ytService.init();

        // Update broadcast details on YouTube
        const { google } = require('googleapis');
        const finalCategoryId = youtube_category || stream.youtube_category || '10'; // Default to Music (10)
        const finalPrivacyStatus = (youtube_privacy || stream.youtube_privacy || 'public').toLowerCase();

        console.log(`[YouTube Sync Debug] Updating broadcast ${stream.youtube_broadcast_id}`);
        console.log(`[YouTube Sync Debug] CategoryId: ${finalCategoryId}, Privacy: ${finalPrivacyStatus}`);

        const broadcastUpdate = {
          id: stream.youtube_broadcast_id,
          snippet: {
            title: title || stream.title,
            scheduledStartTime: scheduleStartTime || stream.schedule_time,
            description: stream.youtube_description || '',
            categoryId: finalCategoryId
          },
          status: {
            privacyStatus: finalPrivacyStatus
          }
        };

        await ytService.youtube.liveBroadcasts.update({
          part: ['snippet', 'status'],
          requestBody: broadcastUpdate
        });

        console.log('[YouTube Update] Broadcast updated:', stream.youtube_broadcast_id);

        // Upload new thumbnail if changed
        if (thumbnailId && updateData.youtube_thumbnail) {
          await ytService.uploadThumbnail(stream.youtube_broadcast_id, updateData.youtube_thumbnail);
          console.log('[YouTube Update] Thumbnail updated for broadcast:', stream.youtube_broadcast_id);
        }
      } catch (ytError) {
        console.error('[YouTube Update] Error syncing to YouTube:', ytError.message);
        // Don't fail the update if YouTube sync fails
      }
    }

    res.json({ success: true, message: 'Stream updated successfully' });
  } catch (error) {
    console.error('Error updating stream:', error);
    res.status(500).json({ success: false, error: 'Failed to update stream' });
  }
});

app.get('/api/streams/:id', isAuthenticated, async (req, res) => {
  try {
    const stream = await Stream.getStreamWithVideo(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized to access this stream' });
    }

    if (stream.youtube_broadcast_id) {
      try {
        const user = await User.findById(req.session.userId);
        if (user.youtube_access_token && user.youtube_client_id && user.youtube_client_secret) {
          const clientSecret = decrypt(user.youtube_client_secret);
          const accessToken = decrypt(user.youtube_access_token);
          const refreshToken = decrypt(user.youtube_refresh_token);

          const protocol = req.headers['x-forwarded-proto'] || req.protocol;
          const host = req.headers['x-forwarded-host'] || req.get('host');
          const redirectUri = `${protocol}://${host}/auth/youtube/callback`;

          const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, redirectUri);
          oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

          const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: stream.youtube_broadcast_id
          });

          if (videoResponse.data.items && videoResponse.data.items.length > 0) {
            const thumbnails = videoResponse.data.items[0].snippet.thumbnails;
            stream.youtube_thumbnail = thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url;
          }
        }
      } catch (ytError) {
        console.log('Note: Could not fetch YouTube thumbnail:', ytError.message);
      }
    }

    res.json({ success: true, stream });
  } catch (error) {
    console.error('Error fetching stream:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream' });
  }
});

app.post('/api/streams/bulk-delete', isAuthenticated, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or empty IDs provided' });
    }

    console.log(`[Bulk Delete] Request to delete ${ids.length} streams by user ${req.session.userId}`);

    // 1. Fetch live streams that need stopping
    const placeholders = ids.map(() => '?').join(',');
    const findQuery = `SELECT id, status FROM streams WHERE id IN (${placeholders}) AND status = 'live'`;

    const liveStreams = await new Promise((resolve, reject) => {
      db.all(findQuery, ids, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    if (liveStreams.length > 0) {
      console.log(`[Bulk Delete] Stopping ${liveStreams.length} live streams before deletion...`);
      for (const s of liveStreams) {
        try {
          await streamingService.stopStream(s.id);
        } catch (e) {
          console.error(`[Bulk Delete] Failed to stop stream ${s.id}:`, e);
        }
      }
    }

    // 2. Perform bulk delete
    const deleteQuery = `DELETE FROM streams WHERE id IN (${placeholders}) AND user_id = ?`;
    const deleteParams = [...ids, req.session.userId];

    const changes = await new Promise((resolve, reject) => {
      db.run(deleteQuery, deleteParams, function (err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });

    console.log(`[Bulk Delete] Successfully deleted ${changes} streams.`);
    res.json({ success: true, message: `Successfully deleted ${changes} streams` });
  } catch (error) {
    console.error('[Bulk Delete] Critical Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/streams/:id', isAuthenticated, uploadThumbnail.single('thumbnail'), async (req, res) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this stream' });
    }
    const updateData = {};

    function parseScheduleDateTime(dateTimeString) {
      const [datePart, timePart] = dateTimeString.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      return new Date(year, month - 1, day, hours, minutes);
    }

    if (req.body.streamMode === 'youtube') {
      if (req.body.title) updateData.title = req.body.title;
      if (req.body.videoId || req.body.playlistId) updateData.video_id = req.body.videoId || req.body.playlistId;
      if (req.body.description !== undefined) updateData.youtube_description = req.body.description;
      if (req.body.privacy) updateData.youtube_privacy = req.body.privacy;
      if (req.body.category) updateData.youtube_category = req.body.category;
      if (req.body.tags !== undefined) updateData.youtube_tags = req.body.tags;
      if (req.body.loopVideo !== undefined) {
        updateData.loop_video = req.body.loopVideo === 'true' || req.body.loopVideo === true;
      }

      if (req.body.scheduleStartTime) {
        const scheduleStartDate = parseScheduleDateTime(req.body.scheduleStartTime);
        updateData.schedule_time = scheduleStartDate.toISOString();
        updateData.status = 'scheduled';

        if (req.body.scheduleEndTime) {
          const scheduleEndDate = parseScheduleDateTime(req.body.scheduleEndTime);
          updateData.end_time = scheduleEndDate.toISOString();
        } else if ('scheduleEndTime' in req.body && !req.body.scheduleEndTime) {
          updateData.end_time = null;
        }
      } else if ('scheduleStartTime' in req.body && !req.body.scheduleStartTime) {
        updateData.schedule_time = null;
        if ('scheduleEndTime' in req.body && !req.body.scheduleEndTime) {
          updateData.end_time = null;
        } else if (req.body.scheduleEndTime) {
          const scheduleEndDate = parseScheduleDateTime(req.body.scheduleEndTime);
          updateData.end_time = scheduleEndDate.toISOString();
        }
      }

      if (req.file) {
        try {
          const originalFilename = req.file.filename;
          const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;
          await generateImageThumbnail(req.file.path, thumbFilename);
          updateData.youtube_thumbnail = `/uploads/thumbnails/${thumbFilename}`;
        } catch (thumbError) {
          console.log('Note: Could not process thumbnail:', thumbError.message);
        }
      }

      if (stream.youtube_broadcast_id) {
        try {
          const user = await User.findById(req.session.userId);
          if (user.youtube_client_id && user.youtube_client_secret) {
            const YoutubeChannel = require('./models/YoutubeChannel');
            let selectedChannel = await YoutubeChannel.findById(stream.youtube_channel_id);
            if (!selectedChannel) {
              selectedChannel = await YoutubeChannel.findDefault(req.session.userId);
            }

            if (selectedChannel && selectedChannel.access_token) {
              const clientSecret = decrypt(user.youtube_client_secret);
              const accessToken = decrypt(selectedChannel.access_token);
              const refreshToken = decrypt(selectedChannel.refresh_token);

              const protocol = req.headers['x-forwarded-proto'] || req.protocol;
              const host = req.headers['x-forwarded-host'] || req.get('host');
              const redirectUri = `${protocol}://${host}/auth/youtube/callback`;

              const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, redirectUri);
              oauth2Client.setCredentials({
                access_token: accessToken,
                refresh_token: refreshToken
              });

              const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

              const broadcastUpdateData = {
                id: stream.youtube_broadcast_id,
                snippet: {
                  title: req.body.title || stream.title,
                  description: req.body.description !== undefined ? req.body.description : (stream.youtube_description || ''),
                  scheduledStartTime: req.body.scheduleStartTime
                    ? new Date(req.body.scheduleStartTime).toISOString()
                    : (stream.schedule_time || new Date().toISOString())
                }
              };

              const privacyUpdateData = {
                id: stream.youtube_broadcast_id,
                status: {
                  privacyStatus: req.body.privacy || stream.youtube_privacy || 'unlisted'
                }
              };

              try {
                await youtube.liveBroadcasts.update({
                  part: 'snippet',
                  requestBody: broadcastUpdateData
                });
              } catch (snippetError) {
                console.log('Note: Could not update broadcast snippet:', snippetError.message);
              }

              try {
                await youtube.liveBroadcasts.update({
                  part: 'status',
                  requestBody: privacyUpdateData
                });
              } catch (statusError) {
                console.log('Note: Could not update broadcast status:', statusError.message);
              }

              const tagsArray = req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(t => t) : [];
              if (tagsArray.length > 0 || req.body.category) {
                try {
                  await youtube.videos.update({
                    part: 'snippet',
                    requestBody: {
                      id: stream.youtube_broadcast_id,
                      snippet: {
                        title: req.body.title || stream.title,
                        description: req.body.description !== undefined ? req.body.description : (stream.youtube_description || ''),
                        categoryId: req.body.category || stream.youtube_category || '22',
                        tags: tagsArray.length > 0 ? tagsArray : undefined
                      }
                    }
                  });
                } catch (videoUpdateError) {
                  console.log('Note: Could not update video metadata:', videoUpdateError.message);
                }
              }

              if (req.file && updateData.youtube_thumbnail) {
                try {
                  const thumbnailPath = path.join(__dirname, 'public', updateData.youtube_thumbnail);
                  if (fs.existsSync(thumbnailPath)) {
                    const thumbnailStream = fs.createReadStream(thumbnailPath);
                    await youtube.thumbnails.set({
                      videoId: stream.youtube_broadcast_id,
                      media: {
                        mimeType: 'image/jpeg',
                        body: thumbnailStream
                      }
                    });
                  }
                } catch (thumbError) {
                  console.log('Note: Could not upload thumbnail to YouTube:', thumbError.message);
                }
              }
            }
          }
        } catch (youtubeError) {
          console.log('Note: Could not update YouTube metadata:', youtubeError.message);
        }
      }

      await Stream.update(req.params.id, updateData);
      return res.json({ success: true, message: 'Stream updated successfully' });
    }

    if (req.body.streamTitle) updateData.title = req.body.streamTitle;
    if (req.body.videoId) updateData.video_id = req.body.videoId;

    if (req.body.rtmpUrl) {
      updateData.rtmp_url = req.body.rtmpUrl;

      let platform = 'Custom';
      let platform_icon = 'ti-broadcast';
      if (req.body.rtmpUrl.includes('youtube.com')) {
        platform = 'YouTube';
        platform_icon = 'ti-brand-youtube';
      } else if (req.body.rtmpUrl.includes('facebook.com')) {
        platform = 'Facebook';
        platform_icon = 'ti-brand-facebook';
      } else if (req.body.rtmpUrl.includes('twitch.tv')) {
        platform = 'Twitch';
        platform_icon = 'ti-brand-twitch';
      } else if (req.body.rtmpUrl.includes('tiktok.com')) {
        platform = 'TikTok';
        platform_icon = 'ti-brand-tiktok';
      } else if (req.body.rtmpUrl.includes('instagram.com')) {
        platform = 'Instagram';
        platform_icon = 'ti-brand-instagram';
      } else if (req.body.rtmpUrl.includes('shopee.io')) {
        platform = 'Shopee Live';
        platform_icon = 'ti-brand-shopee';
      } else if (req.body.rtmpUrl.includes('restream.io')) {
        platform = 'Restream.io';
        platform_icon = 'ti-live-photo';
      }
      updateData.platform = platform;
      updateData.platform_icon = platform_icon;
      updateData.is_youtube_api = platform === 'YouTube' ? 1 : 0;
    }

    if (req.body.streamKey) updateData.stream_key = req.body.streamKey;
    if (req.body.bitrate) updateData.bitrate = parseInt(req.body.bitrate);
    if (req.body.resolution) updateData.resolution = req.body.resolution;
    if (req.body.fps) updateData.fps = parseInt(req.body.fps);
    if (req.body.orientation) updateData.orientation = req.body.orientation;
    if (req.body.loopVideo !== undefined) {
      updateData.loop_video = req.body.loopVideo === 'true' || req.body.loopVideo === true;
    }
    if (req.body.useAdvancedSettings !== undefined) {
      updateData.use_advanced_settings = req.body.useAdvancedSettings === 'true' || req.body.useAdvancedSettings === true;
    }
    const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function parseLocalDateTime(dateTimeString) {
      if (!dateTimeString) return null;
      // If it's already an ISO string with timezone info, return it directly
      if (dateTimeString.includes('Z') || (dateTimeString.includes('+') && dateTimeString.includes(':'))) {
        const d = new Date(dateTimeString);
        if (!isNaN(d.getTime())) return d;
      }

      // Legacy datetime-local format: YYYY-MM-DDTHH:mm
      // This will use the server's local time unless we shift it in frontend
      const [datePart, timePart] = dateTimeString.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);

      return new Date(year, month - 1, day, hours, minutes);
    }

    if (req.body.scheduleStartTime) {
      const scheduleStartDate = parseLocalDateTime(req.body.scheduleStartTime);
      updateData.schedule_time = scheduleStartDate.toISOString();
      updateData.status = 'scheduled';

      if (req.body.scheduleEndTime) {
        const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);

        if (scheduleEndDate <= scheduleStartDate) {
          return res.status(400).json({
            success: false,
            error: 'End time must be after start time'
          });
        }

        updateData.end_time = scheduleEndDate.toISOString();
        const durationMs = scheduleEndDate - scheduleStartDate;
        const durationSeconds = Math.round(durationMs / 1000);
        updateData.duration = durationSeconds > 0 ? durationSeconds : null;
      } else if ('scheduleEndTime' in req.body && req.body.scheduleEndTime === '') {
        updateData.end_time = null;
        updateData.duration = null;
      }
    } else if ('scheduleStartTime' in req.body && !req.body.scheduleStartTime) {
      updateData.schedule_time = null;
      updateData.status = 'offline';

      if (req.body.scheduleEndTime) {
        const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
        updateData.end_time = scheduleEndDate.toISOString();
      } else if ('scheduleEndTime' in req.body && req.body.scheduleEndTime === '') {
        updateData.end_time = null;
        updateData.duration = null;
      }
    } else if (req.body.scheduleEndTime) {
      const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
      updateData.end_time = scheduleEndDate.toISOString();
    } else if ('scheduleEndTime' in req.body && req.body.scheduleEndTime === '') {
      updateData.end_time = null;
      updateData.duration = null;
    }

    const updatedStream = await Stream.update(req.params.id, updateData);
    res.json({ success: true, stream: updatedStream });
  } catch (error) {
    console.error('Error updating stream:', error);
    res.status(500).json({ success: false, error: 'Failed to update stream' });
  }
});
app.delete('/api/streams/:id', isAuthenticated, async (req, res) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this stream' });
    }
    await Stream.delete(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Stream deleted successfully' });
  } catch (error) {
    console.error('Error deleting stream:', error);
    res.status(500).json({ success: false, error: 'Failed to delete stream' });
  }
});
app.post('/api/streams/:id/start', isAuthenticated, async (req, res) => {
  req.body.status = 'live';
  return nextStatusUpdate(req, res);
});

app.post('/api/streams/:id/stop', isAuthenticated, async (req, res) => {
  req.body.status = 'offline';
  return nextStatusUpdate(req, res);
});

async function nextStatusUpdate(req, res) {
  try {
    const streamId = req.params.id;
    const stream = await Stream.findById(streamId);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const newStatus = req.body.status;
    if (newStatus === 'live') {
      if (stream.status === 'live') {
        return res.json({ success: false, error: 'Stream is already live', stream });
      }
      if (!stream.video_id) {
        return res.json({ success: false, error: 'No video attached to this stream', stream });
      }
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${protocol}://${host}`;
      console.log(`[App] Calling streamingService.startStream for ${streamId}, is_youtube_api=${stream.is_youtube_api}`);
      const result = await streamingService.startStream(streamId, false, baseUrl);
      if (result.success) {
        const updatedStream = await Stream.getStreamWithVideo(streamId);
        return res.json({ success: true, stream: updatedStream, isAdvancedMode: result.isAdvancedMode });
      } else {
        return res.status(500).json({ success: false, error: result.error || 'Failed to start stream' });
      }
    } else if (newStatus === 'offline') {
      if (stream.status === 'live') {
        const result = await streamingService.stopStream(streamId);
        if (!result.success) console.warn('Failed to stop FFmpeg process:', result.error);
      } else if (stream.status === 'scheduled') {
        await Stream.update(streamId, { schedule_time: null, end_time: null, status: 'offline' });
      }
      const result = await Stream.updateStatus(streamId, 'offline', req.session.userId);
      return res.json({ success: true, stream: result });
    } else {
      const result = await Stream.updateStatus(streamId, newStatus, req.session.userId);
      return res.json({ success: true, stream: result });
    }
  } catch (error) {
    console.error('Error updating stream status:', error);
    res.status(500).json({ success: false, error: 'Failed to update stream status' });
  }
}

app.post('/api/streams/:id/status', isAuthenticated, [
  body('status').isIn(['live', 'offline', 'scheduled']).withMessage('Invalid status')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: errors.array()[0].msg });
  }
  return nextStatusUpdate(req, res);
});
app.get('/api/streams/check-key', isAuthenticated, async (req, res) => {
  try {
    const streamKey = req.query.key;
    const excludeId = req.query.excludeId || null;
    if (!streamKey) {
      return res.status(400).json({
        success: false,
        error: 'Stream key is required'
      });
    }
    const isInUse = await Stream.isStreamKeyInUse(streamKey, req.session.userId, excludeId);
    res.json({
      success: true,
      isInUse: isInUse,
      message: isInUse ? 'Stream key is already in use' : 'Stream key is available'
    });
  } catch (error) {
    console.error('Error checking stream key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check stream key'
    });
  }
});
app.get('/api/streams/:id/logs', isAuthenticated, async (req, res) => {
  try {
    const streamId = req.params.id;
    const stream = await Stream.findById(streamId);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const logs = streamingService.getStreamLogs(streamId);
    const isActive = streamingService.isStreamActive(streamId);
    res.json({
      success: true,
      logs,
      isActive,
      stream
    });
  } catch (error) {
    console.error('Error fetching stream logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream logs' });
  }
});
app.get('/playlist', isAuthenticated, async (req, res) => {
  try {
    const playlists = await Playlist.findAll(req.session.userId);
    const allVideos = await Video.findAll(req.session.userId, 'NULL');
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const audios = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      return filepath.includes('/audio/') || filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3');
    });
    res.render('playlist', {
      title: 'Playlist',
      active: 'playlist',
      user: await User.findById(req.session.userId),
      playlists: playlists,
      videos: videos,
      audios: audios
    });
  } catch (error) {
    console.error('Playlist error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/api/playlists', isAuthenticated, async (req, res) => {
  try {
    const playlists = await Playlist.findAll(req.session.userId);

    playlists.forEach(playlist => {
      playlist.shuffle = playlist.is_shuffle;
    });

    res.json({ success: true, playlists });
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch playlists' });
  }
});

app.post('/api/playlists', isAuthenticated, [
  body('name').trim().isLength({ min: 1 }).withMessage('Playlist name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlistData = {
      name: req.body.name,
      description: req.body.description || null,
      is_shuffle: req.body.shuffle === 'true' || req.body.shuffle === true,
      user_id: req.session.userId,
      youtube_channel_id: req.body.youtube_channel_id || null
    };

    const playlist = await Playlist.create(playlistData);

    if (req.body.videos && Array.isArray(req.body.videos) && req.body.videos.length > 0) {
      for (let i = 0; i < req.body.videos.length; i++) {
        await Playlist.addVideo(playlist.id, req.body.videos[i], i + 1);
      }
    }

    if (req.body.audios && Array.isArray(req.body.audios) && req.body.audios.length > 0) {
      for (let i = 0; i < req.body.audios.length; i++) {
        await Playlist.addAudio(playlist.id, req.body.audios[i], i + 1);
      }
    }

    res.json({ success: true, playlist });
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to create playlist' });
  }
});

app.get('/api/playlists/:id', isAuthenticated, async (req, res) => {
  try {
    const playlist = await Playlist.findByIdWithVideos(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    playlist.shuffle = playlist.is_shuffle;

    res.json({ success: true, playlist });
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch playlist' });
  }
});

app.put('/api/playlists/:id', isAuthenticated, [
  body('name').trim().isLength({ min: 1 }).withMessage('Playlist name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const updateData = {
      name: req.body.name,
      description: req.body.description || null,
      is_shuffle: req.body.shuffle === 'true' || req.body.shuffle === true
    };

    const updatedPlaylist = await Playlist.update(req.params.id, updateData);

    if (req.body.videos && Array.isArray(req.body.videos)) {
      const existingVideos = await Playlist.findByIdWithVideos(req.params.id);
      if (existingVideos && existingVideos.videos) {
        for (const video of existingVideos.videos) {
          await Playlist.removeVideo(req.params.id, video.id);
        }
      }

      for (let i = 0; i < req.body.videos.length; i++) {
        await Playlist.addVideo(req.params.id, req.body.videos[i], i + 1);
      }
    }

    if (req.body.audios && Array.isArray(req.body.audios)) {
      await Playlist.clearAudios(req.params.id);
      for (let i = 0; i < req.body.audios.length; i++) {
        await Playlist.addAudio(req.params.id, req.body.audios[i], i + 1);
      }
    }

    res.json({ success: true, playlist: updatedPlaylist });
  } catch (error) {
    console.error('Error updating playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to update playlist' });
  }
});

app.post('/api/playlists/bulk-delete', isAuthenticated, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No playlists specified' });
    }

    let deletedCount = 0;
    for (const id of ids) {
      const playlist = await Playlist.findById(id);
      if (playlist && playlist.user_id === req.session.userId) {
        await Playlist.delete(id);
        deletedCount++;
      }
    }

    res.json({ success: true, message: `${deletedCount} playlists deleted successfully` });
  } catch (error) {
    console.error('Error batch deleting playlists:', error);
    res.status(500).json({ success: false, error: 'Failed to delete playlists' });
  }
});

app.delete('/api/playlists/:id', isAuthenticated, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Playlist.delete(req.params.id);
    res.json({ success: true, message: 'Playlist deleted successfully' });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to delete playlist' });
  }
});

app.post('/api/playlists/:id/videos', isAuthenticated, [
  body('videoId').notEmpty().withMessage('Video ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const video = await Video.findById(req.body.videoId);
    if (!video || video.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const position = await Playlist.getNextPosition(req.params.id);
    await Playlist.addVideo(req.params.id, req.body.videoId, position);

    res.json({ success: true, message: 'Video added to playlist' });
  } catch (error) {
    console.error('Error adding video to playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to add video to playlist' });
  }
});

app.delete('/api/playlists/:id/videos/:videoId', isAuthenticated, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Playlist.removeVideo(req.params.id, req.params.videoId);
    res.json({ success: true, message: 'Video removed from playlist' });
  } catch (error) {
    console.error('Error removing video from playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to remove video from playlist' });
  }
});

app.put('/api/playlists/:id/videos/reorder', isAuthenticated, [
  body('videoPositions').isArray().withMessage('Video positions must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Playlist.updateVideoPositions(req.params.id, req.body.videoPositions);
    res.json({ success: true, message: 'Video order updated' });
  } catch (error) {
    console.error('Error reordering videos:', error);
    res.status(500).json({ success: false, error: 'Failed to reorder videos' });
  }
});

// Smart Rotation Generation
app.post('/api/channels/:id/generate-smart-rotation', isAuthenticated, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.session.userId;

    // Verify ownership
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(channelId);
    if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });
    if (channel.user_id !== userId) return res.status(403).json({ success: false, error: 'Unauthorized' });

    const config = {
      daysCount: parseInt(req.body.daysCount) || 14,
      minStreamsPerDay: parseInt(req.body.minStreams) || 6,
      maxStreamsPerDay: parseInt(req.body.maxStreams) || 12,
      minDurationHours: parseInt(req.body.minDuration) || 3,
      maxDurationHours: parseInt(req.body.maxDuration) || 8,
      contentType: req.body.sourceType === 'playlist' ? 'playlist' : 'video',
      sourcePlaylistId: req.body.sourcePlaylistId || null,
      customTitles: req.body.customTitles || [],
      thumbnailMode: req.body.thumbnailMode || 'auto',
      privacy: req.body.privacy || 'unlisted'
    };

    // Set timeout to 5 minutes
    req.setTimeout(300000);

    const result = await AutoSchedulerService.generateRotations(channelId, userId, config);
    res.json({ success: true, message: `Successfully generated ${result.count} smart rotations` });

  } catch (error) {
    console.error('Error generating smart rotation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE Channel Endpoint
app.delete('/api/settings/youtube-channel/:id', isAuthenticated, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.session.userId;
    const YoutubeChannel = require('./models/YoutubeChannel');

    // 1. Verify ownership
    const channel = await YoutubeChannel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    if (channel.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    // 2. Unlink streams (prevent FK issues and logical errors)
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE streams SET youtube_channel_id = NULL, is_youtube_api = 0, platform = "Custom" WHERE youtube_channel_id = ? AND user_id = ?',
        [channelId, userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 3. Delete channel
    const result = await YoutubeChannel.delete(channelId, userId);

    if (result.deleted) {
      res.json({ success: true, message: 'Channel deleted successfully' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete channel' });
    }
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({ success: false, error: 'Internal server error during deletion' });
  }
});

// GET /api/channels/:id/best-hours (New Endpoint for Analytics)
app.get('/api/channels/:id/best-hours', isAuthenticated, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.session.userId;
    const count = req.query.count ? parseInt(req.query.count) : 5;

    const YoutubeChannel = require('./models/YoutubeChannel');
    // We need user object to decrypt tokens inside YoutubeService
    const User = require('./models/User');
    const user = await User.findById(userId);

    const YoutubeService = require('./utils/youtubeService');
    const ytService = new YoutubeService(user, channelId);

    // Init service (authenticates with Google)
    await ytService.init();

    const region = req.query.region || 'GLOBAL';
    const bestHours = await ytService.getChannelBestHours(count, region);

    if (bestHours.length === 0) {
      // No Data Found
      return res.json({ success: true, hours: [], message: 'NO_DATA' });
    }

    res.json({ success: true, hours: bestHours });

  } catch (error) {
    console.error('Error fetching best hours:', error.message);

    if (error.message === 'YOUTUBE_ANALYTICS_API_NOT_ENABLED') {
      return res.json({ success: false, error: 'Youtube Analytics API is NOT Enabled in Google Cloud Console.' });
    }
    if (error.message === 'YOUTUBE_ANALYTICS_SCOPE_MISSING') {
      return res.json({ success: false, error: 'Insufficient Permissions. Please Re-Login your YouTube account.' });
    }

    // Return fallback to prevent UI blocked ONLY for unknown errors, but warn user
    res.json({
      success: true,
      hours: ['08:00', '12:00', '18:00', '20:00', '22:00'].slice(0, 5),
      fallback: true,
      message: `Analytics Error: ${error.message}` // Expose real error
    });
  }
});

app.get('/api/donators', async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://donate.youtube101.id/api/donators', {
      params: { limit: 20 }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching donators:', error.message);
    res.json([]);
  }
});

app.get('/api/server-time', (req, res) => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const formattedTime = `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
  const serverTimezoneOffset = now.getTimezoneOffset();
  res.json({
    serverTime: now.toISOString(),
    formattedTime: formattedTime,
    timezoneOffset: serverTimezoneOffset
  });
});

const Rotation = require('./models/Rotation');

app.get('/rotations', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const playlists = await Playlist.findAll(req.session.userId);
    const rotations = await Rotation.findAll(req.session.userId);
    const YoutubeChannel = require('./models/YoutubeChannel');
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);
    const isYoutubeConnected = youtubeChannels.length > 0;
    const defaultChannel = youtubeChannels.find(c => c.is_default) || youtubeChannels[0];

    res.render('rotations', {
      title: 'Stream Rotations',
      active: 'rotations',
      user: user,
      videos: videos,
      playlists: playlists,
      rotations: rotations,
      youtubeConnected: isYoutubeConnected,
      youtubeChannels: youtubeChannels,
      youtubeChannelName: defaultChannel?.channel_name || '',
      youtubeChannelThumbnail: defaultChannel?.channel_thumbnail || '',
      youtubeSubscriberCount: defaultChannel?.subscriber_count || '0'
    });
  } catch (error) {
    console.error('Rotations page error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/api/rotations', isAuthenticated, async (req, res) => {
  try {
    const rotations = await Rotation.findAll(req.session.userId);
    res.json({ success: true, rotations });
  } catch (error) {
    console.error('Error fetching rotations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rotations' });
  }
});

app.get('/api/rotations/:id', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findByIdWithItems(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    res.json({ success: true, rotation });
  } catch (error) {
    console.error('Error fetching rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rotation' });
  }
});

app.post('/api/rotations', isAuthenticated, uploadThumbnail.array('thumbnails'), async (req, res) => {
  try {
    const { name, repeat_mode, start_time, end_time, items, youtube_channel_id } = req.body;

    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    if (!name || !parsedItems || parsedItems.length === 0) {
      return res.status(400).json({ success: false, error: 'Name and at least one item are required' });
    }

    if (!start_time || !end_time) {
      return res.status(400).json({ success: false, error: 'Start time and end time are required' });
    }

    const rotation = await Rotation.create({
      user_id: req.session.userId,
      name,
      is_loop: true,
      start_time,
      end_time,
      repeat_mode: repeat_mode || 'daily',
      youtube_channel_id: youtube_channel_id || null
    });

    const uploadedFiles = req.files || [];

    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      const thumbnailFile = uploadedFiles[i];

      let thumbnailPath = item.thumbnail_path || null;
      let originalThumbnailPath = item.original_thumbnail_path || null;
      if (thumbnailFile && thumbnailFile.size > 0) {
        const originalFilename = thumbnailFile.filename;
        const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;

        originalThumbnailPath = originalFilename;

        try {
          await generateImageThumbnail(thumbnailFile.path, thumbFilename);
          thumbnailPath = thumbFilename;
        } catch (thumbErr) {
          console.error('Error generating rotation thumbnail:', thumbErr);
          thumbnailPath = originalFilename;
        }
      }

      await Rotation.addItem({
        rotation_id: rotation.id,
        order_index: i,
        video_id: item.video_id,
        title: item.title,
        description: item.description || '',
        tags: item.tags || '',
        thumbnail_path: thumbnailPath,
        original_thumbnail_path: originalThumbnailPath,
        privacy: item.privacy || 'unlisted',
        category: item.category || '22',
        post_live_title: item.post_live_title || null,
        post_live_thumbnail_path: item.post_live_thumbnail_path || null
      });
    }

    res.json({ success: true, rotation });
  } catch (error) {
    console.error('Error creating rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to create rotation' });
  }
});

app.put('/api/rotations/:id', isAuthenticated, uploadThumbnail.array('thumbnails'), async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const { name, repeat_mode, start_time, end_time, items, youtube_channel_id } = req.body;

    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    await Rotation.update(req.params.id, {
      name,
      is_loop: true,
      start_time,
      end_time,
      repeat_mode: repeat_mode || 'daily',
      youtube_channel_id: youtube_channel_id || null
    });

    const existingItems = await Rotation.getItemsByRotationId(req.params.id);
    for (const item of existingItems) {
      await Rotation.deleteItem(item.id);
    }

    const uploadedFiles = req.files || [];

    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      const thumbnailFile = uploadedFiles[i];

      let thumbnailPath = item.thumbnail_path || null;
      let originalThumbnailPath = item.original_thumbnail_path || null;
      if (thumbnailFile && thumbnailFile.size > 0) {
        const originalFilename = thumbnailFile.filename;
        const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;

        originalThumbnailPath = originalFilename;

        try {
          await generateImageThumbnail(thumbnailFile.path, thumbFilename);
          thumbnailPath = thumbFilename;
        } catch (thumbErr) {
          console.error('Error generating rotation thumbnail:', thumbErr);
          thumbnailPath = originalFilename;
        }
      }

      await Rotation.addItem({
        rotation_id: req.params.id,
        order_index: i,
        video_id: item.video_id,
        title: item.title,
        description: item.description || '',
        tags: item.tags || '',
        thumbnail_path: thumbnailPath,
        original_thumbnail_path: originalThumbnailPath,
        privacy: item.privacy || 'unlisted',
        category: item.category || '22',
        post_live_title: item.post_live_title || null,
        post_live_thumbnail_path: item.post_live_thumbnail_path || null
      });
    }

    res.json({ success: true, message: 'Rotation updated' });
  } catch (error) {
    console.error('Error updating rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to update rotation' });
  }
});

app.post('/api/rotations/bulk-delete', isAuthenticated, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No IDs provided' });
    }

    let deletedCount = 0;
    for (const id of ids) {
      const rotation = await Rotation.findById(id);
      if (rotation && rotation.user_id === req.session.userId) {
        if (rotation.status === 'active') {
          await rotationService.stopRotation(id);
        }
        await Rotation.delete(id, req.session.userId);
        deletedCount++;
      }
    }

    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete rotations' });
  }
});

app.delete('/api/rotations/:id', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    if (rotation.status === 'active') {
      await rotationService.stopRotation(req.params.id);
    }

    await Rotation.delete(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Rotation deleted' });
  } catch (error) {
    console.error('Error deleting rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to delete rotation' });
  }
});

app.post('/api/rotations/:id/activate', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const result = await rotationService.activateRotation(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error activating rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to activate rotation' });
  }
});

app.post('/api/rotations/:id/pause', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const result = await rotationService.pauseRotation(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error pausing rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to pause rotation' });
  }
});

app.post('/api/rotations/:id/stop', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const result = await rotationService.stopRotation(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error stopping rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to stop rotation' });
  }
});

app.post('/api/channels/:id/generate-smart-rotation', isAuthenticated, async (req, res) => {
  try {
    const channelId = req.params.id;
    const userId = req.session.userId;
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(channelId);

    if (!channel || channel.user_id !== userId) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const user = await User.findById(userId);
    const playlists = await Playlist.findAll(userId, channelId);

    if (playlists.length === 0) {
      return res.status(400).json({ success: false, error: 'No playlists found for this channel. Please create a playlist first Pipen.' });
    }

    const scheduler = new SmartSchedulerService({
      minDailyHours: 5,
      maxDailyHours: 10,
      minStreamDuration: 3,
      maxStreamDuration: 7
    });

    const schedule = await scheduler.generateFullSchedule(user, channel, 14);

    const TITLE_POOL = [
      "Epic Gaming moments | Live Stream",
      "Non-Stop Relaxing Vibes | Live Now",
      "Ultimate Compilation & Beats | 24/7",
      "Best Highlights of the Week | Live",
      "Extreme Action & Energy Music | LIVE",
      "Chill & Beat Collection | 2026 Live",
      "Daily Gaming Adventure | Non-Stop"
    ];

    const toLocalISO = (d) => {
      const pad = (n) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    for (const slot of schedule) {
      const rotationId = uuidv4();
      const playlist = playlists[Math.floor(Math.random() * playlists.length)];
      const title = TITLE_POOL[Math.floor(Math.random() * TITLE_POOL.length)];

      await Rotation.create({
        id: rotationId,
        user_id: userId,
        name: `Smart - ${title.slice(0, 20)}...`,
        gap_minutes: 0,
        is_loop: true,
        status: 'active',
        start_time: toLocalISO(slot.start),
        end_time: toLocalISO(slot.end),
        repeat_mode: 'none',
        youtube_channel_id: channelId
      });

      await Rotation.addItem({
        rotation_id: rotationId,
        video_id: `playlist:${playlist.id}`,
        order_index: 0,
        title: title,
        thumbnail_path: null, // Use video default
        privacy: 'unlisted',
        category: '22'
      });
    }

    res.json({ success: true, message: `Successfully generated ${schedule.length} smart rotations for 14 days Pipen!` });
  } catch (error) {
    console.error('Smart rotation generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate smart rotation Pipen.' });
  }
});


// --- Bulk Playlist Generator Endpoint ---
app.post('/api/playlists/bulk-generate', isAuthenticated, async (req, res) => {
  try {
    const { count, minAudio, maxAudio, minVideo, maxVideo, channelId } = req.body;
    const userId = req.session.userId;
    const itemsCount = parseInt(count) || 1;

    // Validation
    if (itemsCount < 1 || itemsCount > 100) return res.json({ success: false, error: 'Invalid count (1-100)' });

    // Fetch all qualified media
    const videos = await Video.findAll(userId, channelId);

    // Separate pools
    const musicPool = videos.filter(v => v.filepath.includes('/audio/') || v.format === 'mp3' || v.format === 'aac' || v.format === 'm4a' || v.format === 'flac' || v.format === 'wav');
    const videoPool = videos.filter(v => !musicPool.includes(v) && v.format !== 'youtube');

    if (musicPool.length < parseInt(minAudio)) return res.json({ success: false, error: `Not enough music files (Available: ${musicPool.length})` });
    if (videoPool.length < parseInt(minVideo)) return res.json({ success: false, error: `Not enough video files (Available: ${videoPool.length})` });

    console.log(`[BulkGenerator] Starting generation of ${itemsCount} playlists...`);

    // Fisher-Yates Shuffle Helper
    const shuffle = (array) => {
      let currentIndex = array.length, randomIndex;
      // While there remain elements to shuffle.
      while (currentIndex != 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
      }
      return array;
    };

    let createdCount = 0;

    for (let i = 0; i < itemsCount; i++) {
      const audioTarget = Math.floor(Math.random() * (parseInt(maxAudio) - parseInt(minAudio) + 1)) + parseInt(minAudio);
      const videoTarget = Math.floor(Math.random() * (parseInt(maxVideo) - parseInt(minVideo) + 1)) + parseInt(minVideo);

      // FRESH SHUFFLE for every playlist to ensure "Random Order" as requested
      // Using a copy to avoid mutating original pools if we want reuse (though slice() inside shuffle would be safer)
      const shuffledMusic = shuffle([...musicPool]).slice(0, audioTarget);
      const shuffledVideo = shuffle([...videoPool]).slice(0, videoTarget);

      const playlistName = `Auto Playlist #${Date.now().toString().slice(-4)}-${i + 1}`;

      // Create Playlist Container
      const playlistData = {
        name: playlistName,
        description: `Auto-generated with ${videoTarget} videos and ${audioTarget} songs.`,
        is_shuffle: 1, // Default to shuffle mode
        user_id: userId,
        youtube_channel_id: channelId
      };

      const newPlaylist = await Playlist.create(playlistData);

      // Add Audios
      for (let j = 0; j < shuffledMusic.length; j++) {
        await Playlist.addAudio(newPlaylist.id, shuffledMusic[j].id, j + 1);
      }

      // Add Videos
      for (let k = 0; k < shuffledVideo.length; k++) {
        await Playlist.addVideo(newPlaylist.id, shuffledVideo[k].id, k + 1);
      }

      createdCount++;
    }

    res.json({ success: true, count: createdCount });

  } catch (error) {
    console.error('[BulkGenerator] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/system-stats', isAuthenticated, async (req, res) => {
  try {
    const stats = await systemMonitor.getSystemStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching system stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Initialize metadata worker (check every 2 hours)
metadataWorker.startMetadataWorker(2 * 3600000);

const server = app.listen(port, '0.0.0.0', async () => {
  try {
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }

  const ipAddresses = getLocalIpAddresses();
  console.log(`NeoStream running at:`);
  if (ipAddresses && ipAddresses.length > 0) {
    ipAddresses.forEach(ip => {
      console.log(`  http://${ip}:${port}`);
    });
  } else {
    console.log(`  http://localhost:${port}`);
  }
  try {
    const streams = await Stream.findAll(null, 'live');
    if (streams && streams.length > 0) {
      console.log(`Resetting ${streams.length} live streams to offline state...`);
      for (const stream of streams) {
        await Stream.updateStatus(stream.id, 'offline');
      }
    }
  } catch (error) {
    console.error('Error resetting stream statuses:', error);
  }
  schedulerService.init(streamingService);
  rotationService.init();
  try {
    await streamingService.syncStreamStatuses();
  } catch (error) {
    console.error('Failed to sync stream statuses:', error);
  }
});

server.timeout = 30 * 60 * 1000;
server.keepAliveTimeout = 30 * 60 * 1000;
server.headersTimeout = 30 * 60 * 1000;

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  process.exit(1);
});// Force Restart 01/18/2026 23:41:16
// Rename Video/Audio
app.put('/api/videos/:id/rename', isAuthenticated, [
  body('title').trim().isLength({ min: 1 }).withMessage('Title is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });

    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ success: false, error: 'File not found' });
    if (video.user_id !== req.session.userId) return res.status(403).json({ success: false, error: 'Unauthorized' });

    await Video.update(req.params.id, { title: req.body.title });
    res.json({ success: true, message: 'File renamed successfully' });
  } catch (error) {
    console.error('Error renaming file:', error);
    res.status(500).json({ success: false, error: 'Failed to rename file' });
  }
});

// Rename Thumbnail
app.put('/api/thumbnails/:id/rename', isAuthenticated, [
  body('title').trim().isLength({ min: 1 }).withMessage('Title is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: errors.array()[0].msg });

    const Thumbnail = require('./models/Thumbnail');
    const thumb = await Thumbnail.findById(req.params.id);
    if (!thumb) return res.status(404).json({ success: false, error: 'Thumbnail not found' });
    if (thumb.user_id !== req.session.userId) return res.status(403).json({ success: false, error: 'Unauthorized' });

    await Thumbnail.update(req.params.id, { title: req.body.title });
    res.json({ success: true, message: 'Thumbnail renamed successfully' });
  } catch (error) {
    console.error('Error renaming thumbnail:', error);
    res.status(500).json({ success: false, error: 'Failed to rename thumbnail' });
  }
});
