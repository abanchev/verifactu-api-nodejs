//
// =============== Veri*Factu API 1.0.6 ===============
//
// Copyright (c) 2025 Eduardo Ruiz <eruiz@dataclick.es>
// https://github.com/EduardoRuizM/verifactu-api-nodejs
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE

const mysql = require('mysql2/promise');
const crypto = require('crypto');
const backserver = require('./backserver');
const verifactuxml = require('./verifactu.xml');

// Import VeriFactu constants
const { INVOICE_TYPE, RECTIFICATION_TYPE } = verifactuxml;

// Read configuration from environment variables
const cfg = {
  // Database
  mysql_host: process.env.MYSQL_HOST || '127.0.0.1',
  mysql_port: process.env.MYSQL_PORT || 3306,
  mysql_name: process.env.MYSQL_NAME,
  mysql_user: process.env.MYSQL_USER,
  mysql_pass: process.env.MYSQL_PASS,
  timezone: process.env.TIMEZONE || 'Europe/Madrid',

  // Software info
  software_company_name: process.env.SOFTWARE_COMPANY_NAME,
  software_company_nif: process.env.SOFTWARE_COMPANY_NIF,
  software_name: process.env.SOFTWARE_NAME || 'verifactu',
  software_id: process.env.SOFTWARE_ID || 'vf',
  software_version: process.env.SOFTWARE_VERSION || '1.0',
  software_install_number: process.env.SOFTWARE_INSTALL_NUMBER || '00001',

  // Server
  backend_url: process.env.BACKEND_URL || 'http://0.0.0.0:8023',
  backend_token: process.env.BACKEND_TOKEN,
  allow_ip: process.env.ALLOW_IP,
  process_interval: process.env.PROCESS_INTERVAL
};

// Validate required config (certificates are now optional at global level - can be per-company)
const required = ['mysql_name', 'mysql_user', 'mysql_pass', 'software_company_name', 'software_company_nif'];
const missing = required.filter(k => !cfg[k]);
if(missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// Generate token if not provided
if(!cfg.backend_token) {
  cfg.backend_token = crypto.randomBytes(60).toString('base64').replace(/[\/+]/g, '0').substring(0, 60);
  console.log('Generated BACKEND_TOKEN:', cfg.backend_token);
}

// Database connection pool
const pool = mysql.createPool({
  host: cfg.mysql_host,
  port: cfg.mysql_port,
  user: cfg.mysql_user,
  password: cfg.mysql_pass,
  database: cfg.mysql_name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Use query() instead of execute() to support object syntax (SET ?)
const query = async (sql, params) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

// SQL
async function dbQuery(req, res, q, v) {
  try {

    req.status = 200;
    return await query(q, v);

  } catch(err) {

    req.status = 400;
    if(err.code === 'ER_DUP_ENTRY')
      err = 'Duplicate entry';
    else if(err.sqlMessage)
      err = err.sqlMessage;

    console.error(err);
    req.content.error = err;
  }
}

async function getElm(req, res, sql, id) {
  const result = await dbQuery(req, res, sql, id);
  if(result && result.length)
      return result[0];
  else {

    req.status = 404;
    req.content.error = 'Not found';
  }
}

// Get last inserted ID
async function lastId() {
  const result = await query('SELECT LAST_INSERT_ID() AS id');
  return (result.length) ? result[0].id : 0;
}

const verifactu = verifactuxml({
  query: query,
  software_company_name: cfg.software_company_name,
  software_company_nif: cfg.software_company_nif,
  software_name: cfg.software_name,
  software_id: cfg.software_id,
  software_version: cfg.software_version,
  software_install_number: cfg.software_install_number
});

const app = backserver({url: cfg.backend_url})
  .on('listening', address => console.log('Dataclick VeriFactu API', address))
  .on('error', err => console.error(err));

// Health check endpoint (no auth required)
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    req.content = {status: 'ok', timestamp: new Date().toISOString()};
  } catch(err) {
    req.status = 503;
    req.content = {status: 'error', error: 'Database connection failed'};
  }
});

