//
// =============== Veri*Factu API 1.0.6 ===============
//
// Copyright (c) 2025 Eduardo Ruiz <eruiz@dataclick.es>
// https://github.com/EduardoRuizM/verifactu-api-nodejs
//
// VeriFactu XML Schema Documentation:
// - SuministroInformacion.xsd: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd
// - SuministroLR.xsd: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd
// - Official documentation: https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf
//

const https = require('https');
const crypto = require('crypto');
const xml2js = require('xml2js');

// =============================================================================
// VERIFACTU CONSTANTS - Based on AEAT XSD Schema Enumerations
// =============================================================================

/**
 * Schema version for VeriFactu XML
 */
const SCHEMA_VERSION = '1.0';

/**
 * AEAT Web Service URLs
 */
const AEAT_URLS = {
  PRODUCTION: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  TEST: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP'
};

/**
 * XML Namespaces used in SOAP envelope
 */
const XML_NAMESPACES = {
  SOAP: 'http://schemas.xmlsoap.org/soap/envelope/',
  SUMINISTRO_LR: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
  SUMINISTRO_INFO: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
  CONSULTA_LR: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd'
};

/**
 * Invoice Types (ClaveTipoFacturaType - Lista L2)
 * Based on RD 1619/2012 and Art. 80 LIVA
 */
const INVOICE_TYPE = {
  // Standard invoices
  F1: 'F1', // Factura completa (Art. 6, 7.2 y 7.3 del RD 1619/2012)
  F2: 'F2', // Factura simplificada sin identificación del destinatario (Art. 6.1.d)
  F3: 'F3', // Factura emitida en sustitución de facturas simplificadas

  // Rectification invoices
  R1: 'R1', // Factura rectificativa (Art. 80.1, 80.2 y error fundado en derecho)
  R2: 'R2', // Factura rectificativa (Art. 80.3) - Concurso de acreedores
  R3: 'R3', // Factura rectificativa (Art. 80.4) - Deudas incobrables
  R4: 'R4', // Factura rectificativa (Resto de causas)
  R5: 'R5'  // Factura rectificativa en facturas simplificadas
};

/**
 * Rectification Types (ClaveTipoRectificativaType)
 */
const RECTIFICATION_TYPE = {
  SUBSTITUTION: 'S', // Sustitutiva - Replaces original invoice values
  INCREMENTAL: 'I'   // Por diferencias - Shows only the difference
};

/**
 * Operation Qualification (CalificacionOperacionType)
 */
const OPERATION_QUALIFICATION = {
  S1: 'S1', // Operación sujeta y no exenta - Sin inversión del sujeto pasivo
  S2: 'S2', // Operación sujeta y no exenta - Con inversión del sujeto pasivo
  N1: 'N1', // Operación no sujeta (Artículo 7, 14, otros)
  N2: 'N2'  // Operación no sujeta por reglas de localización
};

/**
 * Tax Regime Keys (ClaveRegimenType - Lista L8)
 */
const TAX_REGIME = {
  GENERAL: '01',                    // Operación de régimen general
  EXPORT: '02',                     // Exportación
  USED_GOODS: '03',                 // Régimen especial de bienes usados, objetos de arte, antigüedades
  INVESTMENT_GOLD: '04',            // Régimen especial del oro de inversión
  TRAVEL_AGENCIES: '05',            // Régimen especial de las agencias de viajes
  ENTITY_GROUPS: '06',              // Régimen especial grupo de entidades en IVA (Nivel Avanzado)
  CASH_CRITERIA: '07',              // Régimen especial del criterio de caja
  IPSI_IGIC: '08',                  // Operaciones sujetas al IPSI/IGIC
  TRAVEL_AGENCY_MEDIATOR: '09',     // Agencias de viaje como mediadoras
  THIRD_PARTY_COLLECTIONS: '10',    // Cobros por cuenta de terceros
  BUSINESS_RENTAL: '11',            // Arrendamiento de local de negocio
  BUSINESS_RENTAL_NO_RET: '12',     // Arrendamiento de local sin retención
  BUSINESS_RENTAL_RET: '13',        // Arrendamiento de local con retención
  PRE_SII: '14',                    // Facturas anteriores a la inclusión en el SII
  PENDING_VAT: '15',                // Factura con IVA pendiente de devengo
  FIRST_SEMESTER_2017: '16',        // Régimen especial primer semestre 2017
  ONE_STOP_SHOP: '17'               // Ventanilla única (OSS)
};

/**
 * Tax Types (ImpuestoType)
 */
