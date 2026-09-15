"""
M9 - BFS 进合成 Implementation (GREEN 阶段)

借鉴 Devix §4.1 - 用 BFS 并行探索多条假设路径，合成最终结论。

设计：
- HypothesisNode: 单个假设节点（id/description/score/evidence）
- BFSScheduler: BFS 调度器（add_hypothesis → explore → synthesize）
- SynthesisResult: 合成结果（best_hypothesis_id / combined_evidence / confidence）

只做测试要求的功能：
- 并行探索（asyncio.gather）
- best_of / top_k / synthesize
- max_depth 配置
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Awaitable, Callable


@dataclass
class HypothesisNode:
    """单个假设节点"""
    id: str
    description: str
    score: float = 0.0
    evidence: list[str] = field(default_factory=list)


@dataclass
class SynthesisResult:
    """BFS 合成结果"""
    best_hypothesis_id: str
    best_hypothesis_description: str
    combined_evidence: list[str]
    confidence: float
    top_hypotheses: list[HypothesisNode]


class BFSScheduler:
    """BFS 调度器

    用法：
        scheduler = BFSScheduler(max_depth=3)
        scheduler.add_hypothesis(HypothesisNode(...))
        results = await scheduler.explore(check_fn)
        final = scheduler.synthesize(results)
    """

    def __init__(self, max_depth: int = 3) -> None:
        self.max_depth = max_depth
        self._hypotheses: list[HypothesisNode] = []

    def add_hypothesis(self, hyp: HypothesisNode) -> None:
        self._hypotheses.append(hyp)

    async def explore(
        self,
        check_fn: Callable[[HypothesisNode], Awaitable[HypothesisNode]],
    ) -> list[HypothesisNode]:
        """并行探索所有假设

        check_fn: 用户传入的检查函数（接收假设，返回更新后的假设）
        """
        if not self._hypotheses:
            return []
        # asyncio.gather 实现真正并行
        results = await asyncio.gather(
            *[check_fn(hyp) for hyp in self._hypotheses]
        )
        return list(results)

    def best_of(self, results: list[HypothesisNode]) -> HypothesisNode:
        """返回评分最高的假设"""
        if not results:
            raise ValueError("No hypotheses to evaluate")
        return max(results, key=lambda h: h.score)

    def top_k(
        self,
        results: list[HypothesisNode],
        k: int = 3,
    ) -> list[HypothesisNode]:
        """返回 top k 个假设，按评分降序"""
        sorted_results = sorted(results, key=lambda h: h.score, reverse=True)
        return sorted_results[:k]

    def synthesize(
        self,
        results: list[HypothesisNode],
        top_n: int = 3,
    ) -> SynthesisResult:
        """合成最终结论

        1. 选 top_n 个假设
        2. 合并它们的 evidence（去重）
        3. confidence = top 假设的 score（加权）
        """
        top = self.top_k(results, k=top_n)
        if not top:
            raise ValueError("No results to synthesize")

        # 合并证据（去重，保留顺序）
        seen = set()
        combined_evidence = []
        for h in top:
            for e in h.evidence:
                if e not in seen:
                    seen.add(e)
                    combined_evidence.append(e)

        # confidence = 最佳 score × top 假设平均分的加权和
        best_score = top[0].score
        avg_top_score = sum(h.score for h in top) / len(top)
        confidence = best_score * 0.7 + avg_top_score * 0.3

        return SynthesisResult(
            best_hypothesis_id=top[0].id,
            best_hypothesis_description=top[0].description,
            combined_evidence=combined_evidence,
            confidence=confidence,
            top_hypotheses=top,
        )