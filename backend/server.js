require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const Imap = require('imap');
const simpleParser = require('mailparser').simpleParser;
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// Initialize app
const app = express();

// Middlewares
app.use(helmet());
app.use(cookieParser());
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://127.0.0.1:3000', "https://web-mail-dusky.vercel.app"],
  credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public/')));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Hardcoded admin credentials
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS_HASH = process.env.ADMIN_PASS ? bcrypt.hashSync(process.env.ADMIN_PASS, 10) : null;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// Email transporter setup - UPDATED CONFIG FOR RENDER
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use TLS instead of SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  connectionTimeout: 30000, // 30 seconds
  greetingTimeout: 30000,
  socketTimeout: 30000,
  pool: true,
  maxConnections: 1, // Reduce for Render's limitations
  rateDelta: 1000,
  rateLimit: 5
});

// Enhanced transporter verification
async function verifyTransporter() {
  try {
    await transporter.verify();
    console.log('📧 Email server is ready');
    return true;
  } catch (error) {
    console.error('❌ Email config error:', error);
    
    // Specific error messages for better debugging
    if (error.code === 'ETIMEDOUT') {
      console.error('🕒 Connection timeout - Check network/firewall settings');
    } else if (error.code === 'EAUTH') {
      console.error('🔐 Authentication failed - Check email credentials');
      console.error('💡 Tip: Use Gmail App Password instead of regular password');
    } else if (error.code === 'ENOTFOUND') {
      console.error('🌐 Network error - Cannot reach SMTP server');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('🚫 Connection refused - Check port and host settings');
    }
    return false;
  }
}

// Verify on startup
verifyTransporter();

// IMAP configuration (for receiving)
const imap = new Imap({
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASS,
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
  connTimeout: 30000,
  authTimeout: 30000
});