const TAX_TYPE = {
  IVA: '01',   // Impuesto sobre el Valor Añadido
  IPSI: '02',  // Impuesto sobre la Producción, Servicios e Importación (Ceuta/Melilla)
  IGIC: '03',  // Impuesto General Indirecto Canario
  OTHER: '05'  // Otros
};

/**
 * Hash Algorithm Types (TipoHuellaType)
 */
const HASH_TYPE = {
  SHA256: '01'
};

/**
 * Boolean values used in VeriFactu XML (SiNoType)
 */
const BOOL = {
  YES: 'S',
  NO: 'N'
};

/**
 * Previous Rejection indicator values (RechazoPrevioType)
 */
const PREVIOUS_REJECTION = {
  NO: 'N',
  YES: 'S',
  ERROR_BASED: 'X' // RechazoPrevio por error fundado en derecho
};

/**
 * Software usage flags
 */
const SOFTWARE_USAGE = {
  ONLY_VERIFACTU: BOOL.NO,      // TipoUsoPosibleSoloVerifactu
  MULTI_TAXPAYER: BOOL.YES,     // TipoUsoPosibleMultiOT
  MULTIPLE_TAXPAYERS: BOOL.YES  // IndicadorMultiplesOT
};

/**
 * Maximum invoices per batch submission
 */
const MAX_INVOICES_PER_BATCH = 1000;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if invoice type is a rectification
 */
function isRectificationInvoice(type) {
  return type.startsWith('R');
}

/**
 * Check if invoice type is a standard invoice (F-type)
 */
function isStandardInvoice(type) {
  return type.startsWith('F');
}

/**
 * Check if invoice type requires reference to original invoice
 */
function requiresInvoiceReference(type) {
  return isRectificationInvoice(type) || type === INVOICE_TYPE.F3;
}

// =============================================================================
// VERIFACTU XML CLASS
// =============================================================================

class VeriFactuXML {
  constructor(options) {
    this.query = options.query;
    this.software = {
      companyName: options.software_company_name,
      companyNif: this.normalizeNif(options.software_company_nif),
      name: options.software_name,
      id: options.software_id.slice(0, 2),
      version: options.software_version,
      installNumber: options.software_install_number
    };
  }

  // ===========================================================================
  // FORMATTING HELPERS
  // ===========================================================================

  /**
   * Format invoice number using company formula
   */
  formatInvoiceNumber(company, invoice) {
    const formulaKey = isStandardInvoice(invoice.verifactu_type) ? 'formula' : 'formula_r';
    const defaultFormula = isStandardInvoice(invoice.verifactu_type) ? '%n%' : 'R-%n%';
    let formula = company[formulaKey] ?? defaultFormula;

    // Replace padded number placeholder
    formula = formula.replace(/%n\.(\d+)%/, (_, len) =>
      invoice.num.toString().padStart(parseInt(len), '0')
    );

    // Replace year and number placeholders
    const year = new Date(invoice.dt).getFullYear();
    const replacements = {
      '%n%': invoice.num,
      '%y%': year.toString().slice(-2),
      '%Y%': year
    };

    return formula.replace(/%n%|%y%|%Y%/g, match => replacements[match]);
  }

  /**
   * Format currency amount with 2 decimal places
   */
  formatCurrency(amount) {
    return amount.toFixed(2);
  }

