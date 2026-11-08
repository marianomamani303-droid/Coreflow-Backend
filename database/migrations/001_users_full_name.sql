-- Migración aditiva y repetible. La conexión debe seleccionar la base objetivo.
-- Si ya hay usuarios, sus filas se conservan con full_name NULL hasta que
-- se complete el dato real. No inventa nombres ni impone NOT NULL a datos viejos.

SET @users_table_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
);

SET @full_name_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'full_name'
);

SET @full_name_migration = IF(
  @users_table_exists = 1 AND @full_name_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `full_name` VARCHAR(120) NULL',
  'DO 0'
);

PREPARE full_name_statement FROM @full_name_migration;
EXECUTE full_name_statement;
DEALLOCATE PREPARE full_name_statement;