// Configure storage for attachments
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Verify credentials
    if (username !== ADMIN_USER || !bcrypt.compareSync(password, ADMIN_PASS_HASH)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { username: ADMIN_USER, role: 'admin' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Set secure HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000 // 1 hour
    });

    res.json({ 
      success: true,
      message: 'Login successful',
      token // Also send token in response for clients that need it
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Protected route example
app.get('/api/admin/data', authenticateToken, (req, res) => {
  res.json({ 
    success: true,
    data: 'Sensitive admin data',
    user: req.user
  });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// JWT authentication middleware
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    req.user = user;
    next();
  });
}

// Function to fetch emails
function fetchEmails() {
  return new Promise((resolve, reject) => {
    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);

        const total = box.messages.total;
        if (total === 0) {
          imap.end();
          return resolve([]);
        }

        // Get the last 10 message sequence numbers
        const start = total - 9 > 0 ? total - 9 : 1;
        const range = `${start}:${total}`;

        const fetch = imap.seq.fetch(range, {
          bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
          struct: true
        });

        fetch.on('message', (msg, seqno) => {
          const email = { id: seqno };

          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', chunk => buffer += chunk.toString('utf8'));
            stream.on('end', () => {
              if (info.which === 'TEXT') {
                email.body = buffer;
              } else {
                const headers = Imap.parseHeader(buffer);
                email.from = headers.from?.[0] || '';
                email.subject = headers.subject?.[0] || '';
                email.date = headers.date?.[0] || '';
              }
            });
          });

          msg.once('end', () => emails.push(email));
        });

        fetch.once('error', reject);
        fetch.once('end', () => {
          // Sort by most recent
          emails.sort((a, b) => new Date(b.date) - new Date(a.date));
          imap.end();
          resolve(emails);
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

// ==================== API ENDPOINTS ====================

// 1. Get Inbox Emails
app.get('/api/inbox', async (req, res) => {
  try {
    const emails = await fetchEmails();
    res.json(emails);
  } catch (error) {
    console.error('Inbox error:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// 2. Send Single Email
app.post('/api/send', upload.array('attachments'), async (req, res) => {
  try {
    // Check if email server is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ 
        error: 'Email server not configured',
        details: 'EMAIL_USER and EMAIL_PASS environment variables are required'
      });
    }

    const emailData = JSON.parse(req.body.data);
    const { from, senderName, to, subject, text, html, cc, bcc, replyTo } = emailData;
    
    const senderEmail = from || process.env.EMAIL_USER;
    const displayName = senderName || 'YourCompany Team';

    const attachments = req.files?.map(file => ({
      filename: file.originalname,
      path: file.path
    })) || [];

    const mailOptions = {
      from: `"${displayName}" <${senderEmail}>`,
      to: Array.isArray(to) ? to : to.split(','),
      cc: cc ? (Array.isArray(cc) ? cc : cc.split(',')) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : bcc.split(',')) : undefined,
      replyTo: replyTo || senderEmail,
      subject,
      text,
      html: html || text,
      attachments
    };

    const info = await transporter.sendMail(mailOptions);

    // Clean up attachments
    attachments.forEach(att => {
      if (fs.existsSync(att.path)) {
        fs.unlinkSync(att.path);
      }
    });

    res.json({ 
      success: true, 
      message: 'Email sent successfully',
      messageId: info.messageId 
    });
  } catch (error) {
    console.error('Send error:', error);
    
    // Clean up attachments even on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({ 
      error: 'Failed to send email',
      details: error.message 
    });
  }
});

// 3. Send Marketing Campaign
app.post('/api/send-campaign', upload.array('attachments'), async (req, res) => {
  try {
    // Check if email server is configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ 
        error: 'Email server not configured',
        details: 'EMAIL_USER and EMAIL_PASS environment variables are required'
      });
    }

    const emailData = JSON.parse(req.body.data);
    const { from, recipients, subject, text, html } = emailData;
    
    const toList = Array.isArray(recipients) ? recipients : recipients.split(',');
    const attachments = req.files?.map(file => ({
      filename: file.originalname,
      path: file.path
    })) || [];

    // Rate limiting for campaign emails
    const results = [];
    for (let i = 0; i < toList.length; i++) {
      const to = toList[i];
      try {
        const info = await transporter.sendMail({
          from: from || process.env.EMAIL_USER,
          to,
          subject,
          text,
          html: html || text,
          attachments
        });
        results.push({ to, success: true, messageId: info.messageId });
        
        // Small delay between emails to avoid rate limiting
        if (i < toList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        results.push({ to, success: false, error: error.message });
      }
    }

    // Clean up attachments
    attachments.forEach(att => {
      if (fs.existsSync(att.path)) {
        fs.unlinkSync(att.path);
      }
    });

    res.json({ 
      success: true, 
      message: 'Campaign sent',
      sentCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      results 
    });
  } catch (error) {
    console.error('Campaign error:', error);
    
    // Clean up attachments even on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({ 
      error: 'Failed to send campaign',
      details: error.message 
    });
  }
});

// 4. Health Check Endpoint
app.get('/api/health', async (req, res) => {
  const emailStatus = await verifyTransporter();
  
  res.json({ 
    status: 'ok',
    services: {
      smtp: emailStatus ? 'connected' : 'disconnected',
      imap: 'connected',
      server: 'running'
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 5. Test Email Endpoint
app.post('/api/test-email', async (req, res) => {
  try {
    const testMailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to yourself
      subject: 'Test Email from Render',
      text: 'This is a test email from your deployed application on Render.',
      html: '<p>This is a test email from your deployed application on Render.</p>'
    };

    const info = await transporter.sendMail(testMailOptions);
    
    res.json({ 
      success: true, 
      message: 'Test email sent successfully',
      messageId: info.messageId 
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send test email',
      details: error.message,
      code: error.code
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📧 API Endpoints:
  - GET    /api/inbox
  - POST   /api/send
  - POST   /api/send-campaign
  - GET    /api/health
  - POST   /api/test-email`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