  /**
   * Format date as DD-MM-YYYY
   */
  formatDate(invoice) {
    return new Date(invoice.dt).toLocaleDateString('en-GB').replace(/\//g, '-');
  }

  /**
   * Normalize NIF/CIF (uppercase, alphanumeric only)
   */
  normalizeNif(str) {
    return str.toUpperCase().replace(/\W/gu, '').trim();
  }

  // ===========================================================================
  // LOGGING
  // ===========================================================================

  log(message) {
    const timestamp = new Date().toISOString().substring(0, 19).replace('T', ' ');
    console.log(`[${timestamp}] ${message}`);
  }

  // ===========================================================================
  // DATABASE QUERIES
  // ===========================================================================

  /**
   * Get the last invoice sent to AEAT for chaining
   */
  async getLastSentInvoice(company) {
    const invoices = await this.query(
      'SELECT * FROM invoices WHERE company_id = ? AND fingerprint IS NOT NULL ORDER BY verifactu_dt DESC, id DESC',
      company.id
    );
    return invoices?.[0];
  }

  // ===========================================================================
  // FINGERPRINT / HASH CALCULATION
  // ===========================================================================

  /**
   * Calculate invoice fingerprint (hash) for AEAT chain verification
   */
  calculateFingerprint(company, invoice, previousInvoice, timestamp, isVoided = false) {
    const previousHash = previousInvoice?.fingerprint ?? '';
    const emitterNif = this.normalizeNif(company.vat_id);
    const invoiceNumber = this.formatInvoiceNumber(company, invoice);
    const invoiceDate = this.formatDate(invoice);

    let data;
    if (isVoided) {
      // Hash for voided invoice registration
      data = [
        `IDEmisorFacturaAnulada=${emitterNif}`,
        `NumSerieFacturaAnulada=${invoiceNumber}`,
        `FechaExpedicionFacturaAnulada=${invoiceDate}`,
        `Huella=${previousHash}`,
        `FechaHoraHusoGenRegistro=${timestamp}`
      ].join('&');
    } else {
      // Hash for new invoice registration
      data = [
        `IDEmisorFactura=${emitterNif}`,
        `NumSerieFactura=${invoiceNumber}`,
        `FechaExpedicionFactura=${invoiceDate}`,
        `TipoFactura=${invoice.verifactu_type}`,
        `CuotaTotal=${this.formatCurrency(invoice.tvat)}`,
        `ImporteTotal=${this.formatCurrency(invoice.total)}`,
        `Huella=${previousHash}`,
        `FechaHoraHusoGenRegistro=${timestamp}`
      ].join('&');
    }

    return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
  }

  // ===========================================================================
  // XML GENERATION - INVOICE REGISTRATION (Alta)
  // ===========================================================================

  /**
   * Build XML for invoice registration (RegistroAlta)
   */
  async buildRegistroAlta(company, invoice, previousInvoice, timestamp) {
    // Get operation description
    let description = invoice.comments;
    if (!description) {
      const lines = await this.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY num',
        invoice.id
      );
      description = lines[0]?.descr;
    }

    const emitterNif = this.normalizeNif(company.vat_id);
    const invoiceNumber = this.formatInvoiceNumber(company, invoice);

    let xml = `<sum:RegistroFactura>
                 <RegistroAlta>
                   <IDVersion>${SCHEMA_VERSION}</IDVersion>
                   <IDFactura>
                     <IDEmisorFactura>${emitterNif}</IDEmisorFactura>
                     <NumSerieFactura>${invoiceNumber}</NumSerieFactura>
                     <FechaExpedicionFactura>${this.formatDate(invoice)}</FechaExpedicionFactura>
                   </IDFactura>
                   <NombreRazonEmisor>${company.name}</NombreRazonEmisor>
                   ${invoice.verifactu_err ? `<Subsanacion>${BOOL.YES}</Subsanacion>` : ''}
                   ${invoice.verifactu_err ? `<RechazoPrevio>${PREVIOUS_REJECTION.ERROR_BASED}</RechazoPrevio>` : ''}
                   <TipoFactura>${invoice.verifactu_type}</TipoFactura>`;

    // Handle rectification/substitution invoices
    if (requiresInvoiceReference(invoice.verifactu_type)) {
      xml += await this.buildRectificationSection(company, invoice);
    }

    xml += `<DescripcionOperacion>${description}</DescripcionOperacion>`;

    // Recipient information
    xml += this.buildRecipientSection(invoice);

    // Tax breakdown
    xml += await this.buildTaxBreakdown(invoice);

    // Totals
    xml += `<CuotaTotal>${this.formatCurrency(invoice.tvat)}</CuotaTotal>`;
    xml += `<ImporteTotal>${this.formatCurrency(invoice.total)}</ImporteTotal>`;

    // Chain linking and fingerprint
    xml += this.buildChainSection(company, previousInvoice);
    xml += this.buildSoftwareInfo();
    xml += `<FechaHoraHusoGenRegistro>${timestamp}</FechaHoraHusoGenRegistro>`;
    xml += `<TipoHuella>${HASH_TYPE.SHA256}</TipoHuella>`;
    xml += `<Huella>${this.calculateFingerprint(company, invoice, previousInvoice, timestamp, false)}</Huella>`;
    xml += '</RegistroAlta></sum:RegistroFactura>';

    return xml;
  }

