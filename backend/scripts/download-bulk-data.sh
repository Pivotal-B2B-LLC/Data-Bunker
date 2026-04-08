#!/bin/bash

echo "🚀 Companies House Bulk Data Download"
echo "======================================"
echo ""

DATA_DIR="./bulk-data"
mkdir -p "$DATA_DIR"

echo "📥 Downloading Companies House bulk data..."
echo "   This is about 2GB and will take 5-10 minutes..."
echo ""

# Use the correct current URL
BASE_URL="http://download.companieshouse.gov.uk"

echo "1️⃣  Downloading BasicCompanyDataAsOneFile-2024-01-01.zip"
wget -O "$DATA_DIR/BasicCompanyDataAsOneFile.zip" \
  "${BASE_URL}/BasicCompanyDataAsOneFile-2024-01-01.zip" \
  --progress=bar:force 2>&1

if [ $? -ne 0 ]; then
  echo ""
  echo "⚠️  Primary URL failed. Trying alternative..."
  echo ""
  
  # Try alternative date format
  wget -O "$DATA_DIR/BasicCompanyDataAsOneFile.zip" \
    "${BASE_URL}/BasicCompanyDataAsOneFile-2023-12-01.zip" \
    --progress=bar:force 2>&1
  
  if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Download failed. Please download manually from:"
    echo "   http://download.companieshouse.gov.uk/en_output.html"
    echo ""
    echo "Save the file to: $DATA_DIR/BasicCompanyDataAsOneFile.zip"
    exit 1
  fi
fi

# Extract files
echo ""
echo "📦 Extracting files..."
cd "$DATA_DIR"
unzip -o BasicCompanyDataAsOneFile.zip

cd ..

echo ""
echo "✅ Download complete!"
echo ""
echo "Files in $DATA_DIR:"
ls -lh "$DATA_DIR"/*.csv 2>/dev/null || ls -lh "$DATA_DIR"
echo ""
echo "📊 Next step: Run ./scripts/fast-import.sh"
