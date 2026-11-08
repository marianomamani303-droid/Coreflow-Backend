-- 004: almacenamiento de invitaciones, aditivo y repetible.
-- Ejecutar con la base seleccionada, despues de schema.sql.
-- No elimina ni corrige filas historicas. Los duplicados pendientes o datos
-- incompatibles deben resolverse explicitamente antes de agregar restricciones.
-- Una invitacion vencida debe pasar a expired para liberar el correo pendiente.

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'department') = 0,
  'ALTER TABLE company_invitations ADD COLUMN department VARCHAR(80) NULL', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'job_title') = 0,
  'ALTER TABLE company_invitations ADD COLUMN job_title VARCHAR(100) NULL', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'updated_at') = 0,
  'ALTER TABLE company_invitations ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'delivery_status') = 0,
  'ALTER TABLE company_invitations ADD COLUMN delivery_status ENUM(''not_sent'', ''sent'', ''failed'') NOT NULL DEFAULT ''not_sent''', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'send_attempts') = 0,
  'ALTER TABLE company_invitations ADD COLUMN send_attempts INT UNSIGNED NOT NULL DEFAULT 0', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'last_send_attempt_at') = 0,
  'ALTER TABLE company_invitations ADD COLUMN last_send_attempt_at DATETIME(6) NULL', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'last_sent_at') = 0,
  'ALTER TABLE company_invitations ADD COLUMN last_sent_at DATETIME(6) NULL', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'last_send_error') = 0,
  'ALTER TABLE company_invitations ADD COLUMN last_send_error VARCHAR(100) NULL COMMENT ''Codigo de error; no guardar credenciales ni tokens''', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND COLUMN_NAME = 'pending_email') = 0,
  'ALTER TABLE company_invitations ADD COLUMN pending_email VARCHAR(254) GENERATED ALWAYS AS (CASE WHEN status = ''pending'' THEN LOWER(TRIM(email)) ELSE NULL END) STORED', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND INDEX_NAME = 'uq_invitations_pending') = 0,
  'ALTER TABLE company_invitations ADD UNIQUE KEY uq_invitations_pending (company_id, pending_email)', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_invitations' AND INDEX_NAME = 'idx_invitations_expiry') = 0,
  'ALTER TABLE company_invitations ADD KEY idx_invitations_expiry (status, expires_at)', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_invitations_accepted_by') = 0,
  'ALTER TABLE company_invitations ADD CONSTRAINT chk_invitations_accepted_by CHECK ((status = ''accepted'' AND accepted_by IS NOT NULL) OR (status <> ''accepted'' AND accepted_by IS NULL))', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_invitations_email') = 0,
  'ALTER TABLE company_invitations ADD CONSTRAINT chk_invitations_email CHECK (CHAR_LENGTH(TRIM(email)) > 3)', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;

SET @invitations_ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'chk_invitations_delivery') = 0,
  'ALTER TABLE company_invitations ADD CONSTRAINT chk_invitations_delivery CHECK (delivery_status = ''not_sent'' OR (send_attempts > 0 AND last_send_attempt_at IS NOT NULL AND (delivery_status <> ''sent'' OR last_sent_at IS NOT NULL)))', 'DO 0'
);
PREPARE invitations_statement FROM @invitations_ddl;
EXECUTE invitations_statement;
DEALLOCATE PREPARE invitations_statement;
