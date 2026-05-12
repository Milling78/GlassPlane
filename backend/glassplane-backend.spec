# glassplane-backend.spec
# Run with: pyinstaller glassplane-backend.spec

import sys
from pathlib import Path

block_cipher = None
root = Path(SPECPATH)

a = Analysis(
    [str(root / 'main.py')],
    pathex=[str(root)],
    binaries=[],
    datas=[
        # Include .env.example so first-run can copy it
        ('.env.example', '.'),
    ],
    hiddenimports=[
        # pyVmomi dynamic imports
        'pyVmomi',
        'pyVim',
        'pyVim.connect',
        'pyVmomi.VmomiSupport',
        # Pydantic
        'pydantic',
        'pydantic_core',
        'pydantic_settings',
        # FastAPI / uvicorn internals
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'starlette',
        'anyio',
        'anyio._backends._asyncio',
        # httpx / networking
        'httpx',
        'certifi',
        # SSH (paramiko) for Aruba direct connector
        'paramiko',
        'paramiko.transport',
        'paramiko.auth_handler',
        'paramiko.channel',
        'cryptography',
        'cryptography.hazmat.primitives',
        # cachetools
        'cachetools',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'pandas', 'PIL'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

_icon = str(root.parent / 'build-resources' / 'icon.ico')

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='glassplane-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # no terminal window — Electron captures stdout/stderr via pipes
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=_icon if Path(_icon).exists() else None,
)
