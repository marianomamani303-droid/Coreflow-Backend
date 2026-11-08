-- 005: reserva breve de envio para serializar solicitudes concurrentes.
-- Aditiva, repetible, sin modificar invitaciones o membresias existentes.
SET @invitation_delivery_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'delivery_lock_id') = 0,
  'ALTER TABLE company_invitations ADD COLUMN delivery_lock_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL', 'DO 0'
);
PREPARE invitation_delivery_statement FROM @invitation_delivery_ddl;
EXECUTE invitation_delivery_statement;
DEALLOCATE PREPARE invitation_delivery_statement;

SET @invitation_delivery_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'delivery_locked_until') = 0,
  'ALTER TABLE company_invitations ADD COLUMN delivery_locked_until DATETIME(6) NULL', 'DO 0'
);
PREPARE invitation_delivery_statement FROM @invitation_delivery_ddl;
EXECUTE invitation_delivery_statement;
DEALLOCATE PREPARE invitation_delivery_statement;

SET @invitation_delivery_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_invitations_delivery_lock') = 0,
  'ALTER TABLE company_invitations ADD CONSTRAINT chk_invitations_delivery_lock CHECK ((delivery_lock_id IS NULL AND delivery_locked_until IS NULL) OR (delivery_lock_id IS NOT NULL AND delivery_locked_until IS NOT NULL))', 'DO 0'
);
PREPARE invitation_delivery_statement FROM @invitation_delivery_ddl;
EXECUTE invitation_delivery_statement;
DEALLOCATE PREPARE invitation_delivery_statement;
