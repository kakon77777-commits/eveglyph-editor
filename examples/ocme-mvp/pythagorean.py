"""OCME MVP 的畢達哥拉斯定理計算伴隨。

此程式提供有限數值檢查與整數畢氏三元組搜尋，不構成普遍證明。
"""
from __future__ import annotations

import json
from math import isclose, sqrt


def is_right_triangle(a: float, b: float, c: float, *, tol: float = 1e-12) -> bool:
    if min(a, b, c) <= 0:
        return False
    x, y, hyp = sorted((a, b, c))
    return isclose(x * x + y * y, hyp * hyp, rel_tol=tol, abs_tol=tol)


def integer_triples(limit: int):
    if limit < 1:
        raise ValueError("limit must be positive")
    for a in range(1, limit + 1):
        for b in range(a, limit + 1):
            c = int(sqrt(a * a + b * b))
            if c <= limit and a * a + b * b == c * c:
                yield (a, b, c)


def main() -> None:
    limit = 200
    triples = list(integer_triples(limit))
    checks = {
        "3-4-5": is_right_triangle(3, 4, 5),
        "5-12-13": is_right_triangle(5, 12, 13),
        "2-3-4_rejected": not is_right_triangle(2, 3, 4),
        "all_generated_exact": all(a * a + b * b == c * c for a, b, c in triples),
    }
    print(json.dumps({
        "object_id": "mko-euclid-pythagorean-theorem",
        "method": "finite_integer_enumeration",
        "limit": limit,
        "triple_count": len(triples),
        "sample": triples[:12],
        "checks": checks,
        "status": "passed" if all(checks.values()) else "failed",
        "warning": "Finite computation is not a universal mathematical proof."
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