  /**
   * Build rectification/substitution section
   */
  async buildRectificationSection(company, invoice) {
    let xml = '';

    if (invoice.verifactu_stype) {
      const rectType = invoice.verifactu_stype === RECTIFICATION_TYPE.SUBSTITUTION
        ? RECTIFICATION_TYPE.SUBSTITUTION
        : RECTIFICATION_TYPE.INCREMENTAL;
      xml += `<TipoRectificativa>${rectType}</TipoRectificativa>`;
    }

    const referencedInvoices = await this.query(
      'SELECT * FROM invoices WHERE id = ? ORDER BY dt',
      invoice.invoice_ref_id
    );

    if (referencedInvoices?.length) {
      const isSubstitution = invoice.verifactu_type === INVOICE_TYPE.F3;
      const containerTag = isSubstitution ? 'FacturasSustituidas' : 'FacturasRectificadas';
      const itemTag = isSubstitution ? 'IDFacturaSustituida' : 'IDFacturaRectificada';

      xml += `<${containerTag}>`;
      for (const refInvoice of referencedInvoices) {
        xml += `<${itemTag}>
                  <IDEmisorFactura>${this.normalizeNif(company.vat_id)}</IDEmisorFactura>
                  <NumSerieFactura>${this.formatInvoiceNumber(company, refInvoice)}</NumSerieFactura>
                  <FechaExpedicionFactura>${this.formatDate(refInvoice)}</FechaExpedicionFactura>
                </${itemTag}>`;
      }
      xml += `</${containerTag}>`;

      // Add rectification amounts for substitution type
      if (invoice.verifactu_stype === RECTIFICATION_TYPE.SUBSTITUTION) {
        let totalBase = 0;
        let totalVat = 0;

        for (const refInvoice of referencedInvoices) {
          const totals = await this.query(
            'SELECT SUM(bi) AS bi, SUM(tvat) AS tvat FROM invoice_lines WHERE invoice_id = ?',
            refInvoice.id
          );
          if (totals?.[0]) {
            totalBase += Number(totals[0].bi ?? 0);
            totalVat += Number(totals[0].tvat ?? 0);
          }
        }

        xml += `<ImporteRectificacion>
                  <BaseRectificada>${this.formatCurrency(totalBase)}</BaseRectificada>
                  <CuotaRectificada>${this.formatCurrency(totalVat)}</CuotaRectificada>
                </ImporteRectificacion>`;
      }
    }

    return xml;
  }

  /**
   * Build recipient section
   */
  buildRecipientSection(invoice) {
    if (!invoice.vat_id) {
      // Simplified invoice without recipient identification (Art. 61d)
      return `<FacturaSinIdentifDestinatarioArt61d>${BOOL.YES}</FacturaSinIdentifDestinatarioArt61d>`;
    }

    return `<Destinatarios>
              <IDDestinatario>
                <NombreRazon>${invoice.name}</NombreRazon>
                <NIF>${invoice.vat_id}</NIF>
              </IDDestinatario>
            </Destinatarios>`;
  }

  /**
   * Build tax breakdown section
   */
  async buildTaxBreakdown(invoice) {
    const lines = await this.query(
      'SELECT vat, SUM(bi) AS bi, SUM(tvat) AS tvat FROM invoice_lines WHERE invoice_id = ? GROUP BY vat',
      invoice.id
    );

    let xml = '<Desglose>';

    for (const line of lines) {
      xml += `<DetalleDesglose>
                <Impuesto>${TAX_TYPE.IVA}</Impuesto>`;

      if (line.vat) {
        // Taxable operation
        xml += `<ClaveRegimen>${TAX_REGIME.GENERAL}</ClaveRegimen>
                <CalificacionOperacion>${OPERATION_QUALIFICATION.S1}</CalificacionOperacion>
                <TipoImpositivo>${line.vat}</TipoImpositivo>
                <BaseImponibleOimporteNoSujeto>${this.formatCurrency(line.bi)}</BaseImponibleOimporteNoSujeto>
                <CuotaRepercutida>${this.formatCurrency(line.tvat)}</CuotaRepercutida>`;
      } else {
        // Non-taxable operation
        xml += `<CalificacionOperacion>${OPERATION_QUALIFICATION.N1}</CalificacionOperacion>
                <BaseImponibleOimporteNoSujeto>${this.formatCurrency(line.bi)}</BaseImponibleOimporteNoSujeto>`;
      }

      xml += '</DetalleDesglose>';
    }

    xml += '</Desglose>';
    return xml;
  }

  /**
   * Build chain linking section
   */
  buildChainSection(company, previousInvoice) {
    if (!previousInvoice) {
      return `<Encadenamiento><PrimerRegistro>${BOOL.YES}</PrimerRegistro></Encadenamiento>`;
    }

    return `<Encadenamiento>
              <RegistroAnterior>
                <IDEmisorFactura>${this.normalizeNif(company.vat_id)}</IDEmisorFactura>
                <NumSerieFactura>${previousInvoice.numFmt}</NumSerieFactura>
                <FechaExpedicionFactura>${this.formatDate(previousInvoice)}</FechaExpedicionFactura>
                <Huella>${previousInvoice.fingerprint}</Huella>
              </RegistroAnterior>
            </Encadenamiento>`;
  }

