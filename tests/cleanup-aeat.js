/**
 * AEAT Test Server Cleanup Script
 *
 * Queries all invoices from the AEAT test server for the current month
 * and voids any that are not already voided.
 *
 * Usage: node tests/cleanup-aeat.js [year] [month]
 */

const path = require('path');
const https = require('https');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  software: {
    company_name: process.env.SOFTWARE_COMPANY_NAME || 'Test Software Company',
    company_nif: process.env.SOFTWARE_COMPANY_NIF || 'B12345678',
    name: process.env.SOFTWARE_NAME || 'verifactu-test',
    id: process.env.SOFTWARE_ID || 'VF',
    version: process.env.SOFTWARE_VERSION || '1.0',
    install_number: process.env.SOFTWARE_INSTALL_NUMBER || '00001'
  }
};

// Simple query function (not using DB, just for verifactu init)
async function query() {
  return [];
}

/**
 * Parse invoice number from formatted string
 * Extracts the numeric part from formats like "2025/00001" or "R-2025/001"
 */
function parseInvoiceNumber(numFmt, tipo) {
  // For rectification types (R1-R5), extract from format like "R-2025/001"
  if (tipo && tipo.startsWith('R')) {
    const match = numFmt.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 1;
  }
  // For standard types (F1-F3), extract from format like "2025/00001"
  const match = numFmt.match(/(\d+)$/);
  return match ? parseInt(match[1]) : 1;
}

async function main() {
  // Check for certificate
  if (!process.env.TEST_CERT_KEY || !process.env.TEST_CERT_CONTENT) {
    console.error('ERROR: TEST_CERT_KEY and TEST_CERT_CONTENT must be set in .env');
    process.exit(1);
  }

  // Parse command line arguments for year/month
  const args = process.argv.slice(2);
  const now = new Date();
  const year = parseInt(args[0]) || now.getFullYear();
  const month = parseInt(args[1]) || (now.getMonth() + 1);

  console.log(`\n=== AEAT Test Server Cleanup ===`);
  console.log(`Querying invoices for ${year}-${String(month).padStart(2, '0')}...`);

  // Initialize verifactu
  const verifactuxml = require('../verifactu.xml');
  const verifactu = verifactuxml({
    query: query,
    software_company_name: config.software.company_name,
    software_company_nif: config.software.company_nif,
    software_name: config.software.name,
    software_id: config.software.id,
    software_version: config.software.version,
    software_install_number: config.software.install_number
  });

  // Create company object with certificate and formulas
  const company = {
    vat_id: process.env.TEST_COMPANY_NIF || process.env.SOFTWARE_COMPANY_NIF,
    name: process.env.SOFTWARE_COMPANY_NAME,
    test: 1, // Use test server
    cert_key: process.env.TEST_CERT_KEY,
    cert_content: process.env.TEST_CERT_CONTENT,
    formula: '%Y%/%n.5%',
    formula_r: 'R-%Y%/%n.3%'
  };

  try {
    // Query all records from AEAT
    const records = await verifactu.queryRecords(company, year, month);

    if (!records || records.length === 0) {
      console.log('No invoices found for this period.');
      return;
    }

    console.log(`Found ${records.length} invoice(s):\n`);

    // Filter out already voided invoices
    const toVoid = [];
    for (const record of records) {
      const status = record.EstadoRegistro?.EstadoRegistro || 'Unknown';
      const numSerie = record.IDFactura?.NumSerieFactura || 'N/A';
      const fecha = record.IDFactura?.FechaExpedicionFactura || 'N/A';
      const tipo = record.DatosRegistroFacturacion?.TipoFactura || 'N/A';

      console.log(`  ${numSerie} (${tipo}) - ${fecha} - Status: ${status}`);

      if (status === 'Correcto' || status === 'AceptadoConErrores') {
        const isoDate = parseAEATDate(fecha);
        const num = parseInvoiceNumber(numSerie, tipo);

        toVoid.push({
          id: 0,
          num: num,
          dt: isoDate,
          fingerprint: record.DatosRegistroFacturacion?.Huella,
          verifactu_type: tipo,
          _numFmt: numSerie // For logging only
        });
      }
    }

    if (toVoid.length === 0) {
      console.log('\nAll invoices are already voided or in error state.');
      return;
    }

    console.log(`\nVoiding ${toVoid.length} invoice(s)...`);

    // Void each invoice
    for (const invoice of toVoid) {
      console.log(`\n  Voiding ${invoice._numFmt}...`);

      try {
        const result = await verifactu.voidInvoices(company, [invoice]);

        if (result.ok && result.ok.length > 0) {
          console.log(`    ✓ Voided successfully`);
        } else if (result.ko && result.ko.length > 0) {
          const error = result.ko[0];
          // AceptadoConErrores (code 2007) means accepted but with chain warning - still voided
          if (error.codError === '2007') {
            console.log(`    ✓ Voided (with chain warning)`);
          } else {
            console.log(`    ✗ Failed: ${error.descrError || 'Unknown error'}`);
          }
        }
      } catch (err) {
        console.log(`    ✗ Error: ${err.message}`);
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n=== Cleanup Complete ===\n');

    // Query again to verify
    console.log('Verifying cleanup...');
    const verifyRecords = await verifactu.queryRecords(company, year, month);

    let correctCount = 0;
    let voidedCount = 0;

    for (const record of verifyRecords || []) {
      const status = record.EstadoRegistro?.EstadoRegistro || 'Unknown';
      if (status === 'Correcto') correctCount++;
      if (status === 'Anulado') voidedCount++;
    }

    console.log(`\nFinal status:`);
    console.log(`  Correcto: ${correctCount}`);
    console.log(`  Anulado: ${voidedCount}`);
    console.log(`  Total: ${verifyRecords?.length || 0}`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

/**
 * Parse AEAT date format (DD-MM-YYYY) to ISO format (YYYY-MM-DD)
 */
function parseAEATDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