// Constant-time string comparison to prevent timing attacks
function secureCompare(a, b) {
  if(!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function checkAccess(req, res) {
  if(cfg.allow_ip && cfg.allow_ip !== req.ip) {
    req.status = 401;
    req.content.error = 'Client not allowed';
    return false;
  }

  // Verify token (constant-time comparison)
  if(!cfg.backend_token || !secureCompare(cfg.backend_token, req.params.backend_token)) {
    req.status = 401;
    req.content.error = 'Missing or wrong token';
    return false;
  }

  // Find company
  if(req.params.company_id)
    app.company = await getElm(req, res, 'SELECT * FROM companies WHERE id = ?', req.params.company_id);

  return true;
}

// Process invoices for AEAT
app.get('/api/:backend_token/process', async (req, res) => {
  if(await checkAccess(req, res))
    req.content = await verifactu.processPendingInvoices();
});

app.get('/api/:backend_token/:company_id/query', async (req, res) => {
  if(await checkAccess(req, res))
    req.content = await verifactu.queryRecords(app.company, req.getparams.get('year'), req.getparams.get('month'));
});

app.get('/api/:backend_token/:company_id/invoices', async (req, res) => {
  if(await checkAccess(req, res)) {
    req.content.data = await dbQuery(req, res, "SELECT *, CONVERT_TZ(verifactu_dt, 'UTC', ?) AS verifactu_dt_local FROM invoices WHERE company_id = ? ORDER BY dt", [cfg.timezone, req.params.company_id]);

    if(req.content.data)
      req.content.data.forEach(item => item.number_format = verifactu.formatInvoiceNumber(app.company, item));
  }
});

app.get('/api/:backend_token/:company_id/invoices/:id', async (req, res) => {
  if(await checkAccess(req, res)) {
    let invoice = await getElm(req, res, "SELECT *, CONVERT_TZ(verifactu_dt, 'UTC', ?) AS verifactu_dt_local FROM invoices WHERE id = ? AND company_id = ?", [cfg.timezone, req.params.id, req.params.company_id]);
    if(!invoice)
      return;

    invoice.number_format = verifactu.formatInvoiceNumber(app.company, invoice);
    invoice.lines = await dbQuery(req, res, 'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY num', req.params.id);
    req.content = invoice;
  }
});

async function insertInvoice(req, res, type, ref = null, stype = null) {
  if(!app.checkParams({name: 'name'})) {
    if(req.content.message) {
      req.content.error = req.content.message;
      delete req.content.message;
    }
    return;
  }

  const numdec = n => {const p = parseFloat(n); return isNaN(p) ? 0 : Number(p.toFixed(2));};

  let tvat = 0, bi = 0, total = 0;
  if(req.body.lines && Array.isArray(req.body.lines)) {
    req.body.lines.forEach(line => {
      let price = numdec((line.units || 1) * line.price);
      bi = numdec(bi + price);
      if(line.vat) {
	let line_vat = numdec(price * (line.vat / 100));
	tvat = numdec(tvat + line_vat);
	price = numdec(price + line_vat);
      }
      total = numdec(total + price);
    });
  } else {
    req.status = 400;
    req.content.error = 'No invoice lines';
    return;
  }

  if(await dbQuery(req, res,	'INSERT INTO invoices SET company_id = ?, dt = CURRENT_TIMESTAMP, num = ?, name = ?, vat_id = ?, address = ?, postal_code = ?, city = ?, ' +
				'state = ?, country = ?, tvat = ?, bi = ?, total = ?, email = ?, ref = ?, comments = ?, verifactu_type = ?, verifactu_stype = ?, invoice_ref_id = ?',
				[req.params.company_id, await nextNum(type), req.body.name.trim(), (req.body.vat_id) ? verifactu.normalizeNif(req.body.vat_id) : null,
				(req.body.address) ? req.body.address.trim() : null, (req.body.postal_code) ? req.body.postal_code.trim() : null,
				(req.body.city) ? req.body.city.trim() : null, (req.body.state) ? req.body.state.trim() : null, req.body.country,
				tvat, bi, total, (req.body.email) ? req.body.email.trim() : null, (req.body.ref) ? req.body.ref.trim() : null,
				(req.body.comments) ? req.body.comments.trim() : null, type, stype, ref])) {

    let id = await lastId();
    let num = 0;
    for(const line of req.body.lines) {
      num++;
      tvat = total = 0;
      bi = numdec((line.units || 1) * line.price);
      if(line.vat) {
        tvat = numdec(bi * (line.vat / 100));
        total = numdec(bi + tvat);
      }
      await dbQuery(req, res, 'INSERT INTO invoice_lines SET invoice_id = ?, num = ?, descr = ?, units = ?, price = ?, vat = ?, tvat = ?, bi = ?, total = ?',
        [id, num, line.descr, line.units, line.price, line.vat, tvat, bi, total]);
    }

    req.status = 201;
    req.content.id = id;
  }
}

app.post('/api/:backend_token/:company_id/invoices', async (req, res) => {
  if(await checkAccess(req, res))
    await insertInvoice(req, res, (req.body.vat_id) ? INVOICE_TYPE.F1 : INVOICE_TYPE.F2);
});

app.post('/api/:backend_token/:company_id/invoices/:id/rect', async (req, res) => {
  if(!await checkAccess(req, res))
    return;

  const invoice = await getElm(req, res, 'SELECT * FROM invoices WHERE id = ? AND company_id = ?', [req.params.id, req.params.company_id]);
  if(!invoice || !([INVOICE_TYPE.F1, INVOICE_TYPE.F2, INVOICE_TYPE.F3].includes(invoice.verifactu_type)) || invoice.voided) {
    req.status = 401;
    req.content.error = 'Not exists, not type F1/F2/F3 or voided: ' + verifactu.formatInvoiceNumber(app.company, invoice);
    return;
  }

  await insertInvoice(req, res, (req.body.vat_id) ? INVOICE_TYPE.R1 : INVOICE_TYPE.R5, invoice.id, RECTIFICATION_TYPE.INCREMENTAL);
});

app.post('/api/:backend_token/:company_id/invoices/:id/rect2', async (req, res) => {
  if(!await checkAccess(req, res))
    return;

  const invoice = await getElm(req, res, 'SELECT * FROM invoices WHERE id = ? AND company_id = ?', [req.params.id, req.params.company_id]);
  if(!invoice || !([INVOICE_TYPE.F1, INVOICE_TYPE.F3].includes(invoice.verifactu_type)) || invoice.voided) {
    req.status = 401;
    req.content.error = 'Not exists, not type F1/F3 or voided: ' + verifactu.formatInvoiceNumber(app.company, invoice);
    return;
  }

  await insertInvoice(req, res, INVOICE_TYPE.R2, invoice.id, RECTIFICATION_TYPE.INCREMENTAL);
});

app.post('/api/:backend_token/:company_id/invoices/:id/rectsust', async (req, res) => {
  if(!await checkAccess(req, res))
    return;

  const invoice = await getElm(req, res, 'SELECT * FROM invoices WHERE id = ? AND company_id = ?', [req.params.id, req.params.company_id]);
  if(!invoice || !([INVOICE_TYPE.F1, INVOICE_TYPE.F2, INVOICE_TYPE.F3, INVOICE_TYPE.R1, INVOICE_TYPE.R5].includes(invoice.verifactu_type)) || invoice.voided) {
    req.status = 401;
    req.content.error = 'Not exists, not type F1/F2/F3/R1/R5 or voided: ' + verifactu.formatInvoiceNumber(app.company, invoice);
    return;
  }

  await insertInvoice(req, res, (req.body.vat_id) ? INVOICE_TYPE.R1 : INVOICE_TYPE.R5, invoice.id, RECTIFICATION_TYPE.SUBSTITUTION);
});

app.post('/api/:backend_token/:company_id/invoices/:id/sust', async (req, res) => {
  if(!await checkAccess(req, res))
    return;

  const invoice = await getElm(req, res, 'SELECT * FROM invoices WHERE id = ? AND company_id = ?', [req.params.id, req.params.company_id]);
  if(!invoice || invoice.verifactu_type !== INVOICE_TYPE.F2 || invoice.voided) {
    req.status = 401;
    req.content.error = 'Not exists, not type F2 or voided: ' + verifactu.formatInvoiceNumber(app.company, invoice);
    return;
  }

  await insertInvoice(req, res, INVOICE_TYPE.F3, invoice.id);
});

app.get('/api/:backend_token/:company_id/invoices/:id/qr', async (req, res) => {
  if(await checkAccess(req, res)) {
    let invoice = await getElm(req, res, 'SELECT * FROM invoices WHERE id = ? AND company_id = ?', [req.params.id, req.params.company_id]);
    if(!invoice)
      return;

    invoice.number_format = verifactu.formatInvoiceNumber(app.company, invoice);
    res.sendHeaders['Content-Type'] = 'image/png';
    req.raw = getQR(app.company, invoice);
  }
});

// QR URL endpoint - returns the verification URL as text for third-party QR generation
app.get('/api/:backend_token/:company_id/invoices/:id/qr-url', async (req, res) => {
  if(await checkAccess(req, res)) {
    let invoice = await getElm(req, res, 'SELECT * FROM invoices WHERE id = ? AND company_id = ?', [req.params.id, req.params.company_id]);
    if(!invoice)
      return;

    req.content = {
      url: getQRUrl(app.company, invoice),
      invoice_number: verifactu.formatInvoiceNumber(app.company, invoice),
      invoice_date: formatDateForAEAT(invoice.dt),
      total: invoice.total
    };
  }
});

app.put('/api/:backend_token/:company_id/invoices/:id/voided', async (req, res) => {
  if(!await checkAccess(req, res))
    return;

  if(!req.params.id || !/^\d+(,\d+)*$/.test(req.params.id)) {
    req.status = 404;
    req.content.error = 'Not found id(s)';
    return;
  }

  const invoices = await dbQuery(req, res, 'SELECT * FROM invoices WHERE id IN(?) AND company_id = ?', [req.params.id, req.params.company_id]);
  for(const invoice of invoices) {
    if(invoice.voided || !invoice.verifactu_dt || invoice.invoice_ref_id) {
      req.status = 401;
      req.content.error = 'Already voided, not sent or referenced: ' + verifactu.formatInvoiceNumber(app.company, invoice);
      return;
    }
  }

  if(invoices)
    req.content = await verifactu.voidInvoices(app.company, invoices);
  else
    req.status = 404;
});

// Get next invoice number for current year
// Checks AEAT if no local invoices exist to avoid duplicates
async function nextNum(type) {
  return verifactu.getNextInvoiceNumber(app.company, type);
}

// AEAT URL (test/production)
function getUrlAEAT() {
  return (app.company.test) ? 'https://prewww2.aeat.es/' : 'https://www2.agenciatributaria.gob.es/';
}

// Format date as DD-MM-YYYY (required by AEAT)
function formatDateForAEAT(dt) {
  return new Date(dt).toLocaleDateString('en-GB').replace(/\//g, '-');
}

// Format amount with decimal point (not comma)
function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

// Invoice QR verification URL
function getQRUrl(company, invoice) {
  return getUrlAEAT() + 'wlpl/TIKE-CONT/ValidarQR?nif=' + encodeURIComponent(company.vat_id) +
    '&numserie=' + encodeURIComponent(verifactu.formatInvoiceNumber(company, invoice)) +
    '&fecha=' + encodeURIComponent(formatDateForAEAT(invoice.dt)) +
    '&importe=' + encodeURIComponent(formatAmount(invoice.total));
}

// Invoice QR code (PNG image)
function getQR(company, invoice) {
  const url = getQRUrl(company, invoice);
  const qr = require('qr-image');
  return qr.imageSync(url, {type: 'png', ec_level: 'M', size: 6});
}

app.createServer();

// Auto-process pending invoices every minute
const PROCESS_INTERVAL = cfg.process_interval ? parseInt(cfg.process_interval, 10) * 1000 : 60000;

if(PROCESS_INTERVAL > 0) {
  setInterval(async () => {
    try {
      const result = await verifactu.processPendingInvoices();
      const hasInvoices = Object.values(result.companies || {}).some(c => c.ok?.length || c.ko?.length);
      if(hasInvoices)
        console.log('Auto-process result:', JSON.stringify(result));
    } catch(err) {
      console.error('Auto-process error:', err.message);
    }
  }, PROCESS_INTERVAL);

  console.log(`Auto-processing enabled: every ${PROCESS_INTERVAL / 1000} seconds`);
}

// Graceful shutdown
async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch(err) {
    console.error('Error closing pool:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
