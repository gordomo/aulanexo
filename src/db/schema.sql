CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE,
 name VARCHAR(160) NOT NULL, password_hash VARCHAR(256) NOT NULL, super_admin BOOLEAN NOT NULL DEFAULT FALSE,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS institutes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, slug VARCHAR(80) NOT NULL UNIQUE,
 contact_email VARCHAR(254) NOT NULL, phone VARCHAR(40), active BOOLEAN NOT NULL DEFAULT TRUE,
 plan VARCHAR(100) NOT NULL DEFAULT 'Estándar', monthly_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
 due_day TINYINT UNSIGNED NOT NULL DEFAULT 10, settings JSON NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS memberships (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 role ENUM('admin','teacher','student') NOT NULL DEFAULT 'student', status ENUM('pending','approved','rejected','inactive') NOT NULL DEFAULT 'pending',
 UNIQUE(institute_id,user_id), UNIQUE(institute_id,id), FOREIGN KEY(institute_id) REFERENCES institutes(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NULL, csrf CHAR(64) NOT NULL,
 expires_at DATETIME NOT NULL, INDEX(expires_at), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS access_tokens (
 token_hash CHAR(64) PRIMARY KEY, kind ENUM('reset','invite') NOT NULL, email VARCHAR(254) NOT NULL,
 institute_id BIGINT UNSIGNED NULL, role ENUM('admin','teacher','student') NULL,
 expires_at DATETIME NOT NULL, used_at DATETIME NULL, FOREIGN KEY(institute_id) REFERENCES institutes(id)
);
CREATE TABLE IF NOT EXISTS people (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NULL, kind ENUM('student','teacher') NOT NULL,
 first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, email VARCHAR(254), phone VARCHAR(40),
 dni VARCHAR(30), birth_date DATE, address VARCHAR(255), guardian_name VARCHAR(160), guardian_phone VARCHAR(40), guardian_email VARCHAR(254),
 notes TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(institute_id,id), UNIQUE(institute_id,user_id,kind), UNIQUE(institute_id,kind,dni),
 FOREIGN KEY(institute_id) REFERENCES institutes(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS courses (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(160) NOT NULL, level VARCHAR(40) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(institute_id,id), FOREIGN KEY(institute_id) REFERENCES institutes(id)
);
CREATE TABLE IF NOT EXISTS commissions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL, course_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(100) NOT NULL, academic_year SMALLINT UNSIGNED NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
 schedule VARCHAR(255) NOT NULL, classroom VARCHAR(100), modality ENUM('presencial','virtual','hibrida') NOT NULL,
 capacity SMALLINT UNSIGNED NOT NULL, monthly_cents BIGINT UNSIGNED NOT NULL, enrollment_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(institute_id,id),
 FOREIGN KEY(institute_id,course_id) REFERENCES courses(institute_id,id)
);
CREATE TABLE IF NOT EXISTS enrollments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL,
 person_id BIGINT UNSIGNED NOT NULL, commission_id BIGINT UNSIGNED NOT NULL, billing_start DATE NOT NULL,
 discount_percent TINYINT UNSIGNED NOT NULL DEFAULT 0, UNIQUE(institute_id,id), UNIQUE(institute_id,person_id,commission_id),
 FOREIGN KEY(institute_id,person_id) REFERENCES people(institute_id,id), FOREIGN KEY(institute_id,commission_id) REFERENCES commissions(institute_id,id)
);
CREATE TABLE IF NOT EXISTS teaching (
 institute_id BIGINT UNSIGNED NOT NULL, person_id BIGINT UNSIGNED NOT NULL, commission_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(institute_id,person_id,commission_id), FOREIGN KEY(institute_id,person_id) REFERENCES people(institute_id,id),
 FOREIGN KEY(institute_id,commission_id) REFERENCES commissions(institute_id,id)
);
CREATE TABLE IF NOT EXISTS lessons (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL,
 commission_id BIGINT UNSIGNED NOT NULL, starts_at DATETIME NOT NULL,
 UNIQUE(institute_id,id), UNIQUE(institute_id,commission_id,starts_at), FOREIGN KEY(institute_id,commission_id) REFERENCES commissions(institute_id,id)
);
CREATE TABLE IF NOT EXISTS attendance (
 institute_id BIGINT UNSIGNED NOT NULL, lesson_id BIGINT UNSIGNED NOT NULL, person_id BIGINT UNSIGNED NOT NULL,
 present BOOLEAN NOT NULL, updated_by BIGINT UNSIGNED NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(institute_id,lesson_id,person_id), FOREIGN KEY(institute_id,lesson_id) REFERENCES lessons(institute_id,id),
 FOREIGN KEY(institute_id,person_id) REFERENCES people(institute_id,id), FOREIGN KEY(updated_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS charges (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL,
 person_id BIGINT UNSIGNED NOT NULL, enrollment_id BIGINT UNSIGNED NULL,
 kind ENUM('monthly','enrollment','manual') NOT NULL, period CHAR(7) NULL, description VARCHAR(255) NOT NULL,
 cents BIGINT UNSIGNED NOT NULL, due_date DATE NOT NULL, status ENUM('pending','paid','forgiven') NOT NULL DEFAULT 'pending',
 forgiveness_reason TEXT NULL, UNIQUE(institute_id,id), UNIQUE(institute_id,enrollment_id,kind,period),
 FOREIGN KEY(institute_id,person_id) REFERENCES people(institute_id,id), FOREIGN KEY(institute_id,enrollment_id) REFERENCES enrollments(institute_id,id)
);
CREATE TABLE IF NOT EXISTS payments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL, charge_id BIGINT UNSIGNED NOT NULL,
 method VARCHAR(60) NOT NULL, paid_date DATE NOT NULL, reference VARCHAR(160), received_by BIGINT UNSIGNED NOT NULL,
 UNIQUE(institute_id,id), UNIQUE(institute_id,charge_id), FOREIGN KEY(institute_id,charge_id) REFERENCES charges(institute_id,id), FOREIGN KEY(received_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS platform_charges (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL, description VARCHAR(255) NOT NULL,
 period CHAR(7) NULL, cents BIGINT UNSIGNED NOT NULL, due_date DATE NOT NULL,
 status ENUM('pending','paid') NOT NULL DEFAULT 'pending', paid_date DATE NULL, method VARCHAR(60) NULL,
 UNIQUE(institute_id,period), FOREIGN KEY(institute_id) REFERENCES institutes(id)
);
CREATE TABLE IF NOT EXISTS notifications (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NOT NULL, title VARCHAR(160) NOT NULL,
 body TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(institute_id,id), FOREIGN KEY(institute_id) REFERENCES institutes(id)
);
CREATE TABLE IF NOT EXISTS notification_recipients (
 institute_id BIGINT UNSIGNED NOT NULL, notification_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, read_at DATETIME NULL,
 PRIMARY KEY(institute_id,notification_id,user_id), FOREIGN KEY(institute_id,notification_id) REFERENCES notifications(institute_id,id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS outbox (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, recipient VARCHAR(254) NOT NULL, subject VARCHAR(255) NOT NULL, body TEXT NOT NULL,
 sent_at DATETIME NULL, attempts INT UNSIGNED NOT NULL DEFAULT 0, available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 dedupe_key VARCHAR(160) NULL UNIQUE, INDEX(sent_at,available_at)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, institute_id BIGINT UNSIGNED NULL, user_id BIGINT UNSIGNED NOT NULL,
 action VARCHAR(100) NOT NULL, entity_id BIGINT UNSIGNED NULL, detail TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(institute_id) REFERENCES institutes(id)
);

CREATE TABLE IF NOT EXISTS job_markers (dedupe_key VARCHAR(160) PRIMARY KEY, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS institute_requests (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 institute_name VARCHAR(160) NOT NULL,
 contact_name VARCHAR(160) NOT NULL,
 email VARCHAR(254) NOT NULL,
 phone VARCHAR(40) NULL,
 message TEXT NULL,
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 request_key CHAR(64) NOT NULL,
 pending_key CHAR(64) GENERATED ALWAYS AS (CASE WHEN status='pending' THEN request_key ELSE NULL END) STORED,
 institute_id BIGINT UNSIGNED NULL,
 reviewed_by BIGINT UNSIGNED NULL,
 review_reason TEXT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at DATETIME NULL,
 UNIQUE(pending_key), INDEX(status,created_at),
 FOREIGN KEY(institute_id) REFERENCES institutes(id),
 FOREIGN KEY(reviewed_by) REFERENCES users(id)
);
