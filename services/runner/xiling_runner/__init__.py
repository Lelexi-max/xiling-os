"""Isolated scientific execution primitives for Xi Ling OS.

Heavy scientific libraries are imported only when their capability is selected.
This keeps connector planning and diagnostics lightweight.
"""

# xarray scans installed backend entry points during open_dataset(). Argopy 1.4
# imports this erddapy 3.3 compatibility symbol even when Argo was not selected.
import erddapy.erddapy as _legacy_erddapy
if not hasattr(_legacy_erddapy, "_quote_string_constraints"):
    from erddapy.core.url import _quote_string_constraints as _quote_constraints
    _legacy_erddapy._quote_string_constraints = _quote_constraints

__all__ = [
    "create_fixture",
    "run_analysis",
    "create_argo_fixture",
    "inspect_argo_dataset",
    "run_argo_analysis",
]


def __getattr__(name: str):
    if name in {"create_fixture", "run_analysis"}:
        from . import analysis
        return getattr(analysis, name)
    if name in {"create_argo_fixture", "inspect_argo_dataset", "run_argo_analysis"}:
        from . import argo
        return getattr(argo, name)
    raise AttributeError(name)
