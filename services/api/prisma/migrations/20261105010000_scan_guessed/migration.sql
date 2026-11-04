-- True when the scan result came from how the package looks (a guess), not from printed text.
ALTER TABLE `scans` ADD COLUMN `guessed` BOOLEAN NOT NULL DEFAULT false;
