-- Runs once when the pgdata volume is created.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE DATABASE medrem_test;
\c medrem_test
CREATE EXTENSION IF NOT EXISTS vector;
