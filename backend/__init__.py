"""PDFZen local conversion backend.

A small package that ports the Stirling-PDF conversion-subsystem discipline to a
local FastAPI service: a single subprocess gateway (``process_executor``) with
per-tool concurrency limits, timeouts, tree-kill, and command validation; a
sandboxed LibreOffice CLI wrapper (``libreoffice``); binary-path resolution
(``runtime_paths``); and the per-format conversion functions (``converters``).
"""
