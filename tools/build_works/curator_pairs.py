"""Near-identical pairs from the curator's embeddings (index.db of the archive server), as [[qid, qid, cosine], ...].
Refresh: python tools/build_works/curator_pairs.py INDEX_DB [MIN_COSINE=0.985] > tools/build_works/curator-pairs.json
Pairs at or above MIN_COSINE are the same picture (the painter's own versions of a subject sit at 0.95 to 0.98, different
images), and two works whose archived JPEG has the same sha1 are listed with cosine 1. The build drops the lesser of a pair."""
import json, sqlite3, sys
import numpy as np

db, lo = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.985
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
rows = con.execute("select qid, emb from curator_emb order by qid").fetchall()
twins = {}
for qid, sha in con.execute("select qid, sha1 from works where status = 'archived' and sha1 is not null order by qid"):
    twins.setdefault(sha, []).append(qid)
q = [r[0] for r in rows]
e = np.stack([np.frombuffer(r[1], dtype=np.float16).astype(np.float32) for r in rows])
e /= np.linalg.norm(e, axis=1, keepdims=True)
s = e @ e.T
i, j = np.nonzero(np.triu(s, 1) >= lo)
pairs = {(q[a], q[b]): round(float(s[a, b]), 4) for a, b in zip(i, j)}
for g in twins.values():
    for k, a in enumerate(g):
        for b in g[k + 1:]:
            pairs[(a, b)] = 1.0
print(json.dumps(sorted(([a, b, c] for (a, b), c in pairs.items()), key=lambda p: (-p[2], p[0], p[1]))))
