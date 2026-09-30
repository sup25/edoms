#!/bin/bash
# Creates one database per service.
#
# Each service owns its own schema and they never share a connection, so this
# is five databases in one server rather than one shared database - the same
# split the services already assume via DB_NAME.
#
# Runs only when the postgres data volume is empty; on an existing volume the
# official image skips /docker-entrypoint-initdb.d entirely.
set -e

for db in auth_service product_service inventory_service order_service payment_service; do
  echo "Creating database $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
    SELECT 'CREATE DATABASE $db'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec
SQL
done
