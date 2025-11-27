# VeriFactu API Usage Guide

## Production API

The VeriFactu API is deployed at:

```
https://verifactu.investhinks.com
```

### Authentication

All API endpoints (except `/health`) require an authentication token in the URL path:

```
https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/...
```

Contact your administrator to obtain your `TOKEN` and `COMPANY_ID`.

---

## Endpoints

### Health Check

```bash
curl https://verifactu.investhinks.com/health
```

**Response:**
```json
{"status": "ok", "timestamp": "2025-01-15T10:30:00.000Z"}
```

### Process Pending Invoices

Sends all pending invoices to AEAT. Called automatically every minute.

```bash
curl https://verifactu.investhinks.com/api/{TOKEN}/process
```

**Response:**
```json
{
  "companies": {
    "1": {
      "ok": [{"id": 5, "num": "2025/00001"}],
      "ko": []
    }
  }
}
```

---

## Invoice Operations

### List All Invoices

```bash
curl https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices
```

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "num": 1,
      "name": "Cliente Example",
      "total": 121.00,
      "verifactu_type": "F1",
      "verifactu_dt": "2025-01-15 10:00:00",
      "number_format": "2025/00001"
    }
  ]
}
```

### Get Single Invoice

```bash
curl https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}
```

**Response:**
```json
{
  "id": 1,
  "num": 1,
  "name": "Cliente Example",
  "vat_id": "A12345678",
  "total": 121.00,
  "number_format": "2025/00001",
  "lines": [
    {"num": 1, "descr": "Service", "units": 1, "price": 100, "vat": 21, "total": 121}
  ]
}
```

### Create Invoice

```bash
curl -X POST https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Client Name",
    "vat_id": "A12345678",
    "address": "Street 123",
    "postal_code": "28001",
    "city": "Madrid",
    "country": "ES",
    "email": "client@example.com",
    "ref": "PO-2025-001",
    "comments": "Monthly service",
    "lines": [
      {"descr": "Consulting services", "units": 10, "price": 50, "vat": 21},
      {"descr": "Travel expenses", "units": 1, "price": 150, "vat": 21}
    ]
  }'
```

**Invoice Types (automatic):**
- With `vat_id` → Creates **F1** (standard invoice)
- Without `vat_id` → Creates **F2** (simplified invoice)

**Response:**
```json
{"id": 5}
```

### Get Invoice QR Code

Returns a PNG image for AEAT invoice verification.

```bash
curl https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/qr \
  --output invoice_qr.png
```

---

## Invoice Corrections

### Rectification Invoice (R1/R5)

Creates a rectification that replaces the original invoice values.

```bash
curl -X POST https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/rect \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Client Name",
    "vat_id": "A12345678",
    "lines": [
      {"descr": "Corrected service", "units": 10, "price": 45, "vat": 21}
    ]
  }'
```

- With `vat_id` → Creates **R1**
- Without `vat_id` → Creates **R5**

### Rectification by Difference (R2)

Creates a rectification showing only the difference.

```bash
curl -X POST https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/rect2 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Client Name",
    "vat_id": "A12345678",
    "lines": [
      {"descr": "Price adjustment", "units": 1, "price": -50, "vat": 21}
    ]
  }'
```

### Substitute Invoice (F3)

Replaces a simplified invoice (F2) with a full invoice.

```bash
curl -X POST https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/sust \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Client Name",
    "vat_id": "A12345678",
    "lines": [
      {"descr": "Service", "units": 1, "price": 100, "vat": 21}
    ]
  }'
```

### Rectification + Substitution (R1/R5 + S)

```bash
curl -X POST https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/rectsust \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Client Name",
    "vat_id": "A12345678",
    "lines": [
      {"descr": "Updated service", "units": 1, "price": 90, "vat": 21}
    ]
  }'
```

---

## Void Invoice

Cancel an invoice that was sent to AEAT by mistake.

```bash
# Void single invoice
curl -X PUT https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/voided

# Void multiple invoices
curl -X PUT https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/5,6,7/voided
```

**Requirements:**
- Invoice must have been sent to AEAT (`verifactu_dt` is not null)
- Invoice must not already be voided
- Invoice must not be referenced by another invoice

---

## Query AEAT Records

Query invoices that have been registered with AEAT.

```bash
# Query specific month
curl "https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/query?year=2025&month=1"

# Defaults to current month if not specified
curl "https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/query"
```

---

## Invoice Types Reference

| Type | Name | Description |
|------|------|-------------|
| **F1** | Factura | Standard invoice with recipient VAT ID |
| **F2** | Factura Simplificada | Simplified invoice without recipient VAT ID |
| **F3** | Factura Sustitutiva | Substitute for a simplified invoice |
| **R1** | Rectificativa | Rectification of F1/F3 |
| **R2** | Rectificativa por Diferencias | Rectification showing only differences |
| **R5** | Rectificativa Simplificada | Rectification of F2 |

---

## Invoice Line Format

```json
{
  "descr": "Description of the service or product",
  "units": 1,
  "price": 100.00,
  "vat": 21
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `descr` | string | Yes | Line description |
| `units` | number | No | Quantity (default: 1) |
| `price` | number | Yes | Unit price (excl. VAT) |
| `vat` | number | No | VAT percentage (0, 4, 10, 21) |

---

## Create Invoice Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Client/recipient name |
| `vat_id` | string | No | Client VAT ID (NIF/CIF). Omit for simplified invoices |
| `address` | string | No | Client address |
| `postal_code` | string | No | Postal code |
| `city` | string | No | City |
| `state` | string | No | Province/state |
| `country` | string | No | Country code (default: ES) |
| `email` | string | No | Client email |
| `ref` | string | No | Reference/PO number |
| `comments` | string | No | Invoice comments |
| `lines` | array | **Yes** | Invoice lines (see above) |

---

## Error Responses

```json
{
  "error": "Error message here"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation error |
| 401 | Unauthorized / invalid token |
| 404 | Resource not found |
| 413 | Request body too large |
| 503 | Service unavailable |

---

## AEAT Submission Status

After creating an invoice, it will be automatically sent to AEAT within 60 seconds. Check the invoice status:

```bash
curl https://verifactu.investhinks.com/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}
```

**Status fields:**
| Field | Description |
|-------|-------------|
| `verifactu_dt` | Timestamp when sent to AEAT (null = pending) |
| `verifactu_csv` | AEAT confirmation code (on success) |
| `verifactu_err` | Error code (on failure) |
| `fingerprint` | SHA-256 hash for invoice chain |

---

## Invoice Number Formats

Companies can configure invoice number formats using placeholders:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `%n%` | Invoice number | 1, 2, 3... |
| `%n.5%` | Padded number (5 digits) | 00001, 00002... |
| `%y%` | 2-digit year | 25 |
| `%Y%` | 4-digit year | 2025 |

**Examples:**
- `%Y%/%n.5%` → 2025/00001
- `F-%y%-%n.4%` → F-25-0001
- `%n%` → 1, 2, 3...

---

## Test vs Production Mode

Each company has a `test` flag:
- `test = 1` → Invoices sent to AEAT **test** environment (prewww1.aeat.es)
- `test = 0` → Invoices sent to AEAT **production** environment (www1.agenciatributaria.gob.es)

Contact your administrator to switch between test and production modes.

---

## Rate Limits

- Maximum 1000 invoices per batch submission
- Automatic processing runs every 60 seconds
- QR code generation is synchronous

---

## Support

For API access, company setup, or technical support, contact your system administrator.
