#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, filename):
    # Create a new image with green background
    img = Image.new('RGB', (size, size), color='#10b981')
    draw = ImageDraw.Draw(img)
    
    # Draw a simple apple icon representation
    # Draw a circle for the apple
    padding = size // 8
    draw.ellipse([padding, padding + size//10, size - padding, size - padding], 
                 fill='white', outline='white')
    
    # Draw a leaf on top
    leaf_size = size // 6
    leaf_x = size // 2 + size // 8
    leaf_y = padding
    draw.ellipse([leaf_x, leaf_y, leaf_x + leaf_size, leaf_y + leaf_size], 
                 fill='#34d399', outline='#34d399')
    
    # Try to add text "NP" in the center
    try:
        font_size = size // 3
        # Use default font
        font = ImageFont.load_default()
        text = "NP"
        # Get text bounding box
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Position text in center
        x = (size - text_width) // 2
        y = (size - text_height) // 2 + size // 10
        draw.text((x, y), text, fill='#10b981', font=font)
    except:
        pass
    
    # Save the image
    img.save(filename, 'PNG')
    print(f'Created {filename}')

# Create both icon sizes
create_icon(192, 'icon-192x192.png')
create_icon(512, 'icon-512x512.png')
