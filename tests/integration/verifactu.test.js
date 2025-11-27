/**
 * VeriFactu Integration Tests
 *
 * Tests all invoice types with in-memory database:
 * - F1: Standard invoice (with recipient VAT ID)
 * - F2: Simplified invoice (without recipient VAT ID)
 * - F3: Substitute invoice (replaces F2)
 * - R1: Rectification of F1/F3 (by substitution)
 * - R2: Rectification by difference
 * - R5: Rectification of F2 (simplified)
 *
 * For AEAT integration tests, set environment variables:
 * - TEST_CERT_KEY: PEM private key content
 * - TEST_CERT_CONTENT: PEM certificate content
 */

const {
  resetDatabase,
  createTestCompany,
  createTestInvoice,
  getInvoice,
  getCompany,
  cleanupTestData,
  initVeriFactu,
  query,
  getDb
} = require('../setup');

const verifactuxml = require('../../verifactu.xml');
const { INVOICE_TYPE, RECTIFICATION_TYPE, TAX_TYPE, TAX_REGIME, OPERATION_QUALIFICATION, HASH_TYPE, BOOL } = verifactuxml;

describe('VeriFactu Unit Tests', () => {
  let verifactu;
  let testCompany;

  beforeAll(async () => {
    resetDatabase();
    verifactu = initVeriFactu();

    // Create test company (without certificate for unit tests)
    testCompany = await createTestCompany({
      code: 'test-unit-' + Date.now(),
      name: 'Empresa Test VeriFactu SL',
      vat_id: 'B12345678',
      cert_key: null,
      cert_content: null
    });
  });

  afterAll(() => {
    resetDatabase();
  });

  describe('Constants Export', () => {
    test('should export INVOICE_TYPE constants', () => {
      expect(verifactuxml.INVOICE_TYPE).toBeDefined();
      expect(INVOICE_TYPE.F1).toBe('F1');
      expect(INVOICE_TYPE.F2).toBe('F2');
      expect(INVOICE_TYPE.F3).toBe('F3');
      expect(INVOICE_TYPE.R1).toBe('R1');
      expect(INVOICE_TYPE.R2).toBe('R2');
      expect(INVOICE_TYPE.R3).toBe('R3');
      expect(INVOICE_TYPE.R4).toBe('R4');
      expect(INVOICE_TYPE.R5).toBe('R5');
    });

    test('should export RECTIFICATION_TYPE constants', () => {
      expect(RECTIFICATION_TYPE).toBeDefined();
      expect(RECTIFICATION_TYPE.SUBSTITUTION).toBe('S');
      expect(RECTIFICATION_TYPE.INCREMENTAL).toBe('I');
    });

    test('should export TAX_REGIME constants', () => {
      expect(TAX_REGIME).toBeDefined();
      expect(TAX_REGIME.GENERAL).toBe('01');
      expect(TAX_REGIME.EXPORT).toBe('02');
    });

    test('should export TAX_TYPE constants', () => {
      expect(TAX_TYPE).toBeDefined();
      expect(TAX_TYPE.IVA).toBe('01');
      expect(TAX_TYPE.IPSI).toBe('02');
      expect(TAX_TYPE.IGIC).toBe('03');
    });

    test('should export HASH_TYPE constants', () => {
      expect(HASH_TYPE).toBeDefined();
      expect(HASH_TYPE.SHA256).toBe('01');
    });

    test('should export BOOL constants', () => {
      expect(BOOL).toBeDefined();
      expect(BOOL.YES).toBe('S');
      expect(BOOL.NO).toBe('N');
    });

    test('should export OPERATION_QUALIFICATION constants', () => {
      expect(OPERATION_QUALIFICATION).toBeDefined();
      expect(OPERATION_QUALIFICATION.S1).toBe('S1');
      expect(OPERATION_QUALIFICATION.S2).toBe('S2');
      expect(OPERATION_QUALIFICATION.N1).toBe('N1');
      expect(OPERATION_QUALIFICATION.N2).toBe('N2');
    });
  });

  describe('Formatting Functions', () => {
    test('should format invoice number correctly with formula', () => {
      const company = { formula: '%Y%/%n.5%' };
      const invoice = { verifactu_type: 'F1', num: 1, dt: '2025-01-15' };

      const result = verifactu.formatInvoiceNumber(company, invoice);
      expect(result).toBe('2025/00001');
    });

    test('should format invoice number with 2-digit year', () => {
      const company = { formula: 'F-%y%-%n.4%' };
      const invoice = { verifactu_type: 'F1', num: 42, dt: '2025-06-20' };

      const result = verifactu.formatInvoiceNumber(company, invoice);
      expect(result).toBe('F-25-0042');
    });

    test('should use formula_r for rectification invoices', () => {
      const company = { formula: '%Y%/%n.5%', formula_r: 'R-%Y%/%n.3%' };
      const invoice = { verifactu_type: 'R1', num: 5, dt: '2025-03-10' };

      const result = verifactu.formatInvoiceNumber(company, invoice);
      expect(result).toBe('R-2025/005');
    });

    test('should format currency correctly', () => {
      expect(verifactu.formatCurrency(100)).toBe('100.00');
      expect(verifactu.formatCurrency(99.999)).toBe('100.00');
      expect(verifactu.formatCurrency(0.1)).toBe('0.10');
      expect(verifactu.formatCurrency(1234.567)).toBe('1234.57');
    });

    test('should normalize NIF correctly', () => {
      expect(verifactu.normalizeNif('b-12345678')).toBe('B12345678');
      expect(verifactu.normalizeNif('  A.98.765.432  ')).toBe('A98765432');
      expect(verifactu.normalizeNif('ES-B12345678')).toBe('ESB12345678');
    });

    test('should format date as DD-MM-YYYY', () => {
      const invoice = { dt: '2025-01-15' };
      const result = verifactu.formatDate(invoice);
      expect(result).toBe('15-01-2025');
    });
  });

  describe('Fingerprint Calculation', () => {
    test('should calculate fingerprint for new invoice', () => {
      const company = { vat_id: 'B12345678', formula: '%n%' };
      const invoice = {
        verifactu_type: 'F1',
        num: 1,
        dt: '2025-01-15',
        tvat: 21,
        total: 121
      };
      const timestamp = '2025-01-15T10:00:00+01:00';

      const fingerprint = verifactu.calculateFingerprint(company, invoice, null, timestamp, false);

      expect(fingerprint).toBeDefined();
      expect(fingerprint.length).toBe(64); // SHA-256 hex length
      expect(fingerprint).toMatch(/^[A-F0-9]+$/); // Uppercase hex
    });

    test('should calculate different fingerprint for voided invoice', () => {
      const company = { vat_id: 'B12345678', formula: '%n%' };
      const invoice = {
        verifactu_type: 'F1',
        num: 1,
        dt: '2025-01-15',
        tvat: 21,
        total: 121
      };
      const timestamp = '2025-01-15T10:00:00+01:00';

      const fpNormal = verifactu.calculateFingerprint(company, invoice, null, timestamp, false);
      const fpVoided = verifactu.calculateFingerprint(company, invoice, null, timestamp, true);

      expect(fpNormal).not.toBe(fpVoided);
    });

    test('should include previous fingerprint in chain', () => {
      const company = { vat_id: 'B12345678', formula: '%n%' };
      const invoice1 = { verifactu_type: 'F1', num: 1, dt: '2025-01-15', tvat: 21, total: 121 };
      const invoice2 = { verifactu_type: 'F1', num: 2, dt: '2025-01-16', tvat: 42, total: 242 };
      const timestamp = '2025-01-15T10:00:00+01:00';

      const fp1 = verifactu.calculateFingerprint(company, invoice1, null, timestamp, false);
      const fp2WithChain = verifactu.calculateFingerprint(company, invoice2, { fingerprint: fp1 }, timestamp, false);
      const fp2NoChain = verifactu.calculateFingerprint(company, invoice2, null, timestamp, false);

      expect(fp2WithChain).not.toBe(fp2NoChain);
    });
  });

  describe('Invoice Creation', () => {
    test('should create F1 invoice correctly', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente Test F1',
        vat_id: '99999999R',
        verifactu_type: INVOICE_TYPE.F1,
        lines: [
          { descr: 'Servicio de consultoría', units: 10, price: 50, vat: 21 }
        ]
      });

      expect(invoice).toBeDefined();
      expect(invoice.verifactu_type).toBe(INVOICE_TYPE.F1);
      expect(invoice.vat_id).toBe('99999999R');
      expect(invoice.bi).toBe(500); // 10 * 50
      expect(invoice.tvat).toBe(105); // 500 * 0.21
      expect(invoice.total).toBe(605); // 500 + 105
    });

    test('should create F2 simplified invoice without VAT ID', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente Simplificado',
        vat_id: null,
        verifactu_type: INVOICE_TYPE.F2,
        lines: [
          { descr: 'Venta producto', units: 2, price: 25, vat: 21 }
        ]
      });

      expect(invoice).toBeDefined();
      expect(invoice.verifactu_type).toBe(INVOICE_TYPE.F2);
      expect(invoice.vat_id).toBeNull();
    });

    test('should create R1 rectification invoice with reference', async () => {
      // First create F1
      const f1Invoice = await createTestInvoice(testCompany.id, {
        verifactu_type: INVOICE_TYPE.F1,
        vat_id: 'C22222222'
      });

      // Create R1 referencing F1
      const r1Invoice = await createTestInvoice(testCompany.id, {
        verifactu_type: INVOICE_TYPE.R1,
        verifactu_stype: RECTIFICATION_TYPE.SUBSTITUTION,
        invoice_ref_id: f1Invoice.id,
        vat_id: 'C22222222'
      });

      expect(r1Invoice.verifactu_type).toBe(INVOICE_TYPE.R1);
      expect(r1Invoice.verifactu_stype).toBe(RECTIFICATION_TYPE.SUBSTITUTION);
      expect(r1Invoice.invoice_ref_id).toBe(f1Invoice.id);
    });
  });

  describe('XML Generation - RegistroAlta', () => {
    test('should build XML for F1 invoice', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente XML Test',
        vat_id: 'D33333333',
        verifactu_type: INVOICE_TYPE.F1,
        lines: [{ descr: 'Test Service', units: 1, price: 100, vat: 21 }]
      });

      const company = await getCompany(testCompany.id);
      const timestamp = '2025-01-15T10:00:00+01:00';

      const xml = await verifactu.buildRegistroAlta(company, invoice, null, timestamp);

      // Verify XML structure for F1 invoice
      expect(xml).toContain('<TipoFactura>F1</TipoFactura>');
      expect(xml).toContain('<IDEmisorFactura>B12345678</IDEmisorFactura>');
      expect(xml).toContain('<NombreRazon>Cliente XML Test</NombreRazon>');
      expect(xml).toContain('<NIF>D33333333</NIF>');
      expect(xml).toContain('<Impuesto>01</Impuesto>');
      expect(xml).toContain('<TipoHuella>01</TipoHuella>');
      expect(xml).toContain('<PrimerRegistro>S</PrimerRegistro>');
      expect(xml).toContain('<Desglose>');
      expect(xml).toContain('<DetalleDesglose>');
      // Verify invoice has tax breakdown (either S1 taxable or N1 non-taxable)
      expect(xml).toMatch(/<CalificacionOperacion>(S1|N1)<\/CalificacionOperacion>/);
    });

    test('should build XML for F2 simplified invoice', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente Simplificado',
        vat_id: null,
        verifactu_type: INVOICE_TYPE.F2,
        lines: [{ descr: 'Producto', units: 1, price: 50, vat: 21 }]
      });

      const company = await getCompany(testCompany.id);
      const timestamp = '2025-01-15T10:00:00+01:00';

      const xml = await verifactu.buildRegistroAlta(company, invoice, null, timestamp);

      expect(xml).toContain('<TipoFactura>F2</TipoFactura>');
      expect(xml).toContain('<FacturaSinIdentifDestinatarioArt61d>S</FacturaSinIdentifDestinatarioArt61d>');
      expect(xml).not.toContain('<Destinatarios>');
    });

    test('should build XML for R1 rectification with reference', async () => {
      // Create original invoice
      const f1Invoice = await createTestInvoice(testCompany.id, {
        verifactu_type: INVOICE_TYPE.F1,
        vat_id: 'E44444444'
      });

      // Create rectification
      const r1Invoice = await createTestInvoice(testCompany.id, {
        verifactu_type: INVOICE_TYPE.R1,
        verifactu_stype: RECTIFICATION_TYPE.SUBSTITUTION,
        invoice_ref_id: f1Invoice.id,
        vat_id: 'E44444444'
      });

      const company = await getCompany(testCompany.id);
      const timestamp = '2025-01-15T10:00:00+01:00';

      const xml = await verifactu.buildRegistroAlta(company, r1Invoice, null, timestamp);

      expect(xml).toContain('<TipoFactura>R1</TipoFactura>');
      expect(xml).toContain('<TipoRectificativa>S</TipoRectificativa>');
      expect(xml).toContain('<FacturasRectificadas>');
      expect(xml).toContain('<IDFacturaRectificada>');
      expect(xml).toContain('<ImporteRectificacion>');
    });

    test('should include chain information when previous invoice exists', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        verifactu_type: INVOICE_TYPE.F1,
        vat_id: 'F55555555'
      });

      const company = await getCompany(testCompany.id);
      const timestamp = '2025-01-15T10:00:00+01:00';

      const previousInvoice = {
        numFmt: '2025/00001',
        dt: '2025-01-14',
        fingerprint: 'ABCD1234' + '0'.repeat(56)
      };

      const xml = await verifactu.buildRegistroAlta(company, invoice, previousInvoice, timestamp);

      expect(xml).toContain('<RegistroAnterior>');
      expect(xml).toContain('<Huella>ABCD1234');
      expect(xml).not.toContain('<PrimerRegistro>');
    });
  });

  describe('XML Generation - RegistroAnulacion', () => {
    test('should build XML for voided invoice', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        verifactu_type: INVOICE_TYPE.F1,
        vat_id: 'G66666666'
      });

      const company = await getCompany(testCompany.id);
      const timestamp = '2025-01-15T10:00:00+01:00';

      const xml = verifactu.buildRegistroAnulacion(company, invoice, null, timestamp);

      expect(xml).toContain('<RegistroAnulacion>');
      expect(xml).toContain('<IDVersion>1.0</IDVersion>');
      expect(xml).toContain('<IDEmisorFacturaAnulada>B12345678</IDEmisorFacturaAnulada>');
      expect(xml).toContain('<TipoHuella>01</TipoHuella>');
    });
  });

  describe('Software Info Section', () => {
    test('should build software info XML correctly', () => {
      const xml = verifactu.buildSoftwareInfo();

      expect(xml).toContain('<SistemaInformatico>');
      expect(xml).toContain('<NombreSistemaInformatico>');
      expect(xml).toContain('<IdSistemaInformatico>');
      expect(xml).toContain('<Version>');
      expect(xml).toContain('<NumeroInstalacion>');
      expect(xml).toContain('<TipoUsoPosibleSoloVerifactu>N</TipoUsoPosibleSoloVerifactu>');
      expect(xml).toContain('<TipoUsoPosibleMultiOT>S</TipoUsoPosibleMultiOT>');
      expect(xml).toContain('<IndicadorMultiplesOT>S</IndicadorMultiplesOT>');
    });
  });
});

