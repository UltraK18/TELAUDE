"""Scrub build-machine paths from compiled Bun exe.

Usage: python scrub-paths.py <exe_path>

Bun's --compile hardcodes __dirname as the build-time absolute path.
This replaces all occurrences of the build directory with a generic
placeholder of the same byte length, preserving binary integrity.
"""
import sys, os, re

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} <exe_path>")
    sys.exit(1)

exe_path = sys.argv[1]

with open(exe_path, "rb") as f:
    data = bytearray(f.read())

# Detect build dir: look for pattern like X:\...\node_modules
# Match drive letter path up to \node_modules or /node_modules
patterns_found = set()
for m in re.finditer(rb'[A-Z]:\\\\[^"\'\x00\n]+?\\\\node_modules', data):
    # Extract the base dir (everything before \node_modules)
    full = m.group()
    base = full.split(b"\\\\node_modules")[0]
    patterns_found.add(bytes(base))

for m in re.finditer(rb'[A-Z]:\\[^"\'\\x00\n]+?\\node_modules', data):
    full = m.group()
    base = full.split(b"\\node_modules")[0]
    if b"\\\\" not in base:  # single backslash variant
        patterns_found.add(bytes(base))

if not patterns_found:
    print("  No build paths found, skipping.")
    sys.exit(0)

total = 0
for pattern in sorted(patterns_found, key=len, reverse=True):
    # Replace with "." padded to same length
    replacement = b"." + b"\x00" * (len(pattern) - 1)
    count = data.count(pattern)
    if count > 0:
        data = data.replace(pattern, replacement)
        decoded = pattern.decode("utf-8", errors="replace")
        total += count
        print(f'  Scrubbed "{decoded}" ({count} occurrences)')

with open(exe_path, "wb") as f:
    f.write(data)

print(f"  Total: {total} path references removed")
