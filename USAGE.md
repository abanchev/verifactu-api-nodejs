# VeriFactu API Usage Guide

## Quick Start

After deployment, the API is available at `http://localhost:8023` (or your configured URL).

### Get Your API Token

On first startup, if `BACKEND_TOKEN` is not set, one will be generated and printed to the console:

```
Generated BACKEND_TOKEN: abc123...
```

Save this token - you'll need it for all API calls.

## Authentication

All API endpoints (except `/health`) require the token in the URL path:

```
/api/{TOKEN}/...
```

## Endpoints

### Health Check

```bash
# No authentication required
curl http://localhost:8023/health
```

**Response:**
```json
{"status": "ok", "timestamp": "2025-01-15T10:30:00.000Z"}
```

### Process Pending Invoices

Sends all pending invoices to AEAT. Called automatically every minute if `PROCESS_INTERVAL > 0`.

```bash
curl http://localhost:8023/api/{TOKEN}/process
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
curl http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices
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
curl http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}
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
curl -X POST http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices \
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

**Invoice Types:**
- With `vat_id` → Creates **F1** (standard invoice)
- Without `vat_id` → Creates **F2** (simplified invoice)

**Response:**
```json
{"id": 5}
```

### Get Invoice QR Code

Returns a PNG image for invoice verification.

```bash
curl http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/{INVOICE_ID}/qr \
  --output invoice_qr.png
```

---

## Invoice Corrections

### Rectification Invoice (R1/R5)

Creates a rectification that replaces the original invoice values.

```bash
# Rectify invoice ID 5
curl -X POST http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/5/rect \
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
curl -X POST http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/5/rect2 \
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
curl -X POST http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/5/sust \
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
curl -X POST http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/5/rectsust \
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
curl -X PUT http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/5/voided

# Void multiple invoices
curl -X PUT http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/invoices/5,6,7/voided
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
curl "http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/query?year=2025&month=1"

# Defaults to current month if not specified
curl "http://localhost:8023/api/{TOKEN}/{COMPANY_ID}/query"
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

## Company Setup

Before creating invoices, add a company to the database:

```sql
INSERT INTO companies SET
  code = 'mycompany',
  name = 'My Company SL',
  vat_id = 'B12345678',
  address = 'Calle Principal 1',
  postal_code = '28001',
  city = 'Madrid',
  state = 'Madrid',
  country = 'ES',
  formula = '%Y%/%n.5%',
  formula_r = 'R-%Y%/%n.5%',
  first_num = 1,
  created = CURRENT_DATE,
  test = 1;
```

### Invoice Number Formulas

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `%n%` | Invoice number | 1, 2, 3... |
| `%n.5%` | Padded number | 00001, 00002... |
| `%y%` | 2-digit year | 25 |
| `%Y%` | 4-digit year | 2025 |

**Examples:**
- `%Y%/%n.5%` → 2025/00001
- `F-%y%-%n.4%` → F-25-0001
- `%n%` → 1, 2, 3...

### Test vs Production

- `test = 1` → Sends to AEAT test environment
- `test = 0` → Sends to AEAT production environment

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
| 503 | Service unavailable (database down) |

---

## Docker Health Check

Add to your `docker-compose.yml`:

```yaml
services:
  verifactu:
    # ...
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8023/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MYSQL_HOST` | No | 127.0.0.1 | Database host |
| `MYSQL_PORT` | No | 3306 | Database port |
| `MYSQL_NAME` | **Yes** | - | Database name |
| `MYSQL_USER` | **Yes** | - | Database user |
| `MYSQL_PASS` | **Yes** | - | Database password |
| `KEY_CONTENT` | **Yes** | - | Private key PEM content |
| `CERT_CONTENT` | **Yes** | - | Certificate PEM content |
| `SOFTWARE_COMPANY_NAME` | **Yes** | - | Your company name |
| `SOFTWARE_COMPANY_NIF` | **Yes** | - | Your company VAT ID |
| `SOFTWARE_NAME` | No | verifactu | Software name |
| `SOFTWARE_ID` | No | vf | Software ID (2 chars) |
| `SOFTWARE_VERSION` | No | 1.0 | Software version |
| `SOFTWARE_INSTALL_NUMBER` | No | 00001 | Installation number |
| `BACKEND_URL` | No | http://0.0.0.0:8023 | API URL |
| `BACKEND_TOKEN` | No | Auto-generated | API authentication token |
| `ALLOW_IP` | No | - | Restrict to specific IP |
| `PROCESS_INTERVAL` | No | 60 | Auto-process interval (seconds, 0 to disable) |
| `TIMEZONE` | No | Europe/Madrid | Timezone for dates |
