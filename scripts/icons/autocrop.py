#!/usr/bin/env python3
"""
autocrop.py — Crop transparent borders from a PNG image.

Usage: python3 autocrop.py <input.png> <output.png>

Finds the bounding box of non-transparent pixels and crops to that region.
Uses only Python standard library (no Pillow/PIL required).
Works by parsing PNG via zlib + struct.
"""

import struct
import sys
import zlib


def read_png_chunks(filepath):
    """Read all chunks from a PNG file."""
    with open(filepath, "rb") as f:
        signature = f.read(8)
        if signature != b"\x89PNG\r\n\x1a\n":
            raise ValueError("Not a valid PNG file")

        chunks = []
        while True:
            length_bytes = f.read(4)
            if len(length_bytes) < 4:
                break
            length = struct.unpack(">I", length_bytes)[0]
            chunk_type = f.read(4)
            chunk_data = f.read(length)
            crc = f.read(4)
            chunks.append((chunk_type, chunk_data, crc))
            if chunk_type == b"IEND":
                break
        return chunks


def parse_ihdr(data):
    """Parse IHDR chunk data."""
    width = struct.unpack(">I", data[0:4])[0]
    height = struct.unpack(">I", data[4:8])[0]
    bit_depth = data[8]
    color_type = data[9]
    return width, height, bit_depth, color_type


def decompress_idat(chunks):
    """Decompress all IDAT chunk data."""
    compressed = b""
    for chunk_type, chunk_data, _ in chunks:
        if chunk_type == b"IDAT":
            compressed += chunk_data
    return zlib.decompress(compressed)


def get_pixel_data(raw_data, width, height, bytes_per_pixel):
    """Reconstruct pixel data from filtered scanlines (filter type 0-4)."""
    stride = width * bytes_per_pixel
    pixels = bytearray(height * stride)
    previous_row = bytearray(stride)
    offset = 0

    for y in range(height):
        filter_type = raw_data[offset]
        offset += 1
        current_row = bytearray(raw_data[offset : offset + stride])
        offset += stride

        if filter_type == 1:  # Sub
            for i in range(stride):
                left = current_row[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
                current_row[i] = (current_row[i] + left) & 0xFF
        elif filter_type == 2:  # Up
            for i in range(stride):
                current_row[i] = (current_row[i] + previous_row[i]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(stride):
                left = current_row[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
                current_row[i] = (current_row[i] + (left + previous_row[i]) // 2) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                left = current_row[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
                up = previous_row[i]
                upper_left = (
                    previous_row[i - bytes_per_pixel] if i >= bytes_per_pixel else 0
                )
                current_row[i] = (current_row[i] + paeth_predictor(left, up, upper_left)) & 0xFF

        pixels[y * stride : (y + 1) * stride] = current_row
        previous_row = current_row

    return pixels


def paeth_predictor(a, b, c):
    """Paeth predictor function for PNG filtering."""
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    elif pb <= pc:
        return b
    return c


def find_content_bounds(pixels, width, height, bytes_per_pixel):
    """Find the bounding box of non-transparent pixels."""
    alpha_offset = 3 if bytes_per_pixel == 4 else -1

    if alpha_offset < 0:
        # No alpha channel — nothing to crop
        return 0, 0, width, height

    top = height
    bottom = 0
    left = width
    right = 0
    stride = width * bytes_per_pixel

    for y in range(height):
        for x in range(width):
            idx = y * stride + x * bytes_per_pixel + alpha_offset
            if pixels[idx] > 0:
                if y < top:
                    top = y
                if y > bottom:
                    bottom = y
                if x < left:
                    left = x
                if x > right:
                    right = x

    if top > bottom or left > right:
        return 0, 0, width, height

    return left, top, right + 1, bottom + 1


def create_cropped_png(pixels, src_width, bytes_per_pixel, left, top, right, bottom, chunks):
    """Create a new PNG with cropped pixel data."""
    crop_width = right - left
    crop_height = bottom - top
    src_stride = src_width * bytes_per_pixel
    new_stride = crop_width * bytes_per_pixel

    # Build raw scanlines with filter type 0 (None)
    raw_lines = bytearray()
    for y in range(top, bottom):
        raw_lines.append(0)  # filter type None
        src_offset = y * src_stride + left * bytes_per_pixel
        raw_lines.extend(pixels[src_offset : src_offset + new_stride])

    compressed = zlib.compress(bytes(raw_lines), 9)

    # Find original IHDR to get bit_depth and color_type
    ihdr_data = None
    for chunk_type, chunk_data, _ in chunks:
        if chunk_type == b"IHDR":
            ihdr_data = chunk_data
            break

    bit_depth = ihdr_data[8]
    color_type = ihdr_data[9]

    # Build new PNG
    output = bytearray(b"\x89PNG\r\n\x1a\n")

    def write_chunk(chunk_type, data):
        output.extend(struct.pack(">I", len(data)))
        output.extend(chunk_type)
        output.extend(data)
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        output.extend(struct.pack(">I", crc))

    # IHDR
    new_ihdr = struct.pack(">II", crop_width, crop_height) + bytes(
        [bit_depth, color_type, 0, 0, 0]
    )
    write_chunk(b"IHDR", new_ihdr)

    # Copy non-critical chunks (like sRGB, gAMA, etc.)
    for chunk_type, chunk_data, _ in chunks:
        if chunk_type in (b"sRGB", b"gAMA", b"cHRM", b"pHYs"):
            write_chunk(chunk_type, chunk_data)

    # IDAT
    write_chunk(b"IDAT", compressed)

    # IEND
    write_chunk(b"IEND", b"")

    return bytes(output), crop_width, crop_height


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.png> <output.png>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    chunks = read_png_chunks(input_path)

    # Parse IHDR
    ihdr_data = None
    for chunk_type, chunk_data, _ in chunks:
        if chunk_type == b"IHDR":
            ihdr_data = chunk_data
            break

    if not ihdr_data:
        print("Error: No IHDR chunk found")
        sys.exit(1)

    width, height, bit_depth, color_type = parse_ihdr(ihdr_data)

    if bit_depth != 8:
        print(f"Error: Only 8-bit depth supported, got {bit_depth}")
        sys.exit(1)

    if color_type == 6:
        bytes_per_pixel = 4  # RGBA
    elif color_type == 2:
        bytes_per_pixel = 3  # RGB (no alpha, skip crop)
        print(f"Warning: No alpha channel, copying as-is ({width}x{height})")
        import shutil
        shutil.copy2(input_path, output_path)
        return
    else:
        print(f"Error: Unsupported color type {color_type}")
        sys.exit(1)

    # Decompress pixel data
    raw_data = decompress_idat(chunks)
    pixels = get_pixel_data(raw_data, width, height, bytes_per_pixel)

    # Find content bounds
    left, top, right, bottom = find_content_bounds(
        pixels, width, height, bytes_per_pixel
    )

    crop_width = right - left
    crop_height = bottom - top

    if crop_width == width and crop_height == height:
        print(f"No transparent borders found ({width}x{height})")
        import shutil
        shutil.copy2(input_path, output_path)
        return

    # Create cropped PNG
    cropped_data, new_width, new_height = create_cropped_png(
        pixels, width, bytes_per_pixel, left, top, right, bottom, chunks
    )

    with open(output_path, "wb") as f:
        f.write(cropped_data)

    trimmed_pixels = (width * height) - (new_width * new_height)
    print(
        f"Cropped: {width}x{height} -> {new_width}x{new_height} "
        f"(removed {trimmed_pixels} transparent pixels)"
    )


if __name__ == "__main__":
    main()