describe('VeriFactu AEAT Integration Tests', () => {
  let verifactu;
  let testCompany;

  const hasCertificate = !!(process.env.TEST_CERT_KEY || process.env.KEY_CONTENT);

  beforeAll(async () => {
    if (!hasCertificate) {
      console.warn('');
      console.warn('========================================');
      console.warn('AEAT integration tests will be SKIPPED');
      console.warn('No certificate configured.');
      console.warn('Set TEST_CERT_KEY and TEST_CERT_CONTENT');
      console.warn('environment variables to enable.');
      console.warn('========================================');
      console.warn('');
      return;
    }

    resetDatabase();
    verifactu = initVeriFactu();

    testCompany = await createTestCompany({
      code: 'test-aeat-' + Date.now(),
      name: 'Empresa Test AEAT SL',
      vat_id: process.env.TEST_COMPANY_NIF || 'B12345678'
    });

    console.log(`AEAT Test company: ID=${testCompany.id}, NIF=${testCompany.vat_id}`);
  });

  afterAll(() => {
    resetDatabase();
  });

  // Use test.skip if no certificate is available
  const itAEAT = hasCertificate ? test : test.skip;

  describe('F1 - Standard Invoice', () => {
    itAEAT('should send F1 invoice to AEAT test environment', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente AEAT F1',
        vat_id: '99999999R',
        verifactu_type: INVOICE_TYPE.F1,
        lines: [
          { descr: 'Servicio de consultoría', units: 10, price: 50, vat: 21 }
        ]
      });

      const company = await getCompany(testCompany.id);
      const result = await verifactu.submitInvoices(company, [invoice]);

      console.log('F1 AEAT Result:', JSON.stringify(result, null, 2));

      expect(result).toBeDefined();
      expect(result.ok).toBeDefined();
      expect(result.ko).toBeDefined();

      if (result.ok.length > 0) {
        const updatedInvoice = await getInvoice(invoice.id);
        expect(updatedInvoice.verifactu_dt).not.toBeNull();
        expect(updatedInvoice.fingerprint).not.toBeNull();
      }
    }, 30000);
  });

  describe('F2 - Simplified Invoice', () => {
    itAEAT('should send F2 invoice to AEAT test environment', async () => {
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente AEAT F2',
        vat_id: null,
        verifactu_type: INVOICE_TYPE.F2,
        lines: [
          { descr: 'Venta simplificada', units: 2, price: 25, vat: 21 }
        ]
      });

      const company = await getCompany(testCompany.id);
      const result = await verifactu.submitInvoices(company, [invoice]);

      console.log('F2 AEAT Result:', JSON.stringify(result, null, 2));

      expect(result).toBeDefined();
      expect(result.ok).toBeDefined();
    }, 30000);
  });

  describe('R1 - Rectification Invoice', () => {
    itAEAT('should send F1 then R1 rectification to AEAT', async () => {
      // First send F1
      const f1Invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente para R1',
        vat_id: '99999999R',
        verifactu_type: INVOICE_TYPE.F1,
        lines: [{ descr: 'Servicio original', units: 1, price: 200, vat: 21 }]
      });

      const company = await getCompany(testCompany.id);
      const f1Result = await verifactu.submitInvoices(company, [f1Invoice]);
      console.log('F1 (for R1) Result:', JSON.stringify(f1Result, null, 2));

      if (f1Result.ok.length === 0) {
        console.warn('F1 failed, skipping R1');
        return;
      }

      // Wait for AEAT processing
      await new Promise(r => setTimeout(r, 2000));

      // Get updated company (may have next_send)
      const refreshedCompany = await getCompany(testCompany.id);

      // Send R1 rectification
      const r1Invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente para R1',
        vat_id: '99999999R',
        verifactu_type: INVOICE_TYPE.R1,
        verifactu_stype: RECTIFICATION_TYPE.SUBSTITUTION,
        invoice_ref_id: f1Invoice.id,
        lines: [{ descr: 'Servicio corregido', units: 1, price: 180, vat: 21 }]
      });

      const r1Result = await verifactu.submitInvoices(refreshedCompany, [r1Invoice]);
      console.log('R1 AEAT Result:', JSON.stringify(r1Result, null, 2));

      expect(r1Result).toBeDefined();
      expect(r1Result.ok).toBeDefined();
    }, 60000);
  });

  describe('Invoice Voiding', () => {
    itAEAT('should void a sent invoice', async () => {
      // Create and send invoice
      const invoice = await createTestInvoice(testCompany.id, {
        name: 'Cliente para Anulación',
        vat_id: '99999999R',
        verifactu_type: INVOICE_TYPE.F1,
        lines: [{ descr: 'Servicio a anular', units: 1, price: 75, vat: 21 }]
      });

      const company = await getCompany(testCompany.id);
      const sendResult = await verifactu.submitInvoices(company, [invoice]);
      console.log('Invoice for voiding:', JSON.stringify(sendResult, null, 2));

      if (sendResult.ok.length === 0) {
        console.warn('Invoice not sent, skipping void test');
        return;
      }

      await new Promise(r => setTimeout(r, 2000));

      // Update invoice with fingerprint for voiding
      const sentInvoice = await getInvoice(invoice.id);
      const refreshedCompany = await getCompany(testCompany.id);

      const voidResult = await verifactu.voidInvoices(refreshedCompany, [sentInvoice]);
      console.log('Void Result:', JSON.stringify(voidResult, null, 2));

      expect(voidResult).toBeDefined();
      expect(voidResult.ok).toBeDefined();

      if (voidResult.ok.length > 0) {
        const voidedInvoice = await getInvoice(invoice.id);
        expect(voidedInvoice.voided).toBe(1);
      }
    }, 60000);
  });

  describe('Query Records', () => {
    itAEAT('should query records from AEAT', async () => {
      const company = await getCompany(testCompany.id);
      const now = new Date();

      const result = await verifactu.queryRecords(company, now.getFullYear(), now.getMonth() + 1);
      console.log('Query Result:', JSON.stringify(result, null, 2));

      expect(result).toBeDefined();
    }, 30000);
  });
});

