#!/bin/bash

# Cognitive Overload Training Game - Start Script

echo "🎮 Starting Cognitive Overload Training Game..."
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

# Check if requirements are installed
if ! python3 -c "import flask" &> /dev/null; then
    echo "📦 Installing dependencies..."
    pip3 install -r requirements.txt
    echo ""
fi

# Start the Flask application
echo "🚀 Starting Flask server on http://localhost:5000"
echo "📖 Press Ctrl+C to stop the server"
echo ""
echo "🌐 Open your browser and navigate to: http://localhost:5000"
echo ""

python3 app.py
