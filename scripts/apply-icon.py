"""Replace exe icon using Windows UpdateResource API.

Usage: python apply-icon.py <exe_path> <ico_path>

Bun's --icon flag doesn't work properly (leaves Bun's default icon).
rcedit adds a second GROUP_ICON instead of replacing the original.
This script uses the Win32 API to delete all existing icon resources
and write fresh ones from the .ico file.
"""
import struct, sys, ctypes
from ctypes import wintypes

if len(sys.argv) != 3:
    print(f"Usage: {sys.argv[0]} <exe_path> <ico_path>")
    sys.exit(1)

exe_path, ico_path = sys.argv[1], sys.argv[2]

# Parse .ico
with open(ico_path, "rb") as f:
    ico = f.read()

_, _, ico_count = struct.unpack_from("<HHH", ico, 0)

images = []
for i in range(ico_count):
    off = 6 + i * 16
    w, h, cc, res, planes, bpp, size, data_off = struct.unpack_from("<BBBBHHII", ico, off)
    images.append((w, h, cc, res, planes, bpp, ico[data_off : data_off + size]))

# Win32 API setup
kernel32 = ctypes.windll.kernel32

BeginUpdateResourceW = kernel32.BeginUpdateResourceW
BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
BeginUpdateResourceW.restype = wintypes.HANDLE

UpdateResourceW = kernel32.UpdateResourceW
UpdateResourceW.argtypes = [
    wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR,
    wintypes.WORD, ctypes.c_void_p, wintypes.DWORD,
]
UpdateResourceW.restype = wintypes.BOOL

EndUpdateResourceW = kernel32.EndUpdateResourceW
EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
EndUpdateResourceW.restype = wintypes.BOOL

RT_ICON = 3
RT_GROUP_ICON = 14
MAKEINTRESOURCE = lambda x: ctypes.cast(x, wintypes.LPCWSTR)

# Delete ALL existing resources, then write ours
hUpdate = BeginUpdateResourceW(exe_path, True)
if not hUpdate:
    print(f"BeginUpdateResource failed: {ctypes.GetLastError()}")
    sys.exit(1)

# Write RT_ICON entries
for i, (w, h, cc, res, planes, bpp, data) in enumerate(images):
    icon_id = i + 1
    buf = ctypes.create_string_buffer(data)
    ok = UpdateResourceW(hUpdate, MAKEINTRESOURCE(RT_ICON), MAKEINTRESOURCE(icon_id), 0, buf, len(data))
    rw = w or 256
    print(f"  icon {icon_id} ({rw}x{rw}): {'ok' if ok else 'FAIL'}")

# Write RT_GROUP_ICON
grp = struct.pack("<HHH", 0, 1, ico_count)
for i, (w, h, cc, res, planes, bpp, data) in enumerate(images):
    grp += struct.pack("<BBBBHHIH", w, h, cc, res, planes, bpp, len(data), i + 1)

buf = ctypes.create_string_buffer(grp)
ok = UpdateResourceW(hUpdate, MAKEINTRESOURCE(RT_GROUP_ICON), MAKEINTRESOURCE(1), 0, buf, len(grp))
print(f"  group: {'ok' if ok else 'FAIL'}")

ok = EndUpdateResourceW(hUpdate, False)
if not ok:
    print(f"EndUpdateResource failed: {ctypes.GetLastError()}")
    sys.exit(1)

print(f"Icon applied: {ico_count} images -> {exe_path}")