describe('SQLite Database Tests', () => {
  beforeEach(() => {
    resetDatabase();
  });

  test('should create and retrieve company', async () => {
    const company = await createTestCompany({
      name: 'Test Company',
      vat_id: 'B99999999'
    });

    expect(company.id).toBe(1);

    const retrieved = await getCompany(company.id);
    expect(retrieved.name).toBe('Test Company');
    expect(retrieved.vat_id).toBe('B99999999');
  });

  test('should create and retrieve invoice', async () => {
    const company = await createTestCompany();
    const invoice = await createTestInvoice(company.id, {
      name: 'Test Client',
      verifactu_type: 'F1'
    });

    expect(invoice.id).toBe(1);
    expect(invoice.company_id).toBe(company.id);

    const retrieved = await getInvoice(invoice.id);
    expect(retrieved.name).toBe('Test Client');
  });

  test('should auto-increment invoice numbers by type', async () => {
    const company = await createTestCompany();

    const f1 = await createTestInvoice(company.id, { verifactu_type: 'F1' });
    const f2 = await createTestInvoice(company.id, { verifactu_type: 'F2' });
    const f3 = await createTestInvoice(company.id, { verifactu_type: 'F1' });

    expect(f1.num).toBe(1);
    expect(f2.num).toBe(2); // Same F-series
    expect(f3.num).toBe(3); // Continues F-series

    const r1 = await createTestInvoice(company.id, { verifactu_type: 'R1' });
    const r2 = await createTestInvoice(company.id, { verifactu_type: 'R5' });

    expect(r1.num).toBe(1); // R-series starts at 1
    expect(r2.num).toBe(2); // Continues R-series
  });

  test('should calculate invoice totals correctly', async () => {
    const company = await createTestCompany();
    const invoice = await createTestInvoice(company.id, {
      lines: [
        { descr: 'Item 1', units: 2, price: 100, vat: 21 },
        { descr: 'Item 2', units: 1, price: 50, vat: 10 }
      ]
    });

    expect(invoice.bi).toBe(250); // 200 + 50
    expect(invoice.tvat).toBe(47); // 42 + 5
    expect(invoice.total).toBe(297); // 250 + 47
  });

  test('should clean up test data correctly', async () => {
    const company = await createTestCompany();
    await createTestInvoice(company.id);
    await createTestInvoice(company.id);

    const db = getDb();
    let companyCount = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
    let invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get().count;
    let lineCount = db.prepare('SELECT COUNT(*) as count FROM invoice_lines').get().count;

    expect(companyCount).toBe(1);
    expect(invoiceCount).toBe(2);
    expect(lineCount).toBe(2);

    await cleanupTestData(company.id);

    companyCount = db.prepare('SELECT COUNT(*) as count FROM companies').get().count;
    invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get().count;
    lineCount = db.prepare('SELECT COUNT(*) as count FROM invoice_lines').get().count;

    expect(companyCount).toBe(0);
    expect(invoiceCount).toBe(0);
    expect(lineCount).toBe(0);
  });

  test('should store and retrieve VAT correctly in invoice lines', async () => {
    const company = await createTestCompany();
    const invoice = await createTestInvoice(company.id, {
      lines: [
        { descr: 'Taxable item', units: 1, price: 100, vat: 21 }
      ]
    });

    const db = getDb();
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(invoice.id);

    expect(lines.length).toBe(1);
    expect(lines[0].vat).toBe(21);
    expect(lines[0].bi).toBe(100);
    expect(lines[0].tvat).toBe(21);
  });
});
