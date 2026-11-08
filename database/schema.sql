-- CoreFlow | Esquema inicial para MySQL 8.0.16+ / MariaDB 10.4+ / TiDB 8.5+.
-- En TiDB, habilitar tidb_enable_check_constraint antes de importar (db:setup).
-- Crea tablas faltantes sin reemplazar las existentes. No altera sus columnas.
-- Para usuarios existentes sin full_name, ejecutar primero la migración 001.
-- Las fechas se guardan en UTC; la aplicación futura debe mantener esa convención.
-- Este archivo define almacenamiento; no define contratos HTTP.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS coreflow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE coreflow;

-- Identidad global. Una misma cuenta puede pertenecer a varias empresas.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  email_verified_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_name CHECK (CHAR_LENGTH(TRIM(full_name)) >= 2),
  CONSTRAINT chk_users_email CHECK (CHAR_LENGTH(TRIM(email)) > 3),
  CONSTRAINT chk_users_password CHECK (CHAR_LENGTH(password_hash) > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  sector VARCHAR(80) NULL,
  tax_id VARCHAR(40) NULL,
  description VARCHAR(1000) NULL,
  contact_email VARCHAR(254) NULL,
  contact_phone VARCHAR(40) NULL,
  address VARCHAR(255) NULL,
  logo_data MEDIUMBLOB NULL,
  logo_mime VARCHAR(32) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ARS',
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  CONSTRAINT chk_companies_name CHECK (CHAR_LENGTH(TRIM(name)) >= 2)
) ENGINE = InnoDB;