  /**
   * Build software information section
   */
  buildSoftwareInfo() {
    return `<SistemaInformatico>
              <NombreRazon>${this.software.companyName}</NombreRazon>
              <NIF>${this.software.companyNif}</NIF>
              <NombreSistemaInformatico>${this.software.name}</NombreSistemaInformatico>
              <IdSistemaInformatico>${this.software.id}</IdSistemaInformatico>
              <Version>${this.software.version}</Version>
              <NumeroInstalacion>${this.software.installNumber}</NumeroInstalacion>
              <TipoUsoPosibleSoloVerifactu>${SOFTWARE_USAGE.ONLY_VERIFACTU}</TipoUsoPosibleSoloVerifactu>
              <TipoUsoPosibleMultiOT>${SOFTWARE_USAGE.MULTI_TAXPAYER}</TipoUsoPosibleMultiOT>
              <IndicadorMultiplesOT>${SOFTWARE_USAGE.MULTIPLE_TAXPAYERS}</IndicadorMultiplesOT>
            </SistemaInformatico>`;
  }

  // ===========================================================================
  // XML GENERATION - INVOICE CANCELLATION (Anulacion)
  // ===========================================================================

  /**
   * Build XML for invoice cancellation (RegistroAnulacion)
   */
  buildRegistroAnulacion(company, invoice, previousInvoice, timestamp) {
    const emitterNif = this.normalizeNif(company.vat_id);

    let xml = `<sum:RegistroFactura>
                 <RegistroAnulacion>
                   <IDVersion>${SCHEMA_VERSION}</IDVersion>
                   <IDFactura>
                     <IDEmisorFacturaAnulada>${emitterNif}</IDEmisorFacturaAnulada>
                     <NumSerieFacturaAnulada>${this.formatInvoiceNumber(company, invoice)}</NumSerieFacturaAnulada>
                     <FechaExpedicionFacturaAnulada>${this.formatDate(invoice)}</FechaExpedicionFacturaAnulada>
                   </IDFactura>
                   ${invoice.verifactu_err ? `<RechazoPrevio>${BOOL.YES}</RechazoPrevio>` : ''}`;

    xml += this.buildChainSection(company, previousInvoice);
    xml += this.buildSoftwareInfo();
    xml += `<FechaHoraHusoGenRegistro>${timestamp}</FechaHoraHusoGenRegistro>`;
    xml += `<TipoHuella>${HASH_TYPE.SHA256}</TipoHuella>`;
    xml += `<Huella>${this.calculateFingerprint(company, invoice, previousInvoice, timestamp, true)}</Huella>`;
    xml += '</RegistroAnulacion></sum:RegistroFactura>';

    return xml;
  }

  // ===========================================================================
  // BATCH PROCESSING
  // ===========================================================================

  /**
   * Process all pending invoices for all companies
   */
  async processPendingInvoices() {
    const response = { companies: {} };

    const companies = await this.query(
      'SELECT *, UNIX_TIMESTAMP(next_send)-UNIX_TIMESTAMP(NOW()) AS nxSend FROM companies'
    );

    if (!companies) return response;

    for (const company of companies) {
      response.companies[company.id] = {};

      // Check if we need to wait before sending
      if (company.nxSend && company.nxSend > 0) {
        response.companies[company.id] = {
          message: `Next send in ${company.nxSend} seconds`
        };
        continue;
      }

      // Get pending invoices
      const invoices = await this.query(
        `SELECT * FROM invoices WHERE company_id = ? AND verifactu_dt IS NULL ORDER BY dt LIMIT ${MAX_INVOICES_PER_BATCH}`,
        company.id
      );

      response.companies[company.id] = await this.submitInvoices(company, invoices);
    }

    return response;
  }

  /**
   * Void invoices
   */
  async voidInvoices(company, invoices) {
    return this.submitInvoices(company, invoices, true);
  }

