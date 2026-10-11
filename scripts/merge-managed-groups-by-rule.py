#!/usr/bin/env python3
"""Fold managed-provider endpoint groups that hit the same endpoint_tags rule.

Mirrors handler.matchEndpointTag: a tag containing "*" is a case-insensitive
glob, a tag without "*" must equal the endpoint. One group per rule survives;
the survivor prefers the "/v1/..." endpoint so the existing naming suffix
(e.g. "_c") is kept, and the folded groups' model_sources / provider_ids are
unioned into it.

usage: merge-managed-groups-by-rule.py [--apply] [db-path]
"""

import json
import sqlite3
import sys

DB = "/Users/me/.hapiy/hapiy.db"


def match_endpoint_tag(endpoint: str, tag: str) -> bool:
    tag = tag.strip()
    if not tag:
        return False
    endpoint = endpoint.strip().lower()
    tag = tag.lower()
    if "*" not in tag:
        return endpoint == tag
    parts = tag.split("*")
    pos = 0
    for i, part in enumerate(parts):
        if not part:
            continue
        if i == 0:
            if not endpoint.startswith(part):
                return False
            pos += len(part)
            continue
        j = endpoint.find(part, pos)
        if j < 0:
            return False
        pos = j + len(part)
    last = parts[-1]
    return last == "" or endpoint.endswith(last)


def match_rule(endpoint: str, protocols):
    for i, p in enumerate(protocols):
        for tag in p.get("endpoint_tags") or []:
            if match_endpoint_tag(endpoint, tag):
                return i
    return -1


def main():
    apply = "--apply" in sys.argv
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    db_path = positional[0] if positional else DB
    conn = sqlite3.connect(db_path, timeout=15)
    conn.row_factory = sqlite3.Row

    protocols_by_type = {}
    for row in conn.execute("SELECT name, protocols FROM agent_type_rules"):
        raw = row["protocols"] or "[]"
        try:
            protocols_by_type[row["name"]] = json.loads(raw) or []
        except json.JSONDecodeError:
            protocols_by_type[row["name"]] = []

    files = {r["id"]: r["agent_type"] for r in conn.execute("SELECT id, agent_type FROM agent_config_files")}

    changed = 0
    for row in conn.execute("SELECT id, name, agent_config_file_id, groups FROM managed_agent_providers"):
        groups = json.loads(row["groups"] or "[]")
        protocols = protocols_by_type.get(files.get(row["agent_config_file_id"], ""), [])
        if not groups or not protocols:
            continue

        folded = []           # survivor groups, in first-seen order
        by_rule = {}          # rule index -> survivor dict
        for g in groups:
            ep = g.get("endpoint") or ""
            if ep == "__none__" or not ep:
                folded.append(dict(g))
                continue
            rule = match_rule(ep, protocols)
            if rule < 0:
                folded.append(dict(g))
                continue
            cur = by_rule.get(rule)
            if cur is None:
                cur = dict(g)
                cur["_hits"] = [ep]
                by_rule[rule] = cur
                folded.append(cur)
                continue
            # survivor prefers the /v1-prefixed endpoint (keeps "…/_c"-style suffixes)
            if ep.startswith("/v1/") and not (cur.get("endpoint") or "").startswith("/v1/"):
                keep, drop = dict(g), cur
                keep["_hits"] = drop["_hits"] + [ep]
                keep["model_sources"] = {**(drop.get("model_sources") or {}), **(keep.get("model_sources") or {})}
                keep["provider_ids"] = sorted(set((drop.get("provider_ids") or []) + (keep.get("provider_ids") or []))) or None
                if keep["provider_ids"] is None:
                    keep.pop("provider_ids", None)
                folded[folded.index(drop)] = keep
                by_rule[rule] = keep
                continue
            cur["_hits"].append(ep)
            merged = {**(g.get("model_sources") or {}), **(cur.get("model_sources") or {})}
            cur["model_sources"] = merged
            pids = sorted(set((cur.get("provider_ids") or []) + (g.get("provider_ids") or [])))
            if pids:
                cur["provider_ids"] = pids

        for g in folded:
            hits = g.pop("_hits", None)
            if hits and len(hits) > 1:
                g["hits"] = hits

        # hits 只用于本次打印：后端把 groups 解析成固定结构，写库时不留这个键。
        stored = [{k: v for k, v in g.items() if k != "hits"} for g in folded]
        if json.dumps(stored, ensure_ascii=False, sort_keys=True) == json.dumps(groups, ensure_ascii=False, sort_keys=True):
            continue

        changed += 1
        print(f"== {row['name']} ({files.get(row['agent_config_file_id'])}) ==")
        for g in folded:
            print("  ", g.get("endpoint"), "| suffix", g.get("suffix"), "| models", len(g.get("model_sources") or {}), "| hits", g.get("hits"))
        if apply:
            conn.execute(
                "UPDATE managed_agent_providers SET groups = ? WHERE id = ?",
                (json.dumps(stored, ensure_ascii=False), row["id"]),
            )

    if apply:
        conn.commit()
        print(f"applied to {changed} row(s)")
    else:
        conn.rollback()
        print(f"dry-run: {changed} row(s) would change (pass --apply to write)")


if __name__ == "__main__":
    main()
