#!/bin/bash

# Database Initialization Script for Data-Bunker
echo "🚀 Initializing Data-Bunker Database..."

# Configuration
DB_NAME="${POSTGRES_DB:-databunker}"
DB_USER="${POSTGRES_USER:-databunker_user}"
DB_PASSWORD="${POSTGRES_PASSWORD:-your_secure_password}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

# Check if PostgreSQL is running
echo "📡 Checking PostgreSQL connection..."
if ! command -v psql &> /dev/null; then
    echo "❌ psql command not found. Please install PostgreSQL client."
    exit 1
fi

# Test connection
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c '\q' 2>/dev/null; then
    echo "❌ Cannot connect to PostgreSQL server at $DB_HOST:$DB_PORT"
    echo "Please ensure PostgreSQL is running and credentials are correct."
    exit 1
fi

echo "✅ Connected to PostgreSQL server"

# Create database user if not exists
echo "👤 Creating database user..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" | grep -q 1 || \
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"

# Create database if not exists
echo "🗄️  Creating database..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# Grant privileges
echo "🔐 Granting privileges..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

# Run schema
echo "📋 Creating schema..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$(dirname "$0")/../src/models/schema.sql"

if [ $? -eq 0 ]; then
    echo "✅ Database initialized successfully!"
    echo ""
    echo "📝 Database Details:"
    echo "   Host: $DB_HOST"
    echo "   Port: $DB_PORT"
    echo "   Database: $DB_NAME"
    echo "   User: $DB_USER"
    echo ""
    echo "🔧 Update your .env file with:"
    echo "   POSTGRES_HOST=$DB_HOST"
    echo "   POSTGRES_PORT=$DB_PORT"
    echo "   POSTGRES_DB=$DB_NAME"
    echo "   POSTGRES_USER=$DB_USER"
    echo "   POSTGRES_PASSWORD=$DB_PASSWORD"
else
    echo "❌ Failed to initialize database schema"
    exit 1
fi
