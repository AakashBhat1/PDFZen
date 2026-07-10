import fitz
import sys

doc = fitz.open("test/Visit report 030726 Yk-54.pdf")
print(f"Total Pages: {len(doc)}")

for page_idx, page in enumerate(doc):
    print(f"\n--- Page {page_idx + 1} ---")
    
    # Extract blocks
    blocks = page.get_text("blocks")
    print(f"Blocks count: {len(blocks)}")
    for block in blocks[:20]: # show first 20 blocks
        x0, y0, x1, y1, text, block_no, block_type = block
        text_clean = text.replace('\n', ' ').strip()
        print(f"Block {block_no} (Type: {block_type}) bbox: ({x0:.1f}, {y0:.1f}, {x1:.1f}, {y1:.1f})")
        print(f"  Text: {text_clean}")
        
    # Extract images
    image_list = page.get_images()
    print(f"Images count: {len(image_list)}")
    for img_idx, img in enumerate(image_list):
        xref = img[0]
        print(f"  Image {img_idx}: xref={xref}, width={img[2]}, height={img[3]}")
