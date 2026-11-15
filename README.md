# X3 Document PDF Converter

A standalone browser-based PDF-to-XTC / XTCH converter for Xteink X3.

## Features

- Accepts text PDFs, scanned PDFs, image-based PDFs, and mixed PDFs.
- Renders every PDF page to a bitmap with PDF.js; no OCR or text extraction is used.
- Automatically rotates portrait pages to landscape while leaving landscape pages unchanged.
- Conservatively trims white margins before splitting.
- Splits each landscape page into three equal vertical sections in left-to-right order.
- Rotates each section for sideways X3 reading and fits it to 528 × 792 without stretching.
- Exports XTC (1-bit) or XTCH (4-level grayscale).
- Supports Atkinson, Floyd–Steinberg, Sierra Lite, Ordered/Bayer, and no dithering, plus brightness and contrast.
- Processes PDF pages sequentially and releases temporary canvases after each page.
- All processing happens locally in the browser; PDF files are not uploaded.

## Run

Open `index.html` through GitHub Pages or a local static web server. The first run needs an internet connection to load PDF.js from jsDelivr.

## Notes

- One output XTC/XTCH file is generated for each input PDF.
- A PDF page becomes exactly three X3 pages: left, center, right.
- White-border trimming is conservative by default. Use Aggressive only if the document has wide blank margins; use Off if there are thin marks close to the page edge.
- The first-page preview shows the three cropped sections before conversion.

## Credits

XTC/XTCH page encoding and container-writing logic are adapted from the user's `MangaToX3` project. PDF.js is loaded from its public CDN package. The original project license is included; referenced components remain subject to their respective licenses.