  /**
   * Submit invoices to AEAT
   */
  async submitInvoices(company, invoices, isVoided = false) {
    if (!invoices?.length) {
      return { message: 'No invoices to send' };
    }

    // Build invoice number lookup map
    const invoicesByNumber = {};
    for (const idx in invoices) {
      invoicesByNumber[this.formatInvoiceNumber(company, invoices[idx])] = idx;
    }

    // Format timestamp with timezone
    const timestamp = this.formatTimestamp(new Date());

    // Build SOAP envelope
    let xml = this.buildSoapEnvelopeStart(company);

    // Get chain start point
    let chain = await this.getLastSentInvoice(company);
    chain = chain
      ? { numFmt: this.formatInvoiceNumber(company, chain), dt: chain.dt, fingerprint: chain.fingerprint }
      : null;

    // Add each invoice to the batch
    for (const invoice of invoices) {
      const fingerprint = this.calculateFingerprint(company, invoice, chain, timestamp, isVoided);
      invoice._prev = chain;
      chain = {
        numFmt: this.formatInvoiceNumber(company, invoice),
        dt: invoice.dt,
        fingerprint: fingerprint
      };

      if (isVoided) {
        xml += this.buildRegistroAnulacion(company, invoice, invoice._prev, timestamp);
      } else {
        xml += await this.buildRegistroAlta(company, invoice, invoice._prev, timestamp);
      }
    }

    xml += this.buildSoapEnvelopeEnd();

    // Send to AEAT
    const response = await this.sendToAEAT(company, xml);

    if (response.status !== 200 || response.error) {
      this.log(`Unable to connect, status=${response.status}, error=${response.error}`);
      return response;
    }

    // Process response
    return this.processAEATResponse(response, company, invoices, invoicesByNumber, timestamp, isVoided);
  }

