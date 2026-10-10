import os
from pathlib import Path

CONTRACTS = Path(os.getenv('CONTRACTS_DIR', Path(__file__).resolve().parents[3] / 'contracts'))
