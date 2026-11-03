#!/bin/sh
# Runs once, when the dbdata volume is created: a second database for the automated tests, so `make test`
# never touches real data (the tests refuse to run against a database whose name does not end in _test).
set -e
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS medrem_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON medrem_test.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