  /**
   * Format timestamp with timezone offset
   */
  formatTimestamp(date) {
    const options = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false };
    const dateString = date.toLocaleString('sv-SE', options).replace(' ', 'T');
    const offset = date.getTimezoneOffset() / -60;
    const sign = offset >= 0 ? '+' : '-';
    return `${dateString}${sign}${String(Math.abs(offset)).padStart(2, '0')}:00`;
  }

  /**
   * Build SOAP envelope start
   */
  buildSoapEnvelopeStart(company) {
    return `<?xml version="1.0" encoding="UTF-8"?>
            <soapenv:Envelope xmlns:soapenv="${XML_NAMESPACES.SOAP}"
              xmlns:sum="${XML_NAMESPACES.SUMINISTRO_LR}"
              xmlns="${XML_NAMESPACES.SUMINISTRO_INFO}">
              <soapenv:Header/>
              <soapenv:Body>
                <sum:RegFactuSistemaFacturacion>
                  <sum:Cabecera>
                    <ObligadoEmision>
                      <NombreRazon>${company.name}</NombreRazon>
                      <NIF>${this.normalizeNif(company.vat_id)}</NIF>
                    </ObligadoEmision>
                  </sum:Cabecera>`;
  }

  /**
   * Build SOAP envelope end
   */
  buildSoapEnvelopeEnd() {
    return `    </sum:RegFactuSistemaFacturacion>
              </soapenv:Body>
            </soapenv:Envelope>`;
  }

  /**
   * Process AEAT response
   */
  async processAEATResponse(response, company, invoices, invoicesByNumber, timestamp, isVoided) {
    return new Promise(resolve => {
      const result = { ok: [], ko: [] };

      xml2js.parseString(response.response, {
        explicitArray: false,
        mergeAttrs: true,
        tagNameProcessors: [xml2js.processors.stripPrefix]
      }, async (err, parsed) => {
        if (err) {
          this.log(`Error=${err}`);
          return resolve(result);
        }

        const aeatResponse = parsed.Envelope?.Body?.RespuestaRegFactuSistemaFacturacion;
        if (!aeatResponse) {
          this.log('Invalid XML response');
          return resolve(result);
        }

        const csv = aeatResponse.CSV;
        const waitTime = aeatResponse.TiempoEsperaEnvio;
        const presentationTimestamp = aeatResponse?.DatosPresentacion?.TimestampPresentacion;
        const utcTimestamp = new Date(presentationTimestamp || timestamp)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 19);

        // Update company's next send time
        await this.query(
          'UPDATE companies SET next_send = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?',
          [waitTime, company.id]
        );

        // Process response lines
        let lines = aeatResponse.RespuestaLinea || [];
        if (!Array.isArray(lines)) lines = [lines];

        for (const line of lines) {
          const invoiceNumber = line?.IDFactura?.NumSerieFactura;
          const errorCode = line?.CodigoErrorRegistro ?? 0;
          const errorDescription = line?.DescripcionErrorRegistro;

          const invoice = invoices[invoicesByNumber[invoiceNumber]];
          if (!invoice) {
            result.ko.push({ num: invoiceNumber, codError: 'Not exists' });
            continue;
          }

          // Build update fields
          const updateFields = {
            verifactu_dt: utcTimestamp,
            verifactu_err: +errorCode
          };

          if (csv) {
            updateFields.verifactu_csv = ((invoice.verifactu_csv || '') + '\n' + csv).trim();
          }

          if (presentationTimestamp) {
            updateFields.fingerprint = this.calculateFingerprint(
              company, invoice, invoice._prev, presentationTimestamp, isVoided
            );
          }

          if (!errorCode && isVoided) {
            updateFields.voided = 1;
          }

          await this.query('UPDATE invoices SET ? WHERE id = ?', [updateFields, invoice.id]);

          // Add to results
          if (errorCode) {
            result.ko.push({
              id: invoice.id,
              num: invoiceNumber,
              codError: errorCode,
              descrError: errorDescription
            });
          } else {
            result.ok.push({ id: invoice.id, num: invoiceNumber });
          }

          // Log response
          const logItems = [
            'Operacion.TipoOperacion',
            'EstadoRegistro',
            'CodigoErrorRegistro',
            'DescripcionErrorRegistro',
            'IDFactura.NumSerieFactura',
            'IDFactura.IDEmisorFactura'
          ];

          const logMessage = lines.map(l =>
            logItems.map(item => {
              const value = item.split('.').reduce((obj, key) => obj?.[key], l);
              return value ? `${item.split('.').pop()}=${value}` : null;
            }).filter(Boolean).join(' ')
          ).join('\n');

          this.log(logMessage);
        }

        resolve(result);
      });
    });
  }

  // ===========================================================================
  // QUERY RECORDS FROM AEAT
  // ===========================================================================

  /**
   * Parse invoice number from formatted string
   * Extracts the numeric part from formats like "2025/00001" or "R-2025/001"
   */
  parseInvoiceNumber(numFmt) {
    if (!numFmt) return 0;
    const match = numFmt.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Get max invoice number from AEAT for a given year
   * Returns { F: maxFNumber, R: maxRNumber }
   */
  async getMaxInvoiceNumberFromAEAT(company, year = 0) {
    year = year || new Date().getFullYear();
    const result = { F: 0, R: 0 };

    // Query all 12 months of the year
    for (let month = 1; month <= 12; month++) {
      try {
        const records = await this.queryRecords(company, year, month);
        if (!Array.isArray(records)) continue;

        for (const record of records) {
          const numSerie = record.IDFactura?.NumSerieFactura;
          const tipo = record.DatosRegistroFacturacion?.TipoFactura;
          if (!numSerie || !tipo) continue;

          const num = this.parseInvoiceNumber(numSerie);
          const series = tipo.startsWith('R') ? 'R' : 'F';

          if (num > result[series]) {
            result[series] = num;
          }
        }
      } catch (err) {
        // Continue on error, may not have data for all months
        this.log(`Error querying month ${month}: ${err.message}`);
      }
    }

    return result;
  }

  /**
   * Sync invoice numbers with AEAT
   * Checks if local DB has any invoices for the year, if not queries AEAT
   * and updates company.first_num to continue from the correct number
   */
  async syncInvoiceNumbers(company, year = 0) {
    year = year || new Date().getFullYear();

    // Check if we have any local invoices for this year
    const localInvoices = await this.query(
      'SELECT MAX(num) AS maxF FROM invoices WHERE company_id = ? AND YEAR(dt) = ? AND LEFT(verifactu_type, 1) = ?',
      [company.id, year, 'F']
    );
    const localRInvoices = await this.query(
      'SELECT MAX(num) AS maxR FROM invoices WHERE company_id = ? AND YEAR(dt) = ? AND LEFT(verifactu_type, 1) = ?',
      [company.id, year, 'R']
    );

    const hasLocalF = localInvoices?.[0]?.maxF > 0;
    const hasLocalR = localRInvoices?.[0]?.maxR > 0;

    // If we have local invoices, no need to sync
    if (hasLocalF && hasLocalR) {
      return { synced: false, reason: 'Local invoices exist' };
    }

    // Query AEAT for max numbers
    this.log(`Syncing invoice numbers with AEAT for year ${year}...`);
    const aeatMax = await this.getMaxInvoiceNumberFromAEAT(company, year);

    const result = {
      synced: true,
      year,
      aeatMaxF: aeatMax.F,
      aeatMaxR: aeatMax.R,
      localMaxF: localInvoices?.[0]?.maxF || 0,
      localMaxR: localRInvoices?.[0]?.maxR || 0
    };

    this.log(`AEAT max numbers: F=${aeatMax.F}, R=${aeatMax.R}`);
    return result;
  }

  /**
   * Get next invoice number, checking AEAT if needed
   */
  async getNextInvoiceNumber(company, type, year = 0) {
    year = year || new Date().getFullYear();
    const series = type.startsWith('R') ? 'R' : 'F';
    const firstNum = company.first_num || 1;

    // First check local DB
    const localResult = await this.query(
      'SELECT MAX(num) AS maxNum FROM invoices WHERE company_id = ? AND YEAR(dt) = ? AND LEFT(verifactu_type, 1) = ?',
      [company.id, year, series]
    );

    const localMax = localResult?.[0]?.maxNum || 0;

    // If we have local invoices, use that
    if (localMax > 0) {
      return localMax + 1;
    }

    // No local invoices - check AEAT
    try {
      this.log(`No local ${series}-series invoices for ${year}, checking AEAT...`);
      const aeatMax = await this.getMaxInvoiceNumberFromAEAT(company, year);
      const aeatNum = aeatMax[series] || 0;

      if (aeatNum > 0) {
        this.log(`AEAT has ${series}-series invoices up to ${aeatNum}, next will be ${aeatNum + 1}`);
        return aeatNum + 1;
      }
    } catch (err) {
      this.log(`Error checking AEAT: ${err.message}, falling back to first_num`);
    }

    // No AEAT invoices either, use first_num
    return firstNum;
  }

  /**
   * Query submitted records from AEAT
   */
  async queryRecords(company, year = 0, month = 0) {
    const currentDate = new Date();
    year = Math.max(2025, Math.min(2200, year)) || currentDate.getFullYear();
    month = String(Math.max(1, Math.min(12, month || currentDate.getMonth() + 1))).padStart(2, '0');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
                 <soapenv:Envelope xmlns:soapenv="${XML_NAMESPACES.SOAP}"
                   xmlns:con="${XML_NAMESPACES.CONSULTA_LR}"
                   xmlns:sum="${XML_NAMESPACES.SUMINISTRO_INFO}">
                   <soapenv:Header/>
                   <soapenv:Body>
                     <con:ConsultaFactuSistemaFacturacion>
                       <con:Cabecera>
                         <sum:IDVersion>${SCHEMA_VERSION}</sum:IDVersion>
                         <sum:ObligadoEmision>
                           <sum:NombreRazon>${company.name}</sum:NombreRazon>
                           <sum:NIF>${this.normalizeNif(company.vat_id)}</sum:NIF>
                         </sum:ObligadoEmision>
                       </con:Cabecera>
                       <con:FiltroConsulta>
                         <con:PeriodoImputacion>
                           <sum:Ejercicio>${year}</sum:Ejercicio>
                           <sum:Periodo>${month}</sum:Periodo>
                         </con:PeriodoImputacion>
                       </con:FiltroConsulta>
                     </con:ConsultaFactuSistemaFacturacion>
                   </soapenv:Body>
                 </soapenv:Envelope>`;

    const response = await this.sendToAEAT(company, xml);

    if (response.status !== 200 || response.error) {
      return response;
    }

    return new Promise(resolve => {
      xml2js.parseString(response.response, {
        explicitArray: false,
        mergeAttrs: true,
        tagNameProcessors: [xml2js.processors.stripPrefix]
      }, (err, result) => {
        if (err) return resolve([]);
        const records = result.Envelope?.Body?.RespuestaConsultaFactuSistemaFacturacion?.RegistroRespuestaConsultaFactuSistemaFacturacion;
        resolve(records || []);
      });
    });
  }

  // ===========================================================================
  // HTTPS COMMUNICATION WITH AEAT
  // ===========================================================================

  /**
   * Send XML to AEAT web service
   */
  async sendToAEAT(company, xml) {
    try {
      if (!company.cert_key || !company.cert_content) {
        return {
          status: 0,
          error: `No certificate configured for company ${company.id}`
        };
      }

      const url = new URL(company.test ? AEAT_URLS.TEST : AEAT_URLS.PRODUCTION);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        key: company.cert_key,
        cert: company.cert_content,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(xml)
        }
      };

      return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
          let data = '';
          const status = res.statusCode;

          res.on('data', chunk => { data += chunk; });
          res.on('end', () => { resolve({ status, response: data }); });
        });

        req.on('error', err => { reject({ status: 0, error: err }); });
        req.write(xml);
        req.end();
      });
    } catch (err) {
      this.log(`Error: ${err}`);
      throw err;
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

// Export constants for external use
module.exports = options => new VeriFactuXML(options);

module.exports.INVOICE_TYPE = INVOICE_TYPE;
module.exports.RECTIFICATION_TYPE = RECTIFICATION_TYPE;
module.exports.OPERATION_QUALIFICATION = OPERATION_QUALIFICATION;
module.exports.TAX_REGIME = TAX_REGIME;
module.exports.TAX_TYPE = TAX_TYPE;
module.exports.HASH_TYPE = HASH_TYPE;
module.exports.BOOL = BOOL;
module.exports.PREVIOUS_REJECTION = PREVIOUS_REJECTION;
module.exports.AEAT_URLS = AEAT_URLS;
module.exports.MAX_INVOICES_PER_BATCH = MAX_INVOICES_PER_BATCH;