-- El rol pertenece a la membresía, no al usuario global.
-- Los empleados se representan con usuarios + membresías, sin duplicar personas.
CREATE TABLE IF NOT EXISTS company_memberships (
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner', 'admin', 'employee') NOT NULL DEFAULT 'employee',
  department VARCHAR(80) NULL,
  job_title VARCHAR(100) NULL,
  status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (company_id, user_id),
  KEY idx_memberships_user (user_id, status),
  KEY idx_memberships_role (company_id, role, status),
  CONSTRAINT fk_memberships_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS company_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(254) NOT NULL,
  role ENUM('admin', 'employee') NOT NULL DEFAULT 'employee',
  department VARCHAR(80) NULL,
  job_title VARCHAR(100) NULL,
  token_hash BINARY(32) NOT NULL COMMENT 'SHA-256 del token; nunca el token original',
  invited_by BIGINT UNSIGNED NOT NULL,
  accepted_by BIGINT UNSIGNED NULL,
  status ENUM('pending', 'accepted', 'declined', 'revoked', 'expired')
    NOT NULL DEFAULT 'pending',
  expires_at DATETIME(6) NOT NULL,
  accepted_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  delivery_status ENUM('not_sent', 'sent', 'failed') NOT NULL DEFAULT 'not_sent',
  send_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_send_attempt_at DATETIME(6) NULL,
  last_sent_at DATETIME(6) NULL,
  last_send_error VARCHAR(100) NULL COMMENT 'Codigo de error; no guardar credenciales ni tokens',
  delivery_lock_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  delivery_locked_until DATETIME(6) NULL,
  -- NULL permite conservar multiples invitaciones historicas para el mismo correo.
  pending_email VARCHAR(254) GENERATED ALWAYS AS (
    CASE WHEN status = 'pending' THEN LOWER(TRIM(email)) ELSE NULL END
  ) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY uq_invitations_token (token_hash),
  UNIQUE KEY uq_invitations_pending (company_id, pending_email),
  KEY idx_invitations_company (company_id, status, email),
  KEY idx_invitations_recipient (email, status, expires_at),
  KEY idx_invitations_expiry (status, expires_at),
  CONSTRAINT fk_invitations_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_invitations_sender FOREIGN KEY (company_id, invited_by)
    REFERENCES company_memberships (company_id, user_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_invitations_recipient FOREIGN KEY (accepted_by)
    -- NO ACTION implícito conserva RESTRICT. TiDB 8.5 rechaza acciones
    -- explícitas sobre accepted_by porque también participa en un CHECK.
    REFERENCES users (id),
  CONSTRAINT chk_invitations_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_invitations_acceptance CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL)
    OR (status <> 'accepted' AND accepted_at IS NULL)
  ),
  CONSTRAINT chk_invitations_accepted_by CHECK (
    (status = 'accepted' AND accepted_by IS NOT NULL)
    OR (status <> 'accepted' AND accepted_by IS NULL)
  ),
  CONSTRAINT chk_invitations_email CHECK (CHAR_LENGTH(TRIM(email)) > 3),
  CONSTRAINT chk_invitations_delivery CHECK (
    delivery_status = 'not_sent'
    OR (send_attempts > 0 AND last_send_attempt_at IS NOT NULL
      AND (delivery_status <> 'sent' OR last_sent_at IS NOT NULL))
  ),
  CONSTRAINT chk_invitations_delivery_lock CHECK (
    (delivery_lock_id IS NULL AND delivery_locked_until IS NULL)
    OR (delivery_lock_id IS NOT NULL AND delivery_locked_until IS NOT NULL)
  )
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_company_id (company_id, id),
  UNIQUE KEY uq_categories_name (company_id, name),
  CONSTRAINT fk_categories_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_categories_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  price DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  UNIQUE KEY uq_products_company_id (company_id, id),
  UNIQUE KEY uq_products_sku (company_id, sku),
  KEY idx_products_category (company_id, category_id),
  KEY idx_products_listing (company_id, status, name),
  CONSTRAINT fk_products_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_products_category FOREIGN KEY (company_id, category_id)
    REFERENCES categories (company_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT chk_products_name CHECK (CHAR_LENGTH(TRIM(name)) >= 2),
  CONSTRAINT chk_products_sku CHECK (CHAR_LENGTH(TRIM(sku)) > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS warehouses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255) NULL,
  status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouses_company_id (company_id, id),
  UNIQUE KEY uq_warehouses_name (company_id, name),
  CONSTRAINT fk_warehouses_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_warehouses_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE = InnoDB;

-- Un saldo por producto y depósito. Stock total = SUM(quantity) de sus depósitos.
CREATE TABLE IF NOT EXISTS inventory_balances (
  company_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  minimum_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (company_id, warehouse_id, product_id),
  KEY idx_inventory_product (company_id, product_id),
  CONSTRAINT fk_inventory_warehouse FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_inventory_product FOREIGN KEY (company_id, product_id)
    REFERENCES products (company_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  order_number VARCHAR(40) NOT NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_email VARCHAR(254) NULL,
  status ENUM('pending', 'processing', 'completed', 'cancelled')
    NOT NULL DEFAULT 'pending',
  currency CHAR(3) NOT NULL DEFAULT 'ARS',
  total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  warehouse_id BIGINT UNSIGNED NULL,
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_company_id (company_id, id),
  UNIQUE KEY uq_orders_number (company_id, order_number),
  UNIQUE KEY uq_orders_request (company_id, request_key),
  KEY idx_orders_listing (company_id, status, created_at),
  KEY idx_orders_date (company_id, created_at),
  CONSTRAINT fk_orders_company FOREIGN KEY (company_id)
    REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_orders_creator FOREIGN KEY (company_id, created_by)
    REFERENCES company_memberships (company_id, user_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_orders_total CHECK (total_amount >= 0),
  CONSTRAINT chk_orders_discount CHECK (discount_amount >= 0),
  CONSTRAINT fk_orders_warehouse FOREIGN KEY (company_id, warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_orders_number CHECK (CHAR_LENGTH(TRIM(order_number)) > 0),
  CONSTRAINT chk_orders_customer CHECK (CHAR_LENGTH(TRIM(customer_name)) > 0)
) ENGINE = InnoDB;

-- Nombre, SKU y precio son fotografías de la venta: no cambian con el catálogo.
CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(160) NOT NULL,
  product_sku VARCHAR(64) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(15, 2) NOT NULL,
  line_total DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,

  PRIMARY KEY (id),
  KEY idx_order_items_order (company_id, order_id),
  KEY idx_order_items_product (company_id, product_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_items_product FOREIGN KEY (company_id, product_id)
    REFERENCES products (company_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
  CONSTRAINT chk_order_items_price CHECK (unit_price >= 0)
) ENGINE = InnoDB;

-- Trazabilidad de responsables y transiciones, sin depender de updated_at.
CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  action ENUM('created', 'edited', 'status') NOT NULL,
  status ENUM('pending', 'processing', 'completed', 'cancelled') NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_order_events_order (company_id, order_id, id),
  CONSTRAINT fk_order_events_order FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_events_creator FOREIGN KEY (company_id, created_by)
    REFERENCES company_memberships (company_id, user_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB;

-- Movimiento y saldo se guardan juntos, bloqueando el saldo para evitar sobreventa.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  type ENUM('initial', 'inbound', 'outbound', 'adjustment') NOT NULL,
  quantity_delta INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  PRIMARY KEY (id),
  KEY idx_movements_balance (company_id, warehouse_id, product_id, created_at),
  KEY idx_movements_order (company_id, order_id),
  CONSTRAINT fk_movements_balance FOREIGN KEY (company_id, warehouse_id, product_id)
    REFERENCES inventory_balances (company_id, warehouse_id, product_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_movements_order FOREIGN KEY (company_id, order_id)
    REFERENCES orders (company_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_movements_creator FOREIGN KEY (company_id, created_by)
    REFERENCES company_memberships (company_id, user_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_movements_quantity CHECK (
    (type IN ('initial', 'inbound') AND quantity_delta > 0)
    OR (type = 'outbound' AND quantity_delta < 0)
    OR (type = 'adjustment' AND quantity_delta <> 0)
  ),
  CONSTRAINT chk_movements_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0)
) ENGINE = InnoDB;

-- Preferencias operativas por empresa; los valores omitidos conservan el comportamiento anterior.
CREATE TABLE IF NOT EXISTS company_settings (
  company_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  date_format ENUM('dmy', 'mdy', 'iso') NOT NULL DEFAULT 'dmy',
  default_minimum INT UNSIGNED NOT NULL DEFAULT 0,
  inventory_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  inventory_view ENUM('all', 'low', 'zero', 'available') NOT NULL DEFAULT 'all',
  product_view ENUM('table', 'cards') NOT NULL DEFAULT 'table',
  auto_create_balances BOOLEAN NOT NULL DEFAULT FALSE,
  default_category VARCHAR(80) NOT NULL DEFAULT '',
  order_initial_status ENUM('pending', 'processing') NOT NULL DEFAULT 'pending',
  order_view ENUM('all', 'pending', 'processing', 'completed', 'cancelled') NOT NULL DEFAULT 'all',
  order_after_save ENUM('confirm', 'new', 'close') NOT NULL DEFAULT 'confirm',
  default_warehouse_id BIGINT UNSIGNED NULL,
  default_customer_name VARCHAR(160) NOT NULL DEFAULT 'Consumidor final',
  default_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  remember_warehouse BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (company_id),
  CONSTRAINT fk_settings_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_settings_warehouse FOREIGN KEY (company_id, default_warehouse_id)
    REFERENCES warehouses (company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_settings_minimum CHECK (default_minimum <= 2147483647),
  CONSTRAINT chk_settings_quantity CHECK (default_quantity BETWEEN 1 AND 1000000)
) ENGINE = InnoDB;

-- Preferencias individuales: nunca dependen de un company_id enviado por el cliente.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  density ENUM('comfortable', 'compact') NOT NULL DEFAULT 'comfortable',
  date_format ENUM('company', 'dmy', 'mdy', 'iso') NOT NULL DEFAULT 'company',
  inventory_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB;
