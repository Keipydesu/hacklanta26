def evidence_source(sources):
    """One origin maps to itself; any mixture is "mixed" (original provenance is never relabelled)."""
    unique = set(sources)
    return next(iter(unique)) if len(unique) == 1 else 'mixed'
