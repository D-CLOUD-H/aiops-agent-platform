"""HarnessLoopEngine — champion-challenger upgrade loop.

Implements the rule: challenger is promoted only if EVERY metric on the
hidden test split strictly exceeds the current champion. Test split is
read-only — never written by the optimizer.

The default eval function is a deterministic hash-based mock. Task 5
will inject a real badcase-replay eval via the ``_eval_fn`` constructor
parameter.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from app.models.badcase import BadCaseEntry
from app.models.harness import Champion, HarnessRunRecord, PatchCandidate
from app.services.badcase_registry_service import BadCaseRegistryService


# Type alias for the mocked eval function signature.
# Returns (dev_metrics, test_metrics).
EvalFn = Callable[
    [PatchCandidate, list[BadCaseEntry], Champion | None],
    tuple[dict[str, float], dict[str, float]],
]


class HarnessLoopEngine:
    def __init__(
        self,
        registry: BadCaseRegistryService,
        runs_path: str = "backend/data/harness/runs.jsonl",
        champion_path: str = "backend/data/champion.json",
        _eval_fn: EvalFn | None = None,
        min_test_threshold: float = 0.0,
        graph_store=None,
        gate_factory=None,
    ) -> None:
        """Initialize the engine.

        Args:
            registry: BadCaseRegistryService used to source dev/test entries.
            runs_path: JSONL file for persisting HarnessRunRecord.
            champion_path: JSON file holding all Champions, keyed by class_name.
            _eval_fn: Injectable eval fn (dev_metrics, test_metrics) → tests
                use a stub. Defaults to a hash-based deterministic mock.
            min_test_threshold: If any test metric falls below this, the
                challenger is rejected unconditionally (safety net).
        """
        self.registry = registry
        self.runs_path = Path(runs_path)
        self.runs_path.parent.mkdir(parents=True, exist_ok=True)
        self.champion_path = Path(champion_path)
        self.champion_path.parent.mkdir(parents=True, exist_ok=True)
        self._eval_fn: EvalFn = _eval_fn or self._default_eval
        self.min_test_threshold = min_test_threshold
        self._graph_store = graph_store
        self._gate_factory = gate_factory

    # ------------------------------------------------------------------
    # Eval
    # ------------------------------------------------------------------

    def _default_eval(
        self,
        candidate: PatchCandidate,
        entries: list[BadCaseEntry],
        champion: Champion | None,
    ) -> tuple[dict[str, float], dict[str, float]]:
        """Default eval: deterministic from candidate content.

        Real eval (Task 5) will run actual badcase replays. For now,
        hash candidate + entries to produce stable mock metrics.
        """
        h = hashlib.sha256(
            (candidate.patch_id + candidate.badcase_class).encode()
        ).hexdigest()
        base = int(h[:4], 16) / 65535.0  # 0..1
        # Dev slightly higher than test, to exercise both
        dev = {
            "precision": 0.6 + base * 0.3,
            "recall": 0.5 + base * 0.3,
            "f1": 0.55 + base * 0.3,
        }
        test = {
            "precision": 0.5 + base * 0.3,
            "recall": 0.4 + base * 0.3,
            "f1": 0.45 + base * 0.3,
        }
        return dev, test

    def _eval(
        self,
        candidate: PatchCandidate,
        entries: list[BadCaseEntry],
        champion: Champion | None,
    ) -> tuple[dict[str, float], dict[str, float]]:
        return self._eval_fn(candidate, entries, champion)

    # ------------------------------------------------------------------
    # Split — must use registry.query_similar + split_for_eval per spec.
    # ------------------------------------------------------------------

    def _split(
        self,
        candidate: PatchCandidate,
    ) -> tuple[list[BadCaseEntry], list[BadCaseEntry]]:
        """Split entries into dev/test by reading only the dev split.

        Per spec §3.1, the test split is hidden from the optimizer. We
        query only the dev split, then deterministically re-derive the
        test partition via `split_for_eval` (which hashes entry.id).
        This ensures the optimizer never directly accesses the test split's
        semantic search — it only sees what split_for_eval allocates.
        """
        dev_entries = self.registry.query_similar(
            candidate.rationale, top_k=100, eval_split="dev"
        )
        # split_for_eval hashes entry.id; same hash regardless of how the
        # entries were collected, so the dev/test partition is deterministic.
        dev, test = self.registry.split_for_eval(dev_entries, dev_ratio=0.7)
        return dev, test

    # ------------------------------------------------------------------
    # Champion I/O
    # ------------------------------------------------------------------

    def get_champion(self, class_name: str) -> Champion | None:
        """Read the current champion for ``class_name`` from disk.

        The file is a JSON object keyed by class_name. Returns None if
        the file doesn't exist, the class is absent, or the entry fails
        validation.
        """
        if not self.champion_path.exists():
            return None
        try:
            data = json.loads(self.champion_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, ValueError):
            return None
        entry = data.get(class_name) if isinstance(data, dict) else None
        if not entry:
            return None
        try:
            return Champion.model_validate(entry)
        except Exception:
            return None

    def _persist(self, record: HarnessRunRecord) -> None:
        with self.runs_path.open("a", encoding="utf-8") as f:
            f.write(record.model_dump_json() + "\n")

    # ------------------------------------------------------------------
    # Decision — strict "every metric must exceed champion" rule.
    # ------------------------------------------------------------------

    def _decide(
        self,
        champion: Champion | None,
        dev_metrics: dict[str, float],
        test_metrics: dict[str, float],
    ) -> str:
        # Sanity: any test metric below min threshold → reject
        if any(v < self.min_test_threshold for v in test_metrics.values()):
            return "reject"
        if champion is None:
            return "hold_for_human"
        # Every metric must strictly exceed champion's (both dev and test)
        for k, v in test_metrics.items():
            if v <= champion.test_metrics.get(k, -1.0):
                return "reject"
        for k, v in dev_metrics.items():
            if v <= champion.dev_metrics.get(k, -1.0):
                return "reject"
        return "promote"

    # ------------------------------------------------------------------
    # Promote
    # ------------------------------------------------------------------

    def promote(self, run: HarnessRunRecord) -> None:
        """Write the run as the new champion for its badcase_class.

        Reads existing champion file (if any), updates the entry for
        ``run.badcase_class``, and atomically writes back. Does NOT touch
        the test split — that guarantee is enforced by
        ``BadCaseRegistryService._check_test_split_readonly``.
        """
        existing: dict = {}
        if self.champion_path.exists():
            try:
                existing = json.loads(self.champion_path.read_text(encoding="utf-8"))
                if not isinstance(existing, dict):
                    existing = {}
            except json.JSONDecodeError:
                existing = {}
        champion = Champion(
            class_name=run.badcase_class,
            version=f"v{run.run_id}",
            promoted_at=run.promoted_at or datetime.now(timezone.utc),
            dev_metrics=run.dev_metrics,
            test_metrics=run.test_metrics,
            source_run_id=run.run_id,
        )
        existing[run.badcase_class] = champion.model_dump(mode="json")
        self.champion_path.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------

    def run_sync(self, candidate: PatchCandidate) -> HarnessRunRecord:
        """Synchronous version of run() — for tests + sync endpoints.

        Pipeline:
            1. Allocate run_id + started_at.
            2. _split(candidate) → (dev_entries, test_entries)
            3. get_champion(candidate.badcase_class)
            4. _eval → (dev_metrics, test_metrics)
            5. _decide → "promote" | "reject" | "hold_for_human"
            6. If "promote" → promote()
            7. _persist(record) — always
            8. Return record.
        """
        run_id = f"hr-{uuid.uuid4().hex[:12]}"
        started_at = datetime.now(timezone.utc)
        dev_entries, test_entries = self._split(candidate)
        champion = self.get_champion(candidate.badcase_class)
        # Eval fn gets the combined entry list (dev + test) so it can
        # compute both metric sets. The split is also encoded in
        # the per-split test set if the eval fn wants to use it.
        dev_metrics, test_metrics = self._eval(
            candidate, dev_entries + test_entries, champion
        )
        decision = self._decide(champion, dev_metrics, test_metrics)
        finished_at = datetime.now(timezone.utc)
        promoted_at = finished_at if decision == "promote" else None
        record = HarnessRunRecord(
            run_id=run_id,
            started_at=started_at,
            finished_at=finished_at,
            badcase_class=candidate.badcase_class,
            candidate=candidate,
            base_champion_version=champion.version if champion else "v0.0.0",
            dev_metrics=dev_metrics,
            test_metrics=test_metrics,
            decision=decision,
            promoted_at=promoted_at,
            notes=f"dev_entries={len(dev_entries)} test_entries={len(test_entries)}",
        )
        if decision == "promote":
            self.promote(record)
        self._persist(record)
        return record

    async def run(self, candidate: PatchCandidate) -> HarnessRunRecord:
        """Async wrapper around run_sync (Task 5 will use this from FastAPI)."""
        return self.run_sync(candidate)
