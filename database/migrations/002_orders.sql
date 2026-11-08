-- Migración 002: aditiva y repetible. Conserva órdenes anteriores con depósito y clave NULL.
-- Ejecutar con la base seleccionada, después de schema.sql. No modifica invitaciones.

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'warehouse_id') = 0,
  'ALTER TABLE orders ADD COLUMN warehouse_id BIGINT UNSIGNED NULL', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'discount_amount') = 0,
  'ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'request_key') = 0,
  'ALTER TABLE orders ADD COLUMN request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'request_hash') = 0,
  'ALTER TABLE orders ADD COLUMN request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'version') = 0,
  'ALTER TABLE orders ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'uq_orders_request') = 0,
  'ALTER TABLE orders ADD UNIQUE KEY uq_orders_request (company_id, request_key)', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_warehouse') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_warehouse FOREIGN KEY (company_id, warehouse_id) REFERENCES warehouses (company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;

SET @orders_migration = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_orders_discount') = 0,
  'ALTER TABLE orders ADD CONSTRAINT chk_orders_discount CHECK (discount_amount >= 0)', 'DO 0'
);
PREPARE orders_statement FROM @orders_migration;
EXECUTE orders_statement;
DEALLOCATE PREPARE orders_statement;
