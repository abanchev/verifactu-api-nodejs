/**
 * Test Setup - SQLite Database and VeriFactu initialization
 */

const path = require('path');
const Database = require('better-sqlite3');

// Load environment variables from .env file if exists
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv not available, use environment variables directly
}

// Test configuration
const config = {
  software: {
    company_name: process.env.SOFTWARE_COMPANY_NAME || 'Test Software Company',
    company_nif: process.env.SOFTWARE_COMPANY_NIF || 'B12345678',
    name: process.env.SOFTWARE_NAME || 'verifactu-test',
    id: process.env.SOFTWARE_ID || 'vf',
    version: process.env.SOFTWARE_VERSION || '1.0',
    install_number: process.env.SOFTWARE_INSTALL_NUMBER || '00001'
  }
};

// SQLite database instance
let db = null;

/**
 * Initialize SQLite database with schema
 */
function initDatabase() {
  db = new Database(':memory:');

  // Create companies table
  db.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      vat_id TEXT,
      address TEXT,
      postal_code TEXT,
      city TEXT,
      state TEXT,
      country TEXT DEFAULT 'ES',
      formula TEXT DEFAULT '%n%',
      formula_r TEXT DEFAULT 'R-%n%',
      first_num INTEGER DEFAULT 1,
      created TEXT,
      test INTEGER DEFAULT 1,
      cert_key TEXT,
      cert_content TEXT,
      next_send TEXT
    )
  `);

  // Create invoices table
  db.exec(`
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      dt TEXT,
      num INTEGER,
      name TEXT,
      vat_id TEXT,
      address TEXT,
      postal_code TEXT,
      city TEXT,
      country TEXT DEFAULT 'ES',
      bi REAL DEFAULT 0,
      tvat REAL DEFAULT 0,
      total REAL DEFAULT 0,
      verifactu_type TEXT,
      verifactu_stype TEXT,
      verifactu_dt TEXT,
      verifactu_csv TEXT,
      verifactu_err INTEGER DEFAULT 0,
      fingerprint TEXT,
      invoice_ref_id INTEGER,
      voided INTEGER DEFAULT 0,
      comments TEXT,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    )
  `);

  // Create invoice_lines table
  db.exec(`
    CREATE TABLE invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      num INTEGER,
      descr TEXT,
      units REAL DEFAULT 1,
      price REAL DEFAULT 0,
      vat REAL DEFAULT 0,
      bi REAL DEFAULT 0,
      tvat REAL DEFAULT 0,
      total REAL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    )
  `);
}

/**
 * Reset database (drop and recreate)
 */
function resetDatabase() {
  if (db) {
    db.close();
  }
  initDatabase();
}

/**
 * MySQL-compatible query function for SQLite
 * Converts MySQL syntax to SQLite syntax
 */
async function query(sql, params = []) {
  if (!db) {
    initDatabase();
  }

  // Normalize params to array
  if (!Array.isArray(params)) {
    params = [params];
  }

  // Convert MySQL syntax to SQLite
  let sqliteSql = sql
    // CURRENT_TIMESTAMP -> datetime('now')
    .replace(/CURRENT_TIMESTAMP/gi, "datetime('now', 'localtime')")
    // CURRENT_DATE -> date('now')
    .replace(/CURRENT_DATE/gi, "date('now', 'localtime')")
    // YEAR(field) -> strftime('%Y', field)
    .replace(/YEAR\s*\(\s*(\w+)\s*\)/gi, "strftime('%Y', $1)")
    // LEFT(field, n) -> substr(field, 1, n)
    .replace(/LEFT\s*\(\s*(\w+)\s*,\s*(\d+)\s*\)/gi, 'substr($1, 1, $2)')
    // UNIX_TIMESTAMP(field) -> unixepoch(field)
    .replace(/UNIX_TIMESTAMP\s*\(\s*(\w+)\s*\)/gi, "unixepoch($1)")
    // UNIX_TIMESTAMP(NOW()) -> unixepoch('now')
    .replace(/UNIX_TIMESTAMP\s*\(\s*NOW\s*\(\s*\)\s*\)/gi, "unixepoch('now')")
    // DATE_ADD(NOW(), INTERVAL ? SECOND) -> datetime('now', '+' || ? || ' seconds')
    .replace(/DATE_ADD\s*\(\s*NOW\s*\(\s*\)\s*,\s*INTERVAL\s+\?\s+SECOND\s*\)/gi, "datetime('now', 'localtime', '+' || ? || ' seconds')")
    // Remove backticks
    .replace(/`/g, '');

  const sqlUpper = sqliteSql.toUpperCase().trim();

  try {
    // Handle SELECT queries
    if (sqlUpper.startsWith('SELECT')) {
      // Handle LAST_INSERT_ID()
      if (sqlUpper.includes('LAST_INSERT_ID')) {
        const lastId = db.prepare('SELECT last_insert_rowid() as id').get();
        return [lastId];
      }

      const stmt = db.prepare(sqliteSql);
      return stmt.all(...params);
    }

    // Handle INSERT queries
    if (sqlUpper.startsWith('INSERT')) {
      // Convert INSERT ... SET syntax to INSERT ... VALUES
      const setMatch = sqliteSql.match(/INSERT\s+INTO\s+(\w+)\s+SET\s+([\s\S]+)$/i);
      if (setMatch) {
        const table = setMatch[1];
        const setContent = setMatch[2].replace(/\s+/g, ' ').trim();

        // Parse field=value pairs more carefully
        const fields = [];
        const values = [];
        let paramIndex = 0;

        // Split on commas but not within parentheses
        let depth = 0;
        let current = '';
        const setParts = [];

        for (const char of setContent) {
          if (char === '(') depth++;
          else if (char === ')') depth--;
          else if (char === ',' && depth === 0) {
            setParts.push(current.trim());
            current = '';
            continue;
          }
          current += char;
        }
        if (current.trim()) setParts.push(current.trim());

        for (const part of setParts) {
          const eqIndex = part.indexOf('=');
          if (eqIndex === -1) continue;

          const field = part.substring(0, eqIndex).trim();
          const value = part.substring(eqIndex + 1).trim();

          fields.push(field);

          if (value === '?') {
            values.push(params[paramIndex++]);
          } else if (value.match(/^datetime\s*\(/i) || value.match(/^date\s*\(/i)) {
            // Execute the date function
            const result = db.prepare(`SELECT ${value} as v`).get();
            values.push(result.v);
          } else if (value.toUpperCase() === 'NULL') {
            values.push(null);
          } else {
            values.push(value.replace(/^['"]|['"]$/g, ''));
          }
        }

        const placeholders = fields.map(() => '?').join(', ');
        const insertSql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`;

        const stmt = db.prepare(insertSql);
        const result = stmt.run(...values);
        return { insertId: result.lastInsertRowid };
      }

      const stmt = db.prepare(sqliteSql);
      const result = stmt.run(...params);
      return { insertId: result.lastInsertRowid };
    }

    // Handle UPDATE queries
    if (sqlUpper.startsWith('UPDATE')) {
      // Handle SET ? syntax (object parameter)
      if (sqliteSql.includes('SET ?')) {
        const updateObj = params[0];
        const whereValue = params[1];

        const tableMatch = sqliteSql.match(/UPDATE\s+(\w+)/i);
        const table = tableMatch[1];

        const setClauses = Object.keys(updateObj).map(k => `${k} = ?`).join(', ');
        const setValues = Object.values(updateObj);

        const whereMatch = sqliteSql.match(/WHERE\s+([\s\S]+)$/i);
        const whereClause = whereMatch ? whereMatch[1].replace('?', '?') : '';

        const updateSql = `UPDATE ${table} SET ${setClauses} WHERE ${whereClause}`;
        const stmt = db.prepare(updateSql);
        const result = stmt.run(...setValues, whereValue);
        return { affectedRows: result.changes };
      }

      const stmt = db.prepare(sqliteSql);
      const result = stmt.run(...params);
      return { affectedRows: result.changes };
    }

    // Handle DELETE queries
    if (sqlUpper.startsWith('DELETE')) {
      // Handle DELETE with JOIN (convert to subquery)
      if (sqlUpper.includes('JOIN')) {
        const companyId = params[0];
        // Get invoice IDs for this company
        const invoiceIds = db.prepare('SELECT id FROM invoices WHERE company_id = ?').all(companyId).map(r => r.id);
        if (invoiceIds.length > 0) {
          db.prepare(`DELETE FROM invoice_lines WHERE invoice_id IN (${invoiceIds.join(',')})`).run();
        }
        return { affectedRows: invoiceIds.length };
      }

      const stmt = db.prepare(sqliteSql);
      const result = stmt.run(...params);
      return { affectedRows: result.changes };
    }

    // Default: run the query
    const stmt = db.prepare(sqliteSql);
    return stmt.run(...params);

  } catch (err) {
    console.error('SQLite Error:', err.message);
    console.error('SQL:', sqliteSql);
    console.error('Params:', params);
    throw err;
  }
}

/**
 * Create test company with certificate
 */
async function createTestCompany(companyData = {}) {
  const defaults = {
    code: 'test-' + Date.now(),
    name: 'Test Company SL',
    vat_id: 'B12345678',
    address: 'Calle Test 123',
    postal_code: '28001',
    city: 'Madrid',
    state: 'Madrid',
    country: 'ES',
    formula: '%Y%/%n.5%',
    formula_r: 'R-%Y%/%n.3%',
    first_num: 1,
    test: 1,
    cert_key: process.env.TEST_CERT_KEY || null,
    cert_content: process.env.TEST_CERT_CONTENT || null
  };

  const company = { ...defaults, ...companyData };

  const result = await query(
    `INSERT INTO companies SET
      code = ?, name = ?, vat_id = ?, address = ?, postal_code = ?,
      city = ?, state = ?, country = ?, formula = ?, formula_r = ?,
      first_num = ?, created = CURRENT_DATE, test = ?,
      cert_key = ?, cert_content = ?`,
    [
      company.code, company.name, company.vat_id, company.address, company.postal_code,
      company.city, company.state, company.country, company.formula, company.formula_r,
      company.first_num, company.test, company.cert_key, company.cert_content
    ]
  );

  company.id = result.insertId;
  return company;
}

// Store verifactu instance for AEAT sync
let verifactuInstance = null;

/**
 * Create test invoice
 * @param {number} companyId - Company ID
 * @param {object} invoiceData - Invoice data
 * @param {boolean} syncWithAEAT - If true, sync invoice numbers with AEAT (for integration tests)
 */
async function createTestInvoice(companyId, invoiceData = {}, syncWithAEAT = false) {
  const defaults = {
    name: 'Test Client',
    vat_id: '99999999R',
    address: 'Client Street 456',
    postal_code: '28002',
    city: 'Madrid',
    country: 'ES',
    verifactu_type: 'F1',
    lines: [
      { descr: 'Test Service', units: 1, price: 100, vat: 21 }
    ]
  };

  const invoice = { ...defaults, ...invoiceData };

  // Calculate totals
  let bi = 0, tvat = 0, total = 0;
  for (const line of invoice.lines) {
    const lineBase = (line.units || 1) * line.price;
    const lineVat = line.vat ? lineBase * (line.vat / 100) : 0;
    bi += lineBase;
    tvat += lineVat;
    total += lineBase + lineVat;
  }

  // Get next invoice number
  const year = new Date().getFullYear();
  const typePrefix = invoice.verifactu_type.startsWith('R') ? 'R' : 'F';

  let num;
  if (syncWithAEAT && verifactuInstance) {
    // For AEAT integration tests, sync with AEAT to avoid duplicates
    const company = await getCompany(companyId);
    num = await verifactuInstance.getNextInvoiceNumber(company, invoice.verifactu_type, year);
  } else {
    // For unit tests, use local DB only
    const numResult = await query(
      `SELECT COALESCE(MAX(num), 0) + 1 AS num FROM invoices
       WHERE company_id = ? AND strftime('%Y', dt) = ? AND substr(verifactu_type, 1, 1) = ?`,
      [companyId, String(year), typePrefix]
    );
    num = numResult[0]?.num || 1;
  }

  const insertResult = await query(
    `INSERT INTO invoices SET
      company_id = ?, dt = CURRENT_TIMESTAMP, num = ?, name = ?, vat_id = ?,
      address = ?, postal_code = ?, city = ?, country = ?,
      bi = ?, tvat = ?, total = ?, verifactu_type = ?, verifactu_stype = ?, invoice_ref_id = ?`,
    [
      companyId, num, invoice.name, invoice.vat_id,
      invoice.address, invoice.postal_code, invoice.city, invoice.country,
      bi, tvat, total, invoice.verifactu_type, invoice.verifactu_stype || null, invoice.invoice_ref_id || null
    ]
  );

  const invoiceId = insertResult.insertId;

  // Insert invoice lines
  let lineNum = 0;
  for (const line of invoice.lines) {
    lineNum++;
    const lineBase = (line.units || 1) * line.price;
    const lineVat = line.vat ? lineBase * (line.vat / 100) : 0;
    const lineTotal = lineBase + lineVat;

    await query(
      `INSERT INTO invoice_lines SET
        invoice_id = ?, num = ?, descr = ?, units = ?, price = ?,
        vat = ?, bi = ?, tvat = ?, total = ?`,
      [invoiceId, lineNum, line.descr, line.units || 1, line.price, line.vat || 0, lineBase, lineVat, lineTotal]
    );
  }

  // Return the full invoice
  const invoices = await query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  return invoices[0];
}

/**
 * Get invoice by ID
 */
async function getInvoice(invoiceId) {
  const invoices = await query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  return invoices[0];
}

/**
 * Get company by ID
 */
async function getCompany(companyId) {
  const companies = await query('SELECT * FROM companies WHERE id = ?', [companyId]);
  return companies[0];
}

/**
 * Clean up test data
 */
async function cleanupTestData(companyId) {
  if (!companyId) return;

  // Delete invoice lines via subquery
  await query(
    'DELETE il FROM invoice_lines il INNER JOIN invoices i ON il.invoice_id = i.id WHERE i.company_id = ?',
    [companyId]
  );

  // Delete invoices
  await query('DELETE FROM invoices WHERE company_id = ?', [companyId]);

  // Delete company
  await query('DELETE FROM companies WHERE id = ?', [companyId]);
}

/**
 * Initialize VeriFactu XML handler
 */
function initVeriFactu() {
  const verifactuxml = require('../verifactu.xml');

  verifactuInstance = verifactuxml({
    query: query,
    software_company_name: config.software.company_name,
    software_company_nif: config.software.company_nif,
    software_name: config.software.name,
    software_id: config.software.id,
    software_version: config.software.version,
    software_install_number: config.software.install_number
  });

  return verifactuInstance;
}

/**
 * Get raw database for direct inspection in tests
 */
function getDb() {
  return db;
}

module.exports = {
  config,
  resetDatabase,
  query,
  createTestCompany,
  createTestInvoice,
  getInvoice,
  getCompany,
  cleanupTestData,
  initVeriFactu,
  getDb
};
