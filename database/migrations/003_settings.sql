-- 003: ampliación aditiva y repetible de empresas y preferencias.
-- No cambia datos históricos, saldos ni estructuras ajenas a Configuración.

SET @settings_ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'description') = 0,
 'ALTER TABLE companies ADD COLUMN description VARCHAR(1000) NULL', 'DO 0');
PREPARE settings_statement FROM @settings_ddl;
EXECUTE settings_statement;
DEALLOCATE PREPARE settings_statement;

SET @settings_ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'contact_email') = 0,
 'ALTER TABLE companies ADD COLUMN contact_email VARCHAR(254) NULL', 'DO 0');
PREPARE settings_statement FROM @settings_ddl;
EXECUTE settings_statement;
DEALLOCATE PREPARE settings_statement;

SET @settings_ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'contact_phone') = 0,
 'ALTER TABLE companies ADD COLUMN contact_phone VARCHAR(40) NULL', 'DO 0');
PREPARE settings_statement FROM @settings_ddl;
EXECUTE settings_statement;
DEALLOCATE PREPARE settings_statement;

SET @settings_ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'address') = 0,
 'ALTER TABLE companies ADD COLUMN address VARCHAR(255) NULL', 'DO 0');
PREPARE settings_statement FROM @settings_ddl;
EXECUTE settings_statement;
DEALLOCATE PREPARE settings_statement;

SET @settings_ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'logo_data') = 0,
 'ALTER TABLE companies ADD COLUMN logo_data MEDIUMBLOB NULL', 'DO 0');
PREPARE settings_statement FROM @settings_ddl;
EXECUTE settings_statement;
DEALLOCATE PREPARE settings_statement;

SET @settings_ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'logo_mime') = 0,
 'ALTER TABLE companies ADD COLUMN logo_mime VARCHAR(32) NULL', 'DO 0');
PREPARE settings_statement FROM @settings_ddl;
EXECUTE settings_statement;
DEALLOCATE PREPARE settings_statement;

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
