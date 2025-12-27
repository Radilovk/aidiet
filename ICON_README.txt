PWA Icons for NutriPlan
========================

Current Status:
--------------
✓ SVG icons created (icon-192x192.svg, icon-512x512.svg)
✓ Placeholder PNG icons created (icon-192x192.png, icon-512x512.png)

The SVG icons feature:
- Green background (#10b981)
- White apple icon
- "NP" letters in the center
- Professional, clean design

Converting SVG to PNG:
---------------------
To create proper PNG icons from the SVG files:

**Option 1: Using ImageMagick**
```bash
convert -background none icon-192x192.svg icon-192x192.png
convert -background none icon-512x512.svg icon-512x512.png
```

**Option 2: Using Inkscape**
```bash
inkscape icon-192x192.svg --export-type=png --export-filename=icon-192x192.png
inkscape icon-512x512.svg --export-type=png --export-filename=icon-512x512.png
```

**Option 3: Using online converter**
- Visit: https://cloudconvert.com/svg-to-png
- Upload the SVG files
- Download the converted PNG files

**Option 4: Using design tools**
- Open the SVG in Figma, Sketch, Adobe Illustrator
- Export as PNG with the correct dimensions

Custom Icon Design:
------------------
If you want to create custom icons:

1. Design requirements:
   - Size: 192x192px and 512x512px
   - Format: PNG (with transparency recommended)
   - Background: #10b981 (green) or transparent
   - Icon: Should represent nutrition/health (apple, fork & knife, etc.)
   - Branding: Include "NP" or NutriPlan logo

2. Recommended tools:
   - Figma (free, online)
   - Canva (free, online)
   - Adobe Illustrator
   - Inkscape (free, desktop)

3. Online icon generators:
   - https://favicon.io/
   - https://realfavicongenerator.net/
   - https://www.pwabuilder.com/imageGenerator

Testing Icons:
-------------
After updating the PNG files:
1. Clear browser cache
2. Uninstall the PWA if already installed
3. Reload the page
4. Check manifest in DevTools (Application → Manifest)
5. Reinstall the PWA and verify the icon

The current SVG and placeholder PNG files are functional and will work for testing,
but for production, consider creating professionally designed PNG icons.

