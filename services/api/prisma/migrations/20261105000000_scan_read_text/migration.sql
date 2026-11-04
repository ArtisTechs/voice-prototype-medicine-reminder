-- Text Gemini read from the package (used to fill the add-medicine form from the box camera).
ALTER TABLE `scans` ADD COLUMN `read_name` VARCHAR(120) NULL, ADD COLUMN `read_strength` VARCHAR(40) NULL;
