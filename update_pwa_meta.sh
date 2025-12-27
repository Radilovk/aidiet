#!/bin/bash

# Function to add PWA meta tags after viewport meta tag
add_pwa_meta() {
    local file=$1
    local title=$(grep -m1 "<title>" "$file")
    
    # Use sed to add PWA meta tags after viewport
    sed -i '/<meta name="viewport"/a\    <meta name="theme-color" content="#10b981">\n    <meta name="apple-mobile-web-app-capable" content="yes">\n    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n    <meta name="apple-mobile-web-app-title" content="NutriPlan">\n    <link rel="manifest" href="/manifest.json">\n    <link rel="apple-touch-icon" href="/icon-192x192.png">' "$file"
    
    echo "Updated $file with PWA meta tags"
}

# Update all HTML files (except index.html which is already updated)
for file in questionnaire.html plan.html profile.html admin.html; do
    if [ -f "$file" ]; then
        add_pwa_meta "$file"
    fi
done
