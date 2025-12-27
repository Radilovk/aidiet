#!/bin/bash

# Service worker registration code
SW_CODE='
        // --- PWA Service Worker Registration ---
        if ('\''serviceWorker'\'' in navigator) {
            window.addEventListener('\''load'\'', () => {
                navigator.serviceWorker.register('\''/sw.js'\'')
                    .then(registration => {
                        console.log('\''Service Worker registered:'\'', registration);
                    })
                    .catch(error => {
                        console.error('\''Service Worker registration failed:'\'', error);
                    });
            });
        }'

# Function to add SW registration before closing </script> tag
add_sw_registration() {
    local file=$1
    
    # Check if SW registration already exists
    if grep -q "serviceWorker.register" "$file"; then
        echo "$file already has SW registration, skipping"
        return
    fi
    
    # Find last </script> before </body> and add SW code before it
    # Use a more robust approach with awk
    awk -v sw_code="$SW_CODE" '
        /<\/script>/ {
            in_script_close = 1
            script_close_line = $0
            next
        }
        in_script_close {
            if (/<\/body>/) {
                print sw_code
                print script_close_line
                in_script_close = 0
            } else {
                print script_close_line
                in_script_close = 0
            }
        }
        { print }
        END {
            if (in_script_close) {
                print sw_code
                print script_close_line
            }
        }
    ' "$file" > "${file}.tmp" && mv "${file}.tmp" "$file"
    
    echo "Added SW registration to $file"
}

# Add to files that don't have it
for file in questionnaire.html plan.html profile.html admin.html; do
    if [ -f "$file" ]; then
        add_sw_registration "$file"
    fi
done
