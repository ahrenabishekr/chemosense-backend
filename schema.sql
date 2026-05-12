CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin', 'doctor', 'technician') DEFAULT 'technician',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sensors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(100),
  status ENUM('active', 'inactive', 'maintenance') DEFAULT 'active',
  location VARCHAR(150),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  patient_name VARCHAR(100),
  patient_id VARCHAR(50),
  status ENUM('open', 'closed', 'pending') DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sensor_id INT,
  case_id INT,
  patient_id VARCHAR(50),
  result ENUM('positive', 'negative', 'inconclusive') DEFAULT 'inconclusive',
  value DECIMAL(10, 4),
  unit VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE SET NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ref_library (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  content TEXT,
  tags JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (name, email, password, role) VALUES
('Admin', 'admin@bioscan.com', 'admin123', 'admin'),
('Dr. Smith', 'doctor@bioscan.com', 'doctor123', 'doctor');

INSERT INTO sensors (name, type, status, location, description) VALUES
('Electrochemical Sensor A1', 'Electrochemical', 'active', 'Lab Room 1', 'High sensitivity biosensor'),
('Optical Sensor B2', 'Optical', 'active', 'Lab Room 2', 'Point-of-care optical biosensor'),
('Piezoelectric Sensor C3', 'Piezoelectric', 'maintenance', 'Lab Room 3', 'Mass-sensitive biosensor');
